import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Api,
	anthropicMessagesApi,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatDimensionNote, getAgentDir, resizeImage } from "@earendil-works/pi-coding-agent";

const MAX_CACHE_ENTRIES = 8;
const MAX_IMAGE_BASE64_CHARS = 32 * 1024 * 1024;
const MAX_CONTEXT_IMAGE_BASE64_CHARS = 64 * 1024 * 1024;
const ANTHROPIC_IMAGE_MIME_TYPES = new Set([
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp",
]);

const FAST_STATE_PATH = join(getAgentDir(), "anthropic-fast.json");
const FAST_BETA = "fast-mode-2026-02-01";
const FAST_MODEL_PREFIXES = ["claude-opus-5", "claude-opus-4-8"];
const messagesApi = anthropicMessagesApi();

function fastEnabled(): boolean {
	try {
		return JSON.parse(readFileSync(FAST_STATE_PATH, "utf8")).enabled === true;
	} catch {
		return false;
	}
}

function fastOptions(model: Model<Api>, options?: SimpleStreamOptions): SimpleStreamOptions {
	const baseFetch = options?.fetch ?? globalThis.fetch;
	const fast = () =>
		fastEnabled() && FAST_MODEL_PREFIXES.some((prefix) => model.id.startsWith(prefix));
	return {
		...options,
		// ponytail: append at fetch time because Pi builds anthropic-beta (including OAuth markers) after option headers, so setting it earlier would drop them.
		fetch: (input, init) => {
			if (!fast()) return baseFetch(input, init);
			const headers = new Headers(init?.headers);
			const betas = headers.get("anthropic-beta");
			headers.set("anthropic-beta", betas ? `${betas},${FAST_BETA}` : FAST_BETA);
			return baseFetch(input, { ...init, headers });
		},
		onPayload: async (payload, requestModel) => {
			const body = (await options?.onPayload?.(payload, requestModel)) ?? payload;
			return fast() ? { ...(body as Record<string, unknown>), speed: "fast" } : body;
		},
	};
}

function anthropicMimeType(mimeType: string): string | undefined {
	const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase();
	if (normalized === "image/jpg") return "image/jpeg";
	return normalized && ANTHROPIC_IMAGE_MIME_TYPES.has(normalized) ? normalized : undefined;
}

export default function anthropicImageGuard(pi: ExtensionAPI): void {
	type CacheEntry = { mimeType: string; pending: ReturnType<typeof resizeImage> };
	const cache = new Map<string, CacheEntry>();
	const clearCache = () => cache.clear();
	pi.on("session_start", clearCache);
	pi.on("session_compact", clearCache);

	pi.on("context", async (event, ctx) => {
		if (ctx.model?.provider !== "anthropic") return;

		let changed = false;
		let contextImageChars = 0;
		for (const message of event.messages) {
			if (message.role === "assistant" || !("content" in message) || !Array.isArray(message.content)) continue;

			let messageChanged = false;
			const content: typeof message.content = [];
			for (const part of message.content) {
				if (part.type !== "image") {
					content.push(part);
					continue;
				}

				const mimeType = anthropicMimeType(part.mimeType);
				if (!mimeType) {
					content.push({
						type: "text",
						text: "[Image omitted: Anthropic does not support this image type.]",
					});
					messageChanged = true;
					continue;
				}

				if (
					part.data.length > MAX_IMAGE_BASE64_CHARS ||
					contextImageChars + part.data.length > MAX_CONTEXT_IMAGE_BASE64_CHARS
				) {
					content.push({
						type: "text",
						text: "[Image omitted: encoded source exceeds the Anthropic resize safety limit.]",
					});
					messageChanged = true;
					continue;
				}
				contextImageChars += part.data.length;

				const cached = cache.get(part.data);
				let pending: ReturnType<typeof resizeImage>;
				if (cached?.mimeType === mimeType) {
					pending = cached.pending;
					cache.delete(part.data);
					cache.set(part.data, cached);
				} else {
					pending = resizeImage(Buffer.from(part.data, "base64"), mimeType).catch(() => null);
					cache.set(part.data, { mimeType, pending });
					// ponytail: Eight recent images bound memory; use a byte budget only if image-heavy sessions need more reuse.
					const oldest = cache.keys().next().value;
					if (cache.size > MAX_CACHE_ENTRIES && oldest !== undefined) cache.delete(oldest);
				}
				const resized = await pending;
				if (!resized) {
					if (cache.get(part.data)?.pending === pending) cache.delete(part.data);
					content.push({
						type: "text",
						text: "[Image omitted: could not be resized below Anthropic's inline image limits.]",
					});
					messageChanged = true;
					continue;
				}
				if (!resized.wasResized) {
					if (part.mimeType === resized.mimeType) {
						content.push(part);
					} else {
						content.push({ ...part, mimeType: resized.mimeType });
						messageChanged = true;
					}
					continue;
				}

				const note = formatDimensionNote(resized);
				if (note) content.push({ type: "text", text: note });
				content.push({ type: "image", data: resized.data, mimeType: resized.mimeType });
				messageChanged = true;
			}

			if (messageChanged) {
				message.content = content;
				changed = true;
			}
		}

		if (changed) return { messages: event.messages };
	});

	pi.registerProvider("anthropic", {
		api: "anthropic-messages",
		streamSimple(model, context, options) {
			return messagesApi.streamSimple(model, context, fastOptions(model, options) as never);
		},
	});

	pi.registerCommand("anthropic-fast", {
		description: "Toggle Anthropic Opus fast mode (2x token price)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on" || arg === "off") {
				writeFileSync(FAST_STATE_PATH, `${JSON.stringify({ enabled: arg === "on" })}\n`);
			}
			ctx.ui.notify(`Anthropic fast mode ${fastEnabled() ? "ON" : "OFF"}`, "info");
		},
	});
}
