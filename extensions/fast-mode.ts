import type {
	BeforeProviderRequestEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import {
	ANTHROPIC_FAST_PROVIDERS,
	OPENAI_TOGGLE,
	PRIORITY_TOGGLES,
	SESSION_MODE_ENTRY,
	TOGGLES,
	ULTRAFAST_UNAVAILABLE,
	createStateWatcher,
	enabled,
	fastStream,
	notify,
	openAIMode,
	openAIStatus,
	ultrafastEligible,
	writeEnabled,
	type OpenAIMode,
	type Toggle,
} from "./fast-mode-policy.ts";
import { FastModeSession } from "./fast-mode-session.ts";
import { GOOGLE_TIER_STATE_PATH, registerGoogleTier } from "./google-tier.ts";

export { fastRates } from "./fast-mode-policy.ts";

const STARTUP_STATE = Symbol.for("pi-fitch-kit.openai-startup");

/**
 * Process-wide startup validation state. Session replacement and reload
 * recreate factories, so this lives on globalThis, not the module.
 */
const startupGlobals: Record<symbol, unknown> = globalThis;

const readStartupError = (): string | undefined => {
	const value: unknown = startupGlobals[STARTUP_STATE];
	if (typeof value !== "object" || value === null || !("error" in value)) {
		return undefined;
	}
	return typeof value.error === "string" ? value.error : undefined;
};

const setStartupError = (message: string): void => {
	startupGlobals[STARTUP_STATE] = { error: message };
};

const clearStartupError = (): void => {
	startupGlobals[STARTUP_STATE] = {};
};

/** The startup validation error implied by the --fast/--ultrafast flags, if any. */
const startupFlagError = (
	ctx: ExtensionContext,
	fast: boolean,
	ultrafast: boolean,
): string | undefined => {
	if (fast && ultrafast) {
		return "Use either --fast or --ultrafast, not both. Select /codex-fast on, off, or ultrafast to continue.";
	}
	if (ultrafast && !ultrafastEligible(ctx.model)) {
		return `${ULTRAFAST_UNAVAILABLE} Select a supported model and run /ultrafast on, or run /ultrafast off to continue.`;
	}
	return undefined;
};

/** Applies --fast/--ultrafast startup flags once, on the cold startup event. */
const applyStartupFlags = (pi: ExtensionAPI, ctx: ExtensionContext): void => {
	const fast = pi.getFlag("fast") === true;
	const ultrafast = pi.getFlag("ultrafast") === true;
	const error = startupFlagError(ctx, fast, ultrafast);
	if (error === undefined) {
		clearStartupError();
	} else {
		setStartupError(error);
	}
	if (error !== undefined) {
		notify(ctx, error, "error");
		if (!ctx.hasUI) {
			process.exitCode = 1;
			ctx.shutdown();
		}
		return;
	}
	if (fast || ultrafast) {
		const tier = ultrafast ? "ultrafast" : undefined;
		writeEnabled(OPENAI_TOGGLE.statePath, true, tier);
	}
};

/** Startup gate: resolve flags, surface validation, and notify ultrafast status. */
const handleSessionStart = (
	pi: ExtensionAPI,
	session: FastModeSession,
	event: SessionStartEvent,
	ctx: ExtensionContext,
): void => {
	session.adoptSession(ctx, event);
	if (event.reason === "startup") {
		applyStartupFlags(pi, ctx);
	}
	const policy = session.policy(ctx);
	if (
		readStartupError() === undefined &&
		(policy.local === "ultrafast" || (policy.shared === "ultrafast" && !policy.delegated))
	) {
		notify(ctx, openAIStatus(ctx, policy));
	}
	session.updateFooter(ctx, policy);
};

/** Applies service_tier to a priority-eligible provider request payload. */
const applyPriorityTier = (
	event: BeforeProviderRequestEvent,
	ctx: ExtensionContext,
	session: FastModeSession,
): Record<string, unknown> | undefined => {
	const toggle = PRIORITY_TOGGLES.find((candidate) => candidate.eligible(ctx.model));
	if (toggle === undefined) {
		return undefined;
	}
	const payload = event.payload;
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
		return undefined;
	}
	if (toggle === OPENAI_TOGGLE) {
		return session.applyTier(payload, ctx);
	}
	return enabled(toggle.statePath) ? { ...payload, service_tier: "priority" } : undefined;
};

