import { availableParallelism } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatDimensionNote, resizeImage } from "@earendil-works/pi-coding-agent";

// ponytail: Retain up to 128 MiB of estimated source/result storage, not every
// historical image. Larger requests reuse a bounded snapshot; raise the byte
// budget only with measured memory headroom, never restore an entry-count cap.
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_IMAGE_BASE64_CHARS = 32 * 1024 * 1024;
const MAX_CONTEXT_IMAGE_BASE64_CHARS = 64 * 1024 * 1024;
// ponytail: Each native resize decodes in its own worker; four at once bound the decode
// memory of a cold request. Raise only with measured memory headroom.
const RESIZE_CONCURRENCY = Math.max(1, Math.min(4, availableParallelism() - 1));
// Messages requests, including text, tools, and JSON framing: https://platform.claude.com/docs/en/api/errors
const MAX_REQUEST_BYTES = 32_000_000;
const ANTHROPIC_IMAGE_MIME_TYPES = new Set([
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp",
]);

type Resized = Awaited<ReturnType<typeof resizeImage>>;
type CachedImage = { mimeType: string; pending: Promise<Resized>; bytes: number };

class ImageGuardCache {
	readonly entries = new Map<string, CachedImage>();
	// Request-size results for the latest over-limit request's captures and their resized
	// forms. Results are smaller than their sources, so this holds under twice that
	// request's image data without joining the byte budget above.
	readonly fits = new Map<string, { mediaType: string; pending: Promise<Resized> }>();
	private bytes = 0;

	clear(): void {
		this.entries.clear();
		this.fits.clear();
		this.bytes = 0;
	}

	delete(data: string): void {
		const entry = this.entries.get(data);
		if (entry) this.bytes -= entry.bytes;
		this.entries.delete(data);
	}

	set(data: string, entry: CachedImage): void {
		this.delete(data);
		this.entries.set(data, entry);
		this.bytes += entry.bytes;
		while (this.bytes > MAX_CACHE_BYTES) this.delete(this.entries.keys().next().value!);
	}
}

// Pi loads each extension with its own module instance; the writer finds the
// loaded guard's cache here instead of decoding every capture again.
const SHARED_CACHE = Symbol.for("pi-fitch-kit.anthropic-image-cache");
type SharedCache = { [SHARED_CACHE]?: ImageGuardCache };
export const sharedImageCache = (): ImageGuardCache => ((globalThis as SharedCache)[SHARED_CACHE] ??= new ImageGuardCache());

/** Starts native resizes in arrival order, at most RESIZE_CONCURRENCY at a time. */
function resizePool() {
	let active = 0;
	const waiting: Array<() => void> = [];
	return {
		// Jobs wait only while every worker slot is busy.
		idle: () => active < RESIZE_CONCURRENCY,
		run: (data: string, mimeType: string, options?: Parameters<typeof resizeImage>[2]): Promise<Resized> =>
			new Promise((resolve) => {
				const start = () => {
					active++;
					resizeImage(Buffer.from(data, "base64"), mimeType, options).catch(() => null).then((result) => {
						active--;
						waiting.shift()?.();
						resolve(result);
					});
				};
				if (active < RESIZE_CONCURRENCY) start();
				else waiting.push(start);
			}),
	};
}

type ImageModel = { api?: string; id?: string } | undefined;
type ImagePart = { type: "image"; mimeType: string; data: string };
type ResizeJob = { image: ImagePart; mimeType: string; pending: Promise<Resized> };

