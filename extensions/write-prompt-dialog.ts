import { stripVTControlCharacters } from "node:util";
import {
	type ExtensionCommandContext,
	DynamicBorder,
	keyHint,
	rawKeyHint,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	getKeybindings,
	type KeybindingsManager,
	SelectList,
	Spacer,
	stripTerminalSequences,
	Text,
	truncateToWidth,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

/** One-line scroll position indicator, truncated so it can never wrap. */
const positionIndicator = (above: number, below: number): string =>
	`${above > 0 ? `↑ ${above} line${above === 1 ? "" : "s"} above · ` : ""}${below > 0 ? `↓ ${below} line${below === 1 ? "" : "s"} below · ` : ""}${rawKeyHint("PgUp/PgDn", "scroll")}`;

/** A cancelled dialog result. */
const cancelled = (): string | undefined => undefined;

/** Inputs for one draft dialog run. */
type DialogOptions = {
	draft: string;
	actions: readonly string[];
	done: (result: string | undefined) => void;
};

/** The writer's draft dialog: full draft text in a scrolling viewport plus the action list. */
class DraftDialog implements Component {
	private readonly topBorder: DynamicBorder;
	private readonly draftText: Text;
	private readonly scrollHint: Text;
	private readonly spacer: Spacer;
	private readonly list: SelectList;
	private readonly hints: Text;
	private readonly bottomBorder: DynamicBorder;
	private readonly children: Component[];
	private readonly tui: TUI;
	private readonly theme: Theme;
	private scrollTop = 0;
	private viewportLines = 1;
	private maxScroll = 0;
	private listTop = 0;
	private listHeight = 0;

	// The dialog renders inside the TUI's editor dock slot below the chat
	// transcript (minimum one line) and the footer (two lines built-in,
	// up to about four with extension statuses). The slot height is not
	// queryable, so the budget reserves for those dock-mates; if a footer
	// ever exceeds the reserve, the bottom border is the first line lost.
	private static readonly DOCK_RESERVE = 5;

	constructor(tui: TUI, theme: Theme, options: DialogOptions) {
		this.tui = tui;
		this.theme = theme;
		this.topBorder = new DynamicBorder((s) => theme.fg("border", s));
		this.bottomBorder = new DynamicBorder((s) => theme.fg("border", s));
		this.draftText = new Text(
			theme.fg("text", stripTerminalSequences(stripVTControlCharacters(options.draft))),
			1,
			0,
		);
		this.scrollHint = new Text(theme.fg("muted", ""), 1, 0);
		this.spacer = new Spacer(1);
		this.list = new SelectList(
			options.actions.map((value) => ({ value, label: value })),
			options.actions.length,
			{
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("muted", text),
				noMatch: (text) => theme.fg("muted", text),
			},
		);
		this.list.onSelect = (item) => options.done(item.value);
		this.list.onCancel = () => options.done(cancelled());
		this.hints = new Text(
			rawKeyHint("↑↓", "navigate") +
				"  " +
				keyHint("tui.select.confirm", "select") +
				"  " +
				keyHint("tui.select.cancel", "cancel") +
				"  " +
				keyHint("tui.select.pageUp", "scroll long drafts"),
			1,
			0,
		);
		this.children = [
			this.topBorder,
			this.draftText,
			this.scrollHint,
			this.spacer,
			this.list,
			this.hints,
			this.bottomBorder,
		];
	}

	render(width: number): string[] {
		const rows = Number.isFinite(this.tui.terminal.rows)
			? this.tui.terminal.rows
			: Number.POSITIVE_INFINITY;
		const top = this.topBorder.render(width);
		const spacer = this.spacer.render(width);
		const actions = this.list.render(width);
		const hints = this.hints.render(width);
		const bottom = this.bottomBorder.render(width);
		const chromeHeight =
			top.length + 2 * spacer.length + actions.length + hints.length + bottom.length;
		const draft = this.renderDraft(width, rows - chromeHeight - DraftDialog.DOCK_RESERVE);
		this.listTop = top.length + draft.length + spacer.length;
		this.listHeight = actions.length;
		return [...top, ...draft, ...spacer, ...actions, ...spacer, ...hints, ...bottom];
	}

	private renderDraft(width: number, free: number): readonly string[] {
		const content = this.draftText.render(width);
		if (content.length <= free) {
			this.viewportLines = content.length;
			this.maxScroll = 0;
			this.scrollTop = 0;
			return content;
		}
		// One line of the free budget goes to the position indicator.
		this.viewportLines = Math.max(1, free - 1);
		this.maxScroll = Math.max(0, content.length - this.viewportLines);
		this.scrollTop = Math.min(this.scrollTop, this.maxScroll);
		this.scrollHint.setText(
			this.theme.fg(
				"muted",
				truncateToWidth(
					positionIndicator(this.scrollTop, this.maxScroll - this.scrollTop),
					Math.max(1, width - 2),
					"",
				),
			),
		);
		return [
			...content.slice(this.scrollTop, this.scrollTop + this.viewportLines),
			...this.scrollHint.render(width),
		];
	}

	invalidate(): void {
		for (const child of this.children) {
			child.invalidate();
		}
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.pageUp")) {
			this.scrollPage(-1);
			return;
		}
		if (kb.matches(data, "tui.select.pageDown")) {
			this.scrollPage(1);
			return;
		}
		this.list.handleInput(data);
		this.tui.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const listY = event.y - this.listTop;
		if (listY >= 0 && listY < this.listHeight) {
			const result = this.list.handleMouse({ ...event, y: listY, height: this.listHeight });
			return result ?? (event.type === "wheel" ? { handled: true, render: false } : undefined);
		}
		if (event.type === "wheel") {
			return { handled: true, render: this.scrollBy(event.wheelDelta ?? 0) };
		}
		return undefined;
	}

	private scrollPage(direction: 1 | -1): void {
		this.scrollBy(direction * this.viewportLines);
		this.tui.requestRender();
	}

	private scrollBy(lines: number): boolean {
		const next = Math.max(0, Math.min(this.maxScroll, this.scrollTop + lines));
		const changed = next !== this.scrollTop;
		this.scrollTop = next;
		return changed;
	}
}

/** Shows the draft with its action menu, scrollable in the TUI and plain in RPC mode. */
export function pickAction(
	ctx: ExtensionCommandContext,
	draft: string,
	actions: readonly string[],
): Promise<string | undefined> {
	if (ctx.mode !== "tui") {
		return ctx.ui.select(draft, [...actions]);
	}
	// The dialog must stay fully readable in small terminals: the draft is
	// clipped to the viewport and scrolls independently of the action list.
	return ctx.ui.custom<string | undefined>(
		(tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (result: string | undefined) => void) =>
			new DraftDialog(tui, theme, { draft, actions, done }),
	);
}
