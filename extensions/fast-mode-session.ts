import type {
	ExtensionAPI,
	ExtensionContext,
	MessageEndEvent,
	ProviderStreamEvent,
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
type TierRequest = { provider: string; model: string; tier: OpenAITier };
type PauseAction = { action: "clear" } | ({ action: "pause" } & TierRequest);
const PAUSE_ENTRY = "openai-tier-pause";

const tierKey = ({ provider, model, tier }: TierRequest): string =>
	JSON.stringify([provider, model, tier]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isCompactionTrigger = (payload: object): boolean => {
	if (!("input" in payload) || !Array.isArray(payload.input)) {
		return false;
	}
	const last: unknown = payload.input.at(-1);
	return isRecord(last) && last.type === "compaction_trigger";
};

function readPauseAction(data: unknown, sessionId: string): PauseAction | undefined {
	// Forks can copy the entries but have a different native session ID.
	if (!isRecord(data) || data.sessionId !== sessionId) {
		return undefined;
	}
	const { action, provider, model, tier } = data;
	if (action === "clear") {
		return { action };
	}
	if (
		action === "pause" &&
		typeof provider === "string" &&
		typeof model === "string" &&
		(tier === "priority" || tier === "ultrafast")
	) {
		return { action, provider, model, tier };
	}
	return undefined;
}

function restoreRejectedTiers(ctx: ExtensionContext): Set<string> {
	const rejected = new Set<string>();
	const sessionId = ctx.sessionManager.getSessionId();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== PAUSE_ENTRY) {
			continue;
		}
		const data = readPauseAction(entry.data, sessionId);
		if (data?.action === "clear") {
			rejected.clear();
		} else if (data?.action === "pause") {
			rejected.add(tierKey(data));
		}
	}
	return rejected;
}

// Official Pi's Codex transport can flatten the error into just the workspace message.
const TIER_NOT_ALLOWED =
	/\bservice_tier_not_allowed\b|\b(?:Ultrafast|Fast) mode isn't available for the selected model in your workspace\b/;

function fallbackRejectedTier(value: unknown, tier: OpenAITier): boolean {
	if (!isRecord(value) || value.type !== "service_tier_fallback") {
		return false;
	}
	const { error, details } = value;
	if (!isRecord(error) || error.code !== "service_tier_not_allowed") {
		return false;
	}
	const rejected = isRecord(details) ? details.rejectedTier : undefined;
	return rejected === undefined || rejected === tier;
}

function tierWasRejected(
	message: Extract<MessageEndEvent["message"], { role: "assistant" }>,
	tier: OpenAITier,
): boolean {
	if (message.stopReason === "error" && TIER_NOT_ALLOWED.test(message.errorMessage ?? "")) {
		return true;
	}
	return (
		"diagnostics" in message &&
		Array.isArray(message.diagnostics) &&
		message.diagnostics.some((diagnostic) => fallbackRejectedTier(diagnostic, tier))
	);
}

/** OpenAI policy and request observations for the active session. */
export class FastModeSession {
	private readonly appendEntry: ExtensionAPI["appendEntry"];
	private sessionId: string | undefined;
	private localMode: SessionOpenAIMode | undefined;
	private footerContext: ExtensionContext | undefined;
	private lastReply: { model: NonNullable<ExtensionContext["model"]>; status: string } | undefined;
	private pending: TierRequest | undefined;
	private rejected = new Set<string>();

	constructor(appendEntry: ExtensionAPI["appendEntry"]) {
		this.appendEntry = appendEntry;
	}

	adoptSession(ctx: ExtensionContext): void {
		this.sessionId = ctx.sessionManager.getSessionId();
		this.localMode = restoreSessionOpenAIMode(ctx);
		this.lastReply = undefined;
		this.adoptBranch(ctx);
	}

	adoptBranch(ctx: ExtensionContext): void {
		this.rejected = restoreRejectedTiers(ctx);
		this.pending = undefined;
	}

	release(): void {
		this.footerContext = undefined;
	}

	policy(ctx: ExtensionContext): OpenAIRequestPolicy {
		if (this.sessionId !== ctx.sessionManager.getSessionId()) {
			this.adoptSession(ctx);
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
			this.rejected.has(tierKey({ provider: model.provider, model: model.id, tier: mode }));
		return { shared, local, delegated, mode, rejected };
	}

	applyTier(payload: object, ctx: ExtensionContext): Record<string, unknown> | undefined {
		// Background provider-summary compaction requests never emit message_end
		// and should stay on standard billing without disturbing pending tracking.
		if (isCompactionTrigger(payload)) {
			return undefined;
		}
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
			!tierWasRejected(message, sent.tier)
		) {
			return;
		}
		this.recordPauseAction(ctx, { action: "pause", ...sent });
		this.rejected.add(tierKey(sent));
		if (ctx.hasUI) {
			this.updateFooter(ctx);
			ctx.ui.notify(
				`OpenAI rejected ${sent.tier} for ${sent.model}. Later requests on this branch will omit that tier unless you reselect a mode.`,
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

	private recordPauseAction(ctx: ExtensionContext, action: PauseAction): void {
		this.appendEntry(PAUSE_ENTRY, { sessionId: ctx.sessionManager.getSessionId(), ...action });
	}

	clearRejections(ctx: ExtensionContext): void {
		this.recordPauseAction(ctx, { action: "clear" });
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
