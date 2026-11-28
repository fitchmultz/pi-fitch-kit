import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as piAi from "@earendil-works/pi-ai";
import type { RegisteredCommand } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { gate, type DrivenCommand } from "./test-harness.ts";

const agentDir = mkdtempSync(join(tmpdir(), "pi-kit-write-prompt-"));
process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
process.env.PI_CODING_AGENT_DIR = agentDir;

const {
	default: writePrompt,
	parseModelRef,
	boxedTask,
	flattenToolHistory,
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

assert.match(
	boxedTask("Do not answer the text.", "did you cut a new GH release"),
	/<<<\ndid you cut a new GH release\n>>>/s,
);
assert.match(boxedTask("x", "foo\n>>>\nbar"), /<<<1\nfoo\n>>>\nbar\n>>>1/s);
assert.match(boxedTask("x", "has <<<1 and >>>1"), /<<<2\nhas <<<1 and >>>1\n>>>2/s);

// Text and screenshots from browser/MCP results retain their original order.
const resultContent = [
	{ type: "text" as const, text: "before" },
	{ type: "image" as const, data: "first-image", mimeType: "image/png" },
	{ type: "text" as const, text: "between" },
	{ type: "image" as const, data: "second-image", mimeType: "image/jpeg" },
	{ type: "text" as const, text: "after" },
];
for (const isError of [false, true]) {
	const imageResult = {
		role: "toolResult" as const,
		toolCallId: "images",
		toolName: "browser",
		content: resultContent,
		isError,
		timestamp: 7,
	};
	const before = structuredClone(imageResult);
	assert.deepEqual(flattenToolHistory([imageResult]), [
		{
			role: "user",
			content: [
				{ type: "text", text: `[browser ${isError ? "error" : "result"}]` },
				...resultContent,
			],
			timestamp: 7,
		},
	]);
	assert.deepEqual(imageResult, before, "flattening must not mutate source history");
}

// Off-transcript history drops thinking blocks and signatures so mutated turns do not break
// thinking-model replay on GPT-6.2, Claude, or Gemini.
const assistantBase = {
	role: "assistant" as const,
	api: "openai-responses" as const,
	provider: "openai",
	model: "gpt-6.2-sol",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "toolUse" as const,
	timestamp: 8,
};
const toolAssistant = {
	...assistantBase,
	content: [
		{
			type: "thinking" as const,
			thinking: "internal reasoning",
			thinkingSignature: "sig_tool",
		},
		{
			type: "thinking" as const,
			thinking: "",
			thinkingSignature: "sig_redacted",
			redacted: true,
		},
		{
			type: "text" as const,
			text: "Checking the file.",
			textSignature: '{"v":1,"id":"msg_1","phase":"commentary"}',
		},
		{
			type: "toolCall" as const,
			id: "call_1",
			name: "read",
			arguments: { path: "README.md" },
		},
	],
};
const plainThinkingAssistant = {
	...assistantBase,
	stopReason: "stop" as const,
	content: [
		{
			type: "thinking" as const,
			thinking: "later reasoning",
			thinkingSignature: "sig_later",
		},
		{
			type: "text" as const,
			text: "Done.",
			textSignature: '{"v":1,"id":"msg_2","phase":"final_answer"}',
		},
	],
};
const thinkingOnlyAssistant = {
	...assistantBase,
	stopReason: "stop" as const,
	content: [
		{
			type: "thinking" as const,
			thinking: "",
			thinkingSignature: "sig_only",
		},
	],
};
const assistantSnapshot = structuredClone([
	toolAssistant,
	plainThinkingAssistant,
	thinkingOnlyAssistant,
]);
assert.deepEqual(
	flattenToolHistory([toolAssistant, plainThinkingAssistant, thinkingOnlyAssistant]),
	[
		{
			...toolAssistant,
			content: [
				{ type: "text", text: "Checking the file." },
				{ type: "text", text: '[called read {"path":"README.md"}]' },
			],
		},
		{
			...plainThinkingAssistant,
			content: [{ type: "text", text: "Done." }],
		},
		{
			...thinkingOnlyAssistant,
			content: [{ type: "text", text: "[empty]" }],
		},
	],
);
assert.deepEqual(
	[toolAssistant, plainThinkingAssistant, thinkingOnlyAssistant],
	assistantSnapshot,
	"assistant flattening must not mutate source history",
);

// Post-providerSummary compaction transcripts start with system(providerSummary) + assistant.
// On hosts that export getProviderSummaryStandIn (Fitch Pi), flattening prepends the host's
// stand-in user message so Anthropic/Gemini do not reject a leading assistant turn, and never
// duplicates it when messages already start with user. On official Pi (no providerSummary),
// flattening leaves the transcript without a fabricated stand-in.
const hasProviderSummaryStandIn =
	typeof Reflect.get(piAi, "getProviderSummaryStandIn") === "function";
const anthropicSummarySystem = {
	role: "system" as const,
	content: "session system",
	providerSummary: {
		provider: "anthropic",
		api: "anthropic-messages",
		model: "claude-opus-5",
		block: { type: "compaction", content: "Prior architecture decisions." },
		timestamp: 42,
	},
	timestamp: 1,
};
const anthropicSummaryInput = [anthropicSummarySystem, plainThinkingAssistant];
const anthropicSummarySnapshot = structuredClone(anthropicSummaryInput);
const anthropicFlattened = flattenToolHistory(anthropicSummaryInput);
const flattenedPlainAssistant = {
	...plainThinkingAssistant,
	content: [{ type: "text", text: "Done." }],
};
if (hasProviderSummaryStandIn) {
	assert.deepEqual(anthropicFlattened, [
		{
			role: "user",
			content: "Summary of the earlier conversation:\n\nPrior architecture decisions.",
			timestamp: 42,
		},
		flattenedPlainAssistant,
	]);
	assert.equal(anthropicFlattened[0]?.role, "user");
	assert.deepEqual(
		flattenToolHistory(anthropicFlattened),
		anthropicFlattened,
		"flattening a transcript that already starts with user must not duplicate the stand-in",
	);
} else {
	assert.deepEqual(anthropicFlattened, [flattenedPlainAssistant]);
}
assert.deepEqual(
	anthropicSummaryInput,
	anthropicSummarySnapshot,
	"providerSummary flattening must not mutate source history",
);

const openaiSummarySystem = {
	role: "system" as const,
	content: "session system",
	providerSummary: {
		provider: "openai",
		api: "openai-responses",
		model: "gpt-6.2-sol",
		block: { type: "compaction", encrypted_content: "SYNTHETIC_COMPACTION" },
	},
	timestamp: 12,
};
const openaiFlattened = flattenToolHistory([openaiSummarySystem, plainThinkingAssistant]);
if (hasProviderSummaryStandIn) {
	assert.deepEqual(openaiFlattened, [
		{
			role: "user",
			content:
				"The earlier conversation was summarized. Its summary is not available to this model.",
			timestamp: 12,
		},
		flattenedPlainAssistant,
	]);
	assert.equal(openaiFlattened[0]?.role, "user");
} else {
	assert.deepEqual(openaiFlattened, [flattenedPlainAssistant]);
}

const plainSystemWithUser = [
	{ role: "system" as const, content: "session system", timestamp: 1 },
	{ role: "user" as const, content: "first real user turn", timestamp: 2 },
	plainThinkingAssistant,
];
assert.deepEqual(flattenToolHistory(plainSystemWithUser), [
	{ role: "user", content: "first real user turn", timestamp: 2 },
	{
		...plainThinkingAssistant,
		content: [{ type: "text", text: "Done." }],
	},
]);

const commands: Record<string, { handler: RegisteredCommand["handler"] }> = {};
let sent: string | undefined;
let sendOptions: { deliverAs?: string } | undefined;
let sendFailure: Error | undefined;
type SavedDraft = {
	type: "custom";
	customType: string;
	data: { source: string; draft: string };
};
const savedDrafts: Array<SavedDraft> = [];

/* oxlint-disable typescript/no-unsafe-type-assertion -- QX-002: the write-prompt entry
 * demands the complete ExtensionAPI and its handlers demand the complete
 * ExtensionCommandContext. This regression drives both with partial recorders; the
 * narrowing casts live only at these two boundaries, matching the harness allowance. */
writePrompt({
	registerCommand: (name: string, config: { handler: RegisteredCommand["handler"] }) => {
		commands[name] = config;
	},
	sendUserMessage: (content: string, options?: { deliverAs?: string }) => {
		if (sendFailure !== undefined) {
			throw sendFailure;
		}
		sent = content;
		sendOptions = options;
	},
	appendEntry: (customType: string, data: { source: string; draft: string }) => {
		savedDrafts.push({ type: "custom", customType, data: structuredClone(data) });
	},
} as unknown as Parameters<typeof writePrompt>[0]);

/** The command under one name as the loose callable this regression drives. */
const writerCommand = (name: string): DrivenCommand => {
	const registered = commands[name];
	if (registered === undefined) {
		throw new Error(`missing command registration: ${name}`);
	}
	return { handler: registered.handler as unknown as DrivenCommand["handler"] };
};
/* oxlint-enable typescript/no-unsafe-type-assertion */

const notices: string[] = [];
const baseUi = {
	notify(message: string) {
		notices.push(message);
	},
	editor: async (_title: string, prefill?: string) => prefill,
	select: async () => {
		return;
	},
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
			getBranch: (): SavedDraft[] => [],
		},
		modelRegistry: {
			find: () => {
				return;
			},
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
		sessionManager: {
			getSessionId: () => "session",
			getHeader: () => null,
			...context.sessionManager,
		},
		modelRegistry: {
			...registry,
			streamSimple: (...args: unknown[]): { result: () => unknown } => ({
				result: (): unknown => Reflect.apply(registry.complete, registry, args) as unknown,
			}),
		},
	};
}

