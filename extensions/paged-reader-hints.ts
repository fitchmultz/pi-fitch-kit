import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Text, visibleWidth } from "@earendil-works/pi-tui";
import type { ReaderState } from "./paged-reader-core.ts";
import { mouseRegion, type MouseEvent } from "./paged-reader-ui.ts";

/** One selectable hint-bar action. */
export type HintAction = { long: string; short: string; action: () => void };

/** The overlay operations hint actions invoke. */
export type HintHost = {
	readonly mode: "read" | "list" | "note";
	readonly listSelection: number;
	state: () => ReaderState;
	saveNote: () => void;
	sendNote: (retry?: boolean) => void;
	leaveNote: () => void;
	showList: () => void;
	close: (save?: boolean) => void;
	returnFromList: () => void;
	selectAt: (index: number) => void;
	bumpSelection: (delta: 1 | -1) => void;
	move: (direction: -1 | 1) => void;
	openNote: () => void;
	openReply: () => void;
	backToOriginal: () => void;
	hasReply: () => boolean;
	hasOriginal: () => boolean;
	retryable: () => boolean;
};

/** The note editor's hint actions. */
const noteActions = (host: HintHost): HintAction[] => [
	{ long: "CtrlS Save", short: "^S", action: () => host.saveNote() },
	{ long: "CtrlEnter Send", short: "^↵", action: () => host.sendNote() },
	{ long: "Esc Read", short: "Esc", action: () => host.leaveNote() },
];

/** The library list's hint actions. */
const listActions = (host: HintHost): HintAction[] => [
	{
		long: "↑ Up",
		short: "↑",
		action: () => {
			host.bumpSelection(-1);
		},
	},
	{
		long: "↓ Down",
		short: "↓",
		action: () => {
			host.bumpSelection(1);
		},
	},
	{
		long: "Enter Open",
		short: "↵",
		action: () => {
			host.selectAt(host.listSelection);
		},
	},
	{ long: "Esc Back", short: "Esc", action: () => host.returnFromList() },
];

/** The reading view's hint actions, with the conditional reply/retry entries. */
const readActions = (host: HintHost): HintAction[] => {
	const actions: HintAction[] = [
		{ long: "← Prev", short: "←", action: () => host.move(-1) },
		{ long: "→ Next", short: "→", action: () => host.move(1) },
		{ long: "N Note", short: "N", action: () => host.openNote() },
	];
	if (host.hasReply()) {
		actions.push({ long: "R Reply", short: "R", action: () => host.openReply() });
	}
	if (host.hasOriginal()) {
		actions.push({ long: "B Original", short: "B", action: () => host.backToOriginal() });
	}
	if (host.retryable()) {
		actions.push({ long: "T Retry", short: "T", action: () => host.sendNote(true) });
	}
	actions.push({ long: "L List", short: "L", action: () => host.showList() });
	actions.push({ long: "Esc Close", short: "Esc", action: () => host.close() });
	return actions;
};

/** The hint actions for the overlay's current mode. */
export const hintActions = (host: HintHost): HintAction[] => {
	if (host.mode === "note") {
		return noteActions(host);
	}
	if (host.mode === "list") {
		return listActions(host);
	}
	return readActions(host);
};

/** Packs hint actions into one clickable line, compacting labels when needed. */
export function hintBar(actions: readonly HintAction[], theme: Theme, width: number): Component {
	const total =
		actions.reduce((sum, action) => sum + visibleWidth(action.long), 0) + 2 * (actions.length - 1);
	const compact = total > width;
	let shown: readonly HintAction[] = actions;
	if (compact) {
		const last = actions.at(-1);
		shown = last === undefined ? actions : [last, ...actions.slice(0, -1)];
	}
	const chosen: HintAction[] = [];
	let used = 0;
	for (const action of shown) {
		const label = compact ? action.short : action.long;
		const cost = visibleWidth(label) + (chosen.length > 0 ? 2 : 0);
		if (used + cost > width) {
			continue;
		}
		chosen.push(action);
		used += cost;
	}
	let line = "";
	const spans: Array<{ start: number; end: number; action: () => void }> = [];
	for (const action of chosen) {
		const label = compact ? action.short : action.long;
		if (line !== "") {
			line += "  ";
		}
		const start = visibleWidth(line);
		line += label;
		spans.push({ start, end: visibleWidth(line), action: action.action });
	}
	return mouseRegion(new Text(theme.fg("accent", line), 0, 0), (event: MouseEvent) => {
		if (event.type !== "click" || event.button !== "left" || event.y !== 0) {
			return;
		}
		const hit = spans.find(({ start, end }) => event.x >= start && event.x < end);
		if (hit === undefined) {
			return;
		}
		hit.action();
		return { handled: true };
	});
}
