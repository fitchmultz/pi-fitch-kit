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
 * This regression provisions two runnable Pi installs from the kit's own
 * dependency and drives the real `pi --mode rpc` binary against a local
 * openai-completions HTTP server:
 *   - legacy (archived v0.5.0 patch): the transient scenario MUST still stall
 *     with exactly one upstream request — the permanent red proof that the
 *     scenario reproduces the defect.
 *   - current (patches/pi-0.84.1-compaction.patch): the same scenario MUST
 *     auto-retry once and recover, and the always-failing scenario MUST stop
 *     after the bounded retry budget with the provider error surfaced.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const PATCH_EXECUTABLE = "/usr/bin/patch";
const EDGE_ERROR = "exceeded request buffer limit while retrying upstream";
const stockRoot = join(projectRoot, "node_modules/@earendil-works/pi-coding-agent");
const currentPatch = join(projectRoot, "patches/pi-0.84.1-compaction.patch");
const legacyPatch = join(projectRoot, "patches/archive/pi-0.84.1-compaction-v0.5.0.patch");

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

function startModelServer(mode) {
	let hits = 0;
	const server = createServer((req, res) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			hits++;
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

function provisionAgentDir(root, port) {
	const agentDir = join(root, "agent");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				dogfood: {
					baseUrl: `http://127.0.0.1:${port}/v1`,
					api: "openai-completions",
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

function runTurn({ piRoot, root, port }) {
	const agentDir = provisionAgentDir(root, port);
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
					...process.env,
					HOME: root,
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
	const piRoot = provisionPi(legacyPatch, "legacy");
	const root = scenarioRoot("legacy");
	const server = await startModelServer("fail-once");
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

// Scenario 2 (green): the current patch must classify the edge error as
// transient, retry once with the native bounded machinery, and recover.
{
	const piRoot = currentPiRoot;
	const root = scenarioRoot("current");
	const server = await startModelServer("fail-once");
	const { events } = await runTurn({ piRoot, root, port: server.port });
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
	const piRoot = currentPiRoot;
	const root = scenarioRoot("exhaust");
	const server = await startModelServer("always-fail");
	const { events } = await runTurn({ piRoot, root, port: server.port });
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

console.log("pi core retry regression passed");
// Fixture teardown is registered on the exit event; leave nothing implicit
// keeping the loop alive (killed children release stdio asynchronously).
process.exit(0);
