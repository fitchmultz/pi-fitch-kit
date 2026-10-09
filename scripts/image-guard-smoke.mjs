#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHook } from "node:async_hooks";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Optional host root and extension path support read-only native host/RED probes.
const sdkPath = process.argv[2]
	? pathToFileURL(join(process.argv[2], "dist/index.js")).href
	: import.meta.resolve("@earendil-works/pi-coding-agent");
const temp = mkdtempSync(join(tmpdir(), "pi-image-guard-"));
const cwd = join(temp, "project");
const agentDir = join(temp, "agent");
mkdirSync(cwd);
mkdirSync(agentDir);
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_OFFLINE = "1";
process.on("exit", () => rmSync(temp, { recursive: true, force: true }));
const { DefaultResourceLoader, SettingsManager } = await import(sdkPath);
const loader = new DefaultResourceLoader({
	cwd, agentDir, settingsManager: SettingsManager.inMemory({}),
	additionalExtensionPaths: [process.argv[3] ?? fileURLToPath(new URL("../extensions/anthropic-image-guard.ts", import.meta.url))],
	noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
});
await loader.reload();
const loaded = loader.getExtensions();
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
const handlers = loaded.extensions[0].handlers;
const { loadPhoton } = await import(new URL("./utils/photon.js", sdkPath));
const photon = await loadPhoton();
assert.ok(photon);
let workers = 0;
const workerHook = createHook({ init(_id, type) { if (type === "WORKER") workers++; } });
workerHook.enable();

const SMALL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const WIDE_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAB9EAAAABCAIAAADmXckUAAAAH0lEQVR4nO3CMREAAAwDofdvuhWRFY6uVFVVVVXV/QNsD8mZm8ZR8gAAAABJRU5ErkJggg==";
const SMALL_BMP = "Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAAATCwAAEwsAAAAAAAAAAAAAAAD/AA==";

const anthropicModel = { provider: "anthropic", api: "anthropic-messages", id: "claude-opus-5" };

const runHandlers = async (event, ...args) => {
	for (const handler of handlers.get(event) ?? []) await handler(...args);
};

const context = handlers.get("context")[0];
assert.equal(typeof context, "function");
assert.equal(typeof handlers.get("session_start")[0], "function");
assert.equal(typeof handlers.get("session_compact")[0], "function");

// Distinct valid captures reproduce the old cyclic LRU miss, including when a
// request exceeds the byte ceiling: retained results must still get reused.
const captures = Array.from({ length: 40 }, (_, seed) => {
	const pixels = new Uint8Array(500 * 500 * 4);
	for (let i = 0; i < pixels.length; i += 4) {
		pixels[i] = (i + seed * 13) % 256;
		pixels[i + 1] = (i * 3 + seed * 29) % 256;
		pixels[i + 2] = (i * 7 + seed * 43) % 256;
		pixels[i + 3] = 255;
	}
	const image = new photon.PhotonImage(pixels, 500, 500);
	try { return Buffer.from(image.get_bytes()).toString("base64"); }
	finally { image.free(); }
});
assert.equal(new Set(captures).size, captures.length);
const cacheReceipts = [];
for (const count of [16, 40]) {
	await runHandlers("session_start");
	const originals = captures.slice(0, count).map((data, timestamp) => ({
		role: "user", timestamp,
		content: [{ type: "image", data, mimeType: "image/png" }],
	}));
	const sourceChars = originals.reduce((sum, message) => sum + message.content[0].data.length, 0);
	assert.ok(sourceChars < 64 * 1024 * 1024, "all captures must fit the existing source admission budget");
	// Native unchanged results own another base64 string. Forty sources alone
	// fit 128 MiB of UTF-16 storage, but their sources plus results do not.
	if (count === 40) {
		assert.ok(2 * sourceChars < 128 * 1024 * 1024);
		assert.ok(4 * sourceChars > 128 * 1024 * 1024);
	}
	const deltas = [];
	for (let pass = 0; pass < 3; pass++) {
		const outgoing = structuredClone(originals);
		const before = workers;
		await context({ messages: outgoing }, { model: anthropicModel });
		const delta = workers - before;
		deltas.push(delta);
		assert.deepEqual(outgoing, originals, "in-limit captures and chronology stay intact");
		if (pass === 0) assert.equal(delta, count, "cold control must use the real native workers");
		else if (count === 16) assert.equal(delta, 0, "admitted16 must reuse every real resize result");
		else assert.ok(delta > 0 && delta < count, "byte eviction must bound sources AND results without cyclic all-miss thrash");
	}
	cacheReceipts.push({ count, sourceChars, workers: deltas });
	if (count === 16) {
		for (const event of ["session_start", "session_compact"]) {
			await runHandlers(event);
			const before = workers;
			await context({ messages: structuredClone(originals) }, { model: anthropicModel });
			assert.equal(workers - before, count, `${event} must discard cached results`);
		}
	}
}
console.log(JSON.stringify({ nativeCache: cacheReceipts, sdkPath }));

const nonAnthropic = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
const beforeNonClaude = workers;
assert.equal(
	await context({ messages: nonAnthropic }, { model: { provider: "openai", api: "openai-responses" } }),
	undefined,
);
assert.equal(nonAnthropic[0].content[0].type, "image");
assert.equal(workers, beforeNonClaude);

