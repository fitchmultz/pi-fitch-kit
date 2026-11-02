import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
// ponytail: official 1.0's Jiti root alias breaks api/* subpaths. Use the public compat factory until the loader resolves narrow exports correctly.
import { anthropicMessagesApi } from "@earendil-works/pi-ai/compat";
import {
	type ExtensionContext,
	getAgentDir,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { fitClaudeRequest, sharedImageCache } from "./anthropic-image-guard.ts";

// Anthropic's fast-mode research preview bills double and rejects the `speed`
// field without its beta header, so payload and header must travel together.
// pi-ai assembles `anthropic-beta` (OAuth identity and feature markers) inside
// its client, after every extension header hook has run, and merges header
// sources last-write-wins. The only safe place to append the fast beta is a
// fetch wrapper on the finished request, which requires owning the provider's
// stream callback for the exact providers we vouch for.
export const ANTHROPIC_FAST_BETA = "fast-mode-2026-02-01";
const ANTHROPIC_FAST_MODEL_PREFIXES = ["claude-opus-5", "claude-opus-4-8"];
// Only routes known to reach Anthropic's entitlement-gated preview: the direct
// route and this setup's Cloudflare AI Gateway passthrough. Proxies such as
// github-copilot or opencode also serve Opus over anthropic-messages but are
// not overridden and stay stock.
export const ANTHROPIC_FAST_PROVIDERS = ["anthropic", "cloudflare-ai-gateway"];
const OPENAI_PROVIDERS = new Set(["openai", "openai-codex", "chatgpt-rotate"]);
// OpenAI Fast pricing supports these o-series models, not the whole family.
const OPENAI_PRIORITY_O_MODELS = new Set(["o3", "o3-2025-04-16", "o4-mini", "o4-mini-2025-04-16"]);
// Ultrafast only rides native global/US OpenAI Responses or Codex Responses routes.
const NATIVE_OPENAI_BASE_URLS = new Set([
	"https://api.openai.com/v1",
	"https://us.api.openai.com/v1",
]);
const NATIVE_CODEX_BASE_URLS = new Set([
	"https://chatgpt.com/backend-api",
	"https://chatgpt.com/backend-api/codex",
	"https://chatgpt.com/backend-api/codex/responses",
]);

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
	"client",
];

const messagesApi = anthropicMessagesApi();

// Faithful port of pi-ai's cloudflare-stream resolveCloudflareModel. The
// override replaces the gateway provider's cloudflareStreams() wrapper, which
// is the only place these endpoint placeholders materialize from the resolved
// provider env, so the same substitution must happen before every dispatch
// here, fast or not.
const CLOUDFLARE_ENV_KEYS = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_GATEWAY_ID"];
function resolveCloudflareModel(
	model: Model<Api>,
	env: Record<string, string> | undefined,
): Model<Api> {
	if (env === undefined) {
		return model;
	}
	let baseUrl = model.baseUrl;
	for (const key of CLOUDFLARE_ENV_KEYS) {
		baseUrl = baseUrl.replaceAll(`{${key}}`, env[key] ?? `{${key}}`);
	}
	return baseUrl === model.baseUrl ? model : { ...model, baseUrl };
}

export type FastModel =
	| { id?: string; provider?: string; api?: string; baseUrl?: string }
	| undefined;
export type FastRates = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type OpenAIMode = "off" | "priority" | "ultrafast";
export type SessionOpenAIMode = "off" | "ultrafast";
export const SESSION_MODE_ENTRY = "openai-ultrafast";
export const ULTRAFAST_UNAVAILABLE =
	"Ultrafast requires gpt-6-astra on a native OpenAI Responses route; other models, non-US regional endpoints and gateways are not supported. No mode was changed.";
export const ULTRAFAST_NOTICE =
	"6x API/credit price; 8x Codex included usage (Pro $500 or eligible Enterprise/Edu). Entitlement and rate limits apply; native cost accounting requires Ultrafast-capable Pi.";

export type Toggle = {
	/** Slash command name and footer status key. */
	name: string;
	/** Human label for notifications. */
	label: string;
	description: string;
	/** Shared per-user state file; other sessions watch it for footer sync. */
	statePath: string;
	/** Whether the active model honors this toggle at all. */
	eligible: (model: FastModel) => boolean;
};

export const anthropicEligible = (model: FastModel): boolean =>
	model?.provider !== undefined &&
	ANTHROPIC_FAST_PROVIDERS.includes(model.provider) &&
	ANTHROPIC_FAST_MODEL_PREFIXES.some((prefix) => model.id?.startsWith(prefix) === true);

export const ANTHROPIC_TOGGLE: Toggle = {
	name: "anthropic-fast",
	label: "Anthropic",
	description: "Toggle Anthropic Opus fast mode (2x token price)",
	statePath: join(getAgentDir(), "anthropic-fast.json"),
	eligible: anthropicEligible,
};

