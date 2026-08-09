#!/usr/bin/env node
/**
 * Reproduces the Anthropic-only "Working..." silence reported in session
 * 9fa7bf9f without calling a live provider. Anthropic SSE ping events keep the
 * HTTP body active, but pi-ai filters them before the assistant event stream.
 * The network idle timeout must keep protecting truly idle bodies; the TUI
 * must make a healthy-but-slow request observable without killing it.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const stockRoot = join(projectRoot, "node_modules/@earendil-works/pi-coding-agent");
const currentPatch = join(projectRoot, "patches/pi-0.84.1-compaction.patch");
const legacyPatch = join(projectRoot, "patches/archive/pi-0.84.1-compaction-v0.7.0.patch");
const fixtureRoot = mkdtempSync(join(tmpdir(), "pi-kit-anthropic-stall-"));

process.on("exit", () => rmSync(fixtureRoot, { recursive: true, force: true }));
function provisionPi(label, patchPath) {
	const root = join(fixtureRoot, label);
	cpSync(stockRoot, root, { recursive: true });
	const applied = spawnSync(
		"/usr/bin/patch",
		["--batch", "--forward", "--no-backup-if-mismatch", "-p1", "-d", root],
		{ encoding: "utf8", input: readFileSync(patchPath) },
	);
	assert.equal(applied.status, 0, applied.stderr || applied.stdout);
	return root;
}
const legacyPiRoot = provisionPi("legacy", legacyPatch);
const piRoot = provisionPi("current", currentPatch);
const importFromPi = (root, relativePath) => import(pathToFileURL(join(root, relativePath)).href);
const { configureHttpDispatcher } = await importFromPi(piRoot, "dist/core/http-dispatcher.js");
const { stream: streamAnthropic } = await importFromPi(
	piRoot,
	"node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js",
);
configureHttpDispatcher(2_000);

function listen(handle) {
	const server = createServer(handle);
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve({
				port: server.address().port,
				close: () => new Promise((done) => server.close(done)),
			});
		});
	});
}

function sendEvent(response, event, data) {
	response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function finishAnthropicResponse(response) {
	sendEvent(response, "message_start", {
		type: "message_start",
		message: { id: "msg_local", usage: { input_tokens: 1, output_tokens: 0 } },
	});
	sendEvent(response, "content_block_start", {
		type: "content_block_start",
		index: 0,
		content_block: { type: "text", text: "" },
	});
	sendEvent(response, "content_block_delta", {
		type: "content_block_delta",
		index: 0,
		delta: { type: "text_delta", text: "done" },
	});
	sendEvent(response, "content_block_stop", { type: "content_block_stop", index: 0 });
	sendEvent(response, "message_delta", {
		type: "message_delta",
		delta: { stop_reason: "end_turn", stop_sequence: null },
		usage: { output_tokens: 1 },
	});
	sendEvent(response, "message_stop", { type: "message_stop" });
	response.end();
}

function anthropicModel(port) {
	return {
		id: "claude-fable-5",
		name: "Claude Fable 5",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: `http://127.0.0.1:${port}`,
		reasoning: true,
		input: ["text"],
		contextWindow: 300_000,
		maxTokens: 8_192,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

async function collect(port) {
	const startedAt = Date.now();
	const events = [];
	const stream = streamAnthropic(
		anthropicModel(port),
		{ messages: [{ role: "user", content: "hello", timestamp: startedAt }] },
		{ apiKey: "test", maxRetries: 0, timeoutMs: 2_000 },
	);
	for await (const event of stream) events.push({ type: event.type, at: Date.now() - startedAt, event });
	return events;
}

// A truly idle response body still fails around the configured timeout.
{
	const server = await listen((request, response) => {
		request.resume();
		request.on("end", () => {
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.flushHeaders();
			const timer = setTimeout(() => finishAnthropicResponse(response), 5_000);
			response.on("close", () => clearTimeout(timer));
		});
	});
	let events;
	try {
		events = await collect(server.port);
	} finally {
		await server.close();
	}
	const failure = events.at(-1);
	assert.equal(failure?.type, "error");
	assert.match(failure?.event.error.errorMessage ?? "", /Body Timeout Error|terminated/);
	assert.ok(failure.at < 4_500, `idle body failed too late: ${failure.at}ms`);
}

// Anthropic pings are real body activity, so a request may outlive the network
// idle timeout while emitting no assistant content. This is the incident class.
{
	const server = await listen((request, response) => {
		request.resume();
		request.on("end", () => {
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.flushHeaders();
			const pings = setInterval(
				() => sendEvent(response, "ping", { type: "ping" }),
				250,
			);
			const finish = setTimeout(() => {
				clearInterval(pings);
				finishAnthropicResponse(response);
			}, 2_600);
			response.on("close", () => {
				clearInterval(pings);
				clearTimeout(finish);
			});
		});
	});
	let events;
	try {
		events = await collect(server.port);
	} finally {
		await server.close();
	}
	assert.equal(events.at(-1)?.type, "done");
	assert.ok(events.at(-1).at >= 2_500, `ping-backed response ended too early: ${events.at(-1).at}ms`);
	const firstVisibleProgress = events.find((event) => !["start", "done"].includes(event.type));
	assert.ok(firstVisibleProgress?.at >= 2_500, `ping leaked as visible progress at ${firstVisibleProgress?.at}ms`);
}

// The fix is observability, not a false provider timeout: v0.7.0 stays red,
// while current shows elapsed time and the existing interrupt key after 30s.
async function probeWorkingIndicator(root, expectElapsed) {
	const realDateNow = Date.now;
	const realSetTimeout = globalThis.setTimeout;
	const realClearTimeout = globalThis.clearTimeout;
	const realSetInterval = globalThis.setInterval;
	const realClearInterval = globalThis.clearInterval;
	let now = 1_000;
	const intervals = [];
	const timeouts = [];
	const cleared = new Set();
	const schedule = (collection) => (callback, delay) => {
		const timer = { callback, delay, unref() {} };
		collection.push(timer);
		return timer;
	};
	Date.now = () => now;
	globalThis.setTimeout = schedule(timeouts);
	globalThis.clearTimeout = (timer) => cleared.add(timer);
	globalThis.setInterval = schedule(intervals);
	globalThis.clearInterval = (timer) => cleared.add(timer);
	try {
		const { initTheme } = await importFromPi(root, "dist/modes/interactive/theme/theme.js");
		initTheme("dark");
		const { WorkingStatusIndicator } = await importFromPi(
			root,
			"dist/modes/interactive/components/status-indicator.js",
		);
		const indicator = new WorkingStatusIndicator({ requestRender() {} }, "Working...");
		const loaderTimer = intervals.find((timer) => timer.delay === 80);
		assert.ok(loaderTimer, "working indicator must retain the inherited loader timer");
		const elapsedDelay = timeouts.find((timer) => timer.delay === 30_000);
		if (!expectElapsed) {
			assert.equal(elapsedDelay, undefined, "v0.7.0 must preserve the silent-working red proof");
			indicator.dispose();
			return;
		}
		assert.ok(elapsedDelay, "working indicator must schedule its 30-second disclosure");
		now += 31_000;
		elapsedDelay.callback();
		const elapsedTimer = intervals.find((timer) => timer.delay === 1_000);
		assert.ok(elapsedTimer, "working indicator must schedule elapsed-time updates after disclosure");
		assert.match(indicator.message, /^Working\.\.\. \(31s; .+ to cancel\)$/);
		indicator.setMessage("Waiting for provider...");
		assert.match(indicator.message, /^Waiting for provider\.\.\. \(31s; .+ to cancel\)$/);
		now += 1_000;
		elapsedTimer.callback();
		assert.match(indicator.message, /^Waiting for provider\.\.\. \(32s; .+ to cancel\)$/);
		indicator.dispose();
		assert.ok(cleared.has(loaderTimer), "working indicator must clear its inherited loader timer");
		assert.ok(cleared.has(elapsedDelay), "working indicator must clear its disclosure timer");
		assert.ok(cleared.has(elapsedTimer), "working indicator must clear its elapsed timer");
	} finally {
		Date.now = realDateNow;
		globalThis.setTimeout = realSetTimeout;
		globalThis.clearTimeout = realClearTimeout;
		globalThis.setInterval = realSetInterval;
		globalThis.clearInterval = realClearInterval;
	}
}
await probeWorkingIndicator(legacyPiRoot, false);
await probeWorkingIndicator(piRoot, true);

console.log("Anthropic ping-silence and observable working-indicator regression passed");
