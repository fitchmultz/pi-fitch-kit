import { availableParallelism } from "node:os";
import { resizeImage } from "@earendil-works/pi-coding-agent";

// ponytail: Retain up to 128 MiB of estimated source/result storage, not every
// historical image. Larger requests reuse a bounded snapshot; raise the byte
// budget only with measured memory headroom, never restore an entry-count cap.
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
export const MAX_IMAGE_BASE64_CHARS = 32 * 1024 * 1024;
export const MAX_CONTEXT_IMAGE_BASE64_CHARS = 64 * 1024 * 1024;
// ponytail: Each native resize decodes in its own worker; four at once bound the decode
// memory of a cold request. Raise only with measured memory headroom.
const RESIZE_CONCURRENCY = Math.max(1, Math.min(4, availableParallelism() - 1));
// Messages requests, including text, tools, and JSON framing: https://platform.claude.com/docs/en/api/errors
export const MAX_REQUEST_BYTES = 32_000_000;
const ANTHROPIC_IMAGE_MIME_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export type Resized = Awaited<ReturnType<typeof resizeImage>>;
export type CachedImage = { mimeType: string; pending: Promise<Resized>; bytes: number };

/** Narrow unknown arrays without the any[] element gap Array.isArray leaves. */
export const isBlockArray = (value: unknown): value is unknown[] => Array.isArray(value);

export class ImageGuardCache {
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
		if (entry !== undefined) {
			this.bytes -= entry.bytes;
		}
		this.entries.delete(data);
	}

	set(data: string, entry: CachedImage): void {
		this.delete(data);
		this.entries.set(data, entry);
		this.bytes += entry.bytes;
		while (this.bytes > MAX_CACHE_BYTES) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.delete(oldest);
		}
	}
}

// Pi loads each extension with its own module instance; the writer finds the
// loaded guard's cache here instead of decoding every capture again. Class
// identity differs per instance, so recognize the cache by shape instead.
const SHARED_CACHE = Symbol.for("pi-fitch-kit.anthropic-image-cache");
const sharedGlobals: Record<symbol, unknown> = globalThis;

/** Recognizes a guard cache across module instances by shape, not class identity. */
const isImageGuardCache = (value: unknown): value is ImageGuardCache =>
	typeof value === "object" &&
	value !== null &&
	"entries" in value &&
	value.entries instanceof Map &&
	"fits" in value &&
	value.fits instanceof Map &&
	"clear" in value &&
	typeof value.clear === "function";

export const sharedImageCache = (): ImageGuardCache => {
	const existing = sharedGlobals[SHARED_CACHE];
	if (isImageGuardCache(existing)) {
		return existing;
	}
	const cache = new ImageGuardCache();
	sharedGlobals[SHARED_CACHE] = cache;
	return cache;
};

/** Registers this load's cache as the shared cross-extension cache. */
export const shareImageCache = (cache: ImageGuardCache): void => {
	sharedGlobals[SHARED_CACHE] = cache;
};

/** Bounded native-resize worker pool. */
export type ResizePool = {
	idle: () => boolean;
	run: (
		data: string,
		mimeType: string,
		options?: Parameters<typeof resizeImage>[2],
	) => Promise<Resized>;
};

/** Starts native resizes in arrival order, at most RESIZE_CONCURRENCY at a time. */
export function resizePool(): ResizePool {
	let active = 0;
	const waiting: Array<() => void> = [];
	const release = () => {
		active--;
		waiting.shift()?.();
	};
	return {
		// Jobs wait only while every worker slot is busy.
		idle: () => active < RESIZE_CONCURRENCY,
		run: (data, mimeType, options) =>
			new Promise<Resized>((resolve) => {
				const start = () => {
					active++;
					resizeImage(Buffer.from(data, "base64"), mimeType, options)
						.then((result) => {
							release();
							resolve(result);
						})
						.catch(() => {
							// A failed native resize resolves to null so every waiter sees the same outcome.
							release();
							resolve(null);
						});
				};
				if (active < RESIZE_CONCURRENCY) {
					start();
				} else {
					waiting.push(start);
				}
			}),
	};
}

export type ImageModel = { api?: string; id?: string } | undefined;

export function isClaude(model: ImageModel): boolean {
	return model?.api === "anthropic-messages" && model.id?.toLowerCase().includes("claude") === true;
}

export function anthropicMimeType(mimeType: string): string | undefined {
	const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase();
	if (normalized === "image/jpg") {
		return "image/jpeg";
	}
	return normalized !== undefined && ANTHROPIC_IMAGE_MIME_TYPES.has(normalized)
		? normalized
		: undefined;
}
