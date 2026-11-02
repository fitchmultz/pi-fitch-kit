import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Box,
	type Component,
	getCapabilities,
	Key,
	matchesKey,
	setCapabilities,
	truncateToWidth,
	type Focusable,
	type ImageProtocol,
	type TUI,
} from "@earendil-works/pi-tui";
import {
	docKey,
	firstAnchor,
	type ReaderController,
	type ReaderDocument,
	type ReaderState,
	type Section,
} from "./paged-reader-core.ts";
import { pageIndexFor, paginateDocument, type ReaderPage } from "./paged-reader-pagination.ts";
import { hintActions, hintBar } from "./paged-reader-hints.ts";
import { listBody, noteBody } from "./paged-reader-bodies.ts";
import { hasMouseHandler, type MouseEvent, type MouseResult } from "./paged-reader-ui.ts";
import { NoteSession } from "./paged-reader-notes.ts";
import {
	pageBody,
	panelDetail,
	panelHeader,
	panelSubtitle,
	panelTitle,
	readingStatus as readingStatusFor,
} from "./paged-reader-panel.ts";

const PANEL_WIDTH = 72;
const PANEL_HEIGHT = 18;

/** Inputs for one overlay run. */
export type OverlayOptions = {
	tui: TUI;
	theme: Theme;
	done: () => void;
	controller: ReaderController;
	isAgentIdle: () => boolean;
	initial: "read" | "list";
	key?: string | undefined;
};

export class ReaderOverlay implements Component, Focusable {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly done: () => void;
	private readonly controller: ReaderController;
	private readonly isAgentIdle: () => boolean;
	private readonly notes: NoteSession;
	private _focused = false;
	private panel?: Box | undefined;
	private panelX = 0;
	private panelY = 0;
	private panelWidth = 0;
	private panelHeight = 0;
	private key?: string | undefined;
	private listMode = false;
	private listOrigin?: string | undefined;
	listSelection = 0;
	private pageCache?: { key: string; width: number; rows: number; pages: ReaderPage[] } | undefined;
	private status = "";
	private priorImageProtocol?: Exclude<ImageProtocol, null> | undefined;

	constructor(options: OverlayOptions) {
		this.tui = options.tui;
		this.theme = options.theme;
		this.done = options.done;
		this.controller = options.controller;
		this.isAgentIdle = options.isAgentIdle;
		this.key =
			options.key ?? options.controller.state().lastKey ?? options.controller.state().order.at(-1);
		this.listSelection = Math.max(0, options.controller.state().order.indexOf(this.key ?? ""));
		this.listMode = options.initial === "list";
		this.notes = new NoteSession({
			tui: options.tui,
			theme: options.theme,
			controller: options.controller,
			isAgentIdle: options.isAgentIdle,
			isFocused: () => this.focused,
			currentKey: () => this.key,
			currentSectionId: () => this.section()?.id,
			setStatus: (line) => {
				this.status = line;
			},
			requestRender: () => this.requestRender(),
		});
		if (options.initial === "read" && this.key !== undefined) {
			this.rememberCursor();
		}
	}

