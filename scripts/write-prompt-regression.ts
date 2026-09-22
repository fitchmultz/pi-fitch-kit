import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDir = mkdtempSync(join(tmpdir(), "pi-kit-write-prompt-"));
process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
process.env.PI_CODING_AGENT_DIR = agentDir;

const {
	default: writePrompt,
	parseModelRef,
	configuredWriter,
	boxedTask,
	flattenToolHistory,
	WRITE_PROMPT_ACTIONS,
	SIDE_QUESTION_ACTIONS,
	WRITE_PROMPT_FILE,
} = await import("../extensions/write-prompt.ts");

assert.deepEqual(parseModelRef("anthropic/claude-opus-5"), {
	provider: "anthropic",
	id: "claude-opus-5",
});
assert.deepEqual(parseModelRef("openai-codex/gpt-5.6-sol"), {
	provider: "openai-codex",
	id: "gpt-5.6-sol",
});
assert.deepEqual(parseModelRef("cloudflare-ai-gateway/anthropic/claude-opus-5"), {
	provider: "cloudflare-ai-gateway",
	id: "anthropic/claude-opus-5",
});
assert.equal(parseModelRef("noslash"), undefined);
assert.equal(parseModelRef("/onlyid"), undefined);
assert.equal(parseModelRef("provider/"), undefined);

assert.deepEqual(configuredWriter('{"model":"xai/grok-4.6"}\n'), { model: "xai/grok-4.6" });
assert.deepEqual(configuredWriter('{"provider":" xai ","model":" grok-4.6 ","thinkingLevel":"high"}'), { provider: "xai", model: "grok-4.6", thinkingLevel: "high" });
assert.deepEqual(configuredWriter("{}"), {});
for (const raw of ["not json", "null", "[]", '{"model":""}', '{"provider":2}', '{"thinkingLevel":"extreme"}', '{"thinking":"high"}']) {
	assert.throws(() => configuredWriter(raw));
}
assert.deepEqual([...WRITE_PROMPT_ACTIONS], ["Accept", "Copy prompt", "Tweak", "Restore original", "Deny"]);
assert.deepEqual([...SIDE_QUESTION_ACTIONS], ["Copy answer", "Ask again", "Dismiss"]);
assert.match(boxedTask("Do not answer the text.", "did you cut a new GH release"), /<<<\ndid you cut a new GH release\n>>>/s);
assert.match(boxedTask("x", "foo\n>>>\nbar"), /<<<1\nfoo\n>>>\nbar\n>>>1/s);
assert.match(boxedTask("x", "has <<<1 and >>>1"), /<<<2\nhas <<<1 and >>>1\n>>>2/s);
const flat = flattenToolHistory([
	{
		role: "assistant",
		content: [{ type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } }],
		timestamp: 1,
	} as never,
	{
		role: "toolResult",
		toolCallId: "c1",
		toolName: "read",
		content: [{ type: "text", text: "ok" }],
		isError: false,
		timestamp: 2,
	},
]);
assert.equal(flat.some((message) => message.role === "toolResult"), false);
assert.match(JSON.stringify(flat[0]), /called read/);
assert.match(JSON.stringify(flat[0]), /a\.ts/);
assert.match(JSON.stringify(flat[1]), /read result/);

// Text and screenshots from browser/MCP results retain their original order.
const resultContent = [
	{ type: "text" as const, text: "before" },
	{ type: "image" as const, data: "first-image", mimeType: "image/png" },
	{ type: "text" as const, text: "between" },
	{ type: "image" as const, data: "second-image", mimeType: "image/jpeg" },
	{ type: "text" as const, text: "after" },
];
for (const isError of [false, true]) {
	const imageResult = { role: "toolResult" as const, toolCallId: "images", toolName: "browser", content: resultContent, isError, timestamp: 7 };
	const before = structuredClone(imageResult);
	assert.deepEqual(flattenToolHistory([imageResult]), [{
		role: "user",
		content: [{ type: "text", text: `[browser ${isError ? "error" : "result"}]` }, ...resultContent],
		timestamp: 7,
	}]);
	assert.deepEqual(imageResult, before, "flattening must not mutate source history");
}