// Independent fields inherit from the session; the legacy provider/id form stays valid.
for (const [config, expected] of [
	[undefined, ["xai", "grok-4.6", "high"]],
	[{}, ["xai", "grok-4.6", "high"]],
	[
		{ provider: " alternate ", model: " other ", thinkingLevel: "low" },
		["alternate", "other", "low"],
	],
	[{ provider: "alternate" }, ["alternate", "grok-4.6", "high"]],
	[{ model: "other" }, ["xai", "other", "high"]],
	[{ thinkingLevel: "medium" }, ["xai", "grok-4.6", "medium"]],
	[{ model: "alternate/other" }, ["alternate", "other", "high"]],
	[{ provider: "alternate", model: "vendor/other" }, ["alternate", "vendor/other", "high"]],
	[{ thinkingLevel: "off" }, ["xai", "grok-4.6", undefined]],
	[{ thinkingLevel: "max" }, ["xai", "grok-4.6", "high"]],
] as const) {
	const path = join(agentDir, WRITE_PROMPT_FILE);
	if (config === undefined) {
		rmSync(path, { force: true });
	} else {
		writeFileSync(path, JSON.stringify(config));
	}
	const calls: unknown[][] = [];
	const context = ctx({
		modelRegistry: {
			find: (provider: string, id: string) => ({ provider, id, reasoning: true }),
			hasConfiguredAuth: () => true,
			complete: async (
				model: { provider: string; id: string },
				_context: unknown,
				options: { reasoning?: string },
			) => {
				calls.push([model.provider, model.id, options.reasoning]);
				return {
					role: "assistant",
					content: [{ type: "text", text: "configured draft" }],
					stopReason: "stop",
				};
			},
		},
		ui: { ...baseUi, select: async () => "Deny" },
	});
	const originalModel = context.model;
	await writerCommand("draft").handler("configuration test", context);
	assert.deepEqual(calls, [expected], JSON.stringify(config));
	assert.equal(context.model, originalModel, "writer selection must not change the active model");
	assert.equal(context.thinkingLevel, "high", "writer selection must not change session thinking");
	if (config && "thinkingLevel" in config && config.thinkingLevel === "max") {
		assert.ok(notices.some((text) => /does not support max thinking; using high/.test(text)));
	}
}

