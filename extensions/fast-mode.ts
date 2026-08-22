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

type FastModel = { id?: string; provider?: string } | undefined;
type FastRates = { input: number; output: number; cacheRead: number; cacheWrite: number };

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
	description: "Toggle OpenAI priority/fast mode",
	statePath: join(getAgentDir(), "openai-codex-fast.json"),
	eligible: (model) =>
		model?.provider !== undefined &&
		(OPENAI_PROVIDERS.has(model.provider) ||
			(model.provider === "cloudflare-ai-gateway" && model.id?.startsWith("gpt-") === true)),
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

function enabled(statePath: string): boolean {
	try {
		return JSON.parse(readFileSync(statePath, "utf8")).enabled === true;
	} catch {
		return false;
	}
}

function writeEnabled(statePath: string, value: boolean): void {
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(statePath, `${JSON.stringify({ enabled: value })}\n`);
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
	const streamOptions = fast ? fastOptions(options) : options;
	return FULL_STREAM_KEYS.some((key) => options !== undefined && key in options)
		? messagesApi.stream(target, context, streamOptions)
		: messagesApi.streamSimple(target, context, streamOptions);
}

// Mirrors the per-request gates, so the footer never claims fast mode on a
// model that ignores it. At most one toggle is eligible for a given model.
function updateFooterStatus(ctx: ExtensionContext): void {
	for (const toggle of TOGGLES) {
		try {
			if (!toggle.eligible(ctx.model) || !enabled(toggle.statePath)) {
				ctx.ui.setStatus(toggle.name, undefined);
				continue;
			}
			ctx.ui.setStatus(toggle.name, ctx.hasUI ? ctx.ui.theme.fg("accent", "fast") : "fast");
		} catch {
			// Headless hosts do not expose a footer.
		}
	}
}

export default function fastMode(pi: ExtensionAPI): void {
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
		if (!toggle || !enabled(toggle.statePath)) return;
		const payload = event.payload;
		if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return;
		return { ...(payload as Record<string, unknown>), service_tier: "priority" };
	});

	// The state files are shared by every session, so watch them rather than
	// only redrawing after local toggles.
	let footerContext: ExtensionContext | undefined;
	const refreshFooter = () => {
		if (footerContext) updateFooterStatus(footerContext);
	};
	pi.on("session_start", (_event, ctx) => {
		footerContext = ctx;
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

	for (const toggle of TOGGLES) {
		pi.registerCommand(toggle.name, {
			description: toggle.description,
			handler: async (args, ctx) => {
				const command = args.trim().toLowerCase();
				if (!["", "status", "on", "off", "toggle"].includes(command)) {
					ctx.ui.notify(`Usage: /${toggle.name} [on|off|toggle|status]`, "warning");
					return;
				}
				if (command === "on" || command === "off" || command === "toggle") {
					const next = command === "toggle" ? !enabled(toggle.statePath) : command === "on";
					writeEnabled(toggle.statePath, next);
				}
				updateFooterStatus(ctx);
				ctx.ui.notify(
					`${toggle.label} fast mode ${enabled(toggle.statePath) ? "ON" : "OFF"}`,
					"info",
				);
			},
		});
	}
}
