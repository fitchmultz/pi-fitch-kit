import { mkdirSync, readFileSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type Api,
	anthropicMessagesApi,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { fitClaudeRequest } from "./anthropic-image-guard.ts";

// Anthropic's fast-mode research preview bills double and rejects the `speed`
// field without its beta header, so payload and header must travel together.
// pi-ai assembles `anthropic-beta` (OAuth identity and feature markers) inside
// its client, after every extension header hook has run, and merges header
// sources last-write-wins. The only safe place to append the fast beta is a
// fetch wrapper on the finished request, which requires owning the provider's
// stream callback for the exact providers we vouch for.
const ANTHROPIC_FAST_BETA = "fast-mode-2026-02-01";
const ANTHROPIC_FAST_MODEL_PREFIXES = ["claude-opus-5", "claude-opus-4-8"];
// Only routes known to reach Anthropic's entitlement-gated preview: the direct
// route and this setup's Cloudflare AI Gateway passthrough. Proxies such as
// github-copilot or opencode also serve Opus over anthropic-messages but are
// not overridden and stay stock.
const ANTHROPIC_FAST_PROVIDERS = ["anthropic", "cloudflare-ai-gateway"];
const OPENAI_PROVIDERS = new Set(["openai", "openai-codex"]);
// OpenAI Fast pricing supports these o-series models, not the whole family.
const OPENAI_PRIORITY_O_MODELS = new Set(["o3", "o3-2025-04-16", "o4-mini", "o4-mini-2025-04-16"]);

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
function resolveCloudflareModel(model: Model<Api>, env: Record<string, string> | undefined): Model<Api> {
	if (!env) return model;
	let baseUrl = model.baseUrl;
	for (const key of CLOUDFLARE_ENV_KEYS) {
		baseUrl = baseUrl.replaceAll(`{${key}}`, env[key] ?? `{${key}}`);
	}
	return baseUrl === model.baseUrl ? model : { ...model, baseUrl };
}

type FastModel = { id?: string; provider?: string; api?: string; baseUrl?: string } | undefined;
type FastRates = { input: number; output: number; cacheRead: number; cacheWrite: number };
type OpenAIMode = "off" | "priority" | "ultrafast";
type SessionOpenAIMode = "off" | "ultrafast";
const SESSION_MODE_ENTRY = "openai-ultrafast";
const STARTUP_STATE = Symbol.for("pi-fitch-kit.openai-startup");
const ULTRAFAST_UNAVAILABLE = "Ultrafast requires gpt-6-astra on a native OpenAI Responses route; other models, non-US regional endpoints and gateways are not supported. No mode was changed.";
const ULTRAFAST_NOTICE = "6x API/credit price; 8x Codex included usage (Pro $500 or eligible Enterprise/Edu). Entitlement and rate limits apply; native cost accounting requires Ultrafast-capable Pi.";

type Toggle = {
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

const anthropicEligible = (model: FastModel): boolean =>
	model?.provider !== undefined &&
	ANTHROPIC_FAST_PROVIDERS.includes(model.provider) &&
	ANTHROPIC_FAST_MODEL_PREFIXES.some((prefix) => model.id?.startsWith(prefix) === true);

const ANTHROPIC_TOGGLE: Toggle = {
	name: "anthropic-fast",
	label: "Anthropic",
	description: "Toggle Anthropic Opus fast mode (2x token price)",
	statePath: join(getAgentDir(), "anthropic-fast.json"),
	eligible: anthropicEligible,
};

const OPENAI_TOGGLE: Toggle = {
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

const XAI_TOGGLE: Toggle = {
	name: "xai-fast",
	label: "xAI",
	description: "Toggle xAI priority/fast mode",
	statePath: join(getAgentDir(), "xai-fast.json"),
	eligible: (model) =>
		model?.provider === "xai" ||
		(model?.provider === "cloudflare-ai-gateway" && model.id?.startsWith("grok-") === true),
};

const TOGGLES = [ANTHROPIC_TOGGLE, OPENAI_TOGGLE, XAI_TOGGLE];
const PRIORITY_TOGGLES = [OPENAI_TOGGLE, XAI_TOGGLE];

function ultrafastEligible(model: FastModel): boolean {
	if (model?.id !== "gpt-6-astra") return false;
	const baseUrl = model.baseUrl?.replace(/\/+$/, "");
	if (model.provider === "openai" && model.api === "openai-responses") {
		return baseUrl === "https://api.openai.com/v1" || baseUrl === "https://us.api.openai.com/v1";
	}
	return model.provider === "openai-codex" && model.api === "openai-codex-responses" &&
		(baseUrl === "https://chatgpt.com/backend-api" ||
			baseUrl === "https://chatgpt.com/backend-api/codex" ||
			baseUrl === "https://chatgpt.com/backend-api/codex/responses");
}

function openAIMode(): OpenAIMode {
	try {
		const state = JSON.parse(readFileSync(OPENAI_TOGGLE.statePath, "utf8")) as {
			enabled?: unknown;
			tier?: unknown;
		};
		if (state?.enabled !== true) return "off";
		if (state.tier === "ultrafast") return "ultrafast";
		return state.tier === undefined || state.tier === "priority" ? "priority" : "off";
	} catch {
		return "off";
	}
}

function sessionOpenAIMode(ctx: ExtensionContext): SessionOpenAIMode | undefined {
	const sessionId = ctx.sessionManager.getSessionId();
	// This is session policy, not branch history: /tree must not silently change
	// tiers, and copied entries in a fork must not enable its parent's override.
	const entries = ctx.sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "custom" || entry.customType !== SESSION_MODE_ENTRY) continue;
		const data = entry.data as { sessionId?: unknown; mode?: unknown } | null;
		if (data?.sessionId !== sessionId) continue;
		return data.mode === "off" || data.mode === "ultrafast" ? data.mode : undefined;
	}
	return undefined;
}

function effectiveOpenAIMode(ctx: ExtensionContext): OpenAIMode {
	return sessionOpenAIMode(ctx) ?? openAIMode();
}

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
	else console.error(message);
}

