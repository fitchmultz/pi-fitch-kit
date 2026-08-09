#!/usr/bin/env node
/**
 * Red/green regression for the edge "request buffer limit" stall.
 *
 * Cloudflare-fronted provider backends occasionally answer with the body
 * "exceeded request buffer limit while retrying upstream" when the edge's own
 * upstream retry cannot replay a large request body. Pi's session-level
 * auto-retry classifies errors with an allowlist, so this text failed fast:
 * the turn ended and the session stalled even though an identical follow-up
 * request succeeds (captured live on 2026-08-09, provider openai-codex, empty
 * content and zero usage on the failed attempt).
 *
 * This harness provisions archived and current Pi installs, drives their real
 * `pi --mode rpc` binaries against local model servers, and directly probes
 * the bundled Responses stream. It also covers the TARS-original resilience
 * patch adopted in v0.7.0: archived v0.6.0 stays red for the exact generic
 * assistant error and lacks stream diagnostics; current captures HTTP and
 * response.failed metadata, then the real RPC binary recovers from a transient
 * response.failed event and stops honestly when it persists. response.failed
 * with code server_error was already retryable through the older server-error
 * pattern; that e2e leg proves the parser, metadata, and bounded lifecycle, not
 * causality from the new exact generic-error pattern.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const PATCH_EXECUTABLE = "/usr/bin/patch";
const EDGE_ERROR = "exceeded request buffer limit while retrying upstream";
const stockRoot = join(projectRoot, "node_modules/@earendil-works/pi-coding-agent");
const currentPatch = join(projectRoot, "patches/pi-0.84.1-compaction.patch");
const bufferLegacyPatch = join(
	projectRoot,
	"patches/archive/pi-0.84.1-compaction-v0.5.0.patch",
);
const responsesLegacyPatch = join(
	projectRoot,
	"patches/archive/pi-0.84.1-compaction-v0.6.0.patch",
);
const GENERIC_OPENAI_ERROR = "Sorry, something went wrong.";

const cleanups = [];
process.on("exit", () => {
	for (const cleanup of cleanups) {
		try {
			cleanup();
		} catch {
			// Best-effort teardown.
		}
	}
});

function scenarioRoot(label) {
	const root = mkdtempSync(join(tmpdir(), `pi-kit-retry-${label}-`));
	cleanups.push(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function provisionPi(patchPath, label) {
	const piRoot = join(scenarioRoot(`${label}-pi`), "pi");
	cpSync(stockRoot, piRoot, { recursive: true });
	const result = spawnSync(
		PATCH_EXECUTABLE,
		["--batch", "--forward", "--no-backup-if-mismatch", "--reject-file=-", "-p1", "-d", piRoot],
		{ encoding: "utf8", input: readFileSync(patchPath) },
	);
	assert.equal(result.status, 0, `${label}: patch failed\n${result.stdout}\n${result.stderr}`);
	return piRoot;
}

function serve(handle) {
	let hits = 0;
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => handle(++hits, res));
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve({
				port: server.address().port,
				requestCount: () => hits,
				close: () => server.close(),
			});
		});
	});
}

function startCompletionsServer(mode) {
	return serve((hits, res) => {
			const failing = mode === "always-fail" || (mode === "fail-once" && hits === 1);
			if (failing) {
				res.writeHead(400, { "content-type": "text/plain" });
				res.end(EDGE_ERROR);
				return;
			}
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
			});
			const chunks = [
				{
					id: `ok-${hits}`,
					model: "dogfood-model",
					choices: [{ index: 0, delta: { content: "recovered" }, finish_reason: null }],
				},
				{
					id: `ok-${hits}`,
					model: "dogfood-model",
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
				},
			];
		for (const chunk of chunks) {
			res.write(`data: ${JSON.stringify(chunk)}\n\n`);
		}
		res.end("data: [DONE]\n\n");
	});
}

function startResponsesServer(mode) {
	return serve((hits, res) => {
			if (mode === "http-error") {
				res.writeHead(500, {
					"content-type": "application/json",
					"x-request-id": `req-${hits}`,
				});
				res.end(
					JSON.stringify({
						error: { message: GENERIC_OPENAI_ERROR, type: "server_error", code: "server_error" },
					}),
				);
				return;
			}
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				"x-request-id": `req-${hits}`,
			});
			const send = (type, payload) => {
				res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
			};
			const failing = mode === "always-fail" || (mode === "fail-once" && hits === 1);
			if (failing) {
				send("response.failed", {
					type: "response.failed",
					sequence_number: 1,
					response: {
						id: `resp-failed-${hits}`,
						status: "failed",
						error: { code: "server_error", message: GENERIC_OPENAI_ERROR },
					},
				});
				res.end();
				return;
			}
		const item = {
			id: `msg-${hits}`,
			type: "message",
			content: [{ type: "output_text", text: "recovered" }],
		};
		send("response.output_item.done", {
			type: "response.output_item.done",
			output_index: 0,
			item,
		});
		send("response.completed", {
			type: "response.completed",
			response: {
				id: `resp-${hits}`,
				status: "completed",
				output: [item],
				usage: { input_tokens: 10, output_tokens: 2 },
			},
		});
		res.end();
	});
}

const importPiAi = (piRoot, relativePath) =>
	import(
		pathToFileURL(
			join(piRoot, "node_modules/@earendil-works/pi-ai/dist", relativePath),
		).href
	);

async function retryClassifier(piRoot) {
	const module = await importPiAi(piRoot, "utils/retry.js");
	return module.isRetryableAssistantError;
}

async function streamOneFailure(piRoot, port) {
	const module = await importPiAi(piRoot, "api/openai-responses.js");
	const model = {
		id: "dogfood-model",
		name: "Dogfood Model",
		api: "openai-responses",
		provider: "dogfood",
		baseUrl: `http://127.0.0.1:${port}/v1`,
		reasoning: false,
		input: ["text"],
		contextWindow: 20000,
		maxTokens: 2000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
	const events = module.stream(
		model,
		{ messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
		{ apiKey: "test", maxRetries: 0 },
	);
	let failure;
	for await (const event of events) {
		if (event.type === "error") failure = event.error;
	}
	assert.ok(failure, "Responses stream must surface the response.failed event");
	return failure;
}

function provisionAgentDir(root, port, api) {
	const agentDir = join(root, "agent");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				dogfood: {
					baseUrl: `http://127.0.0.1:${port}/v1`,
					api,
					apiKey: "test",
					compat: {
						supportsDeveloperRole: false,
						supportsReasoningEffort: false,
						supportsFinishReason: true,
						supportsUsageInStreaming: true,
					},
					models: [
						{
							id: "dogfood-model",
							name: "Dogfood Model",
							reasoning: false,
							input: ["text"],
							contextWindow: 20000,
							maxTokens: 2000,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						},
					],
				},
			},
		}),
	);
	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({
			quietStartup: true,
			retry: { enabled: true, maxRetries: 2, baseDelayMs: 50 },
			compaction: { enabled: false },
		}),
	);
	return agentDir;
}

const TURN_TIMEOUT_MS = 60_000;

function runTurn({ piRoot, root, port, api = "openai-completions" }) {
	const agentDir = provisionAgentDir(root, port, api);
	const sessionDir = join(root, "sessions");
	mkdirSync(sessionDir, { recursive: true });
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[
				join(piRoot, "dist/cli.js"),
				"--mode",
				"rpc",
				"--provider",
				"dogfood",
				"--model",
				"dogfood-model",
				"--session-dir",
				sessionDir,
			],
			{
				env: {
					HOME: root,
					PATH: process.env.PATH ?? "",
					PI_CODING_AGENT_DIR: agentDir,
				},
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		const events = [];
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timer = setTimeout(() => {
			finish(new Error(`turn did not settle within ${TURN_TIMEOUT_MS}ms\nstderr: ${stderr}`));
		}, TURN_TIMEOUT_MS);
		function finish(error) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.kill("SIGKILL");
			if (error) {
				reject(error);
			} else {
				resolve({ events });
			}
		}
		child.on("error", finish);
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			let newline = stdout.indexOf("\n");
			while (newline >= 0) {
				const line = stdout.slice(0, newline).trim();
				stdout = stdout.slice(newline + 1);
				newline = stdout.indexOf("\n");
				if (!line) continue;
				let event;
				try {
					event = JSON.parse(line);
				} catch {
					continue;
				}
				events.push(event);
				if (event.type === "agent_settled") {
					// Allow trailing events (auto_retry_end arrives with the final
					// message) to flush before tearing the process down.
					setTimeout(() => finish(), 250);
				}
			}
		});
		child.stdin.write(`${JSON.stringify({ id: "turn-1", type: "prompt", message: "hello" })}\n`);
	});
}

function summarize(events) {
	const retryStarts = events.filter((event) => event.type === "auto_retry_start");
	const retryEnds = events.filter((event) => event.type === "auto_retry_end");
	const assistantEnds = events.filter(
		(event) => event.type === "message_end" && event.message?.role === "assistant",
	);
	const finalAssistant = assistantEnds.at(-1)?.message;
	return { retryStarts, retryEnds, finalAssistant };
}

// Scenario 1 (permanent red): the legacy patch must stall on the transient
// edge error without retrying, proving the scenario reproduces the defect.
{
	const piRoot = provisionPi(bufferLegacyPatch, "legacy");
	const root = scenarioRoot("legacy");
	const server = await startCompletionsServer("fail-once");
	const { events } = await runTurn({ piRoot, root, port: server.port });
	const { retryStarts, finalAssistant } = summarize(events);
	assert.equal(retryStarts.length, 0, "legacy patch must not classify the edge error as retryable");
	assert.equal(server.requestCount(), 1, "legacy patch must fail fast after one upstream request");
	assert.equal(finalAssistant?.stopReason, "error");
	assert.match(finalAssistant?.errorMessage ?? "", /request buffer limit/);
	server.close();
	console.log("legacy patch: stall reproduced (1 request, no retry, turn error)");
}

// Scenarios 2 and 3 share one patched install; runs never mutate it (HOME,
// agent dir, and session dir live under each scenario's own root).
const currentPiRoot = provisionPi(currentPatch, "current");
const responsesLegacyPiRoot = provisionPi(responsesLegacyPatch, "responses-legacy");

// v0.7.0 classifier red/green: archived v0.6.0 must stay false for the exact
// generic assistant error; current must classify only the exact optional-dot
// shape adopted from TARS (extra detail remains non-retryable).
{
	const legacyClassifier = await retryClassifier(responsesLegacyPiRoot);
	const currentClassifier = await retryClassifier(currentPiRoot);
	const message = { stopReason: "error", errorMessage: GENERIC_OPENAI_ERROR };
	assert.equal(legacyClassifier(message), false, "v0.6.0 must preserve the generic-error red proof");
	assert.equal(currentClassifier(message), true, "current must classify the exact generic error");
	assert.equal(
		currentClassifier({ ...message, errorMessage: GENERIC_OPENAI_ERROR.slice(0, -1) }),
		true,
		"the optional final period must stay optional",
	);
	assert.equal(
		currentClassifier({ ...message, errorMessage: `${GENERIC_OPENAI_ERROR} Extra detail.` }),
		false,
		"the generic retry classification must stay narrow",
	);
}

// v0.7.0 stream diagnostics red/green: response.failed without a prior
// response.created event had no metadata or response ID in v0.6.0. Current
// preserves HTTP/request diagnostics plus terminal response status, ID, and
// provider error code. The shared processor is also used by Codex Responses;
// HTTP-level metadata here is specific to the vanilla Responses adapter.
{
	const legacyServer = await startResponsesServer("always-fail");
	const legacyFailure = await streamOneFailure(responsesLegacyPiRoot, legacyServer.port);
	assert.equal(legacyFailure.providerMetadata, undefined);
	assert.equal(legacyFailure.responseId, undefined);
	legacyServer.close();

	const currentServer = await startResponsesServer("always-fail");
	const currentFailure = await streamOneFailure(currentPiRoot, currentServer.port);
	assert.deepEqual(currentFailure.providerMetadata, {
		httpStatus: 200,
		requestId: "req-1",
		status: "failed",
		code: "server_error",
	});
	assert.equal(currentFailure.responseId, "resp-failed-1");
	currentServer.close();

	const httpErrorServer = await startResponsesServer("http-error");
	const httpFailure = await streamOneFailure(currentPiRoot, httpErrorServer.port);
	assert.deepEqual(
		httpFailure.providerMetadata,
		{ httpStatus: 500, code: "server_error", requestId: "req-1" },
		"OpenAI APIError.requestID must survive an HTTP failure",
	);
	httpErrorServer.close();
}

// Scenario 2 (green): the current patch must classify the edge error as
// transient, retry once with the native bounded machinery, and recover.
{
	const root = scenarioRoot("current");
	const server = await startCompletionsServer("fail-once");
	const { events } = await runTurn({ piRoot: currentPiRoot, root, port: server.port });
	const { retryStarts, retryEnds, finalAssistant } = summarize(events);
	assert.equal(retryStarts.length, 1, "current patch must schedule exactly one retry");
	assert.equal(retryStarts[0]?.attempt, 1);
	assert.match(retryStarts[0]?.errorMessage ?? "", /request buffer limit/);
	assert.equal(server.requestCount(), 2, "recovery must re-send the request exactly once");
	assert.equal(finalAssistant?.stopReason, "stop");
	assert.match(JSON.stringify(finalAssistant?.content ?? []), /recovered/);
	assert.equal(retryEnds.at(-1)?.success, true);
	server.close();
	console.log("current patch: recovered via one bounded retry (2 requests, success)");
}

// Scenario 3 (honest exhaustion): when the edge error persists, the current
// patch must stop after the configured budget and surface the provider error.
{
	const root = scenarioRoot("exhaust");
	const server = await startCompletionsServer("always-fail");
	const { events } = await runTurn({ piRoot: currentPiRoot, root, port: server.port });
	const { retryStarts, retryEnds, finalAssistant } = summarize(events);
	assert.equal(retryStarts.length, 2, "retry budget (maxRetries=2) must bound the attempts");
	assert.deepEqual(
		retryStarts.map((event) => event.attempt),
		[1, 2],
	);
	assert.equal(server.requestCount(), 3, "one initial request plus two bounded retries");
	assert.equal(finalAssistant?.stopReason, "error");
	assert.match(finalAssistant?.errorMessage ?? "", /request buffer limit/);
	assert.equal(retryEnds.at(-1)?.success, false);
	server.close();
	console.log("current patch: bounded exhaustion surfaced honestly (3 requests, final error)");
}

// Responses scenario 4: a transient response.failed event must travel through
// the real parser and Agent retry lifecycle, retain diagnostics, and recover on
// one bounded retry. Its server_error code was already retryable before v0.7.0;
// this leg proves the adopted Responses path and lifecycle, not classifier
// causality from the new exact generic-error pattern.
{
	const root = scenarioRoot("responses-current");
	const server = await startResponsesServer("fail-once");
	const { events } = await runTurn({
		piRoot: currentPiRoot,
		root,
		port: server.port,
		api: "openai-responses",
	});
	const { retryStarts, retryEnds, finalAssistant } = summarize(events);
	assert.equal(retryStarts.length, 1, "response.failed must schedule exactly one retry");
	assert.match(retryStarts[0]?.errorMessage ?? "", /server_error: Sorry, something went wrong/);
	assert.equal(server.requestCount(), 2, "Responses recovery must re-send exactly once");
	assert.equal(finalAssistant?.stopReason, "stop");
	assert.match(JSON.stringify(finalAssistant?.content ?? []), /recovered/);
	assert.deepEqual(finalAssistant?.providerMetadata, {
		httpStatus: 200,
		requestId: "req-2",
		status: "completed",
	});
	assert.equal(retryEnds.at(-1)?.success, true);
	server.close();
	console.log("Responses current patch: recovered via one bounded retry with diagnostics");
}

// Responses scenario 5: persistent response.failed events must stop at the
// configured budget and surface both the provider error and final-attempt
// diagnostics honestly.
{
	const root = scenarioRoot("responses-exhaust");
	const server = await startResponsesServer("always-fail");
	const { events } = await runTurn({
		piRoot: currentPiRoot,
		root,
		port: server.port,
		api: "openai-responses",
	});
	const { retryStarts, retryEnds, finalAssistant } = summarize(events);
	assert.equal(retryStarts.length, 2, "Responses retries must stop at maxRetries=2");
	assert.equal(server.requestCount(), 3, "Responses exhaustion must stop after three attempts");
	assert.equal(finalAssistant?.stopReason, "error");
	assert.match(finalAssistant?.errorMessage ?? "", /server_error: Sorry, something went wrong/);
	assert.deepEqual(finalAssistant?.providerMetadata, {
		httpStatus: 200,
		requestId: "req-3",
		status: "failed",
		code: "server_error",
	});
	assert.equal(finalAssistant?.responseId, "resp-failed-3");
	assert.equal(retryEnds.at(-1)?.success, false);
	server.close();
	console.log("Responses current patch: bounded exhaustion surfaced with diagnostics");
}

console.log("pi core retry and OpenAI Responses resilience regression passed");
// Fixture teardown is registered on the exit event; leave nothing implicit
// keeping the loop alive (killed children release stdio asynchronously).
process.exit(0);
