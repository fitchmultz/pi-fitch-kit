import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type {
	ContextUsage,
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const CHECKPOINT_ENTRY = "clean-footer-checkpoint";

type SessionManager = ExtensionContext["sessionManager"];

/** Session facts the footer consumes from persisted entries. */
type FooterEntryInput = {
	type: string;
	name?: string | undefined;
	message?:
		| {
				role: string;
				usage?: { input: number; cacheRead: number; cacheWrite: number } | undefined;
		  }
		| undefined;
};

function formatCount(count: number): string {
	if (count < 1_000) {
		return String(count);
	}
	if (count < 10_000) {
		return `${(count / 1_000).toFixed(1)}k`;
	}
	if (count < 1_000_000) {
		return `${Math.round(count / 1_000)}k`;
	}
	return `${(count / 1_000_000).toFixed(1)}M`;
}

function formatCwd(cwd: string): string {
	const resolved = resolve(cwd);
	if (resolved === homedir()) {
		return "~";
	}
	// ponytail: last two segments are the disambiguator (repo, or repo/slug for worktrees); full path if ever needed
	return resolved.split(sep).filter(Boolean).slice(-2).join(sep);
}

// Low-chroma xterm-256 tones: identity without neon; stays quiet next to a single-hue theme.
const REPO_COLORS = [66, 72, 96, 102, 108, 132, 138, 144, 151, 174, 180, 187];

function repoColor(key: string): number {
	let hash = 5381;
	for (const char of key) {
		hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
	}
	// The hash is unsigned and the palette is non-empty, so the index always lands in range;
	// 66 is the fallback tone if that ever changes.
	return REPO_COLORS[hash % REPO_COLORS.length] ?? 66;
}

function findRepoRoot(cwd: string): string | undefined {
	const home = homedir();
	let dir = resolve(cwd);
	while (true) {
		// A home-dir dotfiles repo is not a project; show the path instead.
		if (existsSync(join(dir, ".git"))) {
			return dir === home ? undefined : dir;
		}
		if (dir === home) {
			return undefined;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			return undefined;
		}
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
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

const trimmedOrUndefined = (text: string | undefined): string | undefined => {
	const trimmed = text?.trim();
	return trimmed === "" ? undefined : trimmed;
};

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
	private usage: ContextUsage | undefined;

	invalidateFacts(ctx?: ExtensionContext): void {
		this.factsDirty = true;
		this.pendingLeaf = ctx?.sessionManager.getLeafId();
		this.dirty = true;
	}

	settle(): void {
		this.pendingLeaf = undefined;
		this.dirty = true;
	}

	apply(entry: FooterEntryInput): void {
		if (entry.type === "session_info") {
			this.sessionName = trimmedOrUndefined(entry.name);
		}
		if (entry.type === "message") {
			this.applyUsage(entry);
		}
	}

	private applyUsage(entry: FooterEntryInput): void {
		const message = entry.message;
		if (message === undefined || message.role !== "assistant" || message.usage === undefined) {
			return;
		}
		const { input, cacheRead, cacheWrite } = message.usage;
		this.hasCacheActivity ||= cacheRead > 0 || cacheWrite > 0;
		const promptTokens = input + cacheRead + cacheWrite;
		this.latestCacheHitRate = promptTokens > 0 ? (cacheRead / promptTokens) * 100 : undefined;
	}

	read(ctx: ExtensionContext): ContextUsage | undefined {
		const manager = ctx.sessionManager;
		const identity = JSON.stringify([manager.getSessionId(), manager.getSessionFile()]);
		const bootstrap = identity !== this.identity;
		const leaf = manager.getLeafId();
		if (bootstrap) {
			this.resetFacts(identity);
		}
		if (bootstrap || this.factsDue(leaf)) {
			this.reconcileFacts(manager, leaf);
		}
		const key = this.usageKeyFor(ctx, identity, leaf);
		if (this.dirty || key !== this.usageKey) {
			this.usage = ctx.getContextUsage();
			this.usageKey = key;
			this.dirty = false;
		}
		return this.usage;
	}

	private usageKeyFor(ctx: ExtensionContext, identity: string, leaf: string | null): string {
		const model = ctx.model;
		const modelKey =
			model === undefined
				? null
				: [model.provider, model.id, model.api, model.baseUrl, model.contextWindow];
		return JSON.stringify([identity, leaf, modelKey]);
	}

	private resetFacts(identity: string): void {
		this.sessionName = undefined;
		this.hasCacheActivity = false;
		this.latestCacheHitRate = undefined;
		this.entryCount = 0;
		this.identity = identity;
		this.dirty = true;
	}

	private factsDue(leaf: string | null): boolean {
		return this.factsDirty && (this.pendingLeaf === undefined || leaf !== this.pendingLeaf);
	}

	private reconcileFacts(manager: SessionManager, leaf: string | null): void {
		// message_end is replaceable and precedes append. Read only the persisted suffix
		// after the leaf advances (or settlement/tree navigation confirms finalization).
		// ponytail: getEntries copies history once per reconciliation; Pi 1.0 has no public file-wide suffix iterator or out-of-band edit signal.
		const entries = manager.getEntries();
		for (const entry of entries.slice(this.entryCount)) {
			this.apply(entry);
		}
		this.entryCount = entries.length;
		// Another handler may append before the assistant is persisted. Keep pending
		// reconciliation until settlement, but never reread an unchanged leaf.
		if (this.pendingLeaf === undefined) {
			this.factsDirty = false;
		} else {
			this.pendingLeaf = leaf;
		}
	}
}

/** Cached repo label so the location segment stays stable across renders. */
class RepoLabelCache {
	private entry: { cwd: string; name: { text: string; key: string } | undefined } | undefined;

	label(cwd: string): { text: string; key: string } | undefined {
		if (this.entry?.cwd !== cwd) {
			const root = findRepoRoot(cwd);
			this.entry = { cwd, name: root === undefined ? undefined : repoName(root) };
		}
		return this.entry.name;
	}
}

/** Inputs shared by the footer render helpers. */
type FooterFrame = {
	ctx: ExtensionContext;
	theme: Theme;
	footerData: ReadonlyFooterDataProvider;
	snapshot: FooterSnapshot;
	repoLabels: RepoLabelCache;
};

/** Location segment: colored repo name or plain path, plus branch and session name. */
const renderLocation = (frame: FooterFrame): string => {
	const cwd = frame.ctx.sessionManager.getCwd();
	const name = frame.repoLabels.label(cwd);
	let location =
		name !== undefined
			? `\x1b[38;5;${repoColor(name.key)}m${name.text}\x1b[39m`
			: frame.theme.fg("dim", formatCwd(cwd));
	// getGitBranch crawls into the home dotfiles repo; only show a branch for a real project repo.
	const branch = frame.footerData.getGitBranch();
	if (branch !== null && branch !== "" && name !== undefined) {
		location += frame.theme.fg("dim", ` (${branch})`);
	}
	const { sessionName } = frame.snapshot;
	if (sessionName !== undefined) {
		location += frame.theme.fg("dim", ` • ${sessionName}`);
	}
	return location;
};

/** Context window from usage or the active model, or 0 when neither is known. */
const contextWindowOf = (frame: FooterFrame, usage: ContextUsage | undefined): number =>
	usage?.contextWindow ?? frame.ctx.model?.contextWindow ?? 0;

/** Context segment: usage percentage over window, tinted by pressure. */
const contextSegment = (frame: FooterFrame, usage: ContextUsage | undefined): string => {
	const contextWindow = contextWindowOf(frame, usage);
	const percent = usage?.percent ?? null;
	const text =
		percent === null
			? `?/${formatCount(contextWindow)}`
			: `${percent.toFixed(1)}%/${formatCount(contextWindow)}`;
	if (percent !== null && percent > 90) {
		return frame.theme.fg("error", text);
	}
	if (percent !== null && percent > 70) {
		return frame.theme.fg("warning", text);
	}
	return frame.theme.fg("dim", text);
};

/** Right-aligned segment: model, thinking level, provider, and verbosity. */
const renderRightSegment = (frame: FooterFrame): string => {
	const model = frame.ctx.model?.id.split("/").pop() ?? "no-model";
	const thinking =
		frame.ctx.model?.reasoning === true ? ` • ${frame.ctx.thinkingLevel ?? "off"}` : "";
	const provider =
		frame.footerData.getAvailableProviderCount() > 1 && frame.ctx.model !== undefined
			? `(${frame.ctx.model.provider}) `
			: "";
	const verbosity = frame.footerData.getExtensionStatuses().get("verbosity");
	const suffix = verbosity !== undefined && verbosity !== "" ? ` • ${sanitize(verbosity)}` : "";
	return `${provider}${model}${thinking}${suffix}`;
};

/** Top line(s): location and right segment on one line, or wrapped separately. */
const renderTopLines = (
	theme: Theme,
	width: number,
	location: string,
	rightText: string,
): string[] => {
	const locationWidth = visibleWidth(location);
	const rightWidth = visibleWidth(rightText);
	if (locationWidth + rightWidth + 2 <= width) {
		return [location + " ".repeat(width - locationWidth - rightWidth) + theme.fg("dim", rightText)];
	}
	const wrapped = wrapTextWithAnsi(theme.fg("dim", rightText), Math.max(1, width));
	return [
		...wrapTextWithAnsi(location, Math.max(1, width)),
		...wrapped.map((line) => " ".repeat(Math.max(0, width - visibleWidth(line))) + line),
	];
};

/** Context with the cache-hit suffix, when any cache activity was observed. */
const withCacheSuffix = (snapshot: FooterSnapshot, theme: Theme, context: string): string =>
	snapshot.hasCacheActivity && snapshot.latestCacheHitRate !== undefined
		? `${context} ${theme.fg("dim", `• CH${snapshot.latestCacheHitRate.toFixed(1)}%`)}`
		: context;

/** Remaining lines: statuses joined with separators and wrapped to width. */
const renderStatusLines = (
	theme: Theme,
	width: number,
	context: string,
	statuses: string[],
): string[] => {
	const lines: string[] = [];
	let current = context;
	for (const [index, status] of statuses.entries()) {
		const candidate = `${current}${index === 0 ? ` ${theme.fg("dim", "•")}` : ""} ${status}`;
		if (visibleWidth(candidate) <= width) {
			current = candidate;
		} else {
			lines.push(...wrapTextWithAnsi(current, Math.max(1, width)));
			current = status;
		}
	}
	lines.push(...wrapTextWithAnsi(current, Math.max(1, width)));
	return lines;
};

function installFooter(ctx: ExtensionContext, snapshot: FooterSnapshot): void {
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		const frame: FooterFrame = {
			ctx,
			theme,
			footerData,
			snapshot,
			repoLabels: new RepoLabelCache(),
		};

		return {
			dispose: unsubscribe,
			invalidate() {
				// Footer data is read fresh on every render; nothing to invalidate.
			},
			render(width: number): string[] {
				const usage = snapshot.read(ctx);
				const statuses = [...footerData.getExtensionStatuses().entries()]
					.filter(([key]) => key !== "verbosity")
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([, text]) => sanitize(text));
				return [
					...renderTopLines(theme, width, renderLocation(frame), renderRightSegment(frame)),
					...renderStatusLines(
						theme,
						width,
						withCacheSuffix(snapshot, theme, contextSegment(frame, usage)),
						statuses,
					),
				];
			},
		};
	});
}