function openAIStatus(ctx: ExtensionContext): string {
	const shared = openAIMode();
	const local = sessionOpenAIMode(ctx);
	const effective = local ?? shared;
	const availability = effective === "ultrafast" && !ultrafastEligible(ctx.model) ? " (unavailable on this route)" : "";
	return `OpenAI shared: ${shared}; session: ${local ?? "inherit"}; effective: ${effective}${availability}.` +
		(shared === "ultrafast" || local === "ultrafast" ? ` ${ULTRAFAST_NOTICE}` : "");
}

function enabled(statePath: string): boolean {
	try {
		return JSON.parse(readFileSync(statePath, "utf8")).enabled === true;
	} catch {
		return false;
	}
}

function writeEnabled(statePath: string, value: boolean, tier?: "ultrafast"): void {
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(statePath, `${JSON.stringify({ enabled: value, ...(tier ? { tier } : {}) })}\n`);
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
	return {
		...model,
		cost: { ...fastRates(model.cost), tiers: model.cost.tiers?.map(fastRates) },
	};
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
	const resolved = resolveCloudflareModel(model, options?.env);
	// One snapshot per request: a mid-request toggle must not split body and header.
	// A caller-supplied client bypasses options.fetch in pi-ai, so the mandatory beta header
	// cannot be attached; never send speed without it.
	const fast =
		enabled(ANTHROPIC_TOGGLE.statePath) &&
		!(options !== undefined && "client" in options) &&
		anthropicEligible(resolved);
	const target = fast ? fastModel(resolved) : resolved;
	const baseOptions = fast ? fastOptions(options) : options;
	const streamOptions: SimpleStreamOptions = {
		...baseOptions,
		onPayload: async (payload, requestModel) => {
			const replaced = await baseOptions?.onPayload?.(payload, requestModel);
			return fitClaudeRequest(requestModel, replaced === undefined ? payload : replaced);
		},
	};
	// toolChoice is shared by both APIs; explicit reasoning identifies a simple call.
	const fullStream = FULL_STREAM_KEYS.some((key) => options !== undefined && key in options) ||
		(options !== undefined && "toolChoice" in options && options.reasoning === undefined);
	return fullStream
		? messagesApi.stream(target, context, streamOptions)
		: messagesApi.streamSimple(target, context, streamOptions);
}