const isImagePart = (part: unknown): part is ImagePart =>
	!!part && typeof part === "object" && "type" in part && part.type === "image";

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
	cache: ImageGuardCache = new ImageGuardCache(),
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

	let contextImageChars = 0;
	// Keep the request's reusable results alive even if a miss evicts their LRU
	// entries before this newest-first traversal reaches them.
	const reusable = new Map(cache.entries);
	const pool = resizePool();
	const jobs = new Set<ResizeJob>();
	const plans: Array<{ message: { content?: unknown }; parts: unknown[]; changed: boolean }> = [];
	// Admission favors the newest captures; only the request copy is transformed.
	// Every miss starts before any result is awaited, so cold requests overlap workers.
	for (const message of messages.toReversed()) {
		if (message.role === "assistant" || !Array.isArray(message.content) || !message.content.some(isImagePart)) continue;
		const plan = { message, parts: [] as unknown[], changed: false };
		plans.push(plan);
		for (const part of message.content.toReversed()) {
			if (!isImagePart(part)) {
				plan.parts.push(part);
				continue;
			}

			const mimeType = anthropicMimeType(part.mimeType);
			if (!mimeType) {
				plan.parts.push({
					type: "text",
					text: "[Image omitted: Anthropic does not support this image type.]",
				});
				plan.changed = true;
				continue;
			}

			if (
				part.data.length > MAX_IMAGE_BASE64_CHARS ||
				contextImageChars + part.data.length > MAX_CONTEXT_IMAGE_BASE64_CHARS
			) {
				plan.parts.push({
					type: "text",
					text: "[Image omitted: encoded source exceeds the Anthropic resize safety limit.]",
				});
				plan.changed = true;
				continue;
			}
			contextImageChars += part.data.length;

			const cached = cache.entries.get(part.data) ?? reusable.get(part.data);
			let pending: Promise<Resized>;
			if (cached?.mimeType === mimeType) {
				pending = cached.pending;
				cache.set(part.data, cached);
			} else {
				pending = pool.run(part.data, mimeType);
				cache.set(part.data, { mimeType, pending, bytes: 2 * part.data.length + 512 });
			}
			const job = { image: part, mimeType, pending };
			jobs.add(job);
			plan.parts.push(job);
		}
	}

	let changed = false;
	for (const { message, parts, changed: omitted } of plans) {
		let messageChanged = omitted;
		const content: unknown[] = [];
		for (const part of parts) {
			if (!jobs.has(part as ResizeJob)) {
				content.push(part);
				continue;
			}
			const { image, mimeType, pending } = part as ResizeJob;
			const resized = await pending;
			if (!resized) {
				if (cache.entries.get(image.data)?.pending === pending) cache.delete(image.data);
				content.push({
					type: "text",
					text: "[Image omitted: could not be resized below Anthropic's inline image limits.]",
				});
				messageChanged = true;
				continue;
			}
			if (cache.entries.get(image.data)?.pending === pending) {
				// Native results own base64 strings even when unchanged. Budget both
				// strings conservatively as UTF-16, plus an entry/promise allowance.
				cache.set(image.data, { mimeType, pending, bytes: 2 * (image.data.length + resized.data.length) + 512 });
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
export async function fitClaudeRequest(
	model: ImageModel,
	payload: unknown,
	cache: ImageGuardCache = new ImageGuardCache(),
): Promise<unknown> {
	if (!isClaude(model) || !payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
	// Traverse only message image blocks, never tool schemas or tool-call arguments.
	type Source = { type: string; data: string; media_type: string };
	type Block = { type: string; source?: Source; content?: Block[]; text?: string };
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
	const blockBytes = (block: Block) => Buffer.byteLength(JSON.stringify(block));
	let bytes = requestBytes();
	if (bytes <= MAX_REQUEST_BYTES) return payload;
	// Retain native cache-control markers when replacing an image with an explanation.
	const omitted = (image: Block): Block => ({
		...image, type: "text", source: undefined, text: "[Image omitted: Anthropic request size limit.]",
	});
	const withoutImages = bytes - images.reduce((total, { image }) => total + blockBytes(image) - blockBytes(omitted(image)), 0);
	// Text/tool overflow belongs to Pi and the provider; image handling cannot heal it.
	if (withoutImages > MAX_REQUEST_BYTES) return payload;

	// A capture keeps its earlier request-size result while that still fits its share, so
	// repeated over-limit turns skip native work and resend identical, cacheable image bytes.
	const captures = new Set(images.map(({ image }) => image.source!.data));
	const visited = new Set<string>();
	const pool = resizePool();
	const run = (source: Source, maxBytes: number) => {
		const pending = pool.run(source.data, source.media_type, { maxBytes });
		cache.fits.set(source.data, { mediaType: source.media_type, pending });
		return pending;
	};

	while (bytes > MAX_REQUEST_BYTES && images.length) {
		// Resize the largest capture first, sharing the reduction across image bytes.
		// Keep this list chronological so an irreducible image budget drops oldest first.
		const [entry, ...smaller] = images.toSorted((a, b) => b.image.source!.data.length - a.image.source!.data.length);
		const { content, image } = entry;
		const source = image.source!;
		const imageChars = images.reduce((total, entry) => total + entry.image.source!.data.length, 0);
		const maxBytes = Math.floor(source.data.length * (1 - (bytes - MAX_REQUEST_BYTES) / imageChars));
		let resized: Resized = null;
		if (maxBytes > 0 && source.data.length <= MAX_IMAGE_BASE64_CHARS) {
			visited.add(source.data);
			const known = cache.fits.get(source.data);
			const pending = known?.mediaType === source.media_type ? undefined : run(source, maxBytes);
			// Idle workers start the next largest untouched captures at their first smaller encoding.
			// Pi's resizer returns the first fixed-order encoding below maxBytes, so that
			// result is exact for any later budget it still fits.
			for (const { image: { source: next } } of smaller) {
				if (!pool.idle()) break;
				if (captures.has(next!.data) && !cache.fits.has(next!.data) && next!.data.length <= MAX_IMAGE_BASE64_CHARS) {
					run(next!, next!.data.length);
				}
			}
			resized = await (pending ?? known!.pending);
			if (!pending && !(resized && resized.data.length < maxBytes)) resized = await run(source, maxBytes);
		}
		if (resized) {
			image.source = { ...source, data: resized.data, media_type: resized.mimeType };
			// Base64 data and MIME types serialize without escapes.
			bytes += resized.data.length - source.data.length + resized.mimeType.length - source.media_type.length;
			entry.originalWidth ??= resized.originalWidth;
			entry.originalHeight ??= resized.originalHeight;
			if (entry.note) {
				content.splice(content.indexOf(entry.note), 1);
				bytes -= blockBytes(entry.note) + 1; // The note and its array comma.
			}
			if (resized.width !== entry.originalWidth || resized.height !== entry.originalHeight) {
				const note = formatDimensionNote({ ...resized, originalWidth: entry.originalWidth, originalHeight: entry.originalHeight });
				entry.note = {
					type: "text",
					text: `[Additional request-size resize: ${note} Apply this coordinate mapping before any earlier mapping for this image.]`,
				};
				content.splice(content.indexOf(image) + 1, 0, entry.note);
				bytes += blockBytes(entry.note) + 1;
			}
		} else {
			const oldest = images.shift()!;
			const replacement = omitted(oldest.image);
			bytes += blockBytes(replacement) - blockBytes(oldest.image);
			oldest.content[oldest.content.indexOf(oldest.image)] = replacement;
			if (oldest.note) {
				oldest.content.splice(oldest.content.indexOf(oldest.note), 1);
				bytes -= blockBytes(oldest.note) + 1;
			}
		}
		// The running total is exact for well-formed sources; confirm it before stopping.
		if (bytes <= MAX_REQUEST_BYTES) bytes = requestBytes();
	}
	// Remember results only for this request's captures and their resized forms.
	for (const data of cache.fits.keys()) if (!captures.has(data) && !visited.has(data)) cache.fits.delete(data);
	return payload;
}

export default function anthropicImageGuard(pi: ExtensionAPI): void {
	// A fresh instance per load keeps reloaded code from inheriting an older cache shape.
	const cache = ((globalThis as SharedCache)[SHARED_CACHE] = new ImageGuardCache());
	const clearCache = () => cache.clear();
	pi.on("session_start", clearCache);
	pi.on("session_compact", clearCache);

	pi.on("context", async (event, ctx) => {
		if (await prepareClaudeImages(ctx.model, event.messages, cache)) {
			return { messages: event.messages };
		}
	});
}