for (const [raw, diagnostic] of [
	["not json", /not valid JSON/],
	["null", /Expected an object/],
	["[]", /Expected an object/],
	['{"provider":false}', /provider must be a non-empty string/],
	['{"provider":2}', /provider must be a non-empty string/],
	['{"model":""}', /model must be a non-empty string/],
	['{"thinkingLevel":"extreme"}', /thinkingLevel must be one of:/],
	['{"thinking":"low"}', /Unknown field: thinking/],
	['{"model":"missing"}', /Unknown model: xai\/missing/],
	['{"provider":"unauthenticated"}', /No auth for unauthenticated\/grok-4\.6/],
] as const) {
	writeFileSync(join(agentDir, WRITE_PROMPT_FILE), raw);
	notices.length = 0;
	let called = false;
	await writerCommand("draft").handler(
		"invalid configuration",
		ctx({
			modelRegistry: {
				find: (provider: string, id: string) =>
					id === "missing" ? undefined : { provider, id, reasoning: true },
				hasConfiguredAuth: (model: { provider: string }) => model.provider !== "unauthenticated",
				complete: async () => {
					called = true;
					throw new Error("must not call a model");
				},
			},
		}),
	);
	assert.equal(called, false, raw);
	assert.match(notices[0] ?? "", /^write-prompt\.json: /);
	assert.match(notices[0] ?? "", diagnostic, raw);
}
rmSync(join(agentDir, WRITE_PROMPT_FILE));

notices.length = 0;
await writerCommand("draft").handler("", ctx());
assert.equal(notices[0], "Usage: /draft <text>");
assert.equal(sent, undefined);

notices.length = 0;
await writerCommand("draft").handler("do the thing", ctx({ hasUI: false }));
const interactiveNotice = notices.at(0);
assert.ok(interactiveNotice !== undefined, "expected an interactive-UI notice");
assert.match(interactiveNotice, /interactive UI/);

sent = undefined;
await writerCommand("draft").handler(
	"do the thing",
	ctx({
		ui: {
			...baseUi,
			select: async () => "Accept",
		},
	}),
);
assert.equal(sent, "better prompt");
assert.equal(sendOptions, undefined, "idle acceptance keeps normal delivery");

sent = undefined;
await writerCommand("draft").handler(
	"do the thing",
	ctx({
		ui: {
			...baseUi,
			select: async () => "Deny",
		},
	}),
);
assert.equal(sent, undefined);

sent = undefined;
let idleNow = true;
await writerCommand("draft").handler(
	"busy acceptance",
	ctx({
		isIdle: () => idleNow,
		ui: {
			...baseUi,
			select: async () => {
				idleNow = false;
				return "Accept";
			},
		},
	}),
);
assert.equal(sent, "better prompt", "Accept must not discard a draft when the agent becomes busy");
assert.deepEqual(sendOptions, { deliverAs: "steer" });

// Busy from the start is valid too, including recovery after a failed send.
sent = undefined;
await writerCommand("draft").handler(
	"already busy",
	ctx({
		isIdle: () => false,
		ui: { ...baseUi, select: async () => "Accept" },
	}),
);
assert.equal(sent, "better prompt");
assert.deepEqual(sendOptions, { deliverAs: "steer" });

// A synchronous send failure leaves the same dialog open, with no rewrite
// or automatic retry. Both exact inputs are saved before the send attempt.
sent = undefined;
sendFailure = new Error("send unavailable");
let attempts = 0;
const original = "original input\nwith a second line  ";
await writerCommand("draft").handler(
	original,
	ctx({
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
	}),
);
assert.equal(attempts, 2);
assert.equal(sent, "better prompt");

// Reopening needs no model request; the original is available in the editor.
let restored: string | undefined;
const recovery = ctx({
	modelRegistry: {
		complete: () => {
			throw new Error("recovery must not rewrite");
		},
	},
	ui: {
		...baseUi,
		select: async (title: string) => {
			assert.equal(title, "better prompt");
			return "Restore original";
		},
		setEditorText: (text: string) => {
			restored = text;
		},
	},
});
recovery.sessionManager.getBranch = () => savedDrafts;
await writerCommand("draft").handler("", recovery);
assert.equal(restored, `/draft ${original}`);
assert.equal(notices.at(-1), "Original restored to editor");

// A broken writer override must not prevent recovering already-written input.
writeFileSync(join(agentDir, WRITE_PROMPT_FILE), "invalid json");
restored = undefined;
await writerCommand("draft").handler("", recovery);
assert.equal(
	restored,
	`/draft ${original}`,
	"saved recovery does not require a working writer configuration",
);
rmSync(join(agentDir, WRITE_PROMPT_FILE));

// Rewrite flavors share UI guards. Native HTTP fixtures own the new
// flavor's instruction transport, delivery, and journal-backed isolation.
for (const command of ["ambitious", "unreasonable", "ste"]) {
	notices.length = 0;
	sent = undefined;
	await writerCommand(command).handler("", ctx());
	assert.equal(notices[0], `Usage: /${command} <text>`);
	assert.equal(sent, undefined, "an empty rewrite must not send");

	notices.length = 0;
	await writerCommand(command).handler("no UI", ctx({ hasUI: false }));
	const noUiNotice = notices.at(0);
	assert.ok(noUiNotice !== undefined, "expected an interactive-UI notice");
	assert.match(noUiNotice, /interactive UI/);
}

