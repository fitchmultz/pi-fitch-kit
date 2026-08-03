import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatDimensionNote, resizeImage } from "@earendil-works/pi-coding-agent";

const MAX_CACHE_ENTRIES = 8;
const MAX_IMAGE_BASE64_CHARS = 32 * 1024 * 1024;
const MAX_CONTEXT_IMAGE_BASE64_CHARS = 64 * 1024 * 1024;

export default function anthropicImageGuard(pi: ExtensionAPI): void {
	const cache = new Map<string, ReturnType<typeof resizeImage>>();
	const clearCache = () => cache.clear();
	pi.on("session_start", clearCache);
	pi.on("session_compact", clearCache);

	pi.on("context", async (event, ctx) => {
		if (ctx.model?.provider !== "anthropic") return;

		let changed = false;
		let contextImageChars = 0;
		for (const message of event.messages) {
			if (message.role === "assistant" || !Array.isArray(message.content)) continue;

			let messageChanged = false;
			const content: typeof message.content = [];
			for (const part of message.content) {
				if (part.type !== "image") {
					content.push(part);
					continue;
				}

				contextImageChars += part.data.length;
				if (
					part.data.length > MAX_IMAGE_BASE64_CHARS ||
					contextImageChars > MAX_CONTEXT_IMAGE_BASE64_CHARS
				) {
					content.push({
						type: "text",
						text: "[Image omitted: encoded source exceeds the Anthropic resize safety limit.]",
					});
					messageChanged = true;
					continue;
				}

				let pending = cache.get(part.data);
				if (pending) {
					cache.delete(part.data);
					cache.set(part.data, pending);
				} else {
					pending = resizeImage(Buffer.from(part.data, "base64"), part.mimeType).catch(() => null);
					cache.set(part.data, pending);
					// ponytail: Eight recent images bound memory; use a byte budget only if image-heavy sessions need more reuse.
					const oldest = cache.keys().next().value;
					if (cache.size > MAX_CACHE_ENTRIES && oldest !== undefined) cache.delete(oldest);
				}
				const resized = await pending;
				if (!resized) {
					if (cache.get(part.data) === pending) cache.delete(part.data);
					content.push({
						type: "text",
						text: "[Image omitted: could not be resized below Anthropic's inline image limits.]",
					});
					messageChanged = true;
					continue;
				}
				if (!resized.wasResized) {
					content.push(part);
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
