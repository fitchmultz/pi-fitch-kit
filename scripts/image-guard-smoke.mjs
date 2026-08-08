#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDir = mkdtempSync(join(tmpdir(), "pi-kit-anthropic-"));
process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
process.env.PI_CODING_AGENT_DIR = agentDir;

const { default: anthropicImageGuard, fastRates } = await import(
	"../extensions/anthropic-image-guard.ts"
);

const SMALL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const WIDE_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAB9EAAAABCAIAAADmXckUAAAAH0lEQVR4nO3CMREAAAwDofdvuhWRFY6uVFVVVVXV/QNsD8mZm8ZR8gAAAABJRU5ErkJggg==";
const SMALL_BMP = "Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAAATCwAAEwsAAAAAAAAAAAAAAAD/AA==";

const handlers = {};
const commands = {};
const providers = new Map();
anthropicImageGuard({
	on(event, handler) {
		(handlers[event] ??= []).push(handler);
	},
	registerCommand(name, config) {
		commands[name] = config;
	},
	registerProvider(name, config) {
		providers.set(name, config);
	},
});
const runHandlers = async (event, ...args) => {
	for (const handler of handlers[event] ?? []) await handler(...args);
};

const statWatchers = () =>
	process.getActiveResourcesInfo().filter((resource) => resource === "StatWatcher").length;
// Baseline, so an unrelated watcher elsewhere in the process cannot fail the leak check.
const watcherBaseline = statWatchers();

const notices = [];
const status = new Map();
const uiCtx = (id) => ({
	hasUI: true,
	model: id === undefined ? undefined : { provider: "anthropic", id },
	ui: {
		notify: (message) => notices.push(message),
		setStatus: (key, value) => status.set(key, value),
		theme: { fg: (color, text) => `${color}:${text}` },
	},
});

const context = handlers.context[0];
assert.equal(typeof context, "function");
assert.equal(typeof handlers.session_start[0], "function");
assert.equal(typeof handlers.session_compact[0], "function");
// Registered once and gated per request, so unregistering can never delete a peer's registration.
assert.equal(providers.get("anthropic")?.api, "anthropic-messages");

const nonAnthropic = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
assert.equal(await context({ messages: nonAnthropic }, { model: { provider: "openai" } }), undefined);
assert.equal(nonAnthropic[0].content[0].type, "image");