// Active labels mirror the request gates; an unsupported Ultrafast selection
// stays visible as unavailable instead of silently becoming priority.
function updateFooterStatus(ctx: ExtensionContext): void {
	for (const toggle of TOGGLES) {
		try {
			const mode = toggle === OPENAI_TOGGLE ? effectiveOpenAIMode(ctx) : undefined;
			const local = toggle === OPENAI_TOGGLE ? sessionOpenAIMode(ctx) : undefined;
			if (local === "off") {
				const label = toggle.eligible(ctx.model) ? "session OpenAI tiers off" : undefined;
				ctx.ui.setStatus(toggle.name, label && ctx.hasUI ? ctx.ui.theme.fg("muted", label) : label);
				continue;
			}
			if (mode === "ultrafast") {
				const active = ultrafastEligible(ctx.model);
				const label = `${local ? "session " : ""}ultrafast ${active ? "requested" : "unavailable"}`;
				ctx.ui.setStatus(toggle.name, ctx.hasUI ? ctx.ui.theme.fg(active ? "accent" : "warning", label) : label);
				continue;
			}
			const on = toggle === OPENAI_TOGGLE ? mode === "priority" : enabled(toggle.statePath);
			if (!toggle.eligible(ctx.model) || !on) {
				ctx.ui.setStatus(toggle.name, undefined);
				continue;
			}
			const label = toggle === OPENAI_TOGGLE ? "priority enabled" : "fast";
			ctx.ui.setStatus(toggle.name, ctx.hasUI ? ctx.ui.theme.fg("accent", label) : label);
		} catch {
			// Headless hosts do not expose a footer.
		}
	}
}

