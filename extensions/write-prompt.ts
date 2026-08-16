import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contentText, uuidv7, type Message, type UserMessage } from "@earendil-works/pi-ai";
import {
	BorderedLoader,
	copyToClipboard,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

export const WRITE_PROMPT_FILE = "write-prompt.json";
export const WRITE_PROMPT_ACTIONS = ["Accept", "Copy prompt", "Tweak", "Deny"] as const;

const SYSTEM_PROMPT = `Rewrite the user's text into a better prompt for a coding agent.
Output only the rewritten prompt. No preamble, quotes, or explanation.
Preserve intent. Make the request specific, complete, and actionable.`;

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
		if (found && ctx.modelRegistry.hasConfiguredAuth(found)) return found;
		ctx.ui.notify(
			found ? `No auth for ${ref}; using session model` : `Unknown model ${ref}; using session model`,
			"warning",
		);
	}
	return ctx.model;
}

async function completeRewrite(
	ctx: ExtensionCommandContext,
	model: NonNullable<ExtensionCommandContext["model"]>,
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
		{ systemPrompt: SYSTEM_PROMPT, messages: [...messages, pending] },
		{ signal, cacheRetention: "none", sessionId },
	);
	if (response.stopReason === "aborted") return undefined;
	const text = contentText(response.content).trim();
	if (!text) {
		ctx.ui.notify(response.errorMessage ?? "Writer returned no text", "error");
		return undefined;
	}
	messages.push(pending, response);
	return text;
}

async function rewrite(
	ctx: ExtensionCommandContext,
	model: NonNullable<ExtensionCommandContext["model"]>,
	messages: Message[],
	userText: string,
	sessionId: string,
): Promise<string | undefined> {
	if (ctx.mode !== "tui") {
		return completeRewrite(ctx, model, messages, userText, sessionId, ctx.signal);
	}
	return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
		const loader = new BorderedLoader(tui, theme, "Rewriting prompt...");
		loader.onAbort = () => done(undefined);
		completeRewrite(ctx, model, messages, userText, sessionId, loader.signal)
			.then(done)
			.catch((error: unknown) => {
				ctx.ui.notify(error instanceof Error ? error.message : "Rewrite failed", "error");
				done(undefined);
			});
		return loader;
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

			const messages: Message[] = [];
			const sessionId = uuidv7();
			let draft = await rewrite(ctx, model, messages, source, sessionId);
			if (!draft) return;

			let review = true;
			while (true) {
				if (review) {
					const edited = await ctx.ui.editor("Rewritten prompt", draft);
					if (edited === undefined) {
						ctx.ui.notify("Denied", "info");
						return;
					}
					draft = edited.trim();
					if (!draft) {
						ctx.ui.notify("Prompt is empty", "warning");
						continue;
					}
					review = false;
				}

				const action = await ctx.ui.select("Write prompt", [...WRITE_PROMPT_ACTIONS]);
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
				const next = await rewrite(ctx, model, messages, notes.trim(), sessionId);
				if (!next) continue;
				draft = next;
				review = true;
			}
		},
	});
}