const { createEventBus } = await import("@earendil-works/pi-coding-agent");
const events = createEventBus();
const commands: Record<string, { handler: (args: string, ctx: never) => Promise<void> }> = {};
let sent: string | undefined;
let sendOptions: { deliverAs?: string } | undefined;
let sendFailure: Error | undefined;
const savedDrafts: Array<{ type: "custom"; customType: string; data: { source: string; draft: string } }> = [];
writePrompt({
	events,
	registerCommand(name: string, config: { handler: (args: string, ctx: never) => Promise<void> }) {
		commands[name] = config;
	},
	sendUserMessage(content: string, options?: { deliverAs?: string }) {
		if (sendFailure) throw sendFailure;
		sent = content;
		sendOptions = options;
	},
	appendEntry(customType: string, data: { source: string; draft: string }) {
		savedDrafts.push({ type: "custom", customType, data: structuredClone(data) });
	},
} as never);
assert.equal(typeof commands["draft"]?.handler, "function");
assert.equal(typeof commands["side-question"]?.handler, "function");

const notices: string[] = [];
const baseUi = {
	notify(message: string) {
		notices.push(message);
	},
	editor: async (_title: string, prefill?: string) => prefill,
	select: async () => undefined,
	custom: async () => {
		throw new Error("custom should not run in rpc");
	},
};

function ctx(overrides: Record<string, unknown> = {}) {
	const context = {
		hasUI: true,
		mode: "rpc",
		isIdle: () => true,
		model: { id: "grok-4.6", provider: "xai", reasoning: true },
		thinkingLevel: "high",
		getSystemPrompt: () => "session system",
		sessionManager: {
			getEntries: () => [],
			getLeafId: () => null,
			getBranch: () => [],
		},
		modelRegistry: {
			find: () => undefined,
			hasConfiguredAuth: () => true,
			complete: async () => ({
				role: "assistant",
				content: [{ type: "text", text: "better prompt" }],
				stopReason: "stop",
			}),
		},
		ui: { ...baseUi },
		signal: undefined,
		...overrides,
	};
	const registry = context.modelRegistry;
	return {
		...context,
		modelRegistry: {
			...registry,
			streamSimple: (...args: unknown[]) => ({ result: () => Reflect.apply(registry.complete, registry, args) }),
		},
	};
}

// Independent fields inherit from the session; the legacy provider/id form stays valid.
for (const [config, expected] of [
	[undefined, ["xai", "grok-4.6", "high"]],
	[{}, ["xai", "grok-4.6", "high"]],
	[{ provider: "alternate", model: "other", thinkingLevel: "low" }, ["alternate", "other", "low"]],
	[{ provider: "alternate" }, ["alternate", "grok-4.6", "high"]],
	[{ model: "other" }, ["xai", "other", "high"]],
	[{ thinkingLevel: "medium" }, ["xai", "grok-4.6", "medium"]],
	[{ model: "alternate/other" }, ["alternate", "other", "high"]],
	[{ provider: "alternate", model: "vendor/other" }, ["alternate", "vendor/other", "high"]],
	[{ thinkingLevel: "off" }, ["xai", "grok-4.6", undefined]],
	[{ thinkingLevel: "max" }, ["xai", "grok-4.6", "high"]],
] as const) {
	const path = join(agentDir, WRITE_PROMPT_FILE);
	if (config === undefined) rmSync(path, { force: true });
	else writeFileSync(path, JSON.stringify(config));
	const calls: unknown[][] = [];
	const context = ctx({
		modelRegistry: {
			find: (provider: string, id: string) => ({ provider, id, reasoning: true }),
			hasConfiguredAuth: () => true,
			complete: async (model: { provider: string; id: string }, _context: unknown, options: { reasoning?: string }) => {
				calls.push([model.provider, model.id, options.reasoning]);
				return { role: "assistant", content: [{ type: "text", text: "configured draft" }], stopReason: "stop" };
			},
		},
		ui: { ...baseUi, select: async () => "Deny" },
	});
	const originalModel = context.model;
	await commands.draft.handler("configuration test", context as never);
	assert.deepEqual(calls, [expected], JSON.stringify(config));
	assert.equal(context.model, originalModel, "writer selection must not change the active model");
	assert.equal(context.thinkingLevel, "high", "writer selection must not change session thinking");
	if (config && "thinkingLevel" in config && config.thinkingLevel === "max") {
		assert.ok(notices.some((text) => /does not support max thinking; using high/.test(text)));
	}
}