	get mode(): "read" | "list" | "note" {
		if (this.notes.active) {
			return "note";
		}
		if (this.listMode) {
			return "list";
		}
		return "read";
	}

	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.notes.setFocused(value);
	}

	requestRender(): void {
		this.tui.requestRender();
	}
	maskInlineImages(): void {
		if (this.tui.mode !== "fullscreen") {
			return;
		}
		const caps = getCapabilities();
		if (caps.images === null) {
			return;
		}
		this.priorImageProtocol = caps.images;
		setCapabilities({ ...caps, images: null });
		this.tui.invalidate();
		this.tui.requestRender(true);
	}
	dispose(): void {
		if (this.priorImageProtocol === undefined) {
			return;
		}
		const caps = getCapabilities();
		if (caps.images === null) {
			setCapabilities({ ...caps, images: this.priorImageProtocol });
		}
		this.tui.invalidate();
		this.tui.requestRender(true);
		this.priorImageProtocol = undefined;
	}
	clearStatus(): void {
		this.status = "";
		this.requestRender();
	}
	refreshBranch(): void {
		this.notes.reset();
		this.listMode = false;
		this.listOrigin = undefined;
		this.key = this.controller.state().lastKey ?? this.controller.state().order.at(-1);
		this.pageCache = undefined;
		this.status = "";
		this.requestRender();
	}

	showList(): void {
		if (this.notes.active) {
			this.notes.leave();
		}
		this.listMode = true;
		this.listOrigin = this.key;
		this.listSelection = Math.max(0, this.controller.state().order.indexOf(this.key ?? ""));
		this.requestRender();
	}

	close(save = true): void {
		if (save && this.notes.active) {
			this.notes.leave();
		}
		if (save && this.key !== undefined && this.controller.state().documents.has(this.key)) {
			this.rememberCursor();
		}
		this.done();
	}

	private currentDoc(): ReaderDocument | undefined {
		return this.key !== undefined ? this.controller.state().documents.get(this.key) : undefined;
	}

	/** The current document and its key, when both exist. */
	private docPair(): { doc: ReaderDocument; key: string } | undefined {
		const doc = this.currentDoc();
		if (doc === undefined || this.key === undefined) {
			return undefined;
		}
		return { doc, key: this.key };
	}

	private currentPages(width: number, rows: number): ReaderPage[] {
		const pair = this.docPair();
		if (pair === undefined) {
			return [];
		}
		if (
			this.pageCache?.key !== pair.key ||
			this.pageCache.width !== width ||
			this.pageCache.rows !== rows
		) {
			this.pageCache = {
				key: pair.key,
				width,
				rows,
				pages: paginateDocument(pair.doc, width, rows),
			};
		}
		return this.pageCache.pages;
	}
	private currentPage(width: number, rows: number): ReaderPage | undefined {
		const pair = this.docPair();
		if (pair === undefined) {
			return undefined;
		}
		const pages = this.currentPages(width, rows);
		const index = pageIndexFor(
			pair.doc,
			pages,
			this.controller.state().cursors.get(pair.key) ?? firstAnchor(pair.doc),
		);
		return pages[index];
	}
	private rememberCursor(): void {
		const pair = this.docPair();
		if (pair === undefined) {
			return;
		}
		this.controller.persist({
			kind: "cursor",
			key: pair.key,
			anchor: this.controller.state().cursors.get(pair.key) ?? firstAnchor(pair.doc),
		});
	}
	selectDocument(key: string): void {
		if (!this.controller.state().documents.has(key)) {
			return;
		}
		this.key = key;
		this.listMode = false;
		this.listOrigin = undefined;
		this.status = "";
		this.pageCache = undefined;
		this.rememberCursor();
		const doc = this.currentDoc();
		if (doc?.replyToFeedbackId !== undefined && !this.controller.state().readReplies.has(key)) {
			this.controller.persist({ kind: "reply-read", key });
		}
		this.requestRender();
	}
	move(direction: -1 | 1): void {
		const pair = this.docPair();
		if (pair === undefined || this.tui.terminal.rows < 7 || this.tui.terminal.columns < 12) {
			return;
		}
		const pages = this.currentPages(
			Math.min(PANEL_WIDTH, this.tui.terminal.columns) - 2,
			Math.min(PANEL_HEIGHT, this.tui.terminal.rows) - 6,
		);
		const index = pageIndexFor(
			pair.doc,
			pages,
			this.controller.state().cursors.get(pair.key) ?? firstAnchor(pair.doc),
		);
		const next = pages[index + direction];
		if (next === undefined) {
			return;
		}
		this.controller.persist({ kind: "cursor", key: pair.key, anchor: next.anchor });
		this.requestRender();
	}
	private section(): Section | undefined {
		const pair = this.docPair();
		if (pair === undefined) {
			return undefined;
		}
		const anchor = this.controller.state().cursors.get(pair.key) ?? firstAnchor(pair.doc);
		return pair.doc.sections.find((section) => section.id === anchor.sectionId);
	}
	openNote(): void {
		const section = this.section();
		if (section === undefined || this.key === undefined) {
			return;
		}
		this.notes.open(this.key, section);
	}
	openReply(): void {
		const section = this.section();
		if (section === undefined || this.key === undefined) {
			return;
		}
		const reply = this.controller.state().latestReply(this.key, section.id);
		if (reply !== undefined) {
			this.selectDocument(docKey(reply));
		} else {
			this.status = "No reply saved yet";
			this.requestRender();
		}
	}
	backToOriginal(): void {
		const id = this.currentDoc()?.replyToFeedbackId;
		const original = id !== undefined ? this.controller.state().feedback.get(id) : undefined;
		if (original !== undefined) {
			this.selectDocument(original.key);
		}
	}
	returnFromList(): void {
		if (this.listOrigin !== undefined && this.controller.state().documents.has(this.listOrigin)) {
			this.listOrigin = undefined;
			this.listMode = false;
			this.requestRender();
		} else {
			this.close();
		}
	}

	handleInput(data: string): void {
		if (this.notes.active) {
			this.notes.input(data);
			return;
		}
		if (this.listMode) {
			this.listInput(data);
			return;
		}
		this.readInput(data);
	}

	private listInput(data: string): void {
		if (matchesKey(data, Key.up)) {
			this.bumpSelection(-1);
		} else if (matchesKey(data, Key.down)) {
			this.bumpSelection(1);
		} else if (matchesKey(data, Key.enter)) {
			this.selectAt(this.listSelection);
		} else if (matchesKey(data, Key.escape)) {
			this.returnFromList();
		}
		this.tui.requestRender();
	}

	private readInput(data: string): void {
		if (matchesKey(data, Key.right) || matchesKey(data, Key.space)) {
			this.move(1);
		} else if (matchesKey(data, Key.left)) {
			this.move(-1);
		} else if (matchesKey(data, Key.escape)) {
			this.close();
		} else if (matchesKey(data, "n")) {
			this.openNote();
		} else if (matchesKey(data, "r")) {
			this.openReply();
		} else if (matchesKey(data, "b")) {
			this.backToOriginal();
		} else if (matchesKey(data, "l")) {
			this.showList();
		} else if (matchesKey(data, "t")) {
			this.notes.send(true);
		}
	}

	/** Moves the library selection, clamped to the document list. */
	bumpSelection(delta: 1 | -1): void {
		const total = this.controller.state().order.length;
		this.listSelection = Math.max(0, Math.min(total - 1, this.listSelection + delta));
		this.requestRender();
	}

	/** Selects the document at a library row, when one exists. */
	selectAt(index: number): void {
		const key = this.controller.state().order[index];
		if (key !== undefined) {
			this.selectDocument(key);
		}
	}

	/** True when the current section has a saved reply. */
	hasReply(): boolean {
		const section = this.section();
		return (
			section !== undefined &&
			this.key !== undefined &&
			this.controller.state().latestReply(this.key, section.id) !== undefined
		);
	}

	/** True when the current document is a reply to a note. */
	hasOriginal(): boolean {
		return this.currentDoc()?.replyToFeedbackId !== undefined;
	}

	/** True when the current section's note can be retried. */
	retryable(): boolean {
		const section = this.section();
		if (section === undefined || this.key === undefined) {
			return false;
		}
		const latest = this.controller.state().latestFeedback(this.key, section.id);
		const status = this.controller.state().statuses.get(latest?.id ?? "");
		return status === "unanswered" || status === "interrupted";
	}

	/** The live reader state for hint wiring. */
	state(): ReaderState {
		return this.controller.state();
	}

	/** Saves the note draft locally. */
	saveNote(): void {
		this.notes.save();
	}

	/** Sends the note, optionally retrying the latest one. */
	sendNote(retry = false): void {
		this.notes.send(retry);
	}

	/** Closes the note editor, saving the draft. */
	leaveNote(): void {
		this.notes.leave();
	}

	private hintBar(width: number): Component {
		return hintBar(hintActions(this), this.theme, width);
	}

	/** Backdrop rows for a too-small terminal. */
	private smallScreen(width: number, height: number): string[] {
		const warning = truncateToWidth("Resize terminal to read · Esc closes", width, "");
		return Array.from({ length: height }, (_, index) =>
			index === Math.floor(height / 2) ? warning.padEnd(width) : " ".repeat(width),
		);
	}

	render(width: number): string[] {
		const height = this.tui.terminal.rows;
		if (width < 12 || height < 7) {
			return this.smallScreen(width, height);
		}
		const backdrop = Array.from({ length: height }, () => " ".repeat(width));
		this.panelWidth = Math.min(PANEL_WIDTH, width);
		this.panelHeight = Math.min(PANEL_HEIGHT, height);
		const contentWidth = this.panelWidth - 2;
		const bodyRows = this.panelHeight - 6;
		const state = this.controller.state();
		const doc = this.currentDoc();
		const current = this.listMode ? undefined : this.currentPage(contentWidth, bodyRows);
		const section =
			current !== undefined && doc !== undefined ? doc.sections[current.sectionIndex] : undefined;
		const title = panelTitle(this.mode, doc);
		const status = this.notes.active
			? this.status
			: readingStatusFor(this.status, this.controller.state(), this.key, this.section());
		const subtitle = panelSubtitle({
			mode: this.mode,
			orderLength: state.order.length,
			current,
			doc,
			section,
		});
		const detail = panelDetail(this.mode, current, status, contentWidth);
		const panel = new Box(1, 1, (text) => this.theme.bg("customMessageBg", text));
		for (const header of panelHeader({
			theme: this.theme,
			title,
			subtitle,
			detail,
			contentWidth,
		})) {
			panel.addChild(header);
		}
		panel.addChild(this.panelBody(contentWidth, bodyRows, current));
		panel.addChild(this.hintBar(contentWidth));
		const lines = panel.render(this.panelWidth);
		this.panel = panel;
		this.panelX = Math.floor((width - this.panelWidth) / 2);
		this.panelY = Math.floor((height - this.panelHeight) / 2);
		for (const [index, line] of lines.entries()) {
			if (index >= this.panelHeight) {
				break;
			}
			backdrop[this.panelY + index] =
				" ".repeat(this.panelX) + line + " ".repeat(width - this.panelX - this.panelWidth);
		}
		return backdrop;
	}

	private panelBody(
		contentWidth: number,
		bodyRows: number,
		current: ReaderPage | undefined,
	): Component {
		if (this.listMode) {
			return listBody({
				state: this.controller.state(),
				theme: this.theme,
				selection: this.listSelection,
				width: contentWidth,
				rows: bodyRows,
				onPick: (index, key) => {
					this.listSelection = index;
					this.selectDocument(key);
				},
			});
		}
		const editor = this.notes.editor;
		if (this.notes.active && editor !== undefined) {
			return noteBody(editor, contentWidth, bodyRows);
		}
		return pageBody(current, bodyRows);
	}

	handleMouse(event: MouseEvent): MouseResult | undefined {
		const panel = this.panel;
		if (
			panel !== undefined &&
			event.x >= this.panelX &&
			event.x < this.panelX + this.panelWidth &&
			event.y >= this.panelY &&
			event.y < this.panelY + this.panelHeight &&
			hasMouseHandler(panel)
		) {
			const result = panel.handleMouse({
				...event,
				x: event.x - this.panelX,
				y: event.y - this.panelY,
				width: this.panelWidth,
				height: this.panelHeight,
			});
			if (result !== undefined) {
				return result;
			}
		}
		// Capture the press as well as the synthesized click so the backdrop cannot
		// select the streaming transcript behind the reader.
		return { handled: true };
	}

	invalidate(): void {
		this.pageCache = undefined;
		this.panel?.invalidate();
		this.notes.invalidate();
	}
}
