import { readFileSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Api,
	anthropicMessagesApi,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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

type FastRates = { input: number; output: number; cacheRead: number; cacheWrite: number };

// Anthropic-native options a simple caller cannot express. Pi's composer collapses
// Provider.stream() and Provider.streamSimple() into one extension callback and drops the
// provenance, and streamSimple() keeps only a fixed field list, so any of these keys means
// the call must stay on the full API. A future Anthropic-only key would not be listed here
// and would be routed to the simple path, which loses it; that is the known cost of owning
// this callback at all, and it is why the list must be updated when pi-ai adds options.
const FULL_STREAM_KEYS = [
	"thinkingEnabled",
	"thinkingBudgetTokens",
	"effort",
	"thinkingDisplay",
	"interleavedThinking",
	"toolChoice",
	"client",
];

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

/** Fast mode bills double, so reported usage has to double with it. */
export function fastRates<T extends FastRates>(rates: T): T {
	return {
		...rates,
		input: rates.input * 2,
		output: rates.output * 2,
		cacheRead: rates.cacheRead * 2,
		cacheWrite: rates.cacheWrite * 2,
	};
}

function fastModel(model: Model<Api>): Model<Api> {
	return {
		...model,
		cost: { ...fastRates(model.cost), tiers: model.cost.tiers?.map(fastRates) },
	};
}

function fastOptions(options: SimpleStreamOptions | undefined): SimpleStreamOptions {
	const baseFetch = options?.fetch ?? globalThis.fetch;
	return {
		...options,
		// ponytail: append at fetch time because Pi builds anthropic-beta (including OAuth markers) after option headers, so setting it earlier would drop them.
		fetch: (input, init) => {
			const headers = new Headers(init?.headers);
			const betas =
				headers
					.get("anthropic-beta")
					?.split(",")
					.map((beta) => beta.trim())
					.filter(Boolean) ?? [];
			if (!betas.includes(FAST_BETA)) {
				headers.set("anthropic-beta", [...betas, FAST_BETA].join(","));
			}
			return baseFetch(input, { ...init, headers });
		},
		onPayload: async (payload, requestModel) => {
			const replaced = await options?.onPayload?.(payload, requestModel);
			const body = replaced === undefined ? payload : replaced;
			return { ...(body as Record<string, unknown>), speed: "fast" };
		},
	};
}

function fastStream(
	model: Model<Api>,
	context: Parameters<typeof messagesApi.streamSimple>[1],
	options?: SimpleStreamOptions,
) {
	// One snapshot per request: a mid-request toggle must not split body and header.
	// A caller-supplied client bypasses options.fetch in pi-ai, so the mandatory beta header
	// cannot be attached; never send speed without it.
	const fast =
		fastEnabled() && !(options !== undefined && "client" in options) && fastEligible(model);
	const target = fast ? fastModel(model) : model;
	const streamOptions = fast ? fastOptions(options) : options;
	return FULL_STREAM_KEYS.some((key) => options !== undefined && key in options)
		? messagesApi.stream(target, context, streamOptions)
		: messagesApi.streamSimple(target, context, streamOptions);
}

function fastEligible(model: { id?: string; provider?: string } | undefined): boolean {
	return (
		model?.provider === "anthropic" &&
		FAST_MODEL_PREFIXES.some((prefix) => model.id?.startsWith(prefix) === true)
	);
}

// Mirrors the per-request gate, so the footer never claims fast mode on a model that ignores it.
function updateFooterStatus(ctx: ExtensionContext): void {
	try {
		if (!fastEligible(ctx.model)) {
			ctx.ui.setStatus("anthropic-fast", undefined);
			return;
		}
		const fast = fastEnabled();
		const label = `fast:${fast ? "on" : "off"}`;
		ctx.ui.setStatus(
			"anthropic-fast",
			ctx.hasUI ? ctx.ui.theme.fg(fast ? "accent" : "muted", label) : label,
		);
	} catch {
		// Headless hosts do not expose a footer.
	}
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

	// Registered once, gated per request. Toggling registration instead would delete any other
	// extension's Anthropic registration, because Pi merges them into one provider-level object.
	pi.registerProvider("anthropic", { api: "anthropic-messages", streamSimple: fastStream });

	// The state file is shared by every session, so watch it rather than only redrawing locally.
	let footerContext: ExtensionContext | undefined;
	const refreshFooter = () => {
		if (footerContext) updateFooterStatus(footerContext);
	};
	pi.on("session_start", (_event, ctx) => {
		footerContext = ctx;
		updateFooterStatus(ctx);
		// Unwatch first: a repeated session_start would otherwise stack listeners, and a single
		// shutdown would then leave one behind holding the process open.
		unwatchFile(FAST_STATE_PATH, refreshFooter);
		if (ctx.hasUI) watchFile(FAST_STATE_PATH, { interval: 5000 }, refreshFooter);
	});
	pi.on("session_shutdown", () => {
		unwatchFile(FAST_STATE_PATH, refreshFooter);
		footerContext = undefined;
	});
	pi.on("model_select", (_event, ctx) => updateFooterStatus(ctx));

	pi.registerCommand("anthropic-fast", {
		description: "Toggle Anthropic Opus fast mode (2x token price)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg !== "" && arg !== "on" && arg !== "off") {
				ctx.ui.notify("Usage: /anthropic-fast [on|off]", "warning");
				return;
			}
			if (arg === "on" || arg === "off") {
				writeFileSync(FAST_STATE_PATH, `${JSON.stringify({ enabled: arg === "on" })}\n`);
			}
			updateFooterStatus(ctx);
			ctx.ui.notify(`Anthropic fast mode ${fastEnabled() ? "ON" : "OFF"}`, "info");
		},
	});
}
