import { readFile, unwatchFile, watchFile } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const VERBOSITY_PATH = join(homedir(), ".pi", "agent", "verbosity.json");
const VERBOSITY_APIS = new Set(["openai-responses", "openai-codex-responses", "azure-openai-responses"]);
type Verbosity = "low" | "medium" | "high";
type VerbosityConfig = { showIndicator: boolean; models: Record<string, Verbosity> };
const NO_VERBOSITY: VerbosityConfig = { showIndicator: false, models: {} };

async function loadVerbosity(): Promise<VerbosityConfig> {
	return new Promise((resolve) => {
		readFile(VERBOSITY_PATH, "utf8", (error, data) => {
			if (error) return resolve(NO_VERBOSITY);
			try {
				const value = JSON.parse(data) as { showIndicator?: unknown; models?: unknown };
				const models = value.models && typeof value.models === "object" && !Array.isArray(value.models)
					? Object.fromEntries(
							Object.entries(value.models).filter(
								(entry): entry is [string, Verbosity] => ["low", "medium", "high"].includes(entry[1] as string),
							),
						)
					: {};
				resolve({ showIndicator: value.showIndicator === true, models });
			} catch {
				resolve(NO_VERBOSITY);
			}
		});
	});
}

function verbosityText(ctx: ExtensionContext, config: VerbosityConfig): string {
	const model = ctx.model;
	if (!config.showIndicator || !model || !VERBOSITY_APIS.has(model.api)) return "";
	const verbosity = config.models[`${model.provider}/${model.id}`] ?? config.models[model.id];
	return verbosity ? ` • 🗣  ${verbosity}` : "";
}

function formatCount(count: number): string {
	if (count < 1_000) return String(count);
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

function formatCwd(cwd: string): string {
	const home = homedir();
	const path = relative(resolve(home), resolve(cwd));
	return path === "" ? "~" : path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path) ? `~${sep}${path}` : cwd;
}

function sanitize(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function installFooter(ctx: ExtensionContext, verbosity: VerbosityConfig): void {
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

		return {
			dispose: unsubscribe,
			invalidate() {},
			render(width: number): string[] {
				let location = formatCwd(ctx.sessionManager.getCwd());
				const branch = footerData.getGitBranch();
				if (branch) location += ` (${branch})`;
				const sessionName = ctx.sessionManager.getSessionName();
				if (sessionName) location += ` • ${sessionName}`;

				const usage = ctx.getContextUsage();
				const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
				const percent = usage?.percent;
				const contextText = percent == null ? `?/${formatCount(contextWindow)}` : `${percent.toFixed(1)}%/${formatCount(contextWindow)}`;
				const context = percent != null && percent > 90
					? theme.fg("error", contextText)
					: percent != null && percent > 70
						? theme.fg("warning", contextText)
						: theme.fg("dim", contextText);

				const model = ctx.model?.id ?? "no-model";
				const thinking = ctx.model?.reasoning ? ` • ${ctx.thinkingLevel ?? "off"}` : "";
				const provider = footerData.getAvailableProviderCount() > 1 && ctx.model ? `(${ctx.model.provider}) ` : "";
				const rightText = `${provider}${model}${thinking}${verbosityText(ctx, verbosity)}`;
				const topLines = visibleWidth(location) + visibleWidth(rightText) + 2 <= width
					? [theme.fg("dim", location + " ".repeat(width - visibleWidth(location) - visibleWidth(rightText)) + rightText)]
					: [
							...wrapTextWithAnsi(theme.fg("dim", location), Math.max(1, width)),
							...wrapTextWithAnsi(theme.fg("dim", rightText), Math.max(1, width)).map(
								(line) => " ".repeat(Math.max(0, width - visibleWidth(line))) + line,
							),
						];

				const statuses = [...footerData.getExtensionStatuses().entries()]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([, text]) => sanitize(text));
				const statusLines: string[] = [];
				let current = context;
				for (const [index, status] of statuses.entries()) {
					const candidate = `${current}${index === 0 ? ` ${theme.fg("dim", "•")}` : ""} ${status}`;
					if (visibleWidth(candidate) <= width) current = candidate;
					else {
						statusLines.push(...wrapTextWithAnsi(current, Math.max(1, width)));
						current = status;
					}
				}
				statusLines.push(...wrapTextWithAnsi(current, Math.max(1, width)));
				return [...topLines, ...statusLines];
			},
		};
	});
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let verbosity = NO_VERBOSITY;
	let footerContext: ExtensionContext | undefined;
	const refreshVerbosity = async () => {
		verbosity = await loadVerbosity();
		if (enabled && footerContext?.mode === "tui") installFooter(footerContext, verbosity);
	};

	pi.on("session_start", async (_event, ctx) => {
		footerContext = ctx;
		verbosity = await loadVerbosity();
		if (enabled && ctx.mode === "tui") installFooter(ctx, verbosity);
		unwatchFile(VERBOSITY_PATH, refreshVerbosity);
		if (ctx.hasUI) watchFile(VERBOSITY_PATH, { interval: 500 }, refreshVerbosity);
	});
	pi.on("session_shutdown", () => {
		unwatchFile(VERBOSITY_PATH, refreshVerbosity);
		footerContext = undefined;
	});

	pi.registerCommand("clean-footer", {
		description: "Toggle the compact footer without cumulative usage counters",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			enabled = !enabled;
			if (enabled) installFooter(ctx, verbosity);
			else ctx.ui.setFooter(undefined);
			ctx.ui.notify(`Clean footer ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});
}
