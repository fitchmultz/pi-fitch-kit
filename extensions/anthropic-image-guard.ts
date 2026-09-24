import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatDimensionNote, resizeImage } from "@earendil-works/pi-coding-agent";

const MAX_CACHE_ENTRIES = 8;
const MAX_IMAGE_BASE64_CHARS = 32 * 1024 * 1024;
const MAX_CONTEXT_IMAGE_BASE64_CHARS = 64 * 1024 * 1024;
// Messages requests, including text, tools, and JSON framing: https://platform.claude.com/docs/en/api/errors
const MAX_REQUEST_BYTES = 32_000_000;
const ANTHROPIC_IMAGE_MIME_TYPES = new Set([
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp",
]);

type ImageGuardCache = Map<string, { mimeType: string; pending: ReturnType<typeof resizeImage> }>;
type ImageModel = { api?: string; id?: string } | undefined;

function isClaude(model: ImageModel): boolean {
	return model?.api === "anthropic-messages" && model.id?.toLowerCase().includes("claude") === true;
}

function anthropicMimeType(mimeType: string): string | undefined {
	const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase();
	if (normalized === "image/jpg") return "image/jpeg";
	return normalized && ANTHROPIC_IMAGE_MIME_TYPES.has(normalized) ? normalized : undefined;
}

export async function prepareClaudeImages(
	model: ImageModel,
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
	if (!isClaude(model)) {
		return false;
	}

	let changed = false;
	let contextImageChars = 0;
	// Admission favors the newest captures; only the request copy is transformed.
	for (const message of messages.toReversed()) {
		if (message.role === "assistant" || !("content" in message) || !Array.isArray(message.content)) continue;

		let messageChanged = false;
		const content: typeof message.content = [];
		for (const part of message.content.toReversed()) {
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
			content.push({ type: "image", data: resized.data, mimeType: resized.mimeType });
			if (note) content.push({ type: "text", text: note });
			messageChanged = true;
		}

		if (messageChanged) {
			message.content = content.reverse();
			changed = true;
		}
	}

	return changed;
}

/** Runs on the native serialized payload, after prompt/tool conversion and caller hooks. */
export async function fitClaudeRequest(model: ImageModel, payload: unknown): Promise<unknown> {
	if (!isClaude(model) || !payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
	// Traverse only message image blocks, never tool schemas or tool-call arguments.
	type Block = {
		type: string;
		source?: { type: string; data: string; media_type: string };
		content?: Block[];
		text?: string;
	};
	const body = payload as { messages?: { content?: Block[] }[] };
	const images: { content: Block[]; image: Block; note?: Block; originalWidth?: number; originalHeight?: number }[] = [];
	const collect = (content: Block[] | undefined) => {
		if (!Array.isArray(content)) return;
		for (const image of content) {
			if (image.type === "image" && image.source?.type === "base64") images.push({ content, image });
			else if (image.type === "tool_result") collect(image.content);
		}
	};
	for (const message of body.messages ?? []) collect(message.content);
	if (!images.length) return payload;
	// Native Anthropic streaming restores this field after onPayload replacements.
	const requestBytes = () => Buffer.byteLength(JSON.stringify({ ...payload, stream: true }));
	let bytes = requestBytes();
	if (bytes <= MAX_REQUEST_BYTES) return payload;
	// Retain native cache-control markers when replacing an image with an explanation.
	const omitted = (image: Block): Block => ({
		...image, type: "text", source: undefined, text: "[Image omitted: Anthropic request size limit.]",
	});
	const withoutImages = bytes - images.reduce(
		(total, { image }) => total + Buffer.byteLength(JSON.stringify(image)) - Buffer.byteLength(JSON.stringify(omitted(image))), 0,
	);
	// Text/tool overflow belongs to Pi and the provider; image handling cannot heal it.
	if (withoutImages > MAX_REQUEST_BYTES) return payload;

	while (bytes > MAX_REQUEST_BYTES && images.length) {
		// Resize the largest capture first, sharing the reduction across image bytes.
		// Keep this list chronological so an irreducible image budget drops oldest first.
		const entry = images.reduce((largest, next) => next.image.source!.data.length > largest.image.source!.data.length ? next : largest);
		const { content, image } = entry;
		const source = image.source!;
		const imageChars = images.reduce((total, entry) => total + entry.image.source!.data.length, 0);
		const maxBytes = Math.floor(source.data.length * (1 - (bytes - MAX_REQUEST_BYTES) / imageChars));
		const resized = maxBytes > 0 && source.data.length <= MAX_IMAGE_BASE64_CHARS
			? await resizeImage(Buffer.from(source.data, "base64"), source.media_type, { maxBytes }).catch(() => null)
			: null;
		if (resized) {
			image.source = { ...source, data: resized.data, media_type: resized.mimeType };
			entry.originalWidth ??= resized.originalWidth;
			entry.originalHeight ??= resized.originalHeight;
			if (entry.note) content.splice(content.indexOf(entry.note), 1);
			if (resized.width !== entry.originalWidth || resized.height !== entry.originalHeight) {
				const note = formatDimensionNote({ ...resized, originalWidth: entry.originalWidth, originalHeight: entry.originalHeight });
				entry.note = {
					type: "text",
					text: `[Additional request-size resize: ${note} Apply this coordinate mapping before any earlier mapping for this image.]`,
				};
				content.splice(content.indexOf(image) + 1, 0, entry.note);
			}
		} else {
			const oldest = images.shift()!;
			oldest.content[oldest.content.indexOf(oldest.image)] = omitted(oldest.image);
			if (oldest.note) oldest.content.splice(oldest.content.indexOf(oldest.note), 1);
		}
		bytes = requestBytes();
	}
	return payload;
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
