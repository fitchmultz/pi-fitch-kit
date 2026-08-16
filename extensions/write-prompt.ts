import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contentText, uuidv7, type Message, type UserMessage } from "@earendil-works/pi-ai";
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
} from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Spacer, Text } from "@earendil-works/pi-tui";
import { prepareClaudeImages } from "./anthropic-image-guard.ts";

export const WRITE_PROMPT_FILE = "write-prompt.json";
export const WRITE_PROMPT_ACTIONS = ["Accept", "Copy prompt", "Tweak", "Deny"] as const;
export const SIDE_QUESTION_ACTIONS = ["Copy answer", "Ask again", "Dismiss"] as const;

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

export function configuredModelRef(raw: string): string | undefined {
	try {
		const model = JSON.parse(raw).model;
		return typeof model === "string" && model.trim() ? model.trim() : undefined;
	} catch {
		return undefined;
	}
}

function readConfiguredModel(): string | undefined {
	try {
		return configuredModelRef(readFileSync(join(getAgentDir(), WRITE_PROMPT_FILE), "utf8"));
	} catch {
		return undefined;
	}
}

function resolveWriterModel(ctx: ExtensionCommandContext) {
	const ref = readConfiguredModel();
	if (ref) {
		const parsed = parseModelRef(ref);
		const found = parsed && ctx.modelRegistry.find(parsed.provider, parsed.id);
		if (found && ctx.modelRegistry.hasConfiguredAuth(found)) {
			ctx.ui.notify(`Using ${ref}`, "info");
			return found;
		}
		ctx.ui.notify(
			found ? `No auth for ${ref}; using session model` : `Unknown model ${ref}; using session model`,
			"warning",
		);
	}
	return ctx.model;
}

function sessionPrefix(ctx: ExtensionCommandContext): Message[] {
	return convertToLlm(
		buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages,
	);
}

export function flattenToolHistory(messages: Message[]): Message[] {
	const out: Message[] = [];
	for (const message of messages) {
		if (message.role === "toolResult") {
			const label = message.isError ? `${message.toolName} error` : `${message.toolName} result`;
			out.push({
				role: "user",
				content: [{ type: "text", text: `[${label}]\n${contentText(message.content)}` }],
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
	const response = await ctx.modelRegistry.complete(
		model,
		{ systemPrompt, messages: outgoing },
		{ signal, cacheRetention: "short", sessionId },
	);
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
			completeWriter(ctx, model, systemPrompt, messages, userText, sessionId, view.signal)
				.then(done)
				.catch((error: unknown) => {
					ctx.ui.notify(error instanceof Error ? error.message : failed, "error");
					done(undefined);
				});
			return view;
		});
	}
	try {
		return await completeWriter(ctx, model, systemPrompt, messages, userText, sessionId, ctx.signal);
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

function prepare(ctx: ExtensionCommandContext) {
	if (!ctx.hasUI) {
		ctx.ui.notify("Needs an interactive UI", "error");
		return;
	}
	if (!ctx.isIdle()) {
		ctx.ui.notify("Agent is busy", "warning");
		return;
	}
	const model = resolveWriterModel(ctx);
	if (!model) {
		ctx.ui.notify("No model selected", "error");
		return;
	}
	return {
		model,
		messages: sessionPrefix(ctx),
		systemPrompt: ctx.getSystemPrompt(),
		sessionId: uuidv7(),
	};
}

export default function writePrompt(pi: ExtensionAPI): void {
	pi.registerCommand("draft", {
		description: "Rewrite text into a better agent request, then accept, copy, tweak, or deny",
		handler: async (args, ctx) => {
			const source = args.trim();
			if (!source) {
				ctx.ui.notify("Usage: /draft <text>", "warning");
				return;
			}
			const ready = prepare(ctx);
			if (!ready) return;
			const { model, messages, systemPrompt, sessionId } = ready;
			let draft = await runWriter(
				ctx,
				model,
				systemPrompt,
				messages,
				boxedTask(REWRITE_INSTRUCTION, source),
				sessionId,
				"Drafting...",
				"Draft failed",
			);
			if (!draft) return;

			while (true) {
				const action = await pickAction(ctx, draft, WRITE_PROMPT_ACTIONS);
				if (!action || action === "Deny") {
					ctx.ui.notify("Denied", "info");
					return;
				}
				if (action === "Accept") {
					if (!ctx.isIdle()) {
						ctx.ui.notify("Agent is busy; prompt not sent", "warning");
						return;
					}
					pi.sendUserMessage(draft);
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
				const next = await runWriter(
					ctx,
					model,
					systemPrompt,
					messages,
					boxedTask(TWEAK_INSTRUCTION, notes.trim()),
					sessionId,
					"Drafting...",
					"Draft failed",
				);
				if (!next) continue;
				draft = next;
			}
		},
	});

	pi.registerCommand("side-question", {
		description: "Ask a question off-transcript using the current session, then copy, ask again, or dismiss",
		handler: async (args, ctx) => {
			const source = args.trim();
			if (!source) {
				ctx.ui.notify("Usage: /side-question <text>", "warning");
				return;
			}
			const ready = prepare(ctx);
			if (!ready) return;
			const { model, messages, systemPrompt, sessionId } = ready;
			let answer = await runWriter(
				ctx,
				model,
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
		},
	});
}