/** One registered toggle command, with its parsed request shape. */
type ToggleRequest = {
	name: string;
	toggle: Toggle;
	/** An empty argument means "toggle" for the legacy alias form. */
	emptyMeansToggle: boolean;
};

const TOGGLE_COMMANDS = new Set(["", "status", "on", "off", "toggle"]);
const TOGGLE_VERBS = new Set(["on", "off", "toggle", "ultrafast"]);

const parseToggleCommand = (
	args: string,
	request: ToggleRequest,
): { command: string } | { usage: string } => {
	const input = args.trim().toLowerCase();
	const command = request.emptyMeansToggle && input === "" ? "toggle" : input;
	const openai = request.toggle === OPENAI_TOGGLE;
	const known = TOGGLE_COMMANDS.has(command) || (openai && command === "ultrafast");
	if (!known) {
		return { usage: `Usage: /${request.name} [on|off|toggle|status${openai ? "|ultrafast" : ""}]` };
	}
	return { command };
};

const applyTierState = (
	command: string,
	request: ToggleRequest,
	session: FastModeSession,
): void => {
	if (!TOGGLE_VERBS.has(command)) {
		return;
	}
	const openai = request.toggle === OPENAI_TOGGLE;
	const on = openai ? openAIMode() !== "off" : enabled(request.toggle.statePath);
	const next = command === "toggle" ? !on : command !== "off";
	if (command === "ultrafast") {
		writeEnabled(request.toggle.statePath, next, "ultrafast");
	} else {
		writeEnabled(request.toggle.statePath, next);
	}
	if (openai) {
		clearStartupError();
		session.clearRejections();
	}
};

const togglePolicy = (previousMode: OpenAIMode | undefined, mode: OpenAIMode | undefined): string =>
	previousMode === "ultrafast" && mode === "off" ? "ultrafast requests" : "priority requests";

const reportToggleResult = (
	command: string,
	ctx: ExtensionContext,
	session: FastModeSession,
	view: { request: ToggleRequest; previousMode: OpenAIMode | undefined },
): void => {
	const policy = session.policy(ctx);
	session.updateFooter(ctx, policy);
	const openai = view.request.toggle === OPENAI_TOGGLE;
	const mode = openai ? policy.shared : undefined;
	if (
		openai &&
		(mode === "ultrafast" || policy.local !== undefined || command === "status" || command === "")
	) {
		notify(ctx, openAIStatus(ctx, policy));
		return;
	}
	const label = openai ? togglePolicy(view.previousMode, mode) : "fast mode";
	const on = openai ? mode !== "off" : enabled(view.request.toggle.statePath);
	notify(ctx, `${view.request.toggle.label} ${label} ${on ? "ON" : "OFF"}`, "info");
};

const runToggleCommand = async (
	args: string,
	ctx: ExtensionContext,
	session: FastModeSession,
	request: ToggleRequest,
): Promise<void> => {
	const parsed = parseToggleCommand(args, request);
	if ("usage" in parsed) {
		notify(ctx, parsed.usage, "warning");
		return;
	}
	const previousMode = request.toggle === OPENAI_TOGGLE ? openAIMode() : undefined;
	if (parsed.command === "ultrafast" && !ultrafastEligible(ctx.model)) {
		notify(ctx, ULTRAFAST_UNAVAILABLE, "warning");
		return;
	}
	applyTierState(parsed.command, request, session);
	reportToggleResult(parsed.command, ctx, session, { request, previousMode });
};

const ULTRAFAST_VERBS = new Set(["on", "off", "toggle", "status", "reset"]);

const parseUltrafastArgs = (
	args: string,
): { local: boolean; command: string } | { usage: string } => {
	const tokens = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const local = tokens.includes("--session");
	const verbs = tokens.filter((token) => token !== "--session");
	const command = verbs[0] ?? "toggle";
	const sessionFlags = tokens.filter((token) => token === "--session").length;
	if (
		verbs.length > 1 ||
		!ULTRAFAST_VERBS.has(command) ||
		(command === "reset" && !local) ||
		sessionFlags > 1
	) {
		return {
			usage: "Usage: /ultrafast [on|off|toggle|status] [--session], or /ultrafast reset --session",
		};
	}
	return { local, command };
};