export const OPENAI_TOGGLE: Toggle = {
	name: "codex-fast",
	label: "OpenAI",
	description: "Select OpenAI priority/fast or Astra ultrafast mode (6x API/credit price)",
	statePath: join(getAgentDir(), "openai-codex-fast.json"),
	eligible: (model) =>
		model?.provider !== undefined &&
		(OPENAI_PROVIDERS.has(model.provider) ||
			(model.provider === "cloudflare-ai-gateway" &&
				(model.id?.startsWith("gpt-") === true || OPENAI_PRIORITY_O_MODELS.has(model.id ?? "")))),
};

export const XAI_TOGGLE: Toggle = {
	name: "xai-fast",
	label: "xAI",
	description: "Toggle xAI priority/fast mode",
	statePath: join(getAgentDir(), "xai-fast.json"),
	eligible: (model) =>
		model?.provider === "xai" ||
		(model?.provider === "cloudflare-ai-gateway" && model.id?.startsWith("grok-") === true),
};

export const TOGGLES = [ANTHROPIC_TOGGLE, OPENAI_TOGGLE, XAI_TOGGLE];
export const PRIORITY_TOGGLES = [OPENAI_TOGGLE, XAI_TOGGLE];

export function ultrafastEligible(model: FastModel): boolean {
	if (model?.id !== "gpt-6-astra") {
		return false;
	}
	const baseUrl = model.baseUrl?.replace(/\/+$/, "");
	if (baseUrl === undefined) {
		return false;
	}
	if (model.provider === "openai" && model.api === "openai-responses") {
		return NATIVE_OPENAI_BASE_URLS.has(baseUrl);
	}
	return (
		model.provider === "openai-codex" &&
		model.api === "openai-codex-responses" &&
		NATIVE_CODEX_BASE_URLS.has(baseUrl)
	);
}

export function openAIMode(): OpenAIMode {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(OPENAI_TOGGLE.statePath, "utf8"));
	} catch {
		return "off";
	}
	if (typeof parsed !== "object" || parsed === null) {
		return "off";
	}
	if (!("enabled" in parsed) || parsed.enabled !== true) {
		return "off";
	}
	if (!("tier" in parsed)) {
		return "priority";
	}
	if (parsed.tier === "ultrafast") {
		return "ultrafast";
	}
	return parsed.tier === undefined || parsed.tier === "priority" ? "priority" : "off";
}

/** The session-mode override recorded in one entry, when it is this session's. */
const sessionModeFromEntry = (
	entry: SessionEntry,
	sessionId: string,
): { mode: SessionOpenAIMode | undefined } | undefined => {
	if (entry.type !== "custom" || entry.customType !== SESSION_MODE_ENTRY) {
		return undefined;
	}
	const data: unknown = entry.data;
	if (typeof data !== "object" || data === null) {
		return undefined;
	}
	if (!("sessionId" in data) || data.sessionId !== sessionId) {
		return undefined;
	}
	if (!("mode" in data)) {
		return { mode: undefined };
	}
	return { mode: data.mode === "off" || data.mode === "ultrafast" ? data.mode : undefined };
};

export function restoreSessionOpenAIMode(ctx: ExtensionContext): SessionOpenAIMode | undefined {
	const sessionId = ctx.sessionManager.getSessionId();
	// This is session policy, not branch history: /tree must not silently change
	// tiers, and copied entries in a fork must not enable its parent's override.
	const entries = ctx.sessionManager.getEntries();
	for (const entry of entries.toReversed()) {
		const recorded = sessionModeFromEntry(entry, sessionId);
		if (recorded !== undefined) {
			return recorded.mode;
		}
	}
	return undefined;
}

export function notify(
	ctx: ExtensionContext,
	message: string,
	level: "info" | "warning" | "error" = "info",
): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
	} else {
		console.error(message);
	}
}

export function openAIStatus(ctx: ExtensionContext, local: SessionOpenAIMode | undefined): string {
	const shared = openAIMode();
	const effective = local ?? shared;
	const availability =
		effective === "ultrafast" && !ultrafastEligible(ctx.model)
			? " (unavailable on this route)"
			: "";
	return (
		`OpenAI shared: ${shared}; session: ${local ?? "inherit"}; effective: ${effective}${availability}.` +
		(shared === "ultrafast" || local === "ultrafast" ? ` ${ULTRAFAST_NOTICE}` : "")
	);
}

export function enabled(statePath: string): boolean {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(statePath, "utf8"));
	} catch {
		return false;
	}
	if (typeof parsed !== "object" || parsed === null) {
		return false;
	}
	return "enabled" in parsed && parsed.enabled === true;
}

export function writeEnabled(statePath: string, value: boolean, tier?: "ultrafast"): void {
	mkdirSync(dirname(statePath), { recursive: true });
	const state = { enabled: value, ...(tier !== undefined ? { tier } : {}) };
	writeFileSync(statePath, `${JSON.stringify(state)}\n`);
}

/** Anthropic fast mode bills double, so reported usage has to double with it. */
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
	const tiers = model.cost.tiers?.map(fastRates);
	const cost = tiers === undefined ? fastRates(model.cost) : { ...fastRates(model.cost), tiers };
	return { ...model, cost };
}