const unchanged = [{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/png" }] }];
assert.equal(await context({ messages: unchanged }, { model: { provider: "anthropic" } }), undefined);
assert.equal(unchanged[0].content[0].data, SMALL_PNG);

await runHandlers("session_start", {}, uiCtx("claude-opus-5"));
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

await runHandlers("session_compact");
const afterCompaction = [
	{ role: "compactionSummary", summary: "Earlier context" },
	{ role: "branchSummary", summary: "Earlier branch" },
	{ role: "bashExecution", command: "pwd", output: "/tmp" },
	{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] },
];
const afterCompactionResult = await context({ messages: afterCompaction }, { model: { provider: "anthropic" } });
assert.equal(afterCompactionResult.messages[3].content[0].type, "text");

async function fastRequest(id, beta = "pi-existing-beta", extraOptions = {}) {
	let payload;
	let headers = new Headers();
	const stream = providers.get("anthropic").streamSimple(
		{
			id,
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://example.invalid",
			headers: { "anthropic-beta": beta },
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 300_000,
			maxTokens: 4096,
		},
		{ messages: [{ role: "user", content: "test", timestamp: 0 }] },
		{
			apiKey: "test",
			maxRetries: 0,
			...extraOptions,
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
	// A prebuilt client never reaches the wrapped fetch, which is the point of that case.
	if (!extraOptions.client) assert.ok(payload, "an Anthropic request must be issued");
	return { payload, beta: (headers.get("anthropic-beta") ?? "").split(",") };
}

const fastCtx = uiCtx("claude-opus-5");
const offOpus = await fastRequest("claude-opus-5");
assert.equal(offOpus.payload.speed, undefined);
assert.deepEqual(offOpus.beta, ["pi-existing-beta"], "no fast beta while disabled");

await commands["anthropic-fast"].handler("on", fastCtx);
assert.equal(JSON.parse(readFileSync(join(agentDir, "anthropic-fast.json"), "utf8")).enabled, true);
assert.equal(notices.at(-1), "Anthropic fast mode ON");
for (const id of ["claude-opus-5", "claude-opus-4-8"]) {
	const enabled = await fastRequest(id);
	assert.equal(enabled.payload.speed, "fast", `${id} must request fast mode`);
	assert.deepEqual(
		enabled.beta,
		["pi-existing-beta", "fast-mode-2026-02-01"],
		`${id} must append the beta without dropping Pi's own`,
	);
}
const preBeta = await fastRequest("claude-opus-5", "pi-existing-beta,fast-mode-2026-02-01");
assert.deepEqual(preBeta.beta, ["pi-existing-beta", "fast-mode-2026-02-01"], "no duplicate beta");
const unsupported = await fastRequest("claude-fable-5");
assert.equal(unsupported.payload.speed, undefined);
assert.deepEqual(unsupported.beta, ["pi-existing-beta"], "no fast beta on unsupported models");

const fullStreamOnly = await fastRequest("claude-opus-5", "pi-existing-beta", {
	toolChoice: "none",
});
assert.equal(fullStreamOnly.payload.tool_choice?.type, "none", "full-only options must survive");
assert.notEqual(
	fullStreamOnly.payload.thinking?.type,
	"disabled",
	"a full call without thinkingEnabled must not be recomputed by the simple path",
);

let clientPayload;
const prebuilt = await fastRequest("claude-opus-5", "pi-existing-beta", {
	client: {
		messages: {
			create: (params) => {
				clientPayload = params;
				throw new Error("prebuilt client used");
			},
		},
	},
});
assert.equal(prebuilt.payload, undefined, "a prebuilt client bypasses the wrapped fetch");
assert.equal(
	clientPayload?.speed,
	undefined,
	"never request fast mode when the mandatory beta header cannot be attached",
);

await commands["anthropic-fast"].handler("off", fastCtx);
assert.equal(notices.at(-1), "Anthropic fast mode OFF");
assert.equal((await fastRequest("claude-opus-5")).payload.speed, undefined);

const fullStream = await fastRequest("claude-opus-5", "pi-existing-beta", {
	thinkingEnabled: true,
	thinkingBudgetTokens: 2048,
});
assert.equal(
	fullStream.payload.thinking?.type,
	"enabled",
	"explicit full-stream options must stay on the full API instead of being recomputed",
);

assert.deepEqual(
	fastRates({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, inputTokensAbove: 200_000 }),
	{ input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, inputTokensAbove: 200_000 },
	"fast mode bills double, so reported rates double and tier thresholds survive",
);

// Footer: only on fast-capable models, colored by state, and cleared elsewhere.
assert.equal(status.get("anthropic-fast"), "muted:fast:off");
await commands["anthropic-fast"].handler("on", fastCtx);
assert.equal(status.get("anthropic-fast"), "accent:fast:on");

await runHandlers("model_select", {}, uiCtx("claude-fable-5"));
assert.equal(status.get("anthropic-fast"), undefined, "no footer on models fast mode ignores");
await runHandlers("model_select", {}, uiCtx("claude-opus-4-8"));
assert.equal(status.get("anthropic-fast"), "accent:fast:on");

await commands["anthropic-fast"].handler("off", fastCtx);
assert.equal(status.get("anthropic-fast"), "muted:fast:off");
// A second start must not stack watchers: one shutdown has to release everything, or the
// process stays alive holding a listener.
await runHandlers("session_start", {}, uiCtx("claude-opus-5"));
await runHandlers("session_shutdown");
assert.equal(
	statWatchers(),
	watcherBaseline,
	"repeated session starts must not leak a state-file watcher",
);

console.log(
	JSON.stringify({
		ok: true,
		footer: "opus-only",
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
