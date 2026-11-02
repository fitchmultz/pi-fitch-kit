import { formatDimensionNote } from "@earendil-works/pi-coding-agent";
import {
	ImageGuardCache,
	type ImageModel,
	isBlockArray,
	isClaude,
	MAX_IMAGE_BASE64_CHARS,
	MAX_REQUEST_BYTES,
	type Resized,
	type ResizePool,
	resizePool,
} from "./anthropic-image-core.ts";

/** A serialized base64 image source block. */
type Source = { type: "base64"; data: string; media_type: string };

/** A collected image block: always carries its base64 source. */
type ImageBlock = { type: string; source: Source; content?: unknown; text?: string };

/** A text block that replaces a dropped image, keeping other native markers. */
type OmittedBlock = { type: string; source?: undefined; text: string };

/** A note block attached after a request-size resize. */
type NoteBlock = { type: string; text: string };

/** One collected image and the content list it lives in. */
type ImageCapture = {
	content: unknown[];
	image: ImageBlock;
	note?: NoteBlock;
	originalWidth?: number;
	originalHeight?: number;
};

const isBase64Source = (value: unknown): value is Source =>
	typeof value === "object" &&
	value !== null &&
	"type" in value &&
	value.type === "base64" &&
	"data" in value &&
	typeof value.data === "string" &&
	"media_type" in value &&
	typeof value.media_type === "string";

const isImageBlock = (value: unknown): value is ImageBlock =>
	typeof value === "object" &&
	value !== null &&
	"type" in value &&
	value.type === "image" &&
	"source" in value &&
	isBase64Source(value.source);

/** Returns a tool-result block's nested content, if it is one. */
const toolResultContent = (block: unknown): unknown => {
	if (typeof block !== "object" || block === null) {
		return undefined;
	}
	if (!("type" in block) || block.type !== "tool_result" || !("content" in block)) {
		return undefined;
	}
	return block.content;
};

/** Returns a message's content list, if it has one. */
const messageContent = (message: unknown): unknown[] | undefined => {
	if (typeof message !== "object" || message === null || !("content" in message)) {
		return undefined;
	}
	return isBlockArray(message.content) ? message.content : undefined;
};

/** Collects every image block in the payload's messages, tool results included. */
const collectImages = (payload: object): ImageCapture[] => {
	const images: ImageCapture[] = [];
	if (!("messages" in payload) || !isBlockArray(payload.messages)) {
		return images;
	}
	// Traverse only message image blocks, never tool schemas or tool-call arguments.
	const collect = (content: unknown): void => {
		if (!isBlockArray(content)) {
			return;
		}
		for (const block of content) {
			if (isImageBlock(block)) {
				images.push({ content, image: block });
			} else {
				collect(toolResultContent(block));
			}
		}
	};
	for (const message of payload.messages) {
		collect(messageContent(message));
	}
	return images;
};

/** Runs one request-size resize and records it in the fits cache. */
const startFit = (
	source: Source,
	maxBytes: number,
	pool: ResizePool,
	cache: ImageGuardCache,
): Promise<Resized> => {
	const pending = pool.run(source.data, source.media_type, { maxBytes });
	cache.fits.set(source.data, { mediaType: source.media_type, pending });
	return pending;
};

/** Starts first-encoding prefetches for untouched captures while workers are idle. */
const prefetchIdle = (
	smaller: ImageCapture[],
	captures: Set<string>,
	pool: ResizePool,
	cache: ImageGuardCache,
): void => {
	// Idle workers start the next largest untouched captures at their first smaller encoding.
	// Pi's resizer returns the first fixed-order encoding below maxBytes, so that
	// result is exact for any later budget it still fits.
	for (const { image } of smaller) {
		if (!pool.idle()) {
			break;
		}
		const source = image.source;
		if (
			captures.has(source.data) &&
			!cache.fits.has(source.data) &&
			source.data.length <= MAX_IMAGE_BASE64_CHARS
		) {
			startFit(source, source.data.length, pool, cache).catch(() => {
				// The awaited read in cache.fits owns the prefetch result; it resolves to null on failure.
			});
		}
	}
};

/** The running request-size reduction for one over-limit payload. */
class RequestFit {
	private readonly payload: object;
	private readonly images: ImageCapture[];
	private readonly pool: ResizePool;
	private readonly cache: ImageGuardCache;
	private bytes: number;
	private readonly visited = new Set<string>();
	private readonly captures: Set<string>;

	constructor(payload: object, images: ImageCapture[], pool: ResizePool, cache: ImageGuardCache) {
		this.payload = payload;
		this.images = images;
		this.pool = pool;
		this.cache = cache;
		// A capture keeps its earlier request-size result while that still fits its share, so
		// repeated over-limit turns skip native work and resend identical, cacheable image bytes.
		this.captures = new Set(images.map(({ image }) => image.source.data));
		this.bytes = this.requestBytes();
	}

	/** Native Anthropic streaming restores this field after onPayload replacements. */
	requestBytes(): number {
		return Buffer.byteLength(JSON.stringify({ ...this.payload, stream: true }));
	}

	blockBytes(block: object): number {
		return Buffer.byteLength(JSON.stringify(block));
	}

	/** The text replacement for a dropped image, keeping native cache-control markers. */
	omitted(image: ImageBlock): OmittedBlock {
		return {
			...image,
			type: "text",
			source: undefined,
			text: "[Image omitted: Anthropic request size limit.]",
		};
	}

	/** True when dropping every image still fits the request under the limit. */
	withoutImagesFits(): boolean {
		const withoutImages =
			this.bytes -
			this.images.reduce(
				(total, capture) =>
					total + this.blockBytes(capture.image) - this.blockBytes(this.omitted(capture.image)),
				0,
			);
		// Text/tool overflow belongs to Pi and the provider; image handling cannot heal it.
		return withoutImages <= MAX_REQUEST_BYTES;
	}

