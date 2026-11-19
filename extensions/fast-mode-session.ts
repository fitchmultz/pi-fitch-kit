import type {
	ExtensionContext,
	MessageEndEvent,
	ProviderStreamEvent,
	SessionShutdownEvent,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import {
	openAIMode,
	restoreSessionOpenAIMode,
	ultrafastEligible,
	ultrafastRequest,
	updateFooterStatus,
	type OpenAIMode,
	type OpenAIRequestPolicy,
	type SessionOpenAIMode,
} from "./fast-mode-policy.ts";

const RELOAD_REJECTIONS = Symbol.for("pi-fitch-kit.openai-reload-rejections");
const globals: typeof globalThis & {
	[RELOAD_REJECTIONS]?: WeakMap<ExtensionContext["sessionManager"], Set<string>>;
} = globalThis;
const reloadRejections = globals[RELOAD_REJECTIONS] ?? new WeakMap();
globals[RELOAD_REJECTIONS] = reloadRejections;

const TERMINAL_RESPONSES = new Set<unknown>([
	"response.completed",
	"response.done",
	"response.incomplete",
]);
const RETURNED_TIER_STATUS = new Map<unknown, string>([
	["ultrafast", "OpenAI confirmed Ultrafast"],
	["default", "OpenAI reported Standard"],
]);
const UNCONFIRMED_ULTRAFAST = "OpenAI did not confirm Ultrafast";

function returnedTierStatus(data: unknown): string | undefined {
	if (
		data === null ||
		typeof data !== "object" ||
		!("type" in data) ||
		!TERMINAL_RESPONSES.has(data.type)
	) {
		return undefined;
	}
	const response = "response" in data ? data.response : undefined;
	if (response === null || typeof response !== "object" || !("service_tier" in response)) {
		return UNCONFIRMED_ULTRAFAST;
	}
	return RETURNED_TIER_STATUS.get(response.service_tier) ?? UNCONFIRMED_ULTRAFAST;
}

type OpenAITier = Exclude<OpenAIMode, "off">;
const tierKey = (provider: string, model: string, tier: OpenAITier): string =>
	JSON.stringify([provider, model, tier]);

// Official Pi's Codex transport can flatten the error into just the workspace message.
const TIER_NOT_ALLOWED =
	/\bservice_tier_not_allowed\b|\b(?:Ultrafast|Fast) mode isn't available for the selected model in your workspace\b/;

/** OpenAI policy and request observations for the active session. */
export class FastModeSession {
	private sessionId: string | undefined;
	private localMode: SessionOpenAIMode | undefined;
	private footerContext: ExtensionContext | undefined;
	private lastReply: { model: NonNullable<ExtensionContext["model"]>; status: string } | undefined;
	private pending: { provider: string; model: string; tier: OpenAITier } | undefined;
	private rejected = new Set<string>();

	private bind(ctx: ExtensionContext): void {
		this.sessionId = ctx.sessionManager.getSessionId();
		this.localMode = restoreSessionOpenAIMode(ctx);
		this.lastReply = undefined;
		this.rejected = new Set();
		this.pending = undefined;
	}

	adoptSession(ctx: ExtensionContext, { reason }: SessionStartEvent): void {
		this.bind(ctx);
		// Pi recreates extension factories on reload but retains this session manager.
		const prior = reloadRejections.get(ctx.sessionManager);
		reloadRejections.delete(ctx.sessionManager);
		if (reason === "reload" && prior !== undefined) {
			this.rejected = prior;
		}
	}

	release(ctx: ExtensionContext, { reason }: SessionShutdownEvent): void {
		if (reason === "reload" && this.rejected.size > 0) {
			reloadRejections.set(ctx.sessionManager, this.rejected);
		}
		this.footerContext = undefined;
	}

	policy(ctx: ExtensionContext): OpenAIRequestPolicy {
		if (this.sessionId !== ctx.sessionManager.getSessionId()) {
			this.bind(ctx);
		}
		const shared = openAIMode();
		const local = this.localMode;
		// pi-subagents sets this on spawned child actors, which bind in print mode.
		const delegated = !ctx.hasUI && Boolean(process.env.PI_INTERCOM_PARENT_SESSION_ID);
		const mode = local ?? (delegated ? "off" : shared);
		const model = ctx.model;
		const rejected =
			mode !== "off" &&
			model !== undefined &&
			this.rejected.has(tierKey(model.provider, model.id, mode));
		return { shared, local, delegated, mode, rejected };
	}

	applyTier(payload: object, ctx: ExtensionContext): Record<string, unknown> | undefined {
		const { mode, rejected } = this.policy(ctx);
		this.pending = undefined;
		const model = ctx.model;
		if (model === undefined || mode === "off" || rejected) {
			return undefined;
		}
		const payloadModel = "model" in payload ? payload.model : undefined;
		if (mode === "ultrafast" && !ultrafastRequest(model, payloadModel)) {
			return undefined;
		}
		this.pending = { provider: model.provider, model: model.id, tier: mode };
		return { ...payload, service_tier: mode };
	}

	observeMessage({ message }: MessageEndEvent, ctx: ExtensionContext): void {
		if (message.role !== "assistant") {
			return;
		}
		const sent = this.pending;
		this.pending = undefined;
		if (
			sent === undefined ||
			this.sessionId !== ctx.sessionManager.getSessionId() ||
			message.provider !== sent.provider ||
			message.model !== sent.model ||
			message.stopReason !== "error" ||
			!TIER_NOT_ALLOWED.test(message.errorMessage ?? "")
		) {
			return;
		}
		this.rejected.add(tierKey(sent.provider, sent.model, sent.tier));
		if (ctx.hasUI) {
			this.updateFooter(ctx);
			ctx.ui.notify(
				`OpenAI rejected ${sent.tier} for ${sent.model}. Pi won't request that tier again for this model in this session unless you change the mode.`,
				"warning",
			);
		}
	}

	observeReply(
		{ data, provider, api, model: id }: ProviderStreamEvent,
		ctx: ExtensionContext,
	): void {
		const status = returnedTierStatus(data);
		if (status === undefined) {
			return;
		}
		const model = ctx.model;
		if (
			model?.id !== id ||
			model.provider !== provider ||
			model.api !== api ||
			!ultrafastEligible(model)
		) {
			return;
		}
		const { mode, rejected } = this.policy(ctx);
		if (mode === "ultrafast" && !rejected) {
			this.lastReply = { model, status };
		}
	}

	replyStatus(ctx: ExtensionContext, { mode, rejected }: OpenAIRequestPolicy): string {
		const model = ctx.model;
		if (mode !== "ultrafast" || rejected || model === undefined || !ultrafastEligible(model)) {
			return "";
		}
		const reply = this.lastReply;
		if (
			reply?.model.id === model.id &&
			reply.model.provider === model.provider &&
			reply.model.api === model.api &&
			reply.model.baseUrl === model.baseUrl
		) {
			return ` Last reply: ${reply.status}.`;
		}
		return " No reply observed for this model with Ultrafast enabled in this Pi run.";
	}

	setLocalMode(mode: SessionOpenAIMode | undefined): void {
		this.localMode = mode;
	}

	clearRejections(): void {
		this.rejected.clear();
		this.pending = undefined;
	}

	updateFooter(ctx: ExtensionContext, policy = this.policy(ctx)): void {
		this.footerContext = ctx;
		updateFooterStatus(ctx, policy);
	}

	refreshFooter(): void {
		const ctx = this.footerContext;
		if (ctx !== undefined) {
			updateFooterStatus(ctx, this.policy(ctx));
		}
	}
}
