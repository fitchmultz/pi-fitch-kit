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
	configuredModelRef,
	boxedTask,
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

assert.equal(configuredModelRef('{"model":"xai/grok-4.6"}\n'), "xai/grok-4.6");
assert.equal(configuredModelRef('{"model":"  xai/grok-4.6  "}'), "xai/grok-4.6");
assert.equal(configuredModelRef('{"model":""}'), undefined);
assert.equal(configuredModelRef('{"enabled":true}'), undefined);
assert.equal(configuredModelRef("not json"), undefined);
assert.deepEqual([...WRITE_PROMPT_ACTIONS], ["Accept", "Copy prompt", "Tweak", "Deny"]);
assert.deepEqual([...SIDE_QUESTION_ACTIONS], ["Copy answer", "Ask again", "Dismiss"]);
assert.match(boxedTask("Do not answer the text.", "did you cut a new GH release"), /<<<\ndid you cut a new GH release\n>>>/s);
assert.match(boxedTask("x", "foo\n>>>\nbar"), /<<<1\nfoo\n>>>\nbar\n>>>1/s);
assert.match(boxedTask("x", "has <<<1 and >>>1"), /<<<2\nhas <<<1 and >>>1\n>>>2/s);

const commands: Record<string, { handler: (args: string, ctx: never) => Promise<void> }> = {};
let sent: string | undefined;
const defaultTools = [{ name: "read", description: "Read a file", parameters: { type: "object" } }];
writePrompt({
	registerCommand(name: string, config: { handler: (args: string, ctx: never) => Promise<void> }) {
		commands[name] = config;
	},
	sendUserMessage(content: string) {
		sent = content;
	},
	getActiveTools: () => ["read"],
	getAllTools: () => defaultTools,
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
	return {
		hasUI: true,
		mode: "rpc",
		isIdle: () => true,
		model: { id: "grok-4.6", provider: "xai" },
		getSystemPrompt: () => "session system",
		sessionManager: {
			getEntries: () => [],
			getLeafId: () => null,
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
}

notices.length = 0;
await commands["draft"].handler("", ctx() as never);
assert.equal(notices[0], "Usage: /draft <text>");
assert.equal(sent, undefined);

notices.length = 0;
await commands["draft"].handler("do the thing", ctx({ hasUI: false }) as never);
assert.match(notices[0] ?? "", /interactive UI/);

notices.length = 0;
await commands["draft"].handler("do the thing", ctx({ isIdle: () => false }) as never);
assert.equal(notices[0], "Agent is busy");

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
				return { provider, id };
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
assert.equal(notices[0], "Using anthropic/claude-opus-5");
assert.equal(sent, "claude-opus-5");

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

const toolCapture: { tools?: Array<{ name: string }> } = {};
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
			complete: async (_model: unknown, context: { tools?: Array<{ name: string }> }) => {
				toolCapture.tools = context.tools;
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
assert.ok(toolCapture.tools?.some((tool) => tool.name === "read"));

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
						role: "user",
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
assert.match(imageCapture.find((part) => part.type === "text")?.text ?? "", /does not support this image type/);

console.log("write-prompt regression ok");