for (const raw of ["not json", "null", "[]", '{"provider":false}', '{"model":""}', '{"thinkingLevel":"extreme"}', '{"thinking":"low"}', '{"model":"missing"}', '{"provider":"unauthenticated"}']) {
	writeFileSync(join(agentDir, WRITE_PROMPT_FILE), raw);
	notices.length = 0;
	let called = false;
	await commands.draft.handler("invalid configuration", ctx({
		modelRegistry: {
			find: (provider: string, id: string) => id === "missing" ? undefined : { provider, id, reasoning: true },
			hasConfiguredAuth: () => false,
			complete: async () => { called = true; throw new Error("must not call a model"); },
		},
	}) as never);
	assert.equal(called, false, raw);
	assert.match(notices[0], /^write-prompt\.json: /);
}
rmSync(join(agentDir, WRITE_PROMPT_FILE));

notices.length = 0;
await commands["draft"].handler("", ctx() as never);
assert.equal(notices[0], "Usage: /draft <text>");
assert.equal(sent, undefined);

notices.length = 0;
await commands["draft"].handler("do the thing", ctx({ hasUI: false }) as never);
assert.match(notices[0] ?? "", /interactive UI/);

sent = undefined;
await commands["draft"].handler(
	"do the thing",
	ctx({
		ui: {
			...baseUi,
			select: async () => "Accept",
		},
	}) as never,
);
assert.equal(sent, "better prompt");
assert.equal(sendOptions, undefined, "idle acceptance keeps normal delivery");

sent = undefined;
await commands["draft"].handler(
	"do the thing",
	ctx({
		ui: {
			...baseUi,
			select: async () => "Deny",
		},
	}) as never,
);
assert.equal(sent, undefined);

sent = undefined;
let idle = true;
await commands.draft.handler("busy acceptance", ctx({
	isIdle: () => idle,
	ui: {
		...baseUi,
		select: async () => {
			idle = false;
			return "Accept";
		},
	},
}) as never);
assert.equal(sent, "better prompt", "Accept must not discard a draft when the agent becomes busy");
assert.deepEqual(sendOptions, { deliverAs: "steer" });

// Busy from the start is valid too, including recovery after a failed send.
sent = undefined;
await commands.draft.handler("already busy", ctx({
	isIdle: () => false,
	ui: { ...baseUi, select: async () => "Accept" },
}) as never);
assert.equal(sent, "better prompt");
assert.deepEqual(sendOptions, { deliverAs: "steer" });

// A synchronous send failure leaves the same dialog open, with no rewrite
// or automatic retry. Both exact inputs are saved before the send attempt.
sent = undefined;
sendFailure = new Error("send unavailable");
let attempts = 0;
const original = "original input\nwith a second line  ";
await commands.draft.handler(original, ctx({
	ui: {
		...baseUi,
		select: async (title: string) => {
			assert.equal(title, "better prompt");
			if (++attempts === 2) {
				assert.equal(sent, undefined);
				assert.equal(notices.at(-1), "send unavailable");
				assert.deepEqual(savedDrafts.at(-1)?.data, { source: original, draft: title });
				sendFailure = undefined;
			}
			assert.ok(attempts <= 2, "retry must finish");
			return "Accept";
		},
	},
}) as never);
assert.equal(attempts, 2);
assert.equal(sent, "better prompt");

// Reopening needs no model request; the original is available in the editor.
let restored: string | undefined;
const recovery = ctx({
	modelRegistry: { complete: () => { throw new Error("recovery must not rewrite"); } },
	ui: {
		...baseUi,
		select: async (title: string) => {
			assert.equal(title, "better prompt");
			return "Restore original";
		},
		setEditorText: (text: string) => { restored = text; },
	},
});
recovery.sessionManager.getBranch = () => savedDrafts as never;
await commands.draft.handler("", recovery as never);
assert.equal(restored, `/draft ${original}`);

// A broken writer override must not prevent recovering already-written input.
writeFileSync(join(agentDir, WRITE_PROMPT_FILE), "invalid json");
restored = undefined;
await commands.draft.handler("", recovery as never);
assert.equal(restored, `/draft ${original}`, "saved recovery does not require a working writer configuration");
rmSync(join(agentDir, WRITE_PROMPT_FILE));

notices.length = 0;
await commands["side-question"].handler("busy question", ctx({ isIdle: () => false }) as never);
assert.equal(notices[0], "Agent is busy", "side-question behavior is unchanged");