sent = undefined;
let ambitiousTask: string | undefined;
await writerCommand("ambitious").handler(
	"raise the thing",
	ctx({
		modelRegistry: {
			find: () => {
				return;
			},
			hasConfiguredAuth: () => true,
			complete: async (
				_model: unknown,
				context: { messages: Array<{ content: Array<{ type: string; text?: string }> }> },
			) => {
				ambitiousTask = (context.messages[0]?.content ?? [])
					.map((part) => part.text ?? "")
					.join("");
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
	}),
);
assert.match(ambitiousTask ?? "", /more ambitious coding-agent prompt/);
assert.match(ambitiousTask ?? "", /<<<\nraise the thing\n>>>/);
assert.doesNotMatch(
	ambitiousTask ?? "",
	/Rewrite the boxed text into a better coding-agent prompt/,
);
assert.equal(sent, "better prompt");
assert.equal(sendOptions, undefined, "idle acceptance keeps normal delivery");

sent = undefined;
let ambitiousIdle = true;
await writerCommand("ambitious").handler(
	"busy raise",
	ctx({
		isIdle: () => ambitiousIdle,
		ui: {
			...baseUi,
			select: async () => {
				ambitiousIdle = false;
				return "Accept";
			},
		},
	}),
);
assert.equal(
	sent,
	"better prompt",
	"Accept must not discard an ambitious draft when the agent becomes busy",
);
assert.deepEqual(sendOptions, { deliverAs: "steer" });

// Recovery is scoped per command: an ambitious entry reopens through
// /ambitious without a writer call and restores the /ambitious invocation.
sent = undefined;
let ambitiousRestored: string | undefined;
const ambitiousOriginal = "ambitious original input";
savedDrafts.push({
	type: "custom",
	customType: "fitch-kit.ambitious",
	data: { source: ambitiousOriginal, draft: "ambitious prompt" },
});
const ambitiousRecovery = ctx({
	modelRegistry: {
		complete: () => {
			throw new Error("ambitious recovery must not rewrite");
		},
	},
	ui: {
		...baseUi,
		select: async (title: string) => {
			assert.equal(title, "ambitious prompt");
			return "Restore original";
		},
		setEditorText: (text: string) => {
			ambitiousRestored = text;
		},
	},
});
ambitiousRecovery.sessionManager.getBranch = () => savedDrafts;
await writerCommand("ambitious").handler("", ambitiousRecovery);
assert.equal(ambitiousRestored, `/ambitious ${ambitiousOriginal}`);
assert.equal(notices.at(-1), "Original restored to editor");

// The plain command ignores ambitious entries entirely.
notices.length = 0;
let draftSawAmbitious: string | undefined;
const draftIsolation = ctx({
	modelRegistry: {
		complete: () => {
			throw new Error("isolation must not rewrite");
		},
	},
	ui: {
		...baseUi,
		select: async () => "Deny",
		setEditorText: (text: string) => {
			draftSawAmbitious = text;
		},
	},
});
draftIsolation.sessionManager.getBranch = () => {
	const entry = savedDrafts.findLast((draft) => draft.customType === "fitch-kit.ambitious");
	return entry === undefined ? [] : [entry];
};
await writerCommand("draft").handler("", draftIsolation);
assert.equal(
	notices[0],
	"Usage: /draft <text>",
	"saved /ambitious entries must not reopen as /draft",
);
assert.equal(draftSawAmbitious, undefined);

notices.length = 0;
await writerCommand("side-question").handler("busy question", ctx({ isIdle: () => false }));
assert.equal(notices[0], "Agent is busy", "side-question behavior is unchanged");

const seen: number[] = [];
let step = 0;
sent = undefined;
await writerCommand("draft").handler(
	"first draft",
	ctx({
		modelRegistry: {
			find: () => {
				return;
			},
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
				if (title === "Tweak notes") {
					return "shorter";
				}
				return;
			},
			select: async () => {
				step += 1;
				return step === 1 ? "Tweak" : "Accept";
			},
		},
	}),
);
assert.deepEqual(seen, [1, 3]);
assert.equal(sent, "v2");

// Provider failure during unreasonable Tweak must keep the reviewed draft,
// not silently send it or replace it with a partial failed response.
notices.length = 0;
sent = undefined;
let revisionCalls = 0;
let reviewCalls = 0;
await writerCommand("unreasonable").handler(
	"review only; do not edit",
	ctx({
		modelRegistry: {
			complete: async () =>
				++revisionCalls === 1
					? {
							role: "assistant",
							content: [{ type: "text", text: "retained unreasonable draft" }],
							stopReason: "stop",
						}
					: {
							role: "assistant",
							content: [{ type: "text", text: "partial" }],
							stopReason: "error",
							errorMessage: "revision unavailable",
						},
		},
		ui: {
			...baseUi,
			editor: async () => "make the review more exacting",
			select: async (title: string) => {
				assert.equal(title, "retained unreasonable draft");
				return ++reviewCalls === 1 ? "Tweak" : "Deny";
			},
		},
	}),
);
assert.equal(revisionCalls, 2);
assert.equal(reviewCalls, 2);
assert.ok(notices.includes("revision unavailable"));
assert.equal(sent, undefined);

sent = undefined;
let usedSelect = false;
let customCalls = 0;
await writerCommand("draft").handler(
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
	}),
);
assert.equal(usedSelect, false);
assert.equal(customCalls, 2);
assert.equal(sent, "better prompt");