	needsMore(): boolean {
		return this.bytes > MAX_REQUEST_BYTES && this.images.length > 0;
	}

	/** Reduces the payload until the exact byte count fits the request limit. */
	async reduce(): Promise<void> {
		while (this.needsMore()) {
			await this.reduceOne();
		}
		// The running total is exact for well-formed sources; confirm it before stopping.
		if (this.bytes <= MAX_REQUEST_BYTES) {
			this.bytes = this.requestBytes();
		}
		// Remember results only for this request's captures and their resized forms.
		for (const data of this.cache.fits.keys()) {
			if (!this.captures.has(data) && !this.visited.has(data)) {
				this.cache.fits.delete(data);
			}
		}
	}

	private async reduceOne(): Promise<void> {
		// Resize the largest capture first, sharing the reduction across image bytes.
		// Keep this list chronological so an irreducible image budget drops oldest first.
		const [entry, ...smaller] = this.images.toSorted(
			(a, b) => b.image.source.data.length - a.image.source.data.length,
		);
		if (entry === undefined) {
			return;
		}
		const { content, image } = entry;
		const source = image.source;
		const maxBytes = this.budgetFor(source);
		const resized = await this.attemptResize(smaller, source, maxBytes);
		if (resized === null || resized === undefined) {
			this.dropOldest();
			return;
		}
		image.source = { ...source, data: resized.data, media_type: resized.mimeType };
		// Base64 data and MIME types serialize without escapes.
		this.bytes +=
			resized.data.length - source.data.length + resized.mimeType.length - source.media_type.length;
		entry.originalWidth ??= resized.originalWidth;
		entry.originalHeight ??= resized.originalHeight;
		this.removeNote(content, entry.note);
		const note = this.dimensionNote(entry, resized);
		if (note !== undefined) {
			entry.note = note;
			content.splice(content.indexOf(image) + 1, 0, note);
			this.bytes += this.blockBytes(note) + 1;
		}
	}

	/** The byte budget that shares the remaining reduction across image bytes. */
	private budgetFor(source: Source): number {
		const imageChars = this.images.reduce(
			(total, capture) => total + capture.image.source.data.length,
			0,
		);
		return Math.floor(source.data.length * (1 - (this.bytes - MAX_REQUEST_BYTES) / imageChars));
	}

	/** Resizes the largest capture, reusing a still-fitting earlier result. */
	private async attemptResize(
		smaller: ImageCapture[],
		source: Source,
		maxBytes: number,
	): Promise<Resized | undefined> {
		if (maxBytes <= 0 || source.data.length > MAX_IMAGE_BASE64_CHARS) {
			return undefined;
		}
		this.visited.add(source.data);
		const known = this.cache.fits.get(source.data);
		const matched = known !== undefined && known.mediaType === source.media_type;
		const pending = matched ? undefined : startFit(source, maxBytes, this.pool, this.cache);
		prefetchIdle(smaller, this.captures, this.pool, this.cache);
		if (matched) {
			const cached = await known.pending;
			if (cached !== null && cached.data.length < maxBytes) {
				return cached;
			}
			return await startFit(source, maxBytes, this.pool, this.cache);
		}
		return await pending;
	}

	/** Removes a stale note block and its array comma from the byte total. */
	private removeNote(content: unknown[], note: NoteBlock | undefined): void {
		if (note === undefined) {
			return;
		}
		content.splice(content.indexOf(note), 1);
		this.bytes -= this.blockBytes(note) + 1; // The note and its array comma.
	}

	/** Builds the additional-resize note when dimensions changed from the original. */
	private dimensionNote(entry: ImageCapture, resized: NonNullable<Resized>): NoteBlock | undefined {
		if (resized.width === entry.originalWidth && resized.height === entry.originalHeight) {
			return undefined;
		}
		const note = formatDimensionNote({
			...resized,
			...(entry.originalWidth !== undefined ? { originalWidth: entry.originalWidth } : {}),
			...(entry.originalHeight !== undefined ? { originalHeight: entry.originalHeight } : {}),
		});
		if (note === undefined) {
			return undefined;
		}
		return {
			type: "text",
			text: `[Additional request-size resize: ${note} Apply this coordinate mapping before any earlier mapping for this image.]`,
		};
	}

	/** Drops the oldest capture, replacing it with its omission text. */
	private dropOldest(): void {
		const oldest = this.images.shift();
		if (oldest === undefined) {
			return;
		}
		const replacement = this.omitted(oldest.image);
		this.bytes += this.blockBytes(replacement) - this.blockBytes(oldest.image);
		oldest.content[oldest.content.indexOf(oldest.image)] = replacement;
		this.removeNote(oldest.content, oldest.note);
	}
}

/** Runs on the native serialized payload, after prompt/tool conversion and caller hooks. */
export async function fitClaudeRequest(
	model: ImageModel,
	payload: unknown,
	cache: ImageGuardCache = new ImageGuardCache(),
): Promise<unknown> {
	if (
		!isClaude(model) ||
		payload === null ||
		typeof payload !== "object" ||
		Array.isArray(payload)
	) {
		return payload;
	}
	const images = collectImages(payload);
	if (images.length === 0) {
		return payload;
	}
	const fit = new RequestFit(payload, images, resizePool(), cache);
	if (fit.requestBytes() <= MAX_REQUEST_BYTES) {
		return payload;
	}
	if (!fit.withoutImagesFits()) {
		return payload;
	}
	await fit.reduce();
	return payload;
}
