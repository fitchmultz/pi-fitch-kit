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
	getSelectListTheme,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Spacer, Text } from "@earendil-works/pi-tui";

export const WRITE_PROMPT_FILE = "write-prompt.json";
export const WRITE_PROMPT_ACTIONS = ["Accept", "Copy prompt", "Tweak", "Deny"] as const;

const REWRITE_RULES = `Rewrite the following into a better prompt for a coding agent.
Output only the rewritten prompt. No preamble, quotes, or explanation.
Preserve intent. Make the request specific, complete, and actionable.
Do not call tools.`;

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

async function completeRewrite(
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
	const response = await ctx.modelRegistry.complete(
		model,
		{ systemPrompt, messages: [...messages, pending] },
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
	model: NonNullable<ExtensionCommandContext["model"]>,
	systemPrompt: string,
	messages: Message[],
	userText: string,
	sessionId: string,
): Promise<string | undefined> {
	if (ctx.mode === "tui") {
		return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
			const loader = new BorderedLoader(tui, theme, "Rewriting prompt...");
			loader.onAbort = () => done(undefined);
			completeRewrite(ctx, model, systemPrompt, messages, userText, sessionId, loader.signal)
				.then(done)
				.catch((error: unknown) => {
					ctx.ui.notify(error instanceof Error ? error.message : "Rewrite failed", "error");
					done(undefined);
				});
			return loader;
		});
	}
	try {
		return await completeRewrite(ctx, model, systemPrompt, messages, userText, sessionId, ctx.signal);
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : "Rewrite failed", "error");
		return undefined;
	}
}

function pickAction(ctx: ExtensionCommandContext, draft: string) {
	if (ctx.mode !== "tui") return ctx.ui.select(draft, [...WRITE_PROMPT_ACTIONS]);
	return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
		const root = new Container();
		root.addChild(new DynamicBorder((s) => theme.fg("border", s)));
		root.addChild(new Text(theme.fg("text", draft), 1, 0));
		root.addChild(new Spacer(1));
		const list = new SelectList(
			WRITE_PROMPT_ACTIONS.map((value) => ({ value, label: value })),
			WRITE_PROMPT_ACTIONS.length,
			getSelectListTheme(),
		);
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(undefined);
		root.addChild(list);
		root.addChild(new Spacer(1));
		root.addChild(new Text(theme.fg("dim", "↑↓ navigate  enter select  esc cancel"), 1, 0));
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

export default function writePrompt(pi: ExtensionAPI): void {
	pi.registerCommand("write-prompt", {
		description: "Rewrite text into a better agent prompt, then accept, copy, tweak, or deny",
		handler: async (args, ctx) => {
			const source = args.trim();
			if (!source) {
				ctx.ui.notify("Usage: /write-prompt <text>", "warning");
				return;
			}
			if (!ctx.hasUI) {
				ctx.ui.notify("write-prompt needs an interactive UI", "error");
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

			const messages = sessionPrefix(ctx);
			const systemPrompt = ctx.getSystemPrompt();
			const sessionId = uuidv7();
			let draft = await rewrite(ctx, model, systemPrompt, messages, `${REWRITE_RULES}\n\n${source}`, sessionId);
			if (!draft) return;

			while (true) {
				const action = await pickAction(ctx, draft);
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
					model,
					systemPrompt,
					messages,
					`Revise the previous rewritten prompt using these notes. Output only the rewritten prompt. No preamble, quotes, or explanation. Do not call tools.\n\n${notes.trim()}`,
					sessionId,
				);
				if (!next) continue;
				draft = next;
			}
		},
	});
}