function fastOptions(options: SimpleStreamOptions | undefined): SimpleStreamOptions {
	const baseFetch = options?.fetch ?? globalThis.fetch;
	return {
		...options,
		// ponytail: append at fetch time because pi-ai builds anthropic-beta (including OAuth markers) after option headers, so setting it earlier would drop them.
		fetch: (input, init) => {
			const headers = new Headers(init?.headers);
			const betas =
				headers
					.get("anthropic-beta")
					?.split(",")
					.map((beta) => beta.trim())
					.filter(Boolean) ?? [];
			if (!betas.includes(ANTHROPIC_FAST_BETA)) {
				headers.set("anthropic-beta", [...betas, ANTHROPIC_FAST_BETA].join(","));
			}
			return baseFetch(input, { ...init, headers });
		},
		onPayload: async (payload, requestModel) => {
			const replaced = await options?.onPayload?.(payload, requestModel);
			const body: unknown = replaced === undefined ? payload : replaced;
			if (typeof body !== "object" || body === null) {
				return { speed: "fast" };
			}
			return { ...body, speed: "fast" };
		},
	};
}

/** True when the caller used an option only the full API can carry. */
const isFullStream = (options: SimpleStreamOptions | undefined): boolean =>
	FULL_STREAM_KEYS.some((key) => options !== undefined && key in options) ||
	(options !== undefined && "toolChoice" in options && options.reasoning === undefined);

export function fastStream(
	model: Model<Api>,
	context: Parameters<typeof messagesApi.streamSimple>[1],
	options?: SimpleStreamOptions,
): ReturnType<typeof messagesApi.stream> {
	const resolved = resolveCloudflareModel(model, options?.env);
	// One snapshot per request: a mid-request toggle must not split body and header.
	// A caller-supplied client bypasses options.fetch in pi-ai, so the mandatory beta header
	// cannot be attached; never send speed without it.
	const fast =
		anthropicEligible(resolved) &&
		!(options !== undefined && "client" in options) &&
		enabled(ANTHROPIC_TOGGLE.statePath);
	const target = fast ? fastModel(resolved) : resolved;
	const baseOptions = fast ? fastOptions(options) : options;
	const streamOptions: SimpleStreamOptions = {
		...baseOptions,
		onPayload: async (payload, requestModel) => {
			const replaced = await baseOptions?.onPayload?.(payload, requestModel);
			return fitClaudeRequest(
				requestModel,
				replaced === undefined ? payload : replaced,
				sharedImageCache(),
			);
		},
	};
	// toolChoice is shared by both APIs; explicit reasoning identifies a simple call.
	return isFullStream(options)
		? messagesApi.stream(target, context, streamOptions)
		: messagesApi.streamSimple(target, context, streamOptions);
}

export type FooterLabel = { text: string; color: "accent" | "warning" | "muted" } | undefined;

const setStatusLabel = (ctx: ExtensionContext, key: string, label: FooterLabel): void => {
	if (label === undefined) {
		ctx.ui.setStatus(key, undefined);
		return;
	}
	ctx.ui.setStatus(key, ctx.hasUI ? ctx.ui.theme.fg(label.color, label.text) : label.text);
};

/** OpenAI footer label: session off, ultrafast request, or priority state. */
const openAIFooterLabel = (
	ctx: ExtensionContext,
	local: SessionOpenAIMode | undefined,
): FooterLabel => {
	if (local === "off") {
		return OPENAI_TOGGLE.eligible(ctx.model)
			? { text: "session OpenAI tiers off", color: "muted" }
			: undefined;
	}
	const mode = local ?? openAIMode();
	if (mode === "ultrafast") {
		const active = ultrafastEligible(ctx.model);
		return {
			text: `${local !== undefined ? "session " : ""}ultrafast ${active ? "requested" : "unavailable"}`,
			color: active ? "accent" : "warning",
		};
	}
	if (mode !== "priority" || !OPENAI_TOGGLE.eligible(ctx.model)) {
		return undefined;
	}
	return { text: "priority enabled", color: "accent" };
};

/** Simple shared-file toggle label: fast when eligible and enabled. */
const fastFooterLabel = (ctx: ExtensionContext, toggle: Toggle): FooterLabel => {
	if (!toggle.eligible(ctx.model) || !enabled(toggle.statePath)) {
		return undefined;
	}
	return { text: "fast", color: "accent" };
};

// Active labels mirror the request gates; an unsupported Ultrafast selection
// stays visible as unavailable instead of silently becoming priority.
export function updateFooterStatus(
	ctx: ExtensionContext,
	local: SessionOpenAIMode | undefined,
): void {
	for (const toggle of TOGGLES) {
		try {
			const label =
				toggle === OPENAI_TOGGLE ? openAIFooterLabel(ctx, local) : fastFooterLabel(ctx, toggle);
			setStatusLabel(ctx, toggle.name, label);
		} catch {
			// Headless hosts do not expose a footer.
		}
	}
}