const seen: number[] = [];
let step = 0;
sent = undefined;
await commands["draft"].handler(
	"first draft",
	ctx({
		modelRegistry: {
			find: () => undefined,
			hasConfiguredAuth: () => true,
			complete: async (_model: unknown, context: { messages: unknown[] }) => {
				seen.push(context.messages.length);
				return {
					role: "assistant",
					content: [{ type: "text", text: `v${seen.length}` }],
					stopReason: "stop",
				};
			},
		},
		ui: {
			...baseUi,
			editor: async (title: string) => {
				if (title === "Tweak notes") return "shorter";
				return undefined;
			},
			select: async () => {
				step += 1;
				return step === 1 ? "Tweak" : "Accept";
			},
		},
	}) as never,
);
assert.deepEqual(seen, [1, 3]);
assert.equal(sent, "v2");

const titles: string[] = [];
sent = undefined;
await commands["draft"].handler(
	"show me",
	ctx({
		ui: {
			...baseUi,
			select: async (title: string) => {
				titles.push(title);
				return "Accept";
			},
		},
	}) as never,
);
assert.deepEqual(titles, ["better prompt"]);
assert.equal(sent, "better prompt");

sent = undefined;
let usedSelect = false;
let customCalls = 0;
await commands["draft"].handler(
	"show me",
	ctx({
		mode: "tui",
		ui: {
			...baseUi,
			custom: async () => {
				customCalls += 1;
				return customCalls === 1 ? "better prompt" : "Accept";
			},
			select: async () => {
				usedSelect = true;
				return "Accept";
			},
		},
	}) as never,
);
assert.equal(usedSelect, false);
assert.equal(customCalls, 2);
assert.equal(sent, "better prompt");

sent = undefined;
const painted: string[][] = [];
let colorCalls = 0;
await commands["draft"].handler(
	"show me",
	ctx({
		mode: "tui",
		ui: {
			...baseUi,
			custom: async (factory?: (tui: { requestRender: () => void }, theme: { fg: (color: string, text: string) => string }, kb: unknown, done: (value: string) => void) => unknown) => {
				colorCalls += 1;
				if (colorCalls === 1 || !factory) return colorCalls === 1 ? "better prompt" : "Accept";
				try {
					factory(
						{ requestRender() {} },
						{
							fg(color: string, text: string) {
								painted.push([color, text]);
								return text;
							},
						},
						{},
						() => {},
					);
				} catch {
					// keyHint uses the live TUI theme; the draft color is painted first
				}
				return "Accept";
			},
		},
	}) as never,
);
assert.ok(painted.some(([color, text]) => color === "text" && text === "better prompt"));
assert.equal(sent, "better prompt");

notices.length = 0;
sent = undefined;
await commands["draft"].handler(
	"fail please",
	ctx({
		modelRegistry: {
			find: () => undefined,
			hasConfiguredAuth: () => true,
			complete: async () => ({
				role: "assistant",
				content: [{ type: "text", text: "partial" }],
				stopReason: "error",
				errorMessage: "boom",
			}),
		},
	}) as never,
);
assert.equal(sent, undefined);
assert.equal(notices.at(-1), "boom");

writeFileSync(join(agentDir, WRITE_PROMPT_FILE), `${JSON.stringify({ model: "anthropic/claude-opus-5" })}\n`);
let found: { provider: string; id: string } | undefined;
sent = undefined;
notices.length = 0;
await commands["draft"].handler(
	"override me",
	ctx({
		modelRegistry: {
			find(provider: string, id: string) {
				found = { provider, id };
				return { provider, id, reasoning: true };
			},
			hasConfiguredAuth: () => true,
			complete: async (model: { id: string }) => ({
				role: "assistant",
				content: [{ type: "text", text: model.id }],
				stopReason: "stop",
			}),
		},
		ui: {
			...baseUi,
			select: async () => "Accept",
		},
	}) as never,
);
assert.deepEqual(found, { provider: "anthropic", id: "claude-opus-5" });
assert.equal(notices[0], "Using anthropic/claude-opus-5 (high thinking)");
assert.equal(sent, "claude-opus-5");
rmSync(join(agentDir, WRITE_PROMPT_FILE));