export default function fastMode(pi: ExtensionAPI): void {
	pi.registerFlag("fast", {
		description: "Start with OpenAI priority/fast mode enabled",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("ultrafast", {
		description: "Start with Astra ultrafast requests (6x API/credit price; cannot combine with --fast)",
		type: "boolean",
		default: false,
	});
	// Session replacement and reload recreate factories. Unresolved CLI validation
	// belongs to the process; the selected tiers still live in files/session entries.
	const startup = ((globalThis as { [STARTUP_STATE]?: { error?: string } })[STARTUP_STATE] ??= {});
	pi.on("input", (event, ctx) => {
		if (!startup.error || event.source === "extension") return;
		notify(ctx, startup.error, "error");
		return { action: "handled" };
	});

	// Anthropic fast mode: the override receives auth-resolved options (credential
	// headers, gateway env) and reproduces pi-ai's own dispatch for
	// anthropic-messages models, including the gateway endpoint-placeholder
	// resolution its wrapper would have done, so off-state behavior is
	// base-equivalent.
	for (const provider of ANTHROPIC_FAST_PROVIDERS) {
		pi.registerProvider(provider, { api: "anthropic-messages", streamSimple: fastStream });
	}

	// service_tier is OpenAI/xAI priority; gate by provider so other
	// OpenAI-compatible endpoints never receive it.
	pi.on("before_provider_request", (event, ctx) => {
		const toggle = PRIORITY_TOGGLES.find((t) => t.eligible(ctx.model));
		if (!toggle) return;
		const tier = toggle === OPENAI_TOGGLE ? effectiveOpenAIMode(ctx) : enabled(toggle.statePath) ? "priority" : "off";
		if (tier === "off") return;
		const payload = event.payload;
		if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return;
		const body = payload as Record<string, unknown>;
		if (tier === "ultrafast" && (!ultrafastEligible(ctx.model) || body.model !== "gpt-6-astra")) return;
		return { ...body, service_tier: tier };
	});

	// The state files are shared by every session, so watch them rather than
	// only redrawing after local toggles.
	let footerContext: ExtensionContext | undefined;
	const refreshFooter = () => {
		if (footerContext) updateFooterStatus(footerContext);
	};
	pi.on("session_start", (event, ctx) => {
		footerContext = ctx;
		if (event.reason === "startup") {
			const fast = pi.getFlag("fast") === true;
			const ultrafast = pi.getFlag("ultrafast") === true;
			startup.error = fast && ultrafast
				? "Use either --fast or --ultrafast, not both. Select /codex-fast on, off, or ultrafast to continue."
				: ultrafast && !ultrafastEligible(ctx.model)
					? "--ultrafast requires gpt-6-astra on a native OpenAI Responses route. Select a supported model and /codex-fast ultrafast, or /codex-fast off to continue."
					: undefined;
			if (startup.error) {
				notify(ctx, startup.error, "error");
				if (!ctx.hasUI) {
					process.exitCode = 1;
					ctx.shutdown();
				}
			} else if (fast || ultrafast) writeEnabled(OPENAI_TOGGLE.statePath, true, ultrafast ? "ultrafast" : undefined);
		}
		if (!startup.error && (openAIMode() === "ultrafast" || sessionOpenAIMode(ctx) === "ultrafast")) notify(ctx, openAIStatus(ctx));
		updateFooterStatus(ctx);
		for (const toggle of TOGGLES) {
			// Unwatch first: a repeated session_start must not stack listeners, or a
			// single shutdown would leave one behind holding the process open.
			unwatchFile(toggle.statePath, refreshFooter);
			if (ctx.hasUI) watchFile(toggle.statePath, { interval: 5000 }, refreshFooter);
		}
	});
	pi.on("session_shutdown", () => {
		for (const toggle of TOGGLES) unwatchFile(toggle.statePath, refreshFooter);
		footerContext = undefined;
	});
	pi.on("model_select", (_event, ctx) => updateFooterStatus(ctx));

	// Fork-only event; official Pi never emits it and its types do not declare it.
	(pi.on as unknown as (event: "session_checkpoint", handler: () => {
		sleepReady: boolean;
	}) => void)("session_checkpoint", () => {
		// There is no adopted in-memory toggle: every request/status reads native entries and the same files,
		// including enabled()'s existing off fallback on read errors. Native dispatch joins
		// synchronous command/startup writes and provider work. Watchers only read/redraw;
		// they neither accept work nor change settings. Files and session entries belong in the host archive.
		return { sleepReady: true };
	});

	const registerToggleCommand = (name: string, toggle: Toggle, emptyMeansToggle = false): void => {
		pi.registerCommand(name, {
			description: name === toggle.name ? toggle.description : `Alias for /${toggle.name}`,
			handler: async (args, ctx) => {
				const input = args.trim().toLowerCase();
				const command = emptyMeansToggle && input === "" ? "toggle" : input;
				const openai = toggle === OPENAI_TOGGLE;
				const previousMode = openai ? openAIMode() : undefined;
				if (!["", "status", "on", "off", "toggle"].includes(command) && !(openai && command === "ultrafast")) {
					notify(ctx, `Usage: /${name} [on|off|toggle|status${openai ? "|ultrafast" : ""}]`, "warning");
					return;
				}
				if (command === "ultrafast" && !ultrafastEligible(ctx.model)) {
					notify(ctx, ULTRAFAST_UNAVAILABLE, "warning");
					return;
				}
				if (["on", "off", "toggle", "ultrafast"].includes(command)) {
					const on = openai ? previousMode !== "off" : enabled(toggle.statePath);
					const next = command === "toggle" ? !on : command !== "off";
					writeEnabled(toggle.statePath, next, command === "ultrafast" ? "ultrafast" : undefined);
					if (openai) startup.error = undefined;
				}
				updateFooterStatus(ctx);
				const mode = openai ? openAIMode() : undefined;
				if (openai && (mode === "ultrafast" || sessionOpenAIMode(ctx) !== undefined || command === "status" || command === "")) {
					notify(ctx, openAIStatus(ctx));
					return;
				}
				const policy = openai
					? previousMode === "ultrafast" && mode === "off" ? "ultrafast requests" : "priority requests"
					: "fast mode";
				const on = openai ? mode !== "off" : enabled(toggle.statePath);
				notify(ctx,
					`${toggle.label} ${policy} ${on ? "ON" : "OFF"}`,
					"info",
				);
			},
		});
	};
	for (const toggle of TOGGLES) registerToggleCommand(toggle.name, toggle);
	registerToggleCommand("fast", OPENAI_TOGGLE, true);
	pi.registerCommand("ultrafast", {
		description: "Toggle Astra Ultrafast globally, or use --session for a session-only override (6x API/credit price)",
		handler: async (args, ctx) => {
			const tokens = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
			const local = tokens.includes("--session");
			const verbs = tokens.filter((token) => token !== "--session");
			const command = verbs[0] ?? "toggle";
			if (verbs.length > 1 || !["on", "off", "toggle", "status", "reset"].includes(command) ||
				(command === "reset" && !local) || tokens.filter((token) => token === "--session").length > 1) {
				notify(ctx, "Usage: /ultrafast [on|off|toggle|status] [--session], or /ultrafast reset --session", "warning");
				return;
			}
			if (command !== "status") {
				const current = local ? effectiveOpenAIMode(ctx) : openAIMode();
				const next = command === "reset" ? null :
					command === "off" || (command === "toggle" && current === "ultrafast") ? "off" : "ultrafast";
				if (next === "ultrafast" && !ultrafastEligible(ctx.model)) {
					notify(ctx, ULTRAFAST_UNAVAILABLE, "warning");
					return;
				}
				if (local) pi.appendEntry(SESSION_MODE_ENTRY, { sessionId: ctx.sessionManager.getSessionId(), mode: next });
				else writeEnabled(OPENAI_TOGGLE.statePath, next === "ultrafast", next === "ultrafast" ? "ultrafast" : undefined);
				startup.error = undefined;
			}
			updateFooterStatus(ctx);
			notify(ctx, openAIStatus(ctx));
		},
	});
}