const nextUltrafastTier = (command: string, current: OpenAIMode): "ultrafast" | "off" | null => {
	if (command === "reset") {
		return null;
	}
	if (command === "off") {
		return "off";
	}
	if (command === "toggle" && current === "ultrafast") {
		return "off";
	}
	return "ultrafast";
};

const runUltrafastCommand = async (
	args: string,
	ctx: ExtensionContext,
	session: FastModeSession,
	pi: ExtensionAPI,
): Promise<void> => {
	const parsed = parseUltrafastArgs(args);
	if ("usage" in parsed) {
		notify(ctx, parsed.usage, "warning");
		return;
	}
	const { local, command } = parsed;
	if (command !== "status") {
		const policy = session.policy(ctx);
		const current = local ? policy.mode : policy.shared;
		const next = nextUltrafastTier(command, current);
		if (next === "ultrafast" && !ultrafastEligible(ctx.model)) {
			notify(ctx, ULTRAFAST_UNAVAILABLE, "warning");
			return;
		}
		if (local) {
			pi.appendEntry(SESSION_MODE_ENTRY, {
				sessionId: ctx.sessionManager.getSessionId(),
				mode: next,
			});
			session.setLocalMode(next === null ? undefined : next);
		} else if (next === "ultrafast") {
			writeEnabled(OPENAI_TOGGLE.statePath, true, "ultrafast");
		} else {
			writeEnabled(OPENAI_TOGGLE.statePath, false);
		}
		clearStartupError();
		session.clearRejections();
	}
	const policy = session.policy(ctx);
	session.updateFooter(ctx, policy);
	const reply = command === "status" ? session.replyStatus(ctx, policy) : "";
	notify(ctx, openAIStatus(ctx, policy, reply));
};

export default function fastMode(pi: ExtensionAPI): void {
	const session = new FastModeSession();

	pi.registerFlag("fast", {
		description: "Start with OpenAI priority/fast mode enabled",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("ultrafast", {
		description:
			"Start with Ultrafast requests on supported OpenAI or ChatGPT rotation models (up to 6x API/credit price; cannot combine with --fast)",
		type: "boolean",
		default: false,
	});
	pi.on("input", (event, ctx) => {
		const error = readStartupError();
		if (error === undefined || event.source === "extension") {
			return;
		}
		notify(ctx, error, "error");
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
	pi.on("before_provider_request", (event, ctx) => applyPriorityTier(event, ctx, session));
	pi.on("provider_stream_event", (event, ctx) => session.observeReply(event, ctx));
	pi.on("message_end", (event, ctx) => session.observeMessage(event, ctx));

	const refreshListeners: Array<() => void> = [() => session.refreshFooter()];
	const stateWatcher = createStateWatcher(
		[...TOGGLES.map((toggle) => toggle.statePath), GOOGLE_TIER_STATE_PATH],
		() => {
			for (const refresh of refreshListeners) {
				refresh();
			}
		},
	);

	// The state files are shared by every session, so watch them rather than
	// only redrawing after local toggles.
	pi.on("session_start", (event, ctx) => {
		handleSessionStart(pi, session, event, ctx);
		stateWatcher.start(ctx.hasUI);
	});
	pi.on("session_shutdown", (event, ctx) => {
		stateWatcher.stop();
		session.release(ctx, event);
	});
	pi.on("model_select", (_event, ctx) => session.updateFooter(ctx));

	const registerToggleCommand = (name: string, toggle: Toggle, emptyMeansToggle = false): void => {
		pi.registerCommand(name, {
			description: name === toggle.name ? toggle.description : `Alias for /${toggle.name}`,
			handler: (args, ctx) =>
				runToggleCommand(args, ctx, session, { name, toggle, emptyMeansToggle }),
		});
	};
	for (const toggle of TOGGLES) {
		registerToggleCommand(toggle.name, toggle);
	}
	registerToggleCommand("fast", OPENAI_TOGGLE, true);
	pi.registerCommand("ultrafast", {
		description:
			"Toggle OpenAI Ultrafast globally, or use --session for a session-only override (up to 6x API/credit price)",
		handler: (args, ctx) => runUltrafastCommand(args, ctx, session, pi),
	});
	refreshListeners.push(registerGoogleTier(pi));
}
