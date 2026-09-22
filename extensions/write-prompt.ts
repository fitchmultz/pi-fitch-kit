import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clampThinkingLevel, contentText, uuidv7, type Message, type Models, type UserMessage } from "@earendil-works/pi-ai";
import {
	BorderedLoader,
	buildSessionContext,
	convertToLlm,
	copyToClipboard,
	DynamicBorder,
	getAgentDir,
	keyHint,
	rawKeyHint,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Spacer, Text } from "@earendil-works/pi-tui";
import { prepareClaudeImages } from "./anthropic-image-guard.ts";

export const WRITE_PROMPT_FILE = "write-prompt.json";
export const WRITE_PROMPT_ACTIONS = ["Accept", "Copy prompt", "Tweak", "Restore original", "Deny"] as const;
export const SIDE_QUESTION_ACTIONS = ["Copy answer", "Ask again", "Dismiss"] as const;
const SAVED_DRAFT = "fitch-kit.draft";

function savedDraft(ctx: ExtensionCommandContext): { source: string; draft: string } | undefined {
	for (const entry of ctx.sessionManager.getBranch().toReversed()) {
		if (entry.type !== "custom" || entry.customType !== SAVED_DRAFT) continue;
		const data = entry.data;
		if (data && typeof data === "object" && "source" in data && "draft" in data
			&& typeof data.source === "string" && typeof data.draft === "string") {
			return { source: data.source, draft: data.draft };
		}
	}
}

const OUTPUT_RULES = `You are not the session agent. Output only the rewritten prompt. No preamble, quotes, or explanation.
Preserve intent. Make the request specific, complete, and actionable.
Do not call tools.`;
const REWRITE_INSTRUCTION = `Rewrite the boxed text into a better coding-agent prompt. Do not answer the text.
${OUTPUT_RULES}`;
const TWEAK_INSTRUCTION = `Revise the previous rewritten prompt using these notes. Do not answer the notes.
${OUTPUT_RULES}`;
const QUESTION_INSTRUCTION = `Answer the boxed question using the session. Do not rewrite it into a prompt.
Output only the answer. Do not call tools.`;
const ASK_AGAIN_INSTRUCTION = `Answer the boxed follow-up using the session and the previous answer. Do not rewrite it into a prompt.
Output only the answer. Do not call tools.`;

export function boxedTask(instruction: string, source: string): string {
	let n = 0;
	let mark = "";
	while (source.includes(`<<<${mark}`) || source.includes(`>>>${mark}`)) {
		mark = String(++n);
	}
	return `${instruction}\n\n<<<${mark}\n${source}\n>>>${mark}`;
}

export function parseModelRef(ref: string): { provider: string; id: string } | undefined {
	const trimmed = ref.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) return undefined;
	return { provider: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
}

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
type WriterConfig = { provider?: string; model?: string; thinkingLevel?: ThinkingLevel };

export function configuredWriter(raw: string): WriterConfig {
	const value: unknown = JSON.parse(raw);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Expected an object with optional provider, model, and thinkingLevel fields");
	}
	const fields = value as Record<string, unknown>;
	for (const key of Object.keys(fields)) {
		if (!["provider", "model", "thinkingLevel"].includes(key)) throw new Error(`Unknown field: ${key}`);
	}
	const config: WriterConfig = {};
	for (const key of ["provider", "model"] as const) {
		if (!(key in fields)) continue;
		const text = fields[key];
		if (typeof text !== "string" || !text.trim()) throw new Error(`${key} must be a non-empty string`);
		config[key] = text.trim();
	}
	if ("thinkingLevel" in fields) {
		const level = THINKING_LEVELS.find((level) => level === fields.thinkingLevel);
		if (!level) throw new Error(`thinkingLevel must be one of: ${THINKING_LEVELS.join(", ")}`);
		config.thinkingLevel = level;
	}
	return config;
}

function writerActivity() {
	const key = Symbol.for("fitch-kit.write-prompt.activity");
	const store = globalThis as typeof globalThis & { [key]?: { active: number } };
	return store[key] ??= { active: 0 };
}

