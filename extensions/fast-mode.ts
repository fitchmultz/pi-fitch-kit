import { mkdirSync, readFileSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// Anthropic's fast-mode research preview bills double and rejects the `speed`
// field without its beta header, so payload and header travel together.
const ANTHROPIC_FAST_BETA = "fast-mode-2026-02-01";
const ANTHROPIC_FAST_MODEL_PREFIXES = ["claude-opus-5", "claude-opus-4-8"];
// service_tier is an OpenAI platform feature; gate by provider so other
// OpenAI-compatible endpoints (xai, proxies) never receive it.
const OPENAI_PROVIDERS = new Set(["openai", "openai-codex"]);

type FastModel = { id?: string; provider?: string; api?: string } | undefined;

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
	/** Payload addition applied while the toggle is on. */
	fastPayload: (payload: Record<string, unknown>) => Record<string, unknown>;
};

// Eligibility is by wire API, not provider, so Claude Opus through a gateway
// such as cloudflare-ai-gateway gets the same toggle as the direct route.
const anthropicEligible = (model: FastModel): boolean =>
	model?.api === "anthropic-messages" &&
	ANTHROPIC_FAST_MODEL_PREFIXES.some((prefix) => model.id?.startsWith(prefix) === true);

const ANTHROPIC_TOGGLE: Toggle = {
	name: "anthropic-fast",
	label: "Anthropic",
	description: "Toggle Anthropic Opus fast mode (2x token price)",
	statePath: join(getAgentDir(), "anthropic-fast.json"),
	eligible: anthropicEligible,
	fastPayload: (payload) => ({ ...payload, speed: "fast" }),
};

const OPENAI_TOGGLE: Toggle = {
	name: "codex-fast",
	label: "OpenAI",
	description: "Toggle OpenAI priority/fast mode",
	statePath: join(getAgentDir(), "openai-codex-fast.json"),
	eligible: (model) => model?.provider !== undefined && OPENAI_PROVIDERS.has(model.provider),
	fastPayload: (payload) => ({ ...payload, service_tier: "priority" }),
};

const TOGGLES = [ANTHROPIC_TOGGLE, OPENAI_TOGGLE];

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

// Mirrors the per-request gates, so the footer never claims fast mode on a
// model that ignores it. At most one toggle is eligible for a given model.
function updateFooterStatus(ctx: ExtensionContext): void {
	for (const toggle of TOGGLES) {
		try {
			if (!toggle.eligible(ctx.model)) {
				ctx.ui.setStatus(toggle.name, undefined);
				continue;
			}
			const fast = enabled(toggle.statePath);
			const label = `fast:${fast ? "on" : "off"}`;
			ctx.ui.setStatus(
				toggle.name,
				ctx.hasUI ? ctx.ui.theme.fg(fast ? "accent" : "muted", label) : label,
			);
		} catch {
			// Headless hosts do not expose a footer.
		}
	}
}

export default function fastMode(pi: ExtensionAPI): void {
	// ponytail: the header and payload hooks read toggle state independently; a
	// toggle racing between them can skew one request, which self-heals on the next.
	pi.on("before_provider_request", (event, ctx) => {
		const toggle = TOGGLES.find((candidate) => candidate.eligible(ctx.model));
		if (!toggle || !enabled(toggle.statePath)) return;
		const payload = event.payload;
		if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return;
		return toggle.fastPayload(payload as Record<string, unknown>);
	});

	pi.on("before_provider_headers", (event, ctx) => {
		if (!ANTHROPIC_TOGGLE.eligible(ctx.model) || !enabled(ANTHROPIC_TOGGLE.statePath)) return;
		// This hook fires after Pi assembles every header, including its own
		// anthropic-beta markers, so appending here preserves them. A null value
		// is Pi's header-deletion marker; treat it as absent.
		const existing = event.headers["anthropic-beta"];
		const betas =
			typeof existing === "string"
				? existing
						.split(",")
						.map((beta) => beta.trim())
						.filter(Boolean)
				: [];
		if (!betas.includes(ANTHROPIC_FAST_BETA)) {
			event.headers["anthropic-beta"] = [...betas, ANTHROPIC_FAST_BETA].join(",");
		}
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
