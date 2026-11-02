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
	Text,
	truncateToWidth,
	type TUI,
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
class DraftDialog {
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
	private contentLines = 0;

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
		this.draftText = new Text(theme.fg("text", options.draft), 1, 0);
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
		const content = this.draftText.render(width);
		this.contentLines = content.length;
		const chrome = this.renderChrome(width);
		const free = rows - chrome.length - (Number.isFinite(rows) ? DraftDialog.DOCK_RESERVE : 0);
		if (!Number.isFinite(free) || content.length <= free) {
			// Everything fits (or no viewport is reported): original layout.
			this.viewportLines = Number.isFinite(free) ? Math.max(1, free) : content.length;
			this.scrollTop = 0;
			return [this.firstLine(chrome), ...content, ...chrome.slice(1)];
		}
		// One line of the free budget goes to the position indicator.
		this.viewportLines = Math.max(1, free - 1);
		this.scrollTop = Math.min(this.scrollTop, content.length - this.viewportLines);
		const above = this.scrollTop;
		const below = content.length - this.scrollTop - this.viewportLines;
		this.scrollHint.setText(
			this.theme.fg(
				"muted",
				truncateToWidth(positionIndicator(above, below), Math.max(1, width - 2), ""),
			),
		);
		return [
			this.firstLine(chrome),
			...content.slice(this.scrollTop, this.scrollTop + this.viewportLines),
			...this.scrollHint.render(width),
			...chrome.slice(1),
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

	private renderChrome(width: number): string[] {
		return [
			...this.topBorder.render(width),
			...this.spacer.render(width),
			...this.list.render(width),
			...this.spacer.render(width),
			...this.hints.render(width),
			...this.bottomBorder.render(width),
		];
	}

	/** The top border line; the dialog always renders at least one chrome line. */
	private firstLine(chrome: string[]): string {
		const first = chrome[0];
		return first === undefined ? "" : first;
	}

	private scrollPage(direction: 1 | -1): void {
		const step = Math.max(1, this.viewportLines);
		this.scrollTop = Math.max(
			0,
			Math.min(
				Math.max(0, this.contentLines - this.viewportLines),
				this.scrollTop + direction * step,
			),
		);
		this.tui.requestRender();
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
	// clipped to the viewport and scrolled with PageUp/PageDown instead of
	// being cut off by the TUI with no way back. Select keys are unchanged.
	return ctx.ui.custom<string | undefined>(
		(tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (result: string | undefined) => void) =>
			new DraftDialog(tui, theme, { draft, actions, done }),
	);
}