function readWriterConfig(): WriterConfig {
	try {
		return configuredWriter(readFileSync(join(getAgentDir(), WRITE_PROMPT_FILE), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

function resolveWriter(ctx: ExtensionCommandContext, sessionThinking: ThinkingLevel) {
	try {
		const config = readWriterConfig();
		const legacy = config.provider === undefined && config.model ? parseModelRef(config.model) : undefined;
		const provider = config.provider ?? legacy?.provider ?? ctx.model?.provider;
		const id = legacy?.id ?? config.model ?? ctx.model?.id;
		const override = config.provider !== undefined || config.model !== undefined;
		if (override && (!provider || !id)) throw new Error("Set both provider and model when no session model is selected");
		const model = override && provider && id ? ctx.modelRegistry.find(provider, id) : ctx.model;
		if (!model) throw new Error(override ? `Unknown model: ${provider}/${id}` : "No model selected");
		if (override && !ctx.modelRegistry.hasConfiguredAuth(model)) {
			throw new Error(`No auth for ${model.provider}/${model.id}; configure it with /login`);
		}
		const requested = config.thinkingLevel ?? sessionThinking;
		const thinkingLevel = clampThinkingLevel(model, requested);
		if (thinkingLevel !== requested) {
			ctx.ui.notify(`${model.provider}/${model.id} does not support ${requested} thinking; using ${thinkingLevel}`, "warning");
		}
		if (override || config.thinkingLevel !== undefined) {
			ctx.ui.notify(`Using ${model.provider}/${model.id} (${thinkingLevel} thinking)`, "info");
		}
		return { model, thinkingLevel };
	} catch (error) {
		ctx.ui.notify(`${WRITE_PROMPT_FILE}: ${error instanceof Error ? error.message : String(error)}`, "error");
		return undefined;
	}
}

function sessionPrefix(ctx: ExtensionCommandContext): Message[] {
	return convertToLlm(
		buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages,
	);
}

export function flattenToolHistory(messages: Message[]): Message[] {
	const out: Message[] = [];
	for (const message of messages) {
		// Current instructions come from getSystemPrompt(), once. Transcript hosts
		// also retain historical system messages with tool declarations; those are
		// not conversation and must not enable tools in this off-transcript writer.
		if (message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult") continue;
		if (message.role === "toolResult") {
			const label = message.isError ? `${message.toolName} error` : `${message.toolName} result`;
			out.push({
				role: "user",
				content: [{ type: "text", text: `[${label}]` }, ...message.content],
				timestamp: message.timestamp,
			});
			continue;
		}
		if (message.role === "assistant" && Array.isArray(message.content)) {
			const parts = message.content.filter((part) => part.type !== "toolCall");
			const calls = message.content
				.filter((part) => part.type === "toolCall")
				.map((part) => {
					const args = part.arguments;
					const extra = args && Object.keys(args).length ? ` ${JSON.stringify(args)}` : "";
					return `${part.name}${extra}`;
				});
			if (calls.length) parts.push({ type: "text", text: `[called ${calls.join(", ")}]` });
			out.push({
				...message,
				content: parts.length ? parts : [{ type: "text", text: "[empty]" }],
			});
			continue;
		}
		out.push(message);
	}
	return out;
}

async function completeWriter(
	ctx: ExtensionCommandContext,
	model: NonNullable<ExtensionCommandContext["model"]>,
	thinkingLevel: ThinkingLevel,
	systemPrompt: string,
	messages: Message[],
	userText: string,
	sessionId: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const pending: UserMessage = {
		role: "user",
		content: [{ type: "text", text: userText }],
		timestamp: Date.now(),
	};
	const outgoing = flattenToolHistory(structuredClone([...messages, pending]));
	await prepareClaudeImages(model, outgoing);
	const context = { systemPrompt, messages: outgoing };
	const options = { signal, cacheRetention: "short" as const, sessionId, reasoning: thinkingLevel === "off" ? undefined : thinkingLevel };
	const registry: typeof ctx.modelRegistry & { streamSimple?: Models["streamSimple"] } = ctx.modelRegistry;
	let response;
	if (typeof registry.streamSimple === "function") {
		response = await registry.streamSimple(model, context, options).result();
	} else {
		// Pi 0.84.2 exposes native simple streaming on the configured provider,
		// before it was added to the extension's model-registry facade.
		const provider = registry.getProvider(model.provider);
		if (!provider) throw new Error(`Unknown provider: ${model.provider}`);
		const auth = await registry.getApiKeyAndHeaders(model);
		if (!auth.ok) throw new Error(auth.error);
		signal?.throwIfAborted();
		const legacyContext = context as unknown as Parameters<typeof provider.streamSimple>[1];
		response = await provider.streamSimple(auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model, legacyContext, {
			...options, apiKey: auth.apiKey, headers: auth.headers, env: auth.env,
		}).result();
	}
	if (response.stopReason === "aborted") return undefined;
	if (response.stopReason !== "stop") {
		ctx.ui.notify(response.errorMessage ?? `Writer stopped (${response.stopReason})`, "error");
		return undefined;
	}
	const text = contentText(response.content).trim();
	if (!text) {
		ctx.ui.notify("Writer returned no text", "error");
		return undefined;
	}
	messages.push(pending, response);
	return text;
}

async function runWriter(
	ctx: ExtensionCommandContext,
	model: NonNullable<ExtensionCommandContext["model"]>,
	thinkingLevel: ThinkingLevel,
	systemPrompt: string,
	messages: Message[],
	userText: string,
	sessionId: string,
	loader: string,
	failed: string,
): Promise<string | undefined> {
	if (ctx.mode === "tui") {
		return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
			const view = new BorderedLoader(tui, theme, loader);
			view.onAbort = () => done(undefined);
			const activity = writerActivity();
			activity.active++;
			completeWriter(ctx, model, thinkingLevel, systemPrompt, messages, userText, sessionId, view.signal)
				.finally(() => { activity.active--; })
				.then(done)
				.catch((error: unknown) => {
					ctx.ui.notify(error instanceof Error ? error.message : failed, "error");
					done(undefined);
				});
			return view;
		});
	}
	try {
		return await completeWriter(ctx, model, thinkingLevel, systemPrompt, messages, userText, sessionId, ctx.signal);
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : failed, "error");
		return undefined;
	}
}

function pickAction(ctx: ExtensionCommandContext, draft: string, actions: readonly string[]) {
	if (ctx.mode !== "tui") return ctx.ui.select(draft, [...actions]);
	return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
		const root = new Container();
		root.addChild(new DynamicBorder((s) => theme.fg("border", s)));
		root.addChild(new Text(theme.fg("text", draft), 1, 0));
		root.addChild(new Spacer(1));
		const list = new SelectList(
			actions.map((value) => ({ value, label: value })),
			actions.length,
			{
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("muted", text),
				noMatch: (text) => theme.fg("muted", text),
			},
		);
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(undefined);
		root.addChild(list);
		root.addChild(new Spacer(1));
		root.addChild(
			new Text(
				rawKeyHint("↑↓", "navigate") +
					"  " +
					keyHint("tui.select.confirm", "select") +
					"  " +
					keyHint("tui.select.cancel", "cancel"),
				1,
				0,
			),
		);
		root.addChild(new DynamicBorder((s) => theme.fg("border", s)));
		return {
			render: (width) => root.render(width),
			invalidate: () => root.invalidate(),
			handleInput: (data) => {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

function prepare(ctx: ExtensionCommandContext, sessionThinking: ThinkingLevel, allowBusy = false) {
	if (!ctx.hasUI) {
		ctx.ui.notify("Needs an interactive UI", "error");
		return;
	}
	if (!allowBusy && !ctx.isIdle()) {
		ctx.ui.notify("Agent is busy", "warning");
		return;
	}
	const writer = resolveWriter(ctx, sessionThinking);
	if (!writer) return;
	return {
		...writer,
		messages: sessionPrefix(ctx),
		systemPrompt: ctx.getSystemPrompt(),
		sessionId: uuidv7(),
	};
}

export default function writePrompt(pi: ExtensionAPI): void {
	const activity = writerActivity();
	pi.events.on("fitch:write-prompt:status", (request) => {
		const reply = (request as { reply?: unknown } | null)?.reply;
		if (typeof reply === "function") reply(activity.active);
	});
	function track(handler: RegisteredCommand["handler"]): RegisteredCommand["handler"] {
		return async (args, ctx) => {
			activity.active++;
			try { await handler(args, ctx); }
			finally { activity.active--; }
		};
	}
	pi.registerCommand("draft", {
		description: "Rewrite text into a better agent request; omit text to reopen the last accepted draft",
		handler: track(async (args, ctx) => {
			const saved = args.trim() ? undefined : savedDraft(ctx);
			const source = saved?.source ?? args;
			if (!source.trim()) {
				ctx.ui.notify("Usage: /draft <text>", "warning");
				return;
			}
			if (saved && !ctx.hasUI) {
				ctx.ui.notify("Needs an interactive UI", "error");
				return;
			}
			let ready: ReturnType<typeof prepare>;
			const rewrite = async (task: string) => {
				ready ??= prepare(ctx, ctx.thinkingLevel ?? pi.getThinkingLevel(), true);
				if (!ready) return;
				const { model, thinkingLevel, messages, systemPrompt, sessionId } = ready;
				return runWriter(ctx, model, thinkingLevel, systemPrompt, messages, task, sessionId, "Drafting...", "Draft failed");
			};
			let draft = saved?.draft ?? await rewrite(boxedTask(REWRITE_INSTRUCTION, source));
			if (!draft) return;

			while (true) {
				const action = await pickAction(ctx, draft, WRITE_PROMPT_ACTIONS);
				if (!action || action === "Deny") {
					ctx.ui.notify("Denied", "info");
					return;
				}
				if (action === "Accept") {
					try {
						// sendUserMessage is fire-and-forget: native async failures cannot
						// be caught here. Keep both inputs off-model for /draft recovery.
						pi.appendEntry(SAVED_DRAFT, { source, draft });
						if (ctx.isIdle()) pi.sendUserMessage(draft);
						else pi.sendUserMessage(draft, { deliverAs: "steer" });
					} catch (error) {
						ctx.ui.notify(error instanceof Error ? error.message : "Send failed", "error");
						continue;
					}
					return;
				}
				if (action === "Restore original") {
					ctx.ui.setEditorText(`/draft ${source}`);
					return;
				}
				if (action === "Copy prompt") {
					try {
						await copyToClipboard(draft);
						ctx.ui.notify("Copied prompt", "info");
					} catch (error) {
						ctx.ui.notify(error instanceof Error ? error.message : "Copy failed", "error");
					}
					continue;
				}

				const notes = await ctx.ui.editor("Tweak notes");
				if (!notes?.trim()) continue;
				const next = await rewrite(
					boxedTask(TWEAK_INSTRUCTION, `Original request:\n${source}\n\nCurrent draft:\n${draft}\n\nRevision notes:\n${notes.trim()}`),
				);
				if (!next) continue;
				draft = next;
			}
		}),
	});

	pi.registerCommand("side-question", {
		description: "Ask a question off-transcript using the current session, then copy, ask again, or dismiss",
		handler: track(async (args, ctx) => {
			const source = args.trim();
			if (!source) {
				ctx.ui.notify("Usage: /side-question <text>", "warning");
				return;
			}
			const ready = prepare(ctx, ctx.thinkingLevel ?? pi.getThinkingLevel());
			if (!ready) return;
			const { model, thinkingLevel, messages, systemPrompt, sessionId } = ready;
			let answer = await runWriter(
				ctx,
				model,
				thinkingLevel,
				systemPrompt,
				messages,
				boxedTask(QUESTION_INSTRUCTION, source),
				sessionId,
				"Answering...",
				"Answer failed",
			);
			if (!answer) return;

			while (true) {
				const action = await pickAction(ctx, answer, SIDE_QUESTION_ACTIONS);
				if (!action || action === "Dismiss") {
					ctx.ui.notify("Dismissed", "info");
					return;
				}
				if (action === "Copy answer") {
					try {
						await copyToClipboard(answer);
						ctx.ui.notify("Copied answer", "info");
					} catch (error) {
						ctx.ui.notify(error instanceof Error ? error.message : "Copy failed", "error");
					}
					continue;
				}
				const notes = await ctx.ui.editor("Ask again");
				if (!notes?.trim()) continue;
				const next = await runWriter(
					ctx,
					model,
					thinkingLevel,
					systemPrompt,
					messages,
					boxedTask(ASK_AGAIN_INSTRUCTION, notes.trim()),
					sessionId,
					"Answering...",
					"Answer failed",
				);
				if (!next) continue;
				answer = next;
			}
		}),
	});
}