sent = undefined;
const painted: string[][] = [];
let colorCalls = 0;
await writerCommand("draft").handler(
	"show me",
	ctx({
		mode: "tui",
		ui: {
			...baseUi,
			custom: async (
				factory?: (
					tui: { requestRender: () => void },
					theme: { fg: (color: string, text: string) => string },
					kb: unknown,
					done: (value: string) => void,
				) => unknown,
			) => {
				colorCalls += 1;
				if (colorCalls === 1 || !factory) {
					return colorCalls === 1 ? "better prompt" : "Accept";
				}
				try {
					factory(
						{
							requestRender() {
								return;
							},
						},
						{
							fg(color: string, text: string) {
								painted.push([color, text]);
								return text;
							},
						},
						{},
						() => {
							return;
						},
					);
				} catch {
					// keyHint uses the live TUI theme; the draft color is painted first
				}
				return "Accept";
			},
		},
	}),
);
assert.ok(painted.some(([color, text]) => color === "text" && text === "better prompt"));
assert.equal(sent, "better prompt");

// Long drafts clip to the TUI viewport and scroll with PageUp/PageDown
// instead of being cut off. Select keys keep working through the same view.
const longDraft = Array.from(
	{ length: 40 },
	(_, i) => `line ${i + 1} of the rewritten prompt`,
).join("\n");
const themeKey = Symbol.for("@earendil-works/pi-coding-agent:theme");
const priorGlobalTheme: unknown = Reflect.get(globalThis, themeKey);
Reflect.set(globalThis, themeKey, { fg: (_color: string, text: string) => text });
type DialogView = {
	render: (width: number) => string[];
	invalidate: () => void;
	handleInput: (data: string) => unknown;
	handleMouse: (event: TuiMouseEvent) => TuiMouseEventResult | undefined;
};
let dialogFactory:
	| ((tui: unknown, theme: unknown, kb: unknown, done: (value: string) => void) => DialogView)
	| undefined;
const chosen: string[] = [];
let customSequence = 0;
sent = undefined;
await writerCommand("draft").handler(
	"tall draft",
	ctx({
		mode: "tui",
		modelRegistry: {
			find: () => {
				return;
			},
			hasConfiguredAuth: () => true,
			complete: async () => ({
				role: "assistant",
				content: [{ type: "text", text: longDraft }],
				stopReason: "stop",
			}),
		},
		ui: {
			...baseUi,
			custom: async (
				factory?: (
					tui: unknown,
					theme: unknown,
					kb: unknown,
					done: (value: string) => void,
				) => DialogView,
			) => {
				// First custom call is the off-transcript loader; the second is the dialog.
				customSequence += 1;
				if (customSequence === 1) {
					return longDraft;
				}
				if (factory) {
					dialogFactory = factory;
				}
				return "Accept";
			},
		},
	}),
);
assert.equal(sent, longDraft, "dialog acceptance still sends the full draft");
assert.ok(dialogFactory !== undefined, "the dialog view factory was invoked");
const fakeTheme = { fg: (_color: string, text: string) => text };
const smallTui = {
	requestRender() {
		return;
	},
	terminal: { rows: 20 },
};
const scrolledView = dialogFactory(smallTui, fakeTheme, {}, (value) => chosen.push(value));
const firstPage = scrolledView.render(80);
assert.ok(
	firstPage.length <= 15,
	`clipped dialog must fit a 20-row viewport minus the dock reserve, got ${firstPage.length}`,
);
assert.ok(
	firstPage.some((line) => /line 1 of/.test(line)),
	"starts at the top of the draft",
);
assert.ok(
	!firstPage.some((line) => /line 40 of/.test(line)),
	"the last line is initially below the fold",
);
assert.ok(
	firstPage.some((line) => /below/.test(line) && /scroll/.test(line)),
	"clipped drafts show a position indicator with the scroll keys",
);
for (let i = 0; i < 10; i += 1) {
	scrolledView.handleInput("\x1b[6~");
}
const bottom = scrolledView.render(80);
assert.ok(
	bottom.some((line) => /line 40 of/.test(line)),
	"PageDown reaches the last line",
);
assert.ok(
	bottom.some((line) => /above/.test(line)),
	"bottom page reports lines above",
);
assert.ok(!bottom.join("\n").includes("below"), "no lines remain below at the end");
for (let i = 0; i < 10; i += 1) {
	scrolledView.handleInput("\x1b[5~");
}
const backToTop = scrolledView.render(80);
assert.ok(
	backToTop.some((line) => /line 1 of/.test(line)),
	"PageUp returns to the top",
);
// The dialog renders in the editor dock slot under the chat tail and the
// footer; its budget must reserve for those dock-mates, and the indicator
// must stay one line even at widths where its natural text would wrap.
const narrowView = dialogFactory(
	{
		requestRender() {
			return;
		},
		terminal: { rows: 20 },
	},
	fakeTheme,
	{},
	(value) => chosen.push(value),
);
narrowView.handleInput("\x1b[6~");
const narrowPage = narrowView.render(50);
assert.ok(
	narrowPage.length <= 15,
	`clipped dialog must fit rows minus the five-line dock reserve, got ${narrowPage.length}`,
);
assert.ok(
	narrowPage.some((line) => /scroll/.test(line)),
	"the truncated indicator still names the scroll keys at width 50",
);
const firstPageAgain = scrolledView.render(80);
assert.ok(
	firstPageAgain.length <= 15,
	`wide clipped dialog must fit rows minus the dock reserve, got ${firstPageAgain.length}`,
);

const tallView = dialogFactory(
	{
		requestRender() {
			return;
		},
		terminal: { rows: 200 },
	},
	fakeTheme,
	{},
	(value) => chosen.push(value),
);
const full = tallView.render(80);
assert.ok(
	full.some((line) => /line 1 of/.test(line)) && full.some((line) => /line 40 of/.test(line)),
	"tall terminals show the whole draft",
);
assert.ok(!full.join("\n").match(/above|below/), "no indicator when nothing is clipped");
scrolledView.handleInput("\r");
assert.deepEqual(
	chosen,
	["Accept"],
	"Enter still confirms the action through the scrollable scrolledView",
);