const unchanged = [{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/png" }] }];
assert.equal(await context({ messages: unchanged }, { model: anthropicModel }), undefined);
assert.equal(unchanged[0].content[0].data, SMALL_PNG);

await runHandlers("session_start", {}, {});
const mislabeled = [{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/jpeg" }] }];
await context({ messages: mislabeled }, { model: anthropicModel });
const correctlyLabeled = [{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/png" }] }];
assert.equal(await context({ messages: correctlyLabeled }, { model: anthropicModel }), undefined);
assert.equal(correctlyLabeled[0].content[0].mimeType, "image/png");

const wide = [{ role: "user", content: [{ type: "image", data: WIDE_PNG, mimeType: "image/png" }] }];
const wideResult = await context({ messages: wide }, { model: anthropicModel });
assert.match(wideResult.messages[0].content[0].text, /original 2001x1, displayed at 2000x1/);
assert.equal(wideResult.messages[0].content[1].type, "image");
assert.notEqual(wideResult.messages[0].content[1].data, WIDE_PNG);

const custom = [
	{
		role: "custom",
		customType: "image-fixture",
		content: [{ type: "image", data: WIDE_PNG, mimeType: "image/png" }],
		display: false,
		timestamp: 0,
	},
];
const beforeCustom = workers;
const customResult = await context({ messages: custom }, { model: anthropicModel });
assert.match(customResult.messages[0].content[0].text, /original 2001x1, displayed at 2000x1/);
assert.equal(customResult.messages[0].content[1].type, "image");
assert.equal(workers, beforeCustom, "reuse resized data and its coordinate note without another native decode");

const customBmp = [
	{
		role: "custom",
		customType: "image-fixture",
		content: [{ type: "image", data: SMALL_BMP, mimeType: "image/bmp" }],
		display: false,
		timestamp: 0,
	},
];
const customBmpResult = await context({ messages: customBmp }, { model: anthropicModel });
assert.match(customBmpResult.messages[0].content[0].text, /does not support this image type/);
assert.equal(customBmpResult.messages[0].content.some(({ type }) => type === "image"), false);

const anthropic = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
const result = await context({ messages: anthropic }, { model: anthropicModel });
assert.equal(result.messages[0].content[0].type, "text");
assert.match(result.messages[0].content[0].text, /Image omitted/);
const beforeRetry = workers;
const retry = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
const retryResult = await context({ messages: retry }, { model: anthropicModel });
assert.match(retryResult.messages[0].content[0].text, /Image omitted/);
assert.equal(workers - beforeRetry, 1, "failed decoding must be retried, never retained as a successful cache entry");

const oversized = [
	{
		role: "user",
		content: [
			{ type: "image", data: "A".repeat(32 * 1024 * 1024 + 1), mimeType: "image/png" },
			{ type: "image", data: SMALL_PNG, mimeType: "image/png" },
		],
	},
];
const oversizedResult = await context({ messages: oversized }, { model: anthropicModel });
assert.match(oversizedResult.messages[0].content[0].text, /resize safety limit/);
assert.equal(oversizedResult.messages[0].content[1].type, "image");

// The guard requires a Claude model on the anthropic-messages API: Claude
// behind a gateway or proxy hits the same Anthropic image limits, while
// non-Claude models sharing that wire API (and non-Anthropic APIs from the
// same providers) keep their source images untouched.
const gatewayWide = [{ role: "user", content: [{ type: "image", data: WIDE_PNG, mimeType: "image/png" }] }];
const gatewayResult = await context(
	{ messages: gatewayWide },
	{ model: { provider: "cloudflare-ai-gateway", api: "anthropic-messages", id: "claude-fable-5" } },
);
assert.match(gatewayResult.messages[0].content[0].text, /original 2001x1, displayed at 2000x1/);
assert.equal(gatewayResult.messages[0].content[1].type, "image");
const namespacedClaude = [{ role: "user", content: [{ type: "image", data: SMALL_BMP, mimeType: "image/bmp" }] }];
const namespacedResult = await context(
	{ messages: namespacedClaude },
	{ model: { provider: "vercel-ai-gateway", api: "anthropic-messages", id: "anthropic/claude-opus-5" } },
);
assert.match(namespacedResult.messages[0].content[0].text, /does not support this image type/);
const vercelNonClaude = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
assert.equal(
	await context(
		{ messages: vercelNonClaude },
		{ model: { provider: "vercel-ai-gateway", api: "anthropic-messages", id: "openai/gpt-5.6-sol" } },
	),
	undefined,
	"non-Claude models on the anthropic-messages API must keep source images",
);
const gatewayNonClaude = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
assert.equal(
	await context(
		{ messages: gatewayNonClaude },
		{ model: { provider: "cloudflare-ai-gateway", api: "openai-completions", id: "gpt-5.6-sol" } },
	),
	undefined,
);

await runHandlers("session_compact");
const afterCompaction = [
	{ role: "compactionSummary", summary: "Earlier context" },
	{ role: "branchSummary", summary: "Earlier branch" },
	{ role: "bashExecution", command: "pwd", output: "/tmp" },
	{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] },
];
const afterCompactionResult = await context({ messages: afterCompaction }, { model: anthropicModel });
assert.equal(afterCompactionResult.messages[3].content[0].type, "text");
workerHook.disable();

console.log(
	JSON.stringify({
		ok: true,
		nonAnthropic: "unchanged",
		anthropicUnchanged: "preserved",
		anthropicResize: "resized",
		mimeAwareCache: "preserved",
		customImage: "resized",
		unsupportedCustomImage: "omitted",
		anthropicResizeFailure: "omitted",
		oversizedSource: "omitted",
		claudeRoutes: "gateway+namespaced claude guarded, non-claude and non-anthropic APIs untouched",
		compaction: "cleared",
	}),
);