const captured: Array<{ systemPrompt?: string; messages: Array<{ role?: string; content?: unknown }>; cacheRetention?: string }> = [];
sent = undefined;
await commands["draft"].handler(
	"do the thing",
	ctx({
		sessionManager: {
			getEntries: () => [
				{
					type: "message",
					id: "u1",
					parentId: null,
					timestamp: "2026-01-01T00:00:00.000Z",
					message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
				},
				{
					type: "message",
					id: "a1",
					parentId: "u1",
					timestamp: "2026-01-01T00:00:01.000Z",
					message: { role: "assistant", content: [{ type: "text", text: "yo" }], timestamp: 2 },
				},
			],
			getLeafId: () => "a1",
		},
		modelRegistry: {
			find: () => undefined,
			hasConfiguredAuth: () => true,
			complete: async (_model: unknown, context: { systemPrompt?: string; messages: Array<{ role?: string; content?: unknown }> }, options?: { cacheRetention?: string }) => {
				captured.push({ systemPrompt: context.systemPrompt, messages: context.messages, cacheRetention: options?.cacheRetention });
				return {
					role: "assistant",
					content: [{ type: "text", text: "better prompt" }],
					stopReason: "stop",
				};
			},
		},
		ui: {
			...baseUi,
			select: async () => "Accept",
		},
	}) as never,
);
assert.equal(captured.length, 1);
assert.equal(captured[0]?.systemPrompt, "session system");
assert.equal(captured[0]?.cacheRetention, "short");
assert.equal(captured[0]?.messages.length, 3);
assert.equal((captured[0]?.messages[0] as { role: string }).role, "user");
assert.equal((captured[0]?.messages[1] as { role: string }).role, "assistant");
assert.match(JSON.stringify(captured[0]?.messages[2]), /do the thing/);
assert.match(JSON.stringify(captured[0]?.messages[2]), /Do not answer the text/);
assert.match(JSON.stringify(captured[0]?.messages[2]), /<<<\\ndo the thing\\n>>>/);
assert.equal(sent, "better prompt");

const questionCapture: string[] = [];
sent = undefined;
await commands["draft"].handler(
	"did you cut a new GH release",
	ctx({
		modelRegistry: {
			find: () => undefined,
			hasConfiguredAuth: () => true,
			complete: async (_model: unknown, context: { messages: Array<{ content?: Array<{ text?: string }> }> }) => {
				questionCapture.push(context.messages.at(-1)?.content?.[0]?.text ?? "");
				return {
					role: "assistant",
					content: [{ type: "text", text: "better prompt" }],
					stopReason: "stop",
				};
			},
		},
		ui: {
			...baseUi,
			select: async () => "Accept",
		},
	}) as never,
);
assert.match(questionCapture[0] ?? "", /Do not answer the text/);
assert.match(questionCapture[0] ?? "", /not the session agent/);
assert.match(questionCapture[0] ?? "", /<<<\ndid you cut a new GH release\n>>>/s);
assert.equal((questionCapture[0] ?? "").trim().startsWith("did you cut"), false);
assert.equal(sent, "better prompt");

const sideCapture: string[] = [];
sent = undefined;
notices.length = 0;
await commands["side-question"].handler(
	"is that the best fix?",
	ctx({
		modelRegistry: {
			find: () => undefined,
			hasConfiguredAuth: () => true,
			complete: async (_model: unknown, context: { messages: Array<{ content?: Array<{ text?: string }> }> }) => {
				sideCapture.push(context.messages.at(-1)?.content?.[0]?.text ?? "");
				return {
					role: "assistant",
					content: [{ type: "text", text: "yes, wrap it" }],
					stopReason: "stop",
				};
			},
		},
		ui: {
			...baseUi,
			select: async () => "Dismiss",
		},
	}) as never,
);
assert.equal(sent, undefined);
assert.match(sideCapture[0] ?? "", /Answer the boxed question/);
assert.match(sideCapture[0] ?? "", /<<<\nis that the best fix\?\n>>>/s);
assert.equal(sideCapture[0]?.includes("Do not rewrite it into a prompt"), true);
assert.equal(notices.at(-1), "Dismissed");

notices.length = 0;
await commands["side-question"].handler("", ctx() as never);
assert.equal(notices[0], "Usage: /side-question <text>");

const asked: number[] = [];
let askStep = 0;
sent = undefined;
await commands["side-question"].handler(
	"first question",
	ctx({
		modelRegistry: {
			find: () => undefined,
			hasConfiguredAuth: () => true,
			complete: async (_model: unknown, context: { messages: unknown[] }) => {
				asked.push(context.messages.length);
				return {
					role: "assistant",
					content: [{ type: "text", text: `a${asked.length}` }],
					stopReason: "stop",
				};
			},
		},
		ui: {
			...baseUi,
			editor: async (title: string) => {
				if (title === "Ask again") return "and why";
				return undefined;
			},
			select: async () => {
				askStep += 1;
				return askStep === 1 ? "Ask again" : "Dismiss";
			},
		},
	}) as never,
);
assert.deepEqual(asked, [1, 3]);
assert.equal(sent, undefined);

