import {
	type Api,
	contentText,
	type Message,
	type Model,
	type UserMessage,
} from "@earendil-works/pi-ai";
import { BorderedLoader, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	fitClaudeRequest,
	prepareClaudeImages,
	sharedImageCache,
} from "./anthropic-image-guard.ts";
import type { ThinkingLevel } from "./write-prompt-config.ts";

/** A cancelled dialog result. */
const cancelled = (): string | undefined => undefined;

/** Everything one writer run needs, resolved once per command invocation. */
export type WriterRequest = {
	model: Model<Api>;
	thinkingLevel: ThinkingLevel;
	systemPrompt: string;
	messages: Message[];
	sessionId: string;
};

/** Flattens one assistant message's tool calls into labeled text parts. */
function assistantMessage(message: Message & { role: "assistant" }): Message {
	const parts = message.content.filter((part) => part.type !== "toolCall");
	const calls = message.content
		.filter((part) => part.type === "toolCall")
		.map((part) => {
			const args = part.arguments;
			const extra = Object.keys(args).length > 0 ? ` ${JSON.stringify(args)}` : "";
			return `${part.name}${extra}`;
		});
	if (calls.length > 0) {
		parts.push({ type: "text", text: `[called ${calls.join(", ")}]` });
	}
	return {
		...message,
		content: parts.length > 0 ? parts : [{ type: "text", text: "[empty]" }],
	};
}

export function flattenToolHistory(messages: Message[]): Message[] {
	const out: Message[] = [];
	for (const message of messages) {
		// Current instructions come from getSystemPrompt(), once. Transcript hosts
		// also retain historical system messages with tool declarations; those are
		// not conversation and must not enable tools in this off-transcript writer.
		if (message.role === "user") {
			// Image preparation replaces only message.content; a shallow copy keeps history intact.
			out.push({ ...message });
			continue;
		}
		if (message.role === "assistant") {
			if (Array.isArray(message.content)) {
				out.push(assistantMessage(message));
				continue;
			}
			out.push({ ...message });
			continue;
		}
		if (message.role === "toolResult") {
			const label = message.isError ? `${message.toolName} error` : `${message.toolName} result`;
			out.push({
				role: "user",
				content: [{ type: "text", text: `[${label}]` }, ...message.content],
				timestamp: message.timestamp,
			});
		}
	}
	return out;
}

async function completeWriter(
	ctx: ExtensionCommandContext,
	request: WriterRequest,
	userText: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const pending: UserMessage = {
		role: "user",
		content: [{ type: "text", text: userText }],
		timestamp: Date.now(),
	};
	const outgoing = flattenToolHistory([...request.messages, pending]);
	await prepareClaudeImages(request.model, outgoing, sharedImageCache());
	if (signal !== undefined && signal.aborted) {
		return undefined;
	}
	const context = { systemPrompt: request.systemPrompt, messages: outgoing };
	const options = {
		cacheRetention: "short" as const,
		sessionId: request.sessionId,
		onPayload: (payload: unknown) => fitClaudeRequest(request.model, payload, sharedImageCache()),
		...(signal !== undefined ? { signal } : {}),
		...(request.thinkingLevel !== "off" ? { reasoning: request.thinkingLevel } : {}),
	};
	const response = await ctx.modelRegistry.streamSimple(request.model, context, options).result();
	if (response.stopReason === "aborted") {
		return undefined;
	}
	if (response.stopReason !== "stop") {
		ctx.ui.notify(response.errorMessage ?? `Writer stopped (${response.stopReason})`, "error");
		return undefined;
	}
	const text = contentText(response.content).trim();
	if (text === "") {
		ctx.ui.notify("Writer returned no text", "error");
		return undefined;
	}
	request.messages.push(pending, response);
	return text;
}

/** Loader and failure labels for one writer run. */
type WriterStatus = { loader: string; failure: string };

export async function runWriter(
	ctx: ExtensionCommandContext,
	request: WriterRequest,
	userText: string,
	status: WriterStatus,
): Promise<string | undefined> {
	if (ctx.mode !== "tui") {
		try {
			return await completeWriter(ctx, request, userText, ctx.signal);
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : status.failure, "error");
			return undefined;
		}
	}
	return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
		const view = new BorderedLoader(tui, theme, status.loader);
		view.onAbort = () => done(cancelled());
		const settle = async (): Promise<void> => {
			try {
				done(await completeWriter(ctx, request, userText, view.signal));
			} catch (error) {
				if (view.signal.aborted) {
					return;
				}
				ctx.ui.notify(error instanceof Error ? error.message : status.failure, "error");
				done(cancelled());
			}
		};
		settle().catch(() => {
			// settle() reports its own failures and resolves done itself.
		});
		return view;
	});
}
