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
	WRITE_PROMPT_ACTIONS,
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

const commands: Record<string, { handler: (args: string, ctx: never) => Promise<void> }> = {};
let sent: string | undefined;
writePrompt({
	registerCommand(name: string, config: { handler: (args: string, ctx: never) => Promise<void> }) {
		commands[name] = config;
	},
	sendUserMessage(content: string) {
		sent = content;
	},
} as never);
assert.equal(typeof commands["write-prompt"]?.handler, "function");

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
await commands["write-prompt"].handler("", ctx() as never);
assert.equal(notices[0], "Usage: /write-prompt <text>");
assert.equal(sent, undefined);

notices.length = 0;
await commands["write-prompt"].handler("do the thing", ctx({ hasUI: false }) as never);
assert.match(notices[0] ?? "", /interactive UI/);

notices.length = 0;
await commands["write-prompt"].handler("do the thing", ctx({ isIdle: () => false }) as never);
assert.equal(notices[0], "Agent is busy");

sent = undefined;
await commands["write-prompt"].handler(
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
await commands["write-prompt"].handler(
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
await commands["write-prompt"].handler(
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
			editor: async (title: string, prefill?: string) => {
				if (title === "Tweak notes") return "shorter";
				return prefill;
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

writeFileSync(join(agentDir, WRITE_PROMPT_FILE), `${JSON.stringify({ model: "anthropic/claude-opus-5" })}\n`);
let found: { provider: string; id: string } | undefined;
sent = undefined;
await commands["write-prompt"].handler(
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
assert.equal(sent, "claude-opus-5");

console.log("write-prompt regression ok");
