import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatDimensionNote, resizeImage } from "@earendil-works/pi-coding-agent";

const MAX_CACHE_ENTRIES = 8;
const MAX_IMAGE_BASE64_CHARS = 32 * 1024 * 1024;
const MAX_CONTEXT_IMAGE_BASE64_CHARS = 64 * 1024 * 1024;
const ANTHROPIC_IMAGE_MIME_TYPES = new Set([
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp",
]);

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
}
