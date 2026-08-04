#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDir = mkdtempSync(join(tmpdir(), "pi-kit-anthropic-"));
process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
process.env.PI_CODING_AGENT_DIR = agentDir;

const { default: anthropicImageGuard } = await import("../extensions/anthropic-image-guard.ts");

const SMALL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const WIDE_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAB9EAAAABCAIAAADmXckUAAAAH0lEQVR4nO3CMREAAAwDofdvuhWRFY6uVFVVVVXV/QNsD8mZm8ZR8gAAAABJRU5ErkJggg==";
const SMALL_BMP = "Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAAATCwAAEwsAAAAAAAAAAAAAAAD/AA==";

const handlers = {};
const commands = {};
const providers = [];
anthropicImageGuard({
	on(event, handler) {
		handlers[event] = handler;
	},
	registerCommand(name, config) {
		commands[name] = config;
	},
	registerProvider(name, config) {
		providers.push({ name, config });
	},
});

const { context } = handlers;
assert.equal(typeof context, "function");
assert.equal(typeof handlers.session_start, "function");
assert.equal(typeof handlers.session_compact, "function");

const nonAnthropic = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
assert.equal(await context({ messages: nonAnthropic }, { model: { provider: "openai" } }), undefined);
assert.equal(nonAnthropic[0].content[0].type, "image");

const unchanged = [{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/png" }] }];
assert.equal(await context({ messages: unchanged }, { model: { provider: "anthropic" } }), undefined);
assert.equal(unchanged[0].content[0].data, SMALL_PNG);

handlers.session_start();
const mislabeled = [{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/jpeg" }] }];
await context({ messages: mislabeled }, { model: { provider: "anthropic" } });
const correctlyLabeled = [{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/png" }] }];
assert.equal(await context({ messages: correctlyLabeled }, { model: { provider: "anthropic" } }), undefined);
assert.equal(correctlyLabeled[0].content[0].mimeType, "image/png");

const wide = [{ role: "user", content: [{ type: "image", data: WIDE_PNG, mimeType: "image/png" }] }];
const wideResult = await context({ messages: wide }, { model: { provider: "anthropic" } });
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
const customResult = await context({ messages: custom }, { model: { provider: "anthropic" } });
assert.match(customResult.messages[0].content[0].text, /original 2001x1, displayed at 2000x1/);
assert.equal(customResult.messages[0].content[1].type, "image");

const customBmp = [
	{
		role: "custom",
		customType: "image-fixture",
		content: [{ type: "image", data: SMALL_BMP, mimeType: "image/bmp" }],
		display: false,
		timestamp: 0,
	},
];
const customBmpResult = await context({ messages: customBmp }, { model: { provider: "anthropic" } });
assert.match(customBmpResult.messages[0].content[0].text, /does not support this image type/);
assert.equal(customBmpResult.messages[0].content.some(({ type }) => type === "image"), false);

const anthropic = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
const result = await context({ messages: anthropic }, { model: { provider: "anthropic" } });
assert.equal(result.messages[0].content[0].type, "text");
assert.match(result.messages[0].content[0].text, /Image omitted/);

const oversized = [
	{
		role: "user",
		content: [
			{ type: "image", data: "A".repeat(32 * 1024 * 1024 + 1), mimeType: "image/png" },
			{ type: "image", data: SMALL_PNG, mimeType: "image/png" },
		],
	},
];
const oversizedResult = await context({ messages: oversized }, { model: { provider: "anthropic" } });
assert.match(oversizedResult.messages[0].content[0].text, /resize safety limit/);
assert.equal(oversizedResult.messages[0].content[1].type, "image");

handlers.session_compact();
const afterCompaction = [
	{ role: "compactionSummary", summary: "Earlier context" },
	{ role: "branchSummary", summary: "Earlier branch" },
	{ role: "bashExecution", command: "pwd", output: "/tmp" },
	{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] },
];
const afterCompactionResult = await context({ messages: afterCompaction }, { model: { provider: "anthropic" } });
assert.equal(afterCompactionResult.messages[3].content[0].type, "text");

assert.deepEqual(
	providers.map(({ name, config }) => [name, config.api]),
	[["anthropic", "anthropic-messages"]],
);

async function fastRequest(id) {
	let payload;
	let headers = new Headers();
	const stream = providers[0].config.streamSimple(
		{
			id,
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://example.invalid",
			headers: { "anthropic-beta": "pi-existing-beta" },
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 300_000,
			maxTokens: 4096,
		},
		{ messages: [{ role: "user", content: "test", timestamp: 0 }] },
		{
			apiKey: "test",
			maxRetries: 0,
			fetch: async (_input, init = {}) => {
				headers = new Headers(init.headers);
				payload = JSON.parse(String(init.body));
				throw new Error("payload captured");
			},
		},
	);
	for await (const _event of stream) {
		// Drain the capture abort.
	}
	assert.ok(payload, "an Anthropic request must be issued");
	return { payload, beta: (headers.get("anthropic-beta") ?? "").split(",") };
}

const notices = [];
const fastCtx = { ui: { notify: (message) => notices.push(message) } };
assert.equal((await fastRequest("claude-opus-5")).payload.speed, undefined);

commands["anthropic-fast"].handler("on", fastCtx);
assert.equal(JSON.parse(readFileSync(join(agentDir, "anthropic-fast.json"), "utf8")).enabled, true);
assert.equal(notices.at(-1), "Anthropic fast mode ON");
const fastOpus = await fastRequest("claude-opus-5");
assert.equal(fastOpus.payload.speed, "fast");
assert.deepEqual(fastOpus.beta, ["pi-existing-beta", "fast-mode-2026-02-01"]);
assert.equal((await fastRequest("claude-fable-5")).payload.speed, undefined);

commands["anthropic-fast"].handler("off", fastCtx);
assert.equal(notices.at(-1), "Anthropic fast mode OFF");
assert.equal((await fastRequest("claude-opus-5")).payload.speed, undefined);

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
		compaction: "cleared",
		fastMode: "opus-only",
	}),
);
