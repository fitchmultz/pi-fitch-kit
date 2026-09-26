import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const CHECKPOINT_ENTRY = "clean-footer-checkpoint";

function formatCount(count: number): string {
	if (count < 1_000) return String(count);
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

function formatCwd(cwd: string): string {
	const resolved = resolve(cwd);
	if (resolved === homedir()) return "~";
	// ponytail: last two segments are the disambiguator (repo, or repo/slug for worktrees); full path if ever needed
	return resolved.split(sep).filter(Boolean).slice(-2).join(sep);
}

// Low-chroma xterm-256 tones: identity without neon; stays quiet next to a single-hue theme.
const REPO_COLORS = [66, 72, 96, 102, 108, 132, 138, 144, 151, 174, 180, 187];

function repoColor(key: string): number {
	let hash = 5381;
	for (const char of key) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
	return REPO_COLORS[hash % REPO_COLORS.length]!;
}

function findRepoRoot(cwd: string): string | undefined {
	const home = homedir();
	let dir = resolve(cwd);
	while (true) {
		// A home-dir dotfiles repo is not a project; show the path instead.
		if (existsSync(join(dir, ".git"))) return dir === home ? undefined : dir;
		if (dir === home) return undefined;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

// worktrees/<repo>/<slug>: color keys on the repo, slug stays for disambiguation.
function repoName(root: string): { text: string; key: string } {
	return basename(dirname(dirname(root))) === "worktrees"
		? { text: `${basename(dirname(root))}/${basename(root)}`, key: dirname(root) }
		: { text: basename(root), key: root };
}

function sanitize(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function installFooter(ctx: ExtensionContext): void {
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		let repoCache: { cwd: string; name?: { text: string; key: string } } | undefined;
		let sessionStats: {
			revision: number | undefined;
			sessionName: string | undefined;
			hasCacheActivity: boolean;
			latestCacheHitRate: number | undefined;
		} | undefined;

		return {
			dispose: unsubscribe,
			invalidate() {},
			render(width: number): string[] {
				const cwd = ctx.sessionManager.getCwd();
				if (repoCache?.cwd !== cwd) {
					const root = findRepoRoot(cwd);
					repoCache = { cwd, name: root ? repoName(root) : undefined };
				}
				let location = repoCache.name
					? `\x1b[38;5;${repoColor(repoCache.name.key)}m${repoCache.name.text}\x1b[39m`
					: theme.fg("dim", formatCwd(cwd));
				// getGitBranch crawls into the home dotfiles repo; only show a branch for a real project repo.
				const branch = footerData.getGitBranch();
				if (branch && repoCache.name) location += theme.fg("dim", ` (${branch})`);
				const manager = ctx.sessionManager;
				// The revision getter is fork-only; official Pi takes an uncached pass.
				const entryRevision: unknown = "getEntriesRevision" in manager && typeof manager.getEntriesRevision === "function"
					? manager.getEntriesRevision()
					: undefined;
				const revision = typeof entryRevision === "number" ? entryRevision : undefined;
				if (revision === undefined || sessionStats?.revision !== revision) {
					// These values cover the whole file, including abandoned branches.
					let sessionName: string | undefined;
					let latestCacheHitRate: number | undefined;
					let hasCacheActivity = false;
					for (const entry of manager.getEntries()) {
						if (entry.type === "session_info") sessionName = entry.name?.trim() || undefined;
						if (entry.type !== "message" || entry.message.role !== "assistant") continue;
						const { input, cacheRead, cacheWrite } = entry.message.usage;
						hasCacheActivity ||= cacheRead > 0 || cacheWrite > 0;
						const promptTokens = input + cacheRead + cacheWrite;
						latestCacheHitRate = promptTokens > 0 ? (cacheRead / promptTokens) * 100 : undefined;
					}
					sessionStats = { revision, sessionName, hasCacheActivity, latestCacheHitRate };
				}
				const { sessionName, hasCacheActivity, latestCacheHitRate } = sessionStats;
				if (sessionName) location += theme.fg("dim", ` • ${sessionName}`);

				const usage = ctx.getContextUsage();
				const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
				const percent = usage?.percent;
				const contextText = percent == null ? `?/${formatCount(contextWindow)}` : `${percent.toFixed(1)}%/${formatCount(contextWindow)}`;
				const context = percent != null && percent > 90
					? theme.fg("error", contextText)
					: percent != null && percent > 70
						? theme.fg("warning", contextText)
						: theme.fg("dim", contextText);

				const model = ctx.model?.id.split("/").pop() ?? "no-model";
				const thinking = ctx.model?.reasoning ? ` • ${ctx.thinkingLevel ?? "off"}` : "";
				const provider = footerData.getAvailableProviderCount() > 1 && ctx.model ? `(${ctx.model.provider}) ` : "";
				const extensionStatuses = footerData.getExtensionStatuses();
				const verbosity = extensionStatuses.get("verbosity");
				const rightText = `${provider}${model}${thinking}${verbosity ? ` • ${sanitize(verbosity)}` : ""}`;
				const topLines = visibleWidth(location) + visibleWidth(rightText) + 2 <= width
					? [location + " ".repeat(width - visibleWidth(location) - visibleWidth(rightText)) + theme.fg("dim", rightText)]
					: [
							...wrapTextWithAnsi(location, Math.max(1, width)),
							...wrapTextWithAnsi(theme.fg("dim", rightText), Math.max(1, width)).map(
								(line) => " ".repeat(Math.max(0, width - visibleWidth(line))) + line,
							),
						];

				const statuses = [...extensionStatuses.entries()]
					.filter(([key]) => key !== "verbosity")
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([, text]) => sanitize(text));
				const statusLines: string[] = [];
				let current = hasCacheActivity && latestCacheHitRate !== undefined
					? `${context} ${theme.fg("dim", `• CH${latestCacheHitRate.toFixed(1)}%`)}`
					: context;
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

	pi.on("session_start", (event, ctx) => {
		// This is an instance toggle, not a global or branch preference. Warm reload/new/
		// resume/fork still start enabled; tree navigation leaves the live choice alone.
		// Only cold startup restores the file-wide choice saved by a checkpoint, and
		// copied entries in a fork must not carry the parent instance's choice with them.
		if (event.reason === "startup") {
			const entry = ctx.sessionManager.getEntries().findLast((entry) => entry.type === "custom" && entry.customType === CHECKPOINT_ENTRY);
			const saved = entry?.type === "custom" ? entry.data as { sessionId?: unknown; enabled?: unknown } | null : undefined;
			if (saved?.sessionId === ctx.sessionManager.getSessionId() && typeof saved.enabled === "boolean") enabled = saved.enabled;
		}
		if (enabled && ctx.mode === "tui") installFooter(ctx);
	});

	// Additive fork event; no dependency on fork-only exported types or a second state store.
	(pi.on as unknown as (event: "session_checkpoint", handler: (
		event: unknown, ctx: ExtensionContext,
	) => { sleepReady: boolean }) => void)("session_checkpoint", (_event, ctx) => {
		pi.appendEntry(CHECKPOINT_ENTRY, { sessionId: ctx.sessionManager.getSessionId(), enabled });
		// Native command ownership settles the toggle; presentation is reconstructed.
		return { sleepReady: true };
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
