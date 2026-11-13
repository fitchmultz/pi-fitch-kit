import { mkdirSync, readFileSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type BeforeProviderRequestEvent,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { type FastModel, notify } from "./fast-mode-policy.ts";

type GoogleTier = "standard" | "flex" | "priority";
const STATE_PATH = join(getAgentDir(), "google-tier.json");
const STATUS_KEY = "google-tier";
const USAGE = "Usage: /google-tier [standard|flex|priority|status]";

const isGoogleTier = (value: unknown): value is GoogleTier =>
	value === "standard" || value === "flex" || value === "priority";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const eligible = (model: FastModel): boolean =>
	model?.provider === "google" && model.api === "google-generative-ai";

const selectedTier = (): GoogleTier | undefined => {
	try {
		const state: unknown = JSON.parse(readFileSync(STATE_PATH, "utf8"));
		return isRecord(state) && isGoogleTier(state.tier) ? state.tier : undefined;
	} catch {
		return undefined;
	}
};

const requestTier = (
	event: BeforeProviderRequestEvent,
	ctx: ExtensionContext,
): Record<string, unknown> | undefined => {
	if (!eligible(ctx.model)) {
		return undefined;
	}
	const tier = selectedTier();
	if (tier === undefined || !isRecord(event.payload)) {
		return undefined;
	}
	const { config } = event.payload;
	if (config !== undefined && !isRecord(config)) {
		return undefined;
	}
	// Pi's Google hook receives SDK parameters; the SDK moves this onto the wire.
	return { ...event.payload, config: { ...config, serviceTier: tier } };
};

const updateFooter = (ctx: ExtensionContext): void => {
	if (!ctx.hasUI) {
		return;
	}
	const tier = eligible(ctx.model) ? selectedTier() : undefined;
	ctx.ui.setStatus(
		STATUS_KEY,
		tier === undefined ? undefined : ctx.ui.theme.fg("accent", `Google ${tier} requested`),
	);
};

const reportTier = (ctx: ExtensionContext): void => {
	const tier = selectedTier() ?? "standard";
	const inactive = eligible(ctx.model) ? "" : " (inactive on this model)";
	let notice = "";
	if (tier === "flex") {
		notice = " Slower, best-effort; no automatic upgrade to Standard.";
	} else if (tier === "priority") {
		notice = " Premium pricing; Google may return Standard.";
	}
	notify(ctx, `Google shared requests: ${tier}${inactive}.${notice}`);
};

/** Shared Google request policy, using Pi's stock payload hook and lifecycle. */
export function registerGoogleTier(pi: ExtensionAPI): void {
	let context: ExtensionContext | undefined;
	const refresh = (): void => {
		if (context !== undefined) {
			updateFooter(context);
		}
	};
	pi.registerCommand("google-tier", {
		description: "Select Google request tier: standard, flex (half price), or priority (premium)",
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase();
			if (isGoogleTier(command)) {
				mkdirSync(dirname(STATE_PATH), { recursive: true });
				writeFileSync(STATE_PATH, `${JSON.stringify({ tier: command })}\n`);
			} else if (command !== "" && command !== "status") {
				notify(ctx, USAGE, "warning");
				return;
			}
			updateFooter(ctx);
			reportTier(ctx);
		},
	});
	pi.on("before_provider_request", requestTier);
	pi.on("session_start", (_event, ctx) => {
		context = ctx;
		refresh();
		unwatchFile(STATE_PATH, refresh);
		if (ctx.hasUI) {
			watchFile(STATE_PATH, { interval: 5000 }, refresh);
		}
	});
	pi.on("model_select", (_event, ctx) => {
		context = ctx;
		refresh();
	});
	pi.on("session_shutdown", () => {
		unwatchFile(STATE_PATH, refresh);
		context = undefined;
	});
}
