import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

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

function installFooter(ctx: ExtensionContext): void {
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
				const rightText = `${provider}${model}${thinking}`;
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

	pi.on("session_start", (_event, ctx) => {
		if (enabled && ctx.mode === "tui") installFooter(ctx);
	});

	pi.registerCommand("clean-footer", {
		description: "Toggle the compact footer without cumulative usage counters",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			enabled = !enabled;
			if (enabled) installFooter(ctx);
			else ctx.ui.setFooter(undefined);
			ctx.ui.notify(`Clean footer ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});
}