/** Reads the persisted clean-footer checkpoint, when this session wrote one. */
const readCheckpoint = (
	manager: SessionManager,
): { sessionId: unknown; enabled: boolean } | undefined => {
	const entry = manager
		.getEntries()
		.findLast(
			(candidate) => candidate.type === "custom" && candidate.customType === CHECKPOINT_ENTRY,
		);
	if (entry?.type !== "custom") {
		return undefined;
	}
	const data: unknown = entry.data;
	if (data === null || typeof data !== "object" || !("sessionId" in data) || !("enabled" in data)) {
		return undefined;
	}
	if (typeof data.enabled !== "boolean") {
		return undefined;
	}
	return { sessionId: data.sessionId, enabled: data.enabled };
};

export default function cleanFooter(pi: ExtensionAPI): void {
	let enabled = true;
	let snapshot = new FooterSnapshot();

	pi.on("message_end", (event, ctx) => {
		if (event.message.role === "assistant") {
			snapshot.invalidateFacts(ctx);
		}
		snapshot.dirty = true;
	});
	pi.on("session_info_changed", (event) =>
		snapshot.apply({ type: "session_info", name: event.name }),
	);
	const dirtyUsage = () => {
		snapshot.dirty = true;
	};
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
			const saved = readCheckpoint(ctx.sessionManager);
			if (saved !== undefined && saved.sessionId === ctx.sessionManager.getSessionId()) {
				enabled = saved.enabled;
			}
		}
		if (enabled && ctx.mode === "tui") {
			installFooter(ctx, snapshot);
		}
	});

	pi.registerCommand("clean-footer", {
		description: "Toggle the compact footer without cumulative usage counters",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				return;
			}
			enabled = !enabled;
			if (enabled) {
				installFooter(ctx, snapshot);
			} else {
				ctx.ui.setFooter(undefined);
			}
			ctx.ui.notify(`Clean footer ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});
}