const toolCapture: { tools?: Array<{ name: string }>; roles?: Array<string | undefined>; blob?: string } = {};
sent = undefined;
await commands["draft"].handler(
	"after tools",
	ctx({
		sessionManager: {
			getEntries: () => [
				{
					type: "message",
					id: "u1",
					parentId: null,
					timestamp: "2026-01-01T00:00:00.000Z",
					message: { role: "user", content: [{ type: "text", text: "read it" }], timestamp: 1 },
				},
				{
					type: "message",
					id: "a1",
					parentId: "u1",
					timestamp: "2026-01-01T00:00:01.000Z",
					message: {
						role: "assistant",
						content: [{ type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } }],
						timestamp: 2,
					},
				},
				{
					type: "message",
					id: "t1",
					parentId: "a1",
					timestamp: "2026-01-01T00:00:02.000Z",
					message: {
						role: "toolResult",
						toolCallId: "c1",
						toolName: "read",
						content: [{ type: "text", text: "ok" }],
						timestamp: 3,
					},
				},
			],
			getLeafId: () => "t1",
		},
		modelRegistry: {
			find: () => undefined,
			hasConfiguredAuth: () => true,
			complete: async (_model: unknown, context: { tools?: Array<{ name: string }>; messages: Array<{ role?: string; content?: unknown }> }) => {
				toolCapture.tools = context.tools;
				toolCapture.roles = context.messages.map((message) => message.role);
				toolCapture.blob = JSON.stringify(context.messages);
				return {
					role: "assistant",
					content: [{ type: "text", text: "better prompt" }],
					stopReason: "stop",
				};
			},
		},
		ui: {
			...baseUi,
			select: async () => "Accept",
		},
	}) as never,
);
assert.equal(toolCapture.tools, undefined);
assert.equal(toolCapture.roles?.includes("toolResult"), false);
assert.match(toolCapture.blob ?? "", /called read/);
assert.match(toolCapture.blob ?? "", /a\.ts/);
assert.match(toolCapture.blob ?? "", /read result/);

for (const role of ["user", "toolResult"]) {
	const imageCapture: Array<{ type?: string; mimeType?: string; text?: string }> = [];
	sent = undefined;
	await commands["draft"].handler(
		"after image",
		ctx({
			model: { id: "claude-opus-5", provider: "anthropic", api: "anthropic-messages" },
			sessionManager: {
				getEntries: () => [
					{
						type: "message",
						id: "u1",
						parentId: null,
						timestamp: "2026-01-01T00:00:00.000Z",
						message: {
							role,
							...(role === "toolResult" ? { toolCallId: "image", toolName: "browser", isError: false } : {}),
							content: [
								{
									type: "image",
									data: "Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAAATCwAAEwsAAAAAAAAAAAAAAAD/AA==",
									mimeType: "image/bmp",
								},
							],
							timestamp: 1,
						},
					},
				],
				getLeafId: () => "u1",
			},
			modelRegistry: {
				find: () => undefined,
				hasConfiguredAuth: () => true,
				complete: async (_model: unknown, context: { messages: Array<{ content?: Array<{ type?: string; mimeType?: string; text?: string }> }> }) => {
					imageCapture.push(...(context.messages[0]?.content ?? []));
					return {
						role: "assistant",
						content: [{ type: "text", text: "better prompt" }],
						stopReason: "stop",
					};
				},
			},
			ui: {
				...baseUi,
				select: async () => "Accept",
			},
		}) as never,
	);
	assert.equal(imageCapture.some((part) => part.type === "image"), false);
	assert.match(imageCapture.map((part) => part.text ?? "").join("\n"), /does not support this image type/);
}

