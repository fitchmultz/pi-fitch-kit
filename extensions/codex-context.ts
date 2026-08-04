import {
	existsSync,
	mkdirSync,
	readFileSync,
	unwatchFile,
	watchFile,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	type Api,
	type Context,
	type Model,
	type SimpleStreamOptions,
	streamSimple,
} from "@earendil-works/pi-ai/compat";
import {
	compact,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";

const FAST_STATE_PATH = join(getAgentDir(), "openai-codex-fast.json");
const COMPACTION_CONFIG_PATH = join(getAgentDir(), "pi-codex-context.json");
type CompactionModel = {
	provider: string;
	model: string;
	thinkingLevel:
		| "off"
		| "minimal"
		| "low"
		| "medium"
		| "high"
		| "xhigh"
		| "max";
};

const DEFAULT_COMPACTION_MODELS: CompactionModel[] = [
	{ provider: "xai", model: "grok-4.5", thinkingLevel: "high" },
	{
		provider: "openai-codex",
		model: "gpt-5.6-luna",
		thinkingLevel: "high",
	},
];
const THINKING_LEVELS = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const);

function readCompactionConfig(): {
	customCompactionEnabled?: unknown;
	compactionModels?: unknown;
} | undefined {
	try {
		const parsed = JSON.parse(readFileSync(COMPACTION_CONFIG_PATH, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

function compactionModels(): CompactionModel[] | undefined {
	const config = readCompactionConfig();
	if (config?.customCompactionEnabled !== true) return undefined;
	const models = config.compactionModels;
	if (models === undefined) return DEFAULT_COMPACTION_MODELS;
	if (
		!Array.isArray(models) ||
		models.length === 0 ||
		models.some(
			(model) =>
				typeof model?.provider !== "string" ||
				model.provider.length === 0 ||
				typeof model?.model !== "string" ||
				model.model.length === 0 ||
				!THINKING_LEVELS.has(model?.thinkingLevel),
		)
	) {
		return undefined;
	}
	return models;
}

function fastEnabled(): boolean {
	try {
		return JSON.parse(readFileSync(FAST_STATE_PATH, "utf8")).enabled === true;
	} catch {
		return false;
	}
}

function writeFastEnabled(enabled: boolean): void {
	mkdirSync(dirname(FAST_STATE_PATH), { recursive: true });
	writeFileSync(
		FAST_STATE_PATH,
		`${JSON.stringify({ enabled }, null, 2)}\n`,
		"utf8",
	);
}

function isOpenAI(ctx: ExtensionContext): boolean {
	return (
		ctx.model?.provider === "openai" || ctx.model?.provider === "openai-codex"
	);
}

function colorize(ctx: ExtensionContext, on: boolean, text: string): string {
	try {
		if (!ctx.hasUI) return text;
		return ctx.ui.theme.fg(on ? "accent" : "muted", text);
	} catch {
		return text;
	}
}

function updateFooterStatus(ctx: ExtensionContext): void {
	if (!isOpenAI(ctx)) {
		try {
			ctx.ui.setStatus("codex-fast", undefined);
		} catch {
			// Headless hosts do not expose a footer.
		}
		return;
	}

	const fast = fastEnabled();
	const label = `codex-fast:${fast ? "on" : "off"}`;
	try {
		ctx.ui.setStatus("codex-fast", colorize(ctx, fast, label));
	} catch {
		// Headless hosts do not expose a footer.
	}
}

function priorityPayload(payload: unknown): unknown {
	return payload !== null && typeof payload === "object" && !Array.isArray(payload)
		? { ...(payload as Record<string, unknown>), service_tier: "priority" }
		: payload;
}

function fastOptions(options?: SimpleStreamOptions): SimpleStreamOptions {
	return {
		...options,
		onPayload: async (payload: unknown, model: Model<Api>) => {
			const replaced = await options?.onPayload?.(payload, model);
			const body = replaced === undefined ? payload : replaced;
			return fastEnabled() ? priorityPayload(body) : body;
		},
	};
}

function isLegacySource(source: unknown): boolean {
	if (typeof source !== "string") return false;
	let identity = source.replace(/^git:/, "");
	identity = identity.replace(/^(?:https?:\/\/|ssh:\/\/git@|git@)/, "");
	identity = identity.replace(/^github\.com:/, "github.com/");
	identity = identity.split(/[@#]/, 1)[0].replace(/\.git$/, "").replace(/\/$/, "");
	return identity === "github.com/fitchmultz/pi-codex-context";
}

function legacyStandaloneInstalled(): boolean {
	const agentDir = getAgentDir();
	if (
		!existsSync(
			join(
				agentDir,
				"git",
				"github.com",
				"fitchmultz",
				"pi-codex-context",
				"package.json",
			),
		)
	) {
		return false;
	}
	try {
		const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
		return settings.packages?.some((pkg: unknown) =>
			isLegacySource(
				typeof pkg === "string" ? pkg : (pkg as { source?: unknown })?.source,
			),
		) === true;
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI): void {
	// Base releases installed this source user-wide; defer until setup removes its entry and checkout.
	if (legacyStandaloneInstalled()) return;

	let footerContext: ExtensionContext | undefined;
	const refreshFastStatus = () => {
		if (footerContext) updateFooterStatus(footerContext);
	};

	pi.on("before_provider_request", (event, ctx) => {
		if (!isOpenAI(ctx) || !fastEnabled()) return;
		return priorityPayload(event.payload);
	});

	pi.on("session_start", (_event, ctx) => {
		footerContext = ctx;
		updateFooterStatus(ctx);
		// Unwatch first: repeated starts must not leave a state-file watcher behind.
		unwatchFile(FAST_STATE_PATH, refreshFastStatus);
		// 5s is plenty: local toggles redraw immediately; this only catches other sessions.
		if (ctx.hasUI) watchFile(FAST_STATE_PATH, { interval: 5000 }, refreshFastStatus);
	});
	pi.on("session_shutdown", () => {
		unwatchFile(FAST_STATE_PATH, refreshFastStatus);
		footerContext = undefined;
	});
	pi.on("model_select", (_event, ctx) => updateFooterStatus(ctx));

	pi.registerCommand("codex-fast", {
		description: "Toggle OpenAI priority/fast mode",
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase();
			const current = fastEnabled();
			if (command === "" || command === "status") {
				ctx.ui.notify(
					`OpenAI fast mode is ${current ? "ON" : "OFF"}`,
					"info",
				);
				updateFooterStatus(ctx);
				return;
			}
			if (command === "on" || command === "off" || command === "toggle") {
				const next = command === "toggle" ? !current : command === "on";
				writeFastEnabled(next);
				ctx.ui.notify(
					`OpenAI fast mode ${next ? "enabled" : "disabled"}`,
					"info",
				);
				updateFooterStatus(ctx);
				return;
			}
			ctx.ui.notify("Usage: /codex-fast [on|off|toggle|status]", "warning");
		},
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const candidates = compactionModels();
		if (!candidates) return;
		const failures: string[] = [];
		for (const candidate of candidates) {
			if (event.signal.aborted) return { cancel: true };
			const model = ctx.modelRegistry.find(candidate.provider, candidate.model);
			const registeredStream = ctx.modelRegistry.getRegisteredProviderConfig(
				candidate.provider,
			)?.streamSimple;
			const streamFn =
				candidate.provider === "openai" || candidate.provider === "openai-codex"
					? (
							model: Model<Api>,
							context: Context,
							options?: SimpleStreamOptions,
						) =>
							(registeredStream ?? streamSimple)(
								model,
								context,
								fastOptions(options),
							)
					: registeredStream;
			if (!model) {
				failures.push(`${candidate.provider}/${candidate.model} unavailable`);
				continue;
			}

			try {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				if (!auth.ok) {
					failures.push(
						`${candidate.provider}/${candidate.model}: ${auth.error}`,
					);
					continue;
				}
				const result = await compact(
					event.preparation,
					model,
					auth.apiKey,
					auth.headers,
					event.customInstructions,
					event.signal,
					candidate.thinkingLevel,
					streamFn,
					auth.env,
				);
				if (failures.length > 0 && ctx.hasUI) {
					ctx.ui.notify(
						`Compaction used ${candidate.provider}/${candidate.model} after ${failures.join("; ")}`,
						"warning",
					);
				}
				return { compaction: result };
			} catch (error) {
				failures.push(
					`${candidate.provider}/${candidate.model}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		if (event.signal.aborted) return { cancel: true };
		if (ctx.hasUI) {
			ctx.ui.notify(
				`Custom compaction unavailable (${failures.join("; ")}); using the active model`,
				"warning",
			);
		}
		return;
	});
}
