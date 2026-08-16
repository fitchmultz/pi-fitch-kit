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
export const SIDE_QUESTION_ACTIONS = ["Copy answer", "Deny"] as const;

const OUTPUT_RULES = `Output only the rewritten prompt. No preamble, quotes, or explanation.
Preserve intent. Make the request specific, complete, and actionable.
Do not call tools.`;
const REWRITE_INSTRUCTION = `Rewrite the boxed text into a better coding-agent prompt. Do not answer the text.
${OUTPUT_RULES}`;
const TWEAK_INSTRUCTION = `Revise the previous rewritten prompt using these notes. Do not answer the notes.
${OUTPUT_RULES}`;
const QUESTION_INSTRUCTION = `Answer the boxed question using the session. Do not rewrite it into a prompt.
Output only the answer. Do not call tools.`;

export function boxedTask(instruction: string, source: string): string {
	return `${instruction}\n\n<<<\n${source}\n>>>`;
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
			ctx.ui.notify(`Writing with ${ref}`, "info");
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

function writerTools(pi: ExtensionAPI, messages: Message[]) {
	const byName = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
	const names = new Set(pi.getActiveTools());
	for (const message of messages) {
		if (!("content" in message) || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part && typeof part === "object" && "type" in part && part.type === "toolCall" && "name" in part) {
				names.add(String(part.name));
			}
		}
	}
	return [...names].flatMap((name) => {
		const tool = byName.get(name);
		return tool ? [{ name: tool.name, description: tool.description, parameters: tool.parameters }] : [];
	});
}

async function completeRewrite(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
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
	const outgoing = structuredClone([...messages, pending]);
	await prepareClaudeImages(model, outgoing);
	const tools = writerTools(pi, outgoing);
	const response = await ctx.modelRegistry.complete(
		model,
		{ systemPrompt, messages: outgoing, ...(tools.length ? { tools } : {}) },
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

async function rewrite(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
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
			completeRewrite(ctx, pi, model, systemPrompt, messages, userText, sessionId, view.signal)
				.then(done)
				.catch((error: unknown) => {
					ctx.ui.notify(error instanceof Error ? error.message : failed, "error");
					done(undefined);
				});
			return view;
		});
	}
	try {
		return await completeRewrite(ctx, pi, model, systemPrompt, messages, userText, sessionId, ctx.signal);
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
	pi.registerCommand("write-prompt", {
		description: "Rewrite text into a better agent prompt, then accept, copy, tweak, or deny",
		handler: async (args, ctx) => {
			const source = args.trim();
			if (!source) {
				ctx.ui.notify("Usage: /write-prompt <text>", "warning");
				return;
			}
			const ready = prepare(ctx);
			if (!ready) return;
			const { model, messages, systemPrompt, sessionId } = ready;
			let draft = await rewrite(
				ctx,
				pi,
				model,
				systemPrompt,
				messages,
				boxedTask(REWRITE_INSTRUCTION, source),
				sessionId,
				"Rewriting prompt...",
				"Rewrite failed",
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
				const next = await rewrite(
					ctx,
					pi,
					model,
					systemPrompt,
					messages,
					boxedTask(TWEAK_INSTRUCTION, notes.trim()),
					sessionId,
					"Rewriting prompt...",
					"Rewrite failed",
				);
				if (!next) continue;
				draft = next;
			}
		},
	});

	pi.registerCommand("side-question", {
		description: "Ask a question off-transcript using the current session, then copy or deny",
		handler: async (args, ctx) => {
			const source = args.trim();
			if (!source) {
				ctx.ui.notify("Usage: /side-question <text>", "warning");
				return;
			}
			const ready = prepare(ctx);
			if (!ready) return;
			const { model, messages, systemPrompt, sessionId } = ready;
			const answer = await rewrite(
				ctx,
				pi,
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
				if (!action || action === "Deny") {
					ctx.ui.notify("Denied", "info");
					return;
				}
				try {
					await copyToClipboard(answer);
					ctx.ui.notify("Copied answer", "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : "Copy failed", "error");
				}
			}
		},
	});
}
