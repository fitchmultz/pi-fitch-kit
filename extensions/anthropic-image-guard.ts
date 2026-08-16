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

type ImageGuardCache = Map<string, { mimeType: string; pending: ReturnType<typeof resizeImage> }>;

function anthropicMimeType(mimeType: string): string | undefined {
	const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase();
	if (normalized === "image/jpg") return "image/jpeg";
	return normalized && ANTHROPIC_IMAGE_MIME_TYPES.has(normalized) ? normalized : undefined;
}

export async function prepareClaudeImages(
	model: { api?: string; id?: string } | undefined,
	messages: Array<{ role?: string; content?: unknown }>,
	cache: ImageGuardCache = new Map(),
): Promise<boolean> {
	// Anthropic's image limits follow the model, not one provider name:
	// Claude behind cloudflare-ai-gateway or github-copilot hits the same
	// constraints as the direct route. The wire API alone is too broad a
	// gate, though: vercel-ai-gateway, kimi-coding, minimax, and others
	// speak anthropic-messages for non-Claude models whose limits differ,
	// so require a Claude model on that API (vercel namespaces ids as
	// "anthropic/claude-...", hence includes, not startsWith).
	if (model?.api !== "anthropic-messages" || !model.id?.toLowerCase().includes("claude")) {
		return false;
	}

	let changed = false;
	let contextImageChars = 0;
	for (const message of messages) {
		if (message.role === "assistant" || !("content" in message) || !Array.isArray(message.content)) continue;

		let messageChanged = false;
		const content: typeof message.content = [];
		for (const part of message.content) {
			if (!part || typeof part !== "object" || !("type" in part) || part.type !== "image") {
				content.push(part);
				continue;
			}

			const image = part as { type: "image"; mimeType: string; data: string };
			const mimeType = anthropicMimeType(image.mimeType);
			if (!mimeType) {
				content.push({
					type: "text",
					text: "[Image omitted: Anthropic does not support this image type.]",
				});
				messageChanged = true;
				continue;
			}

			if (
				image.data.length > MAX_IMAGE_BASE64_CHARS ||
				contextImageChars + image.data.length > MAX_CONTEXT_IMAGE_BASE64_CHARS
			) {
				content.push({
					type: "text",
					text: "[Image omitted: encoded source exceeds the Anthropic resize safety limit.]",
				});
				messageChanged = true;
				continue;
			}
			contextImageChars += image.data.length;

			const cached = cache.get(image.data);
			let pending: ReturnType<typeof resizeImage>;
			if (cached?.mimeType === mimeType) {
				pending = cached.pending;
				cache.delete(image.data);
				cache.set(image.data, cached);
			} else {
				pending = resizeImage(Buffer.from(image.data, "base64"), mimeType).catch(() => null);
				cache.set(image.data, { mimeType, pending });
				// ponytail: Eight recent images bound memory; use a byte budget only if image-heavy sessions need more reuse.
				const oldest = cache.keys().next().value;
				if (cache.size > MAX_CACHE_ENTRIES && oldest !== undefined) cache.delete(oldest);
			}
			const resized = await pending;
			if (!resized) {
				if (cache.get(image.data)?.pending === pending) cache.delete(image.data);
				content.push({
					type: "text",
					text: "[Image omitted: could not be resized below Anthropic's inline image limits.]",
				});
				messageChanged = true;
				continue;
			}
			if (!resized.wasResized) {
				if (image.mimeType === resized.mimeType) {
					content.push(image);
				} else {
					content.push({ ...image, mimeType: resized.mimeType });
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

	return changed;
}

export default function anthropicImageGuard(pi: ExtensionAPI): void {
	const cache: ImageGuardCache = new Map();
	const clearCache = () => cache.clear();
	pi.on("session_start", clearCache);
	pi.on("session_compact", clearCache);

	pi.on("context", async (event, ctx) => {
		if (await prepareClaudeImages(ctx.model, event.messages, cache)) {
			return { messages: event.messages };
		}
	});
}