// Activity spans the off-transcript call and its dialogs, including overlap and reload.
const activity = (bus = events) => {
	let count: number | undefined;
	bus.emit("fitch:write-prompt:status", { reply: (value: number) => { count = value; } });
	return count;
};
assert.equal(activity(), 0);
let closeDraft!: (value: string) => void;
let closeQuestion!: (value: string) => void;
let dialogsReady!: () => void;
let dialogs = 0;
const readyDialogs = new Promise<void>((resolve) => { dialogsReady = resolve; });
const waiting = (close: (value: (answer: string) => void) => void) => ctx({
	ui: { ...baseUi, select: () => new Promise<string>((resolve) => {
		close(resolve);
		if (++dialogs === 2) dialogsReady();
	}) },
});
const pendingDraft = commands.draft.handler("draft activity", waiting((close) => { closeDraft = close; }) as never);
const pendingQuestion = commands["side-question"].handler("question activity", waiting((close) => { closeQuestion = close; }) as never);
assert.equal(activity(), 2);
await readyDialogs;
assert.equal(activity(), 2, "finishing the model call does not finish the command's unsaved dialog");
const reloadedEvents = createEventBus();
writePrompt({ events: reloadedEvents, registerCommand() {} } as never);
assert.equal(activity(reloadedEvents), 2, "reload must not hide commands still finishing in the old instance");
closeDraft("Deny");
await pendingDraft;
assert.equal(activity(reloadedEvents), 1);
closeQuestion("Dismiss");
await pendingQuestion;
assert.equal(activity(), 0);
await assert.rejects(commands.draft.handler("dialog throws", ctx({ ui: { ...baseUi, select: async () => { throw new Error("dialog failure"); } } }) as never), /dialog failure/);
assert.equal(activity(), 0, "finally releases activity even on a thrown dialog error");

// Closing a cancelled TUI loader is not proof that its API promise has settled.
const { initTheme } = await import("@earendil-works/pi-coding-agent");
initTheme("dark");
let releaseCompletion!: (value: unknown) => void;
let markStarted!: () => void;
let markSettled!: () => void;
let view: { handleInput(data: string): void; dispose(): void };
let apiSignal: AbortSignal | undefined;
const started = new Promise<void>((resolve) => { markStarted = resolve; });
const settled = new Promise<void>((resolve) => { markSettled = resolve; });
let doneCount = 0;
const cancelledWriter = commands.draft.handler("cancel pending API", ctx({
	mode: "tui",
	modelRegistry: {
		find: () => undefined, hasConfiguredAuth: () => true,
		complete: (_model: unknown, _context: unknown, options: { signal?: AbortSignal }) => {
			apiSignal = options.signal;
			markStarted();
			return new Promise((resolve) => { releaseCompletion = resolve; });
		},
	},
	ui: { ...baseUi, custom: (factory: Function) => new Promise((resolve) => {
		view = factory({ requestRender() {} }, { fg: (_color: string, value: string) => value }, {}, (value: unknown) => {
			view.dispose();
			resolve(value);
			if (++doneCount === 2) markSettled();
		});
	}) },
}) as never);
await started;
view!.handleInput("\x1b");
await cancelledWriter;
assert.equal(apiSignal?.aborted, true);
assert.ok(activity()! > 0, "an unsettled API call remains busy after its dialog closes");
releaseCompletion({ role: "assistant", content: [], stopReason: "aborted" });
await settled;
assert.equal(activity(), 0);

// Exercise the actual TUI menu and keyboard selection, including the recovery action.
for (const action of ["Accept", "Restore original"] as const) {
	let calls = 0;
	let editorText = "";
	let idle = true;
	sent = undefined;
	await commands.draft.handler("original TUI input", ctx({
		mode: "tui",
		isIdle: () => idle,
		ui: {
			...baseUi,
			setEditorText: (text: string) => { editorText = text; },
			custom: async (factory: Function) => {
				if (++calls === 1) return "better prompt";
				return new Promise((resolve) => {
					const menu = factory(
						{ requestRender() {} },
						{ fg: (_color: string, text: string) => text },
						{},
						resolve,
					);
					const screen = menu.render(80).join("\n");
					assert.match(screen, /better prompt/);
					assert.match(screen, /Restore original/);
					for (let i = 0; i < WRITE_PROMPT_ACTIONS.indexOf(action); i++) menu.handleInput("\x1b[B");
					idle = false;
					menu.handleInput("\r");
				});
			},
		},
	}) as never);
	if (action === "Accept") {
		assert.equal(sent, "better prompt");
		assert.deepEqual(sendOptions, { deliverAs: "steer" });
	} else {
		assert.equal(sent, undefined);
		assert.equal(editorText, "/draft original TUI input");
	}
}

console.log("write-prompt regression ok");