const mouseAt = (type: TuiMouseEvent["type"], y: number, height: number): TuiMouseEvent => ({
	type,
	button: type === "wheel" ? "none" : "left",
	x: 2,
	y,
	screenX: 2,
	screenY: y + 7,
	width: 80,
	height,
	shift: false,
	alt: false,
	ctrl: false,
});
const draftRow = firstPageAgain.findIndex((line) => line.includes("line 1 of"));
assert.ok(draftRow >= 0);
const draftWheel = { ...mouseAt("wheel", draftRow, firstPageAgain.length), wheelDelta: 3 };
assert.deepEqual(scrolledView.handleMouse(draftWheel), { handled: true, render: true });
assert.match(scrolledView.render(80)[draftRow] ?? "", /line 4 of/);
assert.deepEqual(scrolledView.handleMouse({ ...draftWheel, wheelDelta: 100 }), {
	handled: true,
	render: true,
});
const wheelBottom = scrolledView.render(80);
assert.ok(wheelBottom.some((line) => line.includes("line 40 of")));
assert.deepEqual(scrolledView.handleMouse(draftWheel), { handled: true, render: false });
assert.deepEqual(scrolledView.handleMouse({ ...draftWheel, wheelDelta: -100 }), {
	handled: true,
	render: true,
});
assert.deepEqual(scrolledView.render(80), firstPageAgain);

const actionTop = firstPageAgain.findIndex((line) => line.includes("Accept"));
assert.ok(actionTop > draftRow);
const spacerWheel = { ...mouseAt("wheel", actionTop - 1, firstPageAgain.length), wheelDelta: -3 };
assert.deepEqual(scrolledView.handleMouse(spacerWheel), { handled: true, render: false });
const actionWheel = { ...mouseAt("wheel", actionTop, firstPageAgain.length), wheelDelta: 3 };
assert.deepEqual(scrolledView.handleMouse(actionWheel), { handled: true, render: true });
const actionSelected = scrolledView.render(80);
assert.equal(
	actionSelected[draftRow],
	firstPageAgain[draftRow],
	"menu wheel leaves the draft in place",
);
assert.match(actionSelected[actionTop + 1] ?? "", /^→ Copy prompt$/);

smallTui.terminal.rows = 200;
const resized = scrolledView.render(80);
const denyRow = resized.findIndex((line) => line.trim() === "Deny");
assert.ok(denyRow > actionTop);
assert.deepEqual(scrolledView.handleMouse(mouseAt("press", denyRow, resized.length)), {
	handled: true,
	focus: true,
});
assert.deepEqual(scrolledView.handleMouse(mouseAt("click", denyRow, resized.length)), {
	handled: true,
});
assert.deepEqual(chosen, ["Accept", "Deny"]);
Reflect.set(globalThis, themeKey, priorGlobalTheme);

notices.length = 0;
sent = undefined;
await writerCommand("draft").handler(
	"fail please",
	ctx({
		modelRegistry: {
			find: () => {
				return;
			},
			hasConfiguredAuth: () => true,
			complete: async () => ({
				role: "assistant",
				content: [{ type: "text", text: "partial" }],
				stopReason: "error",
				errorMessage: "boom",
			}),
		},
	}),
);
assert.equal(sent, undefined);
assert.equal(notices.at(-1), "boom");

writeFileSync(
	join(agentDir, WRITE_PROMPT_FILE),
	`${JSON.stringify({ model: "anthropic/claude-opus-5" })}\n`,
);
let found: { provider: string; id: string } | undefined;
sent = undefined;
notices.length = 0;
await writerCommand("draft").handler(
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
	}),
);
assert.deepEqual(found, { provider: "anthropic", id: "claude-opus-5" });
assert.equal(notices[0], "Using anthropic/claude-opus-5 (high thinking)");
assert.equal(sent, "claude-opus-5");
rmSync(join(agentDir, WRITE_PROMPT_FILE));

const captured: Array<{
	systemPrompt: string | undefined;
	messages: Array<{ role?: string; content?: unknown }>;
	cacheRetention: string | undefined;
	reasoningSummary: unknown;
}> = [];
sent = undefined;
await writerCommand("draft").handler(
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
			find: () => {
				return;
			},
			hasConfiguredAuth: () => true,
			complete: async (
				_model: unknown,
				context: { systemPrompt?: string; messages: Array<{ role?: string; content?: unknown }> },
				options?: { cacheRetention?: string; reasoningSummary?: unknown },
			) => {
				captured.push({
					systemPrompt: context.systemPrompt,
					messages: context.messages,
					cacheRetention: options?.cacheRetention,
					reasoningSummary: options?.reasoningSummary,
				});
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
	}),
);
assert.equal(captured.length, 1);
const firstCapture = captured[0];
if (firstCapture === undefined) {
	assert.fail("expected one captured completion request");
}
assert.equal(firstCapture.systemPrompt, "session system");
assert.equal(firstCapture.cacheRetention, "short");
assert.equal(firstCapture.reasoningSummary, null);
assert.equal(firstCapture.messages.length, 3);
assert.equal(firstCapture.messages[0]?.role, "user");
assert.equal(firstCapture.messages[1]?.role, "assistant");
assert.match(JSON.stringify(firstCapture.messages[2]), /do the thing/);
assert.match(JSON.stringify(firstCapture.messages[2]), /Do not answer the text/);
assert.match(
	JSON.stringify(firstCapture.messages[2]),
	/Preserve intent and every explicit constraint/,
);
assert.match(
	JSON.stringify(firstCapture.messages[2]),
	/without adding unrequested scope or presenting assumptions as requirements/,
);
assert.match(JSON.stringify(firstCapture.messages[2]), /phrase it as conditional/);
assert.match(JSON.stringify(firstCapture.messages[2]), /<<<\\ndo the thing\\n>>>/);
assert.equal(sent, "better prompt");

