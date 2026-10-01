import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const CHECKPOINT_ENTRY = "clean-footer-checkpoint";

type FooterEntry = {
	type: string;
	name?: string;
	message?: { role: string; usage?: { input: number; cacheRead: number; cacheWrite: number } };
};

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

// File-wide facts include abandoned branches; usage belongs to the selected leaf.
class FooterSnapshot {
	sessionName: string | undefined;
	hasCacheActivity = false;
	latestCacheHitRate: number | undefined;
	dirty = true;
	private identity: string | undefined;
	private entryCount = 0;
	private factsDirty = false;
	private pendingLeaf: string | null | undefined;
	private usageKey: string | undefined;
	private usage: ReturnType<ExtensionContext["getContextUsage"]>;

	invalidateFacts(ctx?: ExtensionContext): void {
		this.factsDirty = true;
		this.pendingLeaf = ctx?.sessionManager.getLeafId();
		this.dirty = true;
	}

	settle(): void {
		this.pendingLeaf = undefined;
		this.dirty = true;
	}

	apply(entry: Pick<FooterEntry, "type" | "name" | "message">): void {
		if (entry.type === "session_info") this.sessionName = entry.name?.trim() || undefined;
		if (entry.type !== "message" || entry.message?.role !== "assistant" || !entry.message.usage) return;
		const { input, cacheRead, cacheWrite } = entry.message.usage;
		this.hasCacheActivity ||= cacheRead > 0 || cacheWrite > 0;
		const promptTokens = input + cacheRead + cacheWrite;
		this.latestCacheHitRate = promptTokens > 0 ? cacheRead / promptTokens * 100 : undefined;
	}

	read(ctx: ExtensionContext) {
		const manager = ctx.sessionManager;
		const identity = JSON.stringify([manager.getSessionId(), manager.getSessionFile()]);
		const bootstrap = identity !== this.identity;
		const leaf = manager.getLeafId();
		if (bootstrap) {
			this.sessionName = undefined;
			this.hasCacheActivity = false;
			this.latestCacheHitRate = undefined;
			this.entryCount = 0;
			this.identity = identity;
			this.dirty = true;
		}
		if (bootstrap || this.factsDirty && (this.pendingLeaf === undefined || leaf !== this.pendingLeaf)) {
			// message_end is replaceable and precedes append. Read only the persisted suffix
			// after the leaf advances (or settlement/tree navigation confirms finalization).
			// ponytail: getEntries copies history once per reconciliation; Pi 1.0 has no public file-wide suffix iterator or out-of-band edit signal.
			const entries = manager.getEntries();
			for (let i = this.entryCount; i < entries.length; i++) this.apply(entries[i]!);
			this.entryCount = entries.length;
			// Another handler may append before the assistant is persisted. Keep pending
			// reconciliation until settlement, but never reread an unchanged leaf.
			if (this.pendingLeaf === undefined) this.factsDirty = false;
			else this.pendingLeaf = leaf;
		}
		const key = JSON.stringify([identity, leaf, ctx.model?.provider, ctx.model?.id, ctx.model?.api, ctx.model?.baseUrl, ctx.model?.contextWindow]);
		if (this.dirty || key !== this.usageKey) {
			this.usage = ctx.getContextUsage();
			this.usageKey = key;
			this.dirty = false;
		}
		return this.usage;
	}
}

function installFooter(ctx: ExtensionContext, snapshot: FooterSnapshot): void {
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		let repoCache: { cwd: string; name?: { text: string; key: string } } | undefined;

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
				const usage = snapshot.read(ctx);
				const { sessionName, hasCacheActivity, latestCacheHitRate } = snapshot;
				if (sessionName) location += theme.fg("dim", ` • ${sessionName}`);

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
	let snapshot = new FooterSnapshot();

	pi.on("message_end", (event, ctx) => {
		if (event.message.role === "assistant") snapshot.invalidateFacts(ctx);
		snapshot.dirty = true;
	});
	pi.on("session_info_changed", (event) => snapshot.apply({ type: "session_info", name: event.name }));
	const dirtyUsage = () => { snapshot.dirty = true; };
	pi.on("session_tree", () => snapshot.invalidateFacts());
	pi.on("session_compact", () => snapshot.invalidateFacts());
	pi.on("model_select", dirtyUsage);
	pi.on("agent_settled", () => snapshot.settle());

	pi.on("session_start", (event, ctx) => {
		snapshot = new FooterSnapshot();
		// This is an instance toggle, not a global or branch preference. Warm reload/new/
		// resume/fork still start enabled; tree navigation leaves the live choice alone.
		// Only cold startup restores the file-wide choice saved by a checkpoint, and
		// copied entries in a fork must not carry the parent instance's choice with them.
		if (event.reason === "startup") {
			const entry = ctx.sessionManager.getEntries().findLast((entry) => entry.type === "custom" && entry.customType === CHECKPOINT_ENTRY);
			const saved = entry?.type === "custom" ? entry.data as { sessionId?: unknown; enabled?: unknown } | null : undefined;
			if (saved?.sessionId === ctx.sessionManager.getSessionId() && typeof saved.enabled === "boolean") enabled = saved.enabled;
		}
		if (enabled && ctx.mode === "tui") installFooter(ctx, snapshot);
	});

	pi.registerCommand("clean-footer", {
		description: "Toggle the compact footer without cumulative usage counters",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			enabled = !enabled;
			if (enabled) installFooter(ctx, snapshot);
			else ctx.ui.setFooter(undefined);
			ctx.ui.notify(`Clean footer ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});
}
