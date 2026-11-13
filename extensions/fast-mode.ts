import { unwatchFile, watchFile } from "node:fs";
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
	enabled,
	fastStream,
	notify,
	openAIMode,
	openAIStatus,
	restoreSessionOpenAIMode,
	ultrafastEligible,
	updateFooterStatus,
	writeEnabled,
	type OpenAIMode,
	type SessionOpenAIMode,
	type Toggle,
} from "./fast-mode-policy.ts";
import { registerGoogleTier } from "./google-tier.ts";

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

/** Session-scoped OpenAI tier override and footer wiring for one factory. */
class FastModeSession {
	private sessionId: string | undefined;
	private localMode: SessionOpenAIMode | undefined;
	private footerContext: ExtensionContext | undefined;
	private boundRefresh: (() => void) | undefined;

	localModeFor(ctx: ExtensionContext): SessionOpenAIMode | undefined {
		const id = ctx.sessionManager.getSessionId();
		if (this.sessionId !== id) {
			this.sessionId = id;
			this.localMode = restoreSessionOpenAIMode(ctx);
		}
		return this.localMode;
	}

	effectiveMode(ctx: ExtensionContext): OpenAIMode {
		return this.localModeFor(ctx) ?? openAIMode();
	}

	adoptSession(ctx: ExtensionContext): void {
		this.sessionId = ctx.sessionManager.getSessionId();
		this.localMode = restoreSessionOpenAIMode(ctx);
		this.footerContext = ctx;
	}

	setLocalMode(mode: SessionOpenAIMode | undefined): void {
		this.localMode = mode;
	}

	/** One stable watcher callback for watchFile/unwatchFile listener identity. */
	refreshCallback(): () => void {
		this.boundRefresh ??= () => this.refreshFooter();
		return this.boundRefresh;
	}

	/** Redraws the footer from the most recent TUI context, when there was one. */
	refreshFooter(): void {
		const ctx = this.footerContext;
		if (ctx !== undefined) {
			updateFooterStatus(ctx, this.localModeFor(ctx));
		}
	}

	release(): void {
		this.footerContext = undefined;
	}
}

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
		return "--ultrafast requires gpt-6-astra on a native OpenAI Responses route. Select a supported model and /codex-fast ultrafast, or /codex-fast off to continue.";
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
	session.adoptSession(ctx);
	if (event.reason === "startup") {
		applyStartupFlags(pi, ctx);
	}
	const local = session.localModeFor(ctx);
	if (readStartupError() === undefined && (openAIMode() === "ultrafast" || local === "ultrafast")) {
		notify(ctx, openAIStatus(ctx, local));
	}
	updateFooterStatus(ctx, local);
	const refreshFooter = session.refreshCallback();
	for (const toggle of TOGGLES) {
		// Unwatch first: a repeated session_start must not stack listeners, or a
		// single shutdown would leave one behind holding the process open.
		unwatchFile(toggle.statePath, refreshFooter);
		if (ctx.hasUI) {
			watchFile(toggle.statePath, { interval: 5000 }, refreshFooter);
		}
	}
};

/** Resolves the service_tier a priority-eligible request should carry, if any. */
const priorityTier = (
	toggle: Toggle,
	ctx: ExtensionContext,
	session: FastModeSession,
): "priority" | "ultrafast" | "off" => {
	if (toggle !== OPENAI_TOGGLE) {
		return enabled(toggle.statePath) ? "priority" : "off";
	}
	return session.effectiveMode(ctx);
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
	const tier = priorityTier(toggle, ctx, session);
	if (tier === "off") {
		return undefined;
	}
	const payload = event.payload;
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
		return undefined;
	}
	if (tier === "ultrafast") {
		const model = "model" in payload ? payload.model : undefined;
		if (!ultrafastEligible(ctx.model) || model !== "gpt-6-astra") {
			return undefined;
		}
	}
	return { ...payload, service_tier: tier };
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

const applyTierState = (command: string, request: ToggleRequest): void => {
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
	updateFooterStatus(ctx, session.localModeFor(ctx));
	const openai = view.request.toggle === OPENAI_TOGGLE;
	const mode = openai ? openAIMode() : undefined;
	const local = session.localModeFor(ctx);
	if (
		openai &&
		(mode === "ultrafast" || local !== undefined || command === "status" || command === "")
	) {
		notify(ctx, openAIStatus(ctx, local));
		return;
	}
	const policy = openai ? togglePolicy(view.previousMode, mode) : "fast mode";
	const on = openai ? mode !== "off" : enabled(view.request.toggle.statePath);
	notify(ctx, `${view.request.toggle.label} ${policy} ${on ? "ON" : "OFF"}`, "info");
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
	applyTierState(parsed.command, request);
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
		const current = local ? session.effectiveMode(ctx) : openAIMode();
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
	}
	updateFooterStatus(ctx, session.localModeFor(ctx));
	notify(ctx, openAIStatus(ctx, session.localModeFor(ctx)));
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
			"Start with Astra ultrafast requests (6x API/credit price; cannot combine with --fast)",
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

	// The state files are shared by every session, so watch them rather than
	// only redrawing after local toggles.
	pi.on("session_start", (event, ctx) => handleSessionStart(pi, session, event, ctx));
	pi.on("session_shutdown", () => {
		const refreshFooter = session.refreshCallback();
		for (const toggle of TOGGLES) {
			unwatchFile(toggle.statePath, refreshFooter);
		}
		session.release();
	});
	pi.on("model_select", (_event, ctx) => {
		updateFooterStatus(ctx, session.localModeFor(ctx));
	});

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
			"Toggle Astra Ultrafast globally, or use --session for a session-only override (6x API/credit price)",
		handler: (args, ctx) => runUltrafastCommand(args, ctx, session, pi),
	});
	registerGoogleTier(pi);
}