const questionCapture: string[] = [];
sent = undefined;
await writerCommand("draft").handler(
	"did you cut a new GH release",
	ctx({
		modelRegistry: {
			find: () => {
				return;
			},
			hasConfiguredAuth: () => true,
			complete: async (
				_model: unknown,
				context: { messages: Array<{ content?: Array<{ text?: string }> }> },
			) => {
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
	}),
);
assert.match(questionCapture[0] ?? "", /Do not answer the text/);
assert.match(questionCapture[0] ?? "", /not the session agent/);
assert.match(questionCapture[0] ?? "", /<<<\ndid you cut a new GH release\n>>>/s);
assert.equal((questionCapture[0] ?? "").trim().startsWith("did you cut"), false);
assert.equal(sent, "better prompt");

const sideCapture: string[] = [];
sent = undefined;
notices.length = 0;
await writerCommand("side-question").handler(
	"is that the best fix?",
	ctx({
		modelRegistry: {
			find: () => {
				return;
			},
			hasConfiguredAuth: () => true,
			complete: async (
				_model: unknown,
				context: { messages: Array<{ content?: Array<{ text?: string }> }> },
			) => {
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
	}),
);
assert.equal(sent, undefined);
assert.match(sideCapture[0] ?? "", /Answer the boxed question/);
assert.match(sideCapture[0] ?? "", /<<<\nis that the best fix\?\n>>>/s);
assert.equal(sideCapture[0]?.includes("Do not rewrite it into a prompt"), true);
assert.equal(notices.at(-1), "Dismissed");

notices.length = 0;
await writerCommand("side-question").handler("", ctx());
assert.equal(notices[0], "Usage: /side-question <text>");

const asked: number[] = [];
let askStep = 0;
sent = undefined;
await writerCommand("side-question").handler(
	"first question",
	ctx({
		modelRegistry: {
			find: () => {
				return;
			},
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
				if (title === "Ask again") {
					return "and why";
				}
				return;
			},
			select: async () => {
				askStep += 1;
				return askStep === 1 ? "Ask again" : "Dismiss";
			},
		},
	}),
);
assert.deepEqual(asked, [1, 3]);
assert.equal(sent, undefined);

for (const role of ["user", "toolResult"]) {
	const imageCapture: Array<{ type?: string; mimeType?: string; text?: string }> = [];
	const history = [
		{
			type: "message",
			id: "u1",
			parentId: null,
			timestamp: "2026-01-01T00:00:00.000Z",
			message: {
				role,
				...(role === "toolResult"
					? { toolCallId: "image", toolName: "browser", isError: false }
					: {}),
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
	];
	const saved = structuredClone(history);
	sent = undefined;
	await writerCommand("draft").handler(
		"after image",
		ctx({
			model: { id: "claude-opus-5", provider: "anthropic", api: "anthropic-messages" },
			sessionManager: {
				getEntries: () => history,
				getLeafId: () => "u1",
			},
			modelRegistry: {
				find: () => {
					return;
				},
				hasConfiguredAuth: () => true,
				complete: async (
					_model: unknown,
					context: {
						messages: Array<{
							content?: Array<{ type?: string; mimeType?: string; text?: string }>;
						}>;
					},
					options: { onPayload?: (payload: unknown) => Promise<unknown> },
				) => {
					imageCapture.push(...(context.messages[0]?.content ?? []));
					assert.equal(
						typeof options.onPayload,
						"function",
						"nested writer calls must guard the serialized payload",
					);
					const payload = {
						messages: [{ role: "user", content: [{ type: "text", text: "unchanged" }] }],
					};
					const onPayload = options.onPayload;
					if (onPayload === undefined) {
						assert.fail("expected an onPayload hook");
					}
					assert.equal(await onPayload(payload), payload);
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
		}),
	);
	assert.equal(
		imageCapture.some((part) => part.type === "image"),
		false,
	);
	assert.match(
		imageCapture.map((part) => part.text ?? "").join("\n"),
		/does not support this image type/,
	);
	assert.deepEqual(history, saved, "writer image preparation must not rewrite saved history");
}

/** The TUI widget handle surface this regression drives through ui.custom. */
type WidgetHandle = {
	handleInput: (data: string) => void;
	dispose: () => void;
	render: (width: number) => string[];
};

/** The widget factory Pi hands to ui.custom, typed at the fixture boundary. */
type WidgetFactory = (
	terminal: { requestRender: () => void; terminal?: { rows: number } },
	theme: { fg: (color: string, text: string) => string },
	props: Record<string, unknown>,
	onDone: (value: unknown) => void,
) => WidgetHandle;

// Cancelling a TUI loader aborts its pending API call, and the late result is harmless.
const { initTheme } = await import("@earendil-works/pi-coding-agent");
initTheme("dark");
let releaseCompletion: (value: unknown) => void = () => {
	throw new Error("completion release before the provider call started");
};
let view: WidgetHandle | undefined;
/** The latest widget a custom callback created, if any, read across a call boundary. */
const latestView = (): WidgetHandle | undefined => view;
let apiSignal: AbortSignal | undefined;
const started = gate();
const settled = gate();
let doneCount = 0;
const cancelledWriter = writerCommand("draft").handler(
	"cancel pending API",
	ctx({
		mode: "tui",
		modelRegistry: {
			find: () => {
				return;
			},
			hasConfiguredAuth: () => true,
			complete: (_model: unknown, _context: unknown, options: { signal?: AbortSignal }) => {
				apiSignal = options.signal;
				started.open();
				return new Promise((resolve) => {
					releaseCompletion = resolve;
				});
			},
		},
		ui: {
			...baseUi,
			custom: (factory: WidgetFactory) =>
				new Promise((resolve) => {
					const widget = factory(
						{
							requestRender() {
								return;
							},
						},
						{ fg: (_color: string, value: string) => value },
						{},
						(value: unknown) => {
							widget.dispose();
							resolve(value);
							if (++doneCount === 2) {
								settled.open();
							}
						},
					);
					view = widget;
				}),
		},
	}),
);
await started.promise;
if (view === undefined) {
	assert.fail("expected the loader widget to be created");
}
view.handleInput("\x1b");
await cancelledWriter;
assert.equal(apiSignal?.aborted, true);
releaseCompletion({ role: "assistant", content: [], stopReason: "aborted" });
await settled.promise;

// Cancelled work must not touch a context retired by /reload or /new.
for (const command of ["draft", "unreasonable", "ste", "side-question"]) {
	for (const phase of ["image preparation", "provider rejection"]) {
		let retired = false;
		let staleReads = 0;
		let calls = 0;
		let rejectCompletion: (error: Error) => void = () => {
			throw new Error("rejection before the provider call started");
		};
		const providerStarted = gate();
		const finished = gate();
		let doneCalls = 0;
		const context = ctx({
			mode: "tui",
			model: { id: "claude-test", provider: "anthropic", api: "anthropic-messages" },
			thinkingLevel: "off",
			sessionManager: {
				getEntries: () => [
					{
						type: "message",
						id: "image",
						parentId: null,
						timestamp: "2026-01-01T00:00:00.000Z",
						message: {
							role: "user",
							timestamp: 1,
							content: [
								{
									type: "image",
									mimeType: "image/png",
									data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
								},
							],
						},
					},
				],
				getLeafId: () => "image",
			},
			modelRegistry: {
				complete: () => {
					calls += 1;
					providerStarted.open();
					return new Promise((_resolve, reject) => {
						rejectCompletion = reject;
					});
				},
			},
			ui: {
				...baseUi,
				custom: (factory: WidgetFactory) =>
					new Promise((resolve) => {
						const widget = factory(
							{
								requestRender() {
									return;
								},
							},
							{ fg: (_color: string, value: string) => value },
							{},
							(value: unknown) => {
								widget.dispose();
								resolve(value);
								// The abort closes the loader first; the completion's own return is the second call.
								if (++doneCalls === 2) {
									finished.open();
								}
							},
						);
						view = widget;
					}),
			},
		});
		for (const key of ["ui", "modelRegistry"] as const) {
			const value = context[key];
			Object.defineProperty(context, key, {
				get() {
					if (retired) {
						staleReads++;
						throw new Error(`stale ${key}`);
					}
					return value;
				},
			});
		}
		notices.length = 0;
		const pending = writerCommand(command).handler("cancel before replacement", context);
		if (phase === "provider rejection") {
			await providerStarted.promise;
		}
		const currentView = latestView();
		assert.ok(currentView !== undefined, "expected the loader widget to be created");
		currentView.handleInput("\x1b");
		await pending;
		retired = true;
		if (phase === "provider rejection") {
			rejectCompletion(new Error("late provider failure"));
		} else {
			await finished.promise;
		}
		await new Promise<void>((resolve) => {
			setImmediate(resolve);
		});
		assert.equal(staleReads, 0, `${command}: cancelled ${phase} must not read retired context`);
		assert.equal(calls, phase === "provider rejection" ? 1 : 0);
		assert.deepEqual(notices, [], "cancelled work must not report late errors");
	}
}

// Draft dialog strips VT/OSC escape sequences from rendered draft text.
let escapeCalls = 0;
await writerCommand("draft").handler(
	"escape check",
	ctx({
		mode: "tui",
		ui: {
			...baseUi,
			custom: async (factory: WidgetFactory) => {
				if (++escapeCalls === 1) {
					return "\x1b[31mbetter\x1b[39m prompt\x1b]0;title\x07";
				}
				const dialog = factory(
					{
						requestRender() {
							return;
						},
						terminal: { rows: 40 },
					},
					{ fg: (_color: string, text: string) => text },
					{},
					() => {
						return;
					},
				);
				const screen = dialog.render(80).join("\n");
				assert.match(screen, /better prompt/);
				assert.ok(!screen.includes("\x1b[31m") && !screen.includes("\x1b]0;"));
				return "Deny";
			},
		},
	}),
);

// Exercise the actual TUI menu and keyboard selection, including the recovery action.
for (const action of ["Accept", "Restore original"] as const) {
	let calls = 0;
	let editorText = "";
	let menuIdle = true;
	sent = undefined;
	await writerCommand("draft").handler(
		"original TUI input",
		ctx({
			mode: "tui",
			isIdle: () => menuIdle,
			ui: {
				...baseUi,
				setEditorText: (text: string) => {
					editorText = text;
				},
				custom: async (factory: WidgetFactory) => {
					if (++calls === 1) {
						return "better prompt";
					}
					return new Promise((resolve) => {
						const menu = factory(
							{
								requestRender() {
									return;
								},
								terminal: { rows: 40 },
							},
							{ fg: (_color: string, text: string) => text },
							{},
							resolve,
						);
						const screen = menu.render(80).join("\n");
						assert.match(screen, /better prompt/);
						assert.match(screen, /Restore original/);
						for (let i = 0; i < (action === "Accept" ? 0 : 3); i++) {
							menu.handleInput("\x1b[B");
						}
						menuIdle = false;
						menu.handleInput("\r");
					});
				},
			},
		}),
	);
	if (action === "Accept") {
		assert.equal(sent, "better prompt");
		assert.deepEqual(sendOptions, { deliverAs: "steer" });
	} else {
		assert.equal(sent, undefined);
		assert.equal(editorText, "/draft original TUI input");
	}
}

console.log("write-prompt regression ok");
