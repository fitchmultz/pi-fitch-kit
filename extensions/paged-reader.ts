import { randomUUID } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import {
	getMarkdownTheme,
	getSelectListTheme,
	type ExtensionAPI,
	type ExtensionContext,
	type SessionEntry,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Box,
	Container,
	CURSOR_MARKER,
	Editor,
	getCapabilities,
	Key,
	Markdown,
	matchesKey,
	sliceByColumn,
	setCapabilities,
	stripTerminalSequences,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type Focusable,
	type TUI,
	type ImageProtocol,
} from "@earendil-works/pi-tui";
import * as nativeTui from "@earendil-works/pi-tui";

const ENTRY_TYPE = "fitch-paged-reader";
const FEEDBACK_TYPE = "fitch-paged-reader-feedback";
const PANEL_WIDTH = 72;
const PANEL_HEIGHT = 18;
const BODY_WIDTH = PANEL_WIDTH - 2;
type MouseEvent = {
	type: string; button: string; x: number; y: number; width: number; height: number;
	screenX: number; screenY: number; shift: boolean; alt: boolean; ctrl: boolean;
	wheelDelta?: number; clickCount?: number;
};
type MouseResult = { handled?: boolean; capture?: boolean; focus?: boolean; render?: boolean };
// ponytail: Pi before 0.85.1 has no native mouse routing; keep keyboard reading there.
const MouseRegion = (nativeTui as unknown as {
	MouseRegion?: new (child: Component, onMouse: (event: MouseEvent) => MouseResult | undefined) => Component;
}).MouseRegion;
const mouseRegion = (child: Component, onMouse: (event: MouseEvent) => MouseResult | undefined): Component =>
	MouseRegion ? new MouseRegion(child, onMouse) : child;
const displayBody = (text: string) =>
	stripTerminalSequences(text.replace(/\r\n?/g, "\n")).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
const displayLabel = (text: string) => displayBody(text).replace(/\s+/g, " ").trim();

type Section = { id: string; heading: string; text: string };
export type ReaderDocument = {
	id: string;
	revision: number;
	title: string;
	sections: Section[];
	replyToFeedbackId?: string;
	unlinkedFeedbackIds?: string[];
	incomplete?: boolean;
};
export type ReaderAnchor = { sectionId: string; line: number; column: number };
type Feedback = { id: string; key: string; sectionId: string; note: string };
type FeedbackStatus = "requested" | "entered" | "unanswered" | "interrupted";
type ReaderEvent =
	| { kind: "document"; document: ReaderDocument }
	| { kind: "cursor"; key: string; anchor: ReaderAnchor }
	| { kind: "draft"; key: string; sectionId: string; text: string }
	| { kind: "feedback"; feedback: Feedback }
	| { kind: "feedback-status"; id: string; status: FeedbackStatus }
	| { kind: "reply-read"; key: string };

const docKey = (doc: ReaderDocument) => `${doc.id}@${doc.revision}`;
const noteKey = (key: string, sectionId: string) => `${key}/${sectionId}`;
const firstAnchor = (doc: ReaderDocument): ReaderAnchor => ({ sectionId: doc.sections[0].id, line: 0, column: 0 });

export class ReaderState {
	readonly documents = new Map<string, ReaderDocument>();
	readonly order: string[] = [];
	readonly cursors = new Map<string, ReaderAnchor>();
	readonly drafts = new Map<string, string>();
	readonly feedback = new Map<string, Feedback>();
	readonly statuses = new Map<string, FeedbackStatus>();
	readonly readReplies = new Set<string>();
	lastKey: string | undefined;

	apply(event: ReaderEvent): void {
		switch (event.kind) {
			case "document": {
				const doc = event.document;
				if (!doc || typeof doc.id !== "string" || typeof doc.title !== "string"
					|| !Number.isSafeInteger(doc.revision) || doc.revision < 1
					|| !Array.isArray(doc.sections) || !doc.sections.length
					|| !doc.sections.every((section) => typeof section.id === "string"
						&& typeof section.heading === "string" && typeof section.text === "string")) return;
				const key = docKey(doc);
				if (!this.documents.has(key)) {
					this.documents.set(key, doc);
					this.order.push(key);
				}
				break;
			}
			case "cursor":
				if (this.documents.get(event.key)?.sections.some((section) => section.id === event.anchor?.sectionId)
					&& Number.isSafeInteger(event.anchor.line) && event.anchor.line >= 0
					&& Number.isSafeInteger(event.anchor.column) && event.anchor.column >= 0) {
					this.cursors.set(event.key, event.anchor);
					this.lastKey = event.key;
				}
				break;
			case "draft":
				if (this.documents.get(event.key)?.sections.some((section) => section.id === event.sectionId)
					&& typeof event.text === "string") this.drafts.set(noteKey(event.key, event.sectionId), event.text);
				break;
			case "feedback":
				if (event.feedback && typeof event.feedback.id === "string"
					&& this.documents.get(event.feedback.key)?.sections.some((section) => section.id === event.feedback.sectionId)
					&& typeof event.feedback.note === "string" && !this.feedback.has(event.feedback.id)) {
					this.feedback.set(event.feedback.id, event.feedback);
					this.statuses.set(event.feedback.id, "requested");
				}
				break;
			case "feedback-status":
				if (this.feedback.has(event.id) && ["requested", "entered", "unanswered", "interrupted"].includes(event.status)) {
					this.statuses.set(event.id, event.status);
				}
				break;
			case "reply-read":
				if (this.documents.has(event.key)) this.readReplies.add(event.key);
				break;
		}
	}

	latestFeedback(key: string, sectionId: string): Feedback | undefined {
		return [...this.feedback.values()].reverse().find((item) => item.key === key && item.sectionId === sectionId);
	}

	replies(id: string): ReaderDocument[] {
		return this.order.flatMap((key) => {
			const doc = this.documents.get(key)!;
			return doc.replyToFeedbackId === id ? [doc] : [];
		});
	}

	latestReply(key: string, sectionId: string): ReaderDocument | undefined {
		const notes = [...this.feedback.values()].reverse().filter((item) => item.key === key && item.sectionId === sectionId);
		for (const note of notes) {
			const replies = this.replies(note.id);
			const unread = replies.findLast((doc) => !this.readReplies.has(docKey(doc)));
			if (unread) return unread;
		}
		for (const note of notes) {
			const latest = this.replies(note.id).at(-1);
			if (latest) return latest;
		}
		return undefined;
	}

	markUnansweredAfterRestart(): void {
		for (const id of this.feedback.keys()) {
			if (!this.replies(id).length && this.statuses.get(id) !== "interrupted") this.statuses.set(id, "unanswered");
		}
	}
}

export function restoreReaderState(entries: readonly SessionEntry[]): ReaderState {
	const state = new ReaderState();
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === ENTRY_TYPE && entry.data && typeof entry.data === "object") {
			state.apply(entry.data as ReaderEvent);
		}
	}
	return state;
}

type Fragment = { line: number; column: number; text: string };
export type ReaderPage = { anchor: ReaderAnchor; sectionIndex: number; sectionPage: number; sectionPages: number; body: string[] };

function splitLine(line: string, width: number, lineIndex: number): Fragment[] {
	// Markdown pads each rendered row; pagination must not turn that padding into extra pages.
	const plain = stripTerminalSequences(line).trimEnd();
	if (!plain) return [{ line: lineIndex, column: 0, text: "" }];
	const styled = sliceByColumn(line, 0, visibleWidth(plain), true);
	const fragments: Fragment[] = [];
	let offset = 0;
	for (const text of wrapTextWithAnsi(styled, width)) {
		const visible = stripTerminalSequences(text).trimEnd();
		if (!visible) continue;
		const start = plain.indexOf(visible, offset);
		if (start < 0) return hardSplitLine(line, width, lineIndex, plain);
		fragments.push({ line: lineIndex, column: visibleWidth(plain.slice(0, start)), text });
		offset = start + visible.length;
	}
	return fragments.length ? fragments : [{ line: lineIndex, column: 0, text: "" }];
}

function hardSplitLine(line: string, width: number, lineIndex: number, plain: string): Fragment[] {
	const fragments: Fragment[] = [];
	let start = 0;
	let column = 0;
	for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(plain)) {
		const size = visibleWidth(segment);
		if (column > start && column - start + size > width) {
			fragments.push({ line: lineIndex, column: start, text: sliceByColumn(line, start, column - start, true) });
			start = column;
		}
		column += size;
	}
	fragments.push({ line: lineIndex, column: start, text: sliceByColumn(line, start, column - start, true) });
	return fragments;
}

export function paginateDocument(doc: ReaderDocument, width: number, rows: number): ReaderPage[] {
	const pageWidth = Math.max(2, Math.min(BODY_WIDTH, Math.floor(width)));
	const pageRows = Math.max(1, Math.floor(rows));
	const pages: ReaderPage[] = [];
	for (const [sectionIndex, section] of doc.sections.entries()) {
		const rendered = new Markdown(displayBody(section.text), 0, 0, getMarkdownTheme()).render(BODY_WIDTH);
		const fragments = (rendered.length ? rendered : [""]).flatMap((line, index) => splitLine(line, pageWidth, index));
		const sectionPages = Math.ceil(fragments.length / pageRows);
		for (let start = 0; start < fragments.length; start += pageRows) {
			const first = fragments[start];
			pages.push({
				anchor: { sectionId: section.id, line: first.line, column: first.column },
				sectionIndex,
				sectionPage: Math.floor(start / pageRows) + 1,
				sectionPages,
				body: fragments.slice(start, start + pageRows).map((fragment) => fragment.text),
			});
		}
	}
	return pages;
}

function pageIndexFor(doc: ReaderDocument, pages: ReaderPage[], anchor: ReaderAnchor): number {
	const sectionIndex = Math.max(0, doc.sections.findIndex((section) => section.id === anchor.sectionId));
	let selected = 0;
	for (const [index, page] of pages.entries()) {
		const at = page.anchor;
		if (page.sectionIndex > sectionIndex
			|| (page.sectionIndex === sectionIndex && (at.line > anchor.line
				|| (at.line === anchor.line && at.column > anchor.column)))) break;
		selected = index;
	}
	return selected;
}

type SendResult = "requested" | "queued" | "duplicate" | "empty" | "unavailable";
type ReaderController = {
	state: () => ReaderState;
	persist: (event: ReaderEvent) => void;
	send: (key: string, sectionId: string, note: string, retry: boolean, agentIdle: boolean) => SendResult;
};

class ReaderOverlay implements Component, Focusable {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly done: () => void;
	private readonly controller: ReaderController;
	private readonly isAgentIdle: () => boolean;
	private _focused = false;
	private panel?: Box;
	private panelX = 0;
	private panelY = 0;
	private panelWidth = 0;
	private panelHeight = 0;
	private key?: string;
	private mode: "read" | "list" | "note";
	private listOrigin?: string;
	private listSelection = 0;
	private editor?: Editor;
	private editorSectionId?: string;
	private pageCache?: { key: string; width: number; rows: number; pages: ReaderPage[] };
	private status = "";
	private priorImageProtocol?: Exclude<ImageProtocol, null>;

	constructor(
		tui: TUI,
		theme: Theme,
		done: () => void,
		controller: ReaderController,
		isAgentIdle: () => boolean,
		initial: "read" | "list",
		key?: string,
	) {
		this.tui = tui;
		this.theme = theme;
		this.done = done;
		this.controller = controller;
		this.isAgentIdle = isAgentIdle;
		this.key = key ?? controller.state().lastKey ?? controller.state().order.at(-1);
		this.mode = initial;
		this.listSelection = Math.max(0, controller.state().order.indexOf(this.key ?? ""));
		if (initial === "read" && this.key) this.rememberCursor();
	}

	get focused(): boolean { return this._focused; }
	set focused(value: boolean) {
		this._focused = value;
		if (this.editor) this.editor.focused = value;
	}

	requestRender(): void { this.tui.requestRender(); }
	maskInlineImages(): void {
		if (this.tui.mode !== "fullscreen") return;
		const caps = getCapabilities();
		if (!caps.images) return;
		this.priorImageProtocol = caps.images;
		setCapabilities({ ...caps, images: null });
		this.tui.invalidate();
		this.tui.requestRender(true);
	}
	dispose(): void {
		if (!this.priorImageProtocol) return;
		const caps = getCapabilities();
		if (caps.images === null) setCapabilities({ ...caps, images: this.priorImageProtocol });
		this.tui.invalidate();
		this.tui.requestRender(true);
		this.priorImageProtocol = undefined;
	}
	clearStatus(): void { this.status = ""; this.requestRender(); }
	refreshBranch(): void {
		this.editor = undefined;
		this.editorSectionId = undefined;
		this.mode = "read";
		this.key = this.controller.state().lastKey ?? this.controller.state().order.at(-1);
		this.pageCache = undefined;
		this.status = "";
		this.requestRender();
	}
	showList(): void {
		if (this.mode === "note") this.leaveNote();
		this.listOrigin = this.key;
		this.mode = "list";
		this.listSelection = Math.max(0, this.controller.state().order.indexOf(this.key ?? ""));
		this.requestRender();
	}
	close(save = true): void {
		if (save && this.mode === "note") this.leaveNote();
		if (save && this.key && this.controller.state().documents.has(this.key)) this.rememberCursor();
		this.done();
	}

	private currentDoc(): ReaderDocument | undefined { return this.key ? this.controller.state().documents.get(this.key) : undefined; }
	private currentPages(width: number, rows: number): ReaderPage[] {
		const doc = this.currentDoc();
		if (!doc || !this.key) return [];
		if (this.pageCache?.key !== this.key || this.pageCache.width !== width || this.pageCache.rows !== rows) {
			this.pageCache = { key: this.key, width, rows, pages: paginateDocument(doc, width, rows) };
		}
		return this.pageCache.pages;
	}
	private currentPage(width: number, rows: number): ReaderPage | undefined {
		const doc = this.currentDoc();
		if (!doc || !this.key) return undefined;
		const pages = this.currentPages(width, rows);
		const index = pageIndexFor(doc, pages, this.controller.state().cursors.get(this.key) ?? firstAnchor(doc));
		return pages[index];
	}
	private rememberCursor(): void {
		const doc = this.currentDoc();
		if (!doc || !this.key) return;
		this.controller.persist({ kind: "cursor", key: this.key, anchor: this.controller.state().cursors.get(this.key) ?? firstAnchor(doc) });
	}
	private selectDocument(key: string): void {
		if (!this.controller.state().documents.has(key)) return;
		this.key = key;
		this.mode = "read";
		this.listOrigin = undefined;
		this.status = "";
		this.pageCache = undefined;
		this.rememberCursor();
		const doc = this.currentDoc();
		if (doc?.replyToFeedbackId && !this.controller.state().readReplies.has(key)) {
			this.controller.persist({ kind: "reply-read", key });
		}
		this.requestRender();
	}
	private move(direction: -1 | 1): void {
		const doc = this.currentDoc();
		if (!doc || !this.key || this.tui.terminal.rows < 7 || this.tui.terminal.columns < 12) return;
		const pages = this.currentPages(Math.min(PANEL_WIDTH, this.tui.terminal.columns) - 2, Math.min(PANEL_HEIGHT, this.tui.terminal.rows) - 6);
		const index = pageIndexFor(doc, pages, this.controller.state().cursors.get(this.key) ?? firstAnchor(doc));
		const next = pages[index + direction];
		if (!next) return;
		this.controller.persist({ kind: "cursor", key: this.key, anchor: next.anchor });
		this.requestRender();
	}
	private section(): Section | undefined {
		const doc = this.currentDoc();
		if (!doc || !this.key) return undefined;
		const anchor = this.controller.state().cursors.get(this.key) ?? firstAnchor(doc);
		return doc.sections.find((section) => section.id === anchor.sectionId);
	}
	private openNote(): void {
		const section = this.section();
		if (!section || !this.key) return;
		this.mode = "note";
		this.editorSectionId = section.id;
		this.editor = new Editor(this.tui, {
			borderColor: (text) => this.theme.fg("border", text),
			selectList: getSelectListTheme(),
		}, { paddingX: 0 });
		this.editor.disableSubmit = true;
		const draft = this.controller.state().drafts.get(noteKey(this.key, section.id)) ?? "";
		this.editor.setText(draft);
		const previous = this.controller.state().latestFeedback(this.key, section.id);
		const previousStatus = previous ? this.controller.state().statuses.get(previous.id) : undefined;
		this.status = previous?.note !== draft ? "Draft autosaved locally"
			: this.controller.state().replies(previous.id).length ? "Sent · reply saved"
				: previousStatus === "entered" ? "Sent to agent · awaiting reply"
					: previousStatus === "unanswered" ? "Sent request · no saved reply"
						: previousStatus === "interrupted" ? "Queued request canceled · not sent"
						: "Queued for agent · awaiting reply";
		this.editor.onChange = (text) => {
			if (this.key && this.editorSectionId
				&& this.controller.state().drafts.get(noteKey(this.key, this.editorSectionId)) !== text) {
				this.controller.persist({ kind: "draft", key: this.key, sectionId: this.editorSectionId, text });
				this.status = "Draft autosaved locally";
			}
		};
		this.editor.focused = this.focused;
		this.requestRender();
	}
	private saveNote(): void {
		if (!this.key || !this.editor || !this.editorSectionId) return;
		this.controller.persist({ kind: "draft", key: this.key, sectionId: this.editorSectionId, text: this.editor.getText() });
		this.status = "Saved locally · no agent call";
		this.requestRender();
	}
	private leaveNote(): void {
		if (!this.key || !this.editor || !this.editorSectionId) return;
		const text = this.editor.getText();
		if (this.controller.state().drafts.get(noteKey(this.key, this.editorSectionId)) !== text) this.saveNote();
		this.editor = undefined;
		this.editorSectionId = undefined;
		this.mode = "read";
		this.status = "";
		this.requestRender();
	}
	private sendNote(retry = false): void {
		const sectionId = retry ? this.section()?.id : this.editorSectionId;
		const note = retry
			? this.key && sectionId ? this.controller.state().latestFeedback(this.key, sectionId)?.note ?? "" : ""
			: this.editor?.getText() ?? "";
		if (!this.key || !sectionId) return;
		const outcome = this.controller.send(this.key, sectionId, note, retry, this.isAgentIdle());
		this.status = outcome === "requested" || outcome === "queued" ? ""
			: outcome === "duplicate" ? "Already requested · edit note to send again"
			: outcome === "empty" ? "Write a note first" : "No saved reply · request not sent";
		if ((outcome === "requested" || outcome === "queued") && this.mode === "note") {
			this.editor = undefined;
			this.editorSectionId = undefined;
			this.mode = "read";
		}
		this.requestRender();
	}
	private openReply(): void {
		const section = this.section();
		if (!section || !this.key) return;
		const reply = this.controller.state().latestReply(this.key, section.id);
		if (reply) this.selectDocument(docKey(reply));
		else { this.status = "No reply saved yet"; this.requestRender(); }
	}
	private backToOriginal(): void {
		const id = this.currentDoc()?.replyToFeedbackId;
		const original = id ? this.controller.state().feedback.get(id) : undefined;
		if (original) this.selectDocument(original.key);
	}
	private returnFromList(): void {
		if (this.listOrigin && this.controller.state().documents.has(this.listOrigin)) {
			this.listOrigin = undefined;
			this.mode = "read";
			this.requestRender();
		} else this.close();
	}

	handleInput(data: string): void {
		if (this.mode === "note") {
			if (matchesKey(data, Key.ctrl("enter")) || data === "\x1b[13;5~") this.sendNote();
			else if (matchesKey(data, Key.ctrl("s"))) this.saveNote();
			else if (matchesKey(data, Key.escape)) this.leaveNote();
			else if (matchesKey(data, Key.enter)) this.editor?.insertTextAtCursor("\n");
			else this.editor?.handleInput(data);
			this.tui.requestRender();
			return;
		}
		if (this.mode === "list") {
			const total = this.controller.state().order.length;
			if (matchesKey(data, Key.up)) this.listSelection = Math.max(0, this.listSelection - 1);
			else if (matchesKey(data, Key.down)) this.listSelection = Math.min(total - 1, this.listSelection + 1);
			else if (matchesKey(data, Key.enter)) {
				const key = this.controller.state().order[this.listSelection];
				if (key) this.selectDocument(key);
			} else if (matchesKey(data, Key.escape)) this.returnFromList();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.right) || matchesKey(data, Key.space)) this.move(1);
		else if (matchesKey(data, Key.left)) this.move(-1);
		else if (matchesKey(data, Key.escape)) this.close();
		else if (matchesKey(data, "n")) this.openNote();
		else if (matchesKey(data, "r")) this.openReply();
		else if (matchesKey(data, "b")) this.backToOriginal();
		else if (matchesKey(data, "l")) this.showList();
		else if (matchesKey(data, "t")) this.sendNote(true);
	}

	private hintBar(width: number): Component {
		type Action = { long: string; short: string; action: () => void };
		const actions: Action[] = this.mode === "note"
			? [
				{ long: "CtrlS Save", short: "^S", action: () => this.saveNote() },
				{ long: "CtrlEnter Send", short: "^↵", action: () => this.sendNote() },
				{ long: "Esc Read", short: "Esc", action: () => this.leaveNote() },
			]
			: this.mode === "list"
				? [
					{ long: "↑ Up", short: "↑", action: () => { this.listSelection = Math.max(0, this.listSelection - 1); this.requestRender(); } },
					{ long: "↓ Down", short: "↓", action: () => {
						this.listSelection = Math.min(this.controller.state().order.length - 1, this.listSelection + 1);
						this.requestRender();
					} },
					{ long: "Enter Open", short: "↵", action: () => {
						const key = this.controller.state().order[this.listSelection];
						if (key) this.selectDocument(key);
					} },
					{ long: "Esc Back", short: "Esc", action: () => this.returnFromList() },
				]
				: [
					{ long: "← Prev", short: "←", action: () => this.move(-1) },
					{ long: "→ Next", short: "→", action: () => this.move(1) },
					{ long: "N Note", short: "N", action: () => this.openNote() },
					...(this.section() && this.key && this.controller.state().latestReply(this.key, this.section()!.id)
						? [{ long: "R Reply", short: "R", action: () => this.openReply() }] : []),
					...(this.currentDoc()?.replyToFeedbackId
						? [{ long: "B Original", short: "B", action: () => this.backToOriginal() }] : []),
					...(this.section() && this.key && ["unanswered", "interrupted"].includes(
						this.controller.state().statuses.get(this.controller.state().latestFeedback(this.key, this.section()!.id)?.id ?? "") ?? "",
					)
						? [{ long: "T Retry", short: "T", action: () => this.sendNote(true) }] : []),
					{ long: "L List", short: "L", action: () => this.showList() },
					{ long: "Esc Close", short: "Esc", action: () => this.close() },
				];
		const full = actions.reduce((n, action) => n + visibleWidth(action.long), 0) + 2 * (actions.length - 1);
		const compact = full > width;
		const shown = compact ? [actions.at(-1)!, ...actions.slice(0, -1)] : actions;
		const chosen: Action[] = [];
		let used = 0;
		for (const action of shown) {
			const label = compact ? action.short : action.long;
			const cost = visibleWidth(label) + (chosen.length ? 2 : 0);
			if (used + cost > width) continue;
			chosen.push(action);
			used += cost;
		}
		let line = "";
		const spans: Array<{ start: number; end: number; action: () => void }> = [];
		for (const action of chosen) {
			const label = compact ? action.short : action.long;
			if (line) line += "  ";
			const start = visibleWidth(line);
			line += label;
			spans.push({ start, end: visibleWidth(line), action: action.action });
		}
		return mouseRegion(new Text(this.theme.fg("accent", line), 0, 0), (event) => {
			if (event.type !== "click" || event.button !== "left" || event.y !== 0) return undefined;
			const hit = spans.find(({ start, end }) => event.x >= start && event.x < end);
			if (!hit) return undefined;
			hit.action();
			return { handled: true };
		});
	}

	private readingStatus(): string {
		if (this.status) return this.status;
		const section = this.section();
		if (!this.key || !section) return "";
		const note = this.controller.state().latestFeedback(this.key, section.id);
		if (!note) return this.controller.state().drafts.has(noteKey(this.key, section.id)) ? "Draft saved" : "";
		const reply = this.controller.state().latestReply(this.key, section.id);
		if (reply && !this.controller.state().readReplies.has(docKey(reply))
			&& this.controller.state().replies(note.id).length) return "Reply ready · R to read";
		if (this.controller.state().replies(note.id).length) return "Reply saved · R to reopen";
		const unlinked = this.controller.state().order
			.map((key) => this.controller.state().documents.get(key)!)
			.find((doc) => doc.unlinkedFeedbackIds?.includes(note.id));
		if (unlinked) {
			return `${unlinked.incomplete ? "Incomplete" : "Unlinked"} response in L List · T to retry`;
		}
		return this.controller.state().statuses.get(note.id) === "unanswered"
			? "No saved reply · T to retry deliberately"
			: this.controller.state().statuses.get(note.id) === "interrupted" ? "Queued request canceled · T to retry"
			: this.controller.state().statuses.get(note.id) === "entered" ? "Sent to agent · awaiting reply"
				: "Queued for agent · awaiting reply";
	}

	private listBody(width: number, rows: number): Component {
		const body = new Container();
		const state = this.controller.state();
		const start = Math.max(0, Math.min(this.listSelection - rows + 1, state.order.length - rows));
		for (let row = 0; row < rows; row++) {
			const index = start + row;
			const key = state.order[index];
			const doc = key ? state.documents.get(key) : undefined;
			const prefix = index === this.listSelection ? "› " : "  ";
			const label = doc ? `${prefix}${doc.replyToFeedbackId ? "↳ " : doc.unlinkedFeedbackIds ? "? " : ""}${displayLabel(doc.title)} · r${doc.revision}` : "";
			const clipped = truncateToWidth(label, width);
			const text = new Text(index === this.listSelection ? this.theme.fg("accent", clipped) : clipped, 0, 0);
			body.addChild(mouseRegion(text, (event) => {
				if (!doc || event.type !== "click" || event.button !== "left" || event.x >= visibleWidth(clipped)) return undefined;
				this.listSelection = index;
				this.selectDocument(key);
				return { handled: true };
			}));
			if (!label) body.addChild({ render: (w) => [" ".repeat(w)], invalidate() {} });
		}
		return body;
	}

	private noteBody(width: number, rows: number): Component {
		const editor = this.editor!;
		const all = editor.render(width);
		const capacity = Math.max(1, rows - 2);
		const cursor = all.findIndex((line) => line.includes(CURSOR_MARKER));
		const start = Math.max(0, Math.min(Math.max(0, cursor - 1) - capacity + 1, all.length - 2 - capacity));
		const cursorRow = Math.max(1, cursor);
		const visible = rows < 3
			? [all[cursorRow] ?? all[1] ?? all[0], ...(rows === 2 ? [all.at(-1)!] : [])]
			: [
				all[0],
				...all.slice(1 + start, Math.min(all.length - 1, 1 + start + capacity)),
				all.at(-1)!,
			];
		const body = {
			render: (w: number) => Array.from({ length: rows }, (_, index) => {
				const line = visible[index] ?? "";
				return truncateToWidth(line, w, "", true);
			}),
			invalidate: () => editor.invalidate(),
			handleMouse: (event: MouseEvent) => {
				const y = rows < 3 ? event.y === 0 ? cursorRow : all.length - 1
					: event.y === 0 ? 0 : event.y === rows - 1 ? all.length - 1 : event.y + start;
				const result = (editor as Editor & { handleMouse?: (event: MouseEvent) => MouseResult | undefined })
					.handleMouse?.({ ...event, y });
				return result ? { handled: true } : undefined;
			},
		};
		return body;
	}

	render(width: number): string[] {
		const height = this.tui.terminal.rows;
		const backdrop = Array.from({ length: height }, () => " ".repeat(width));
		if (width < 12 || height < 7) {
			const warning = truncateToWidth("Resize terminal to read · Esc closes", width, "");
			if (height) backdrop[Math.floor(height / 2)] = warning.padEnd(width);
			this.panel = undefined;
			return backdrop;
		}
		this.panelWidth = Math.min(PANEL_WIDTH, width);
		this.panelHeight = Math.min(PANEL_HEIGHT, height);
		const contentWidth = this.panelWidth - 2;
		const bodyRows = this.panelHeight - 6;
		const state = this.controller.state();
		const doc = this.currentDoc();
		const current = this.mode === "list" ? undefined : this.currentPage(contentWidth, bodyRows);
		const section = current && doc ? doc.sections[current.sectionIndex] : undefined;
		const title = this.mode === "list" ? "Reader library"
			: `${this.mode === "note" ? "Note" : doc?.replyToFeedbackId ? "Reply" : "Reader"} · ${displayLabel(doc?.title ?? "")}`;
		const status = this.mode === "note" ? this.status : this.readingStatus();
		const subtitle = this.mode === "list" ? `${state.order.length} saved documents · latest at bottom`
			: current ? `Section ${current.sectionIndex + 1}/${doc?.sections.length} · ${displayLabel(section?.heading ?? "")}` : "";
		const detail = this.mode === "list" ? "─".repeat(contentWidth)
			: [current ? `Page ${current.sectionPage}/${current.sectionPages}` : "", status].filter(Boolean).join(" · ");
		const panel = new Box(1, 1, (text) => this.theme.bg("customMessageBg", text));
		panel.addChild(new Text(this.theme.fg("accent", this.theme.bold(truncateToWidth(title, contentWidth))), 0, 0));
		panel.addChild(new Text(truncateToWidth(subtitle, contentWidth), 0, 0));
		panel.addChild(new Text(this.theme.fg("muted", truncateToWidth(detail, contentWidth)), 0, 0));
		const body: Component = this.mode === "list" ? this.listBody(contentWidth, bodyRows)
			: this.mode === "note" ? this.noteBody(contentWidth, bodyRows)
			: { render: (w) => Array.from({ length: bodyRows }, (_, i) => {
				const line = current?.body[i] ?? "";
				return truncateToWidth(line, w, "", true);
			}), invalidate() {} };
		panel.addChild(body);
		panel.addChild(this.hintBar(contentWidth));
		const lines = panel.render(this.panelWidth);
		this.panel = panel;
		this.panelX = Math.floor((width - this.panelWidth) / 2);
		this.panelY = Math.floor((height - this.panelHeight) / 2);
		for (const [index, line] of lines.entries()) {
			if (index >= this.panelHeight) break;
			backdrop[this.panelY + index] = " ".repeat(this.panelX) + line + " ".repeat(width - this.panelX - this.panelWidth);
		}
		return backdrop;
	}

	handleMouse(event: MouseEvent): MouseResult | undefined {
		if (this.panel && event.x >= this.panelX && event.x < this.panelX + this.panelWidth
			&& event.y >= this.panelY && event.y < this.panelY + this.panelHeight) {
			const result = (this.panel as Box & { handleMouse?: (event: MouseEvent) => MouseResult | undefined })
				.handleMouse?.({
				...event,
				x: event.x - this.panelX,
				y: event.y - this.panelY,
				width: this.panelWidth,
				height: this.panelHeight,
			});
			if (result) return result;
		}
		// Capture the press as well as the synthesized click so the backdrop cannot
		// select the streaming transcript behind the reader.
		return { handled: true };
	}

	invalidate(): void { this.pageCache = undefined; this.panel?.invalidate(); this.editor?.invalidate(); }
}

const idSchema = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$" });
const sectionSchema = Type.Object({
	id: Type.Optional(idSchema),
	heading: Type.String({ minLength: 1, maxLength: 160 }),
	text: Type.String({ minLength: 1 }),
});
const documentSchema = Type.Object({
	title: Type.String({ minLength: 1, maxLength: 160 }),
	sections: Type.Array(sectionSchema, { minItems: 1 }),
	documentId: Type.Optional(idSchema),
	revision: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
	replyToFeedbackId: Type.Optional(idSchema),
});

type DocumentInput = {
	title: string;
	sections: Array<{ id?: string; heading: string; text: string }>;
	documentId?: string;
	revision?: number;
	replyToFeedbackId?: string;
	unlinkedFeedbackIds?: string[];
};

export default function pagedReader(pi: ExtensionAPI): void {
	let state = new ReaderState();
	let active: ReaderOverlay | undefined;
	let opening = false;
	let responseScope: { ids: Set<string>; otherInput: boolean } | undefined;
	let pendingFeedbackIds: string[] = [];
	let lastRunCompleted = false;

	const persist = (event: ReaderEvent) => {
		state.apply(event);
		pi.appendEntry(ENTRY_TYPE, event);
		if (event.kind === "document") active?.clearStatus();
		else active?.requestRender();
	};
	const dispatchFeedback = (feedback: Feedback): boolean => {
		const doc = state.documents.get(feedback.key);
		const section = doc?.sections.find((item) => item.id === feedback.sectionId);
		if (!doc || !section) return false;
		const context = [
			`Reader feedback ID: ${feedback.id}`,
			`Document ID: ${doc.id} · immutable revision: ${doc.revision}`,
			`Section ID: ${section.id} · heading: ${section.heading}`,
			"The complete original section and the user's note follow as JSON data:",
			JSON.stringify({ originalSectionText: section.text, note: feedback.note }),
			`Answer the note. For a paged response call reader_present with replyToFeedbackId: "${feedback.id}". A normal text response is also okay.`,
		].join("\n\n");
		try {
			pi.sendMessage({
				customType: FEEDBACK_TYPE,
				content: context,
				display: true,
				details: { feedbackId: feedback.id, heading: section.heading },
			}, { triggerTurn: true });
		} catch {
			persist({ kind: "feedback-status", id: feedback.id, status: "interrupted" });
			return false;
		}
		return true;
	};
	const send = (key: string, sectionId: string, note: string, retry: boolean, agentIdle: boolean): SendResult => {
		const doc = state.documents.get(key);
		if (!doc?.sections.some((section) => section.id === sectionId)) return "unavailable";
		if (!note.trim()) return "empty";
		const previous = state.latestFeedback(key, sectionId);
		if (retry) {
			if (!previous || !["unanswered", "interrupted"].includes(state.statuses.get(previous.id) ?? "")
				|| state.replies(previous.id).length) return "duplicate";
		} else if (previous?.note === note) return "duplicate";
		const feedback: Feedback = { id: randomUUID(), key, sectionId, note };
		persist({ kind: "feedback", feedback });
		if (!agentIdle || pendingFeedbackIds.length) {
			pendingFeedbackIds.push(feedback.id);
			return "queued";
		}
		return dispatchFeedback(feedback) ? "requested" : "unavailable";
	};
	const controller: ReaderController = { state: () => state, persist, send };

	const open = (ctx: ExtensionContext, initial: "read" | "list", key?: string) => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("Reader pages require interactive Pi; the documents are saved in this session.", "info");
			return;
		}
		if (!state.order.length) {
			ctx.ui.notify("No reader documents yet. Try /reader demo.", "info");
			return;
		}
		if (active) {
			if (initial === "list") active.showList();
			return;
		}
		if (opening) return;
		opening = true;
		let overlay: ReaderOverlay | undefined;
		void ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
			overlay = new ReaderOverlay(tui, theme, done, controller, () => ctx.isIdle(), initial, key);
			active = overlay;
			return overlay;
		}, {
			overlay: true,
			overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left" },
			onHandle: () => overlay?.maskInlineImages(),
		})
			.catch((error) => ctx.ui.notify(`Reader could not open: ${String(error)}`, "error"))
			.finally(() => { if (active === overlay) active = undefined; opening = false; });
	};

	const publish = (input: DocumentInput, ctx: ExtensionContext, autoOpen = true) => {
		if (!input.title.trim() || input.sections.some((section) => !section.heading.trim() || !section.text.trim())) {
			throw new Error("Reader title, headings, and section text cannot be blank");
		}
		if (input.replyToFeedbackId && !state.feedback.has(input.replyToFeedbackId)) {
			throw new Error(`Unknown reader feedback ID ${input.replyToFeedbackId} on this session branch`);
		}
		const sections = input.sections.map((section, index) => ({ id: section.id ?? `section-${index + 1}`, heading: section.heading, text: section.text }));
		if (new Set(sections.map((section) => section.id)).size !== sections.length) throw new Error("Reader section IDs must be unique within a document");
		const id = input.documentId ?? (input.replyToFeedbackId ? `reply-${input.replyToFeedbackId}` : randomUUID());
		const previous = state.order.map((key) => state.documents.get(key)!).filter((doc) => doc.id === id);
		const latest = previous.reduce<ReaderDocument | undefined>(
			(best, doc) => !best || doc.revision > best.revision ? doc : best, undefined,
		);
		const revision = input.revision ?? (latest?.revision ?? 0) + 1;
		const doc: ReaderDocument = {
			id, revision, title: input.title, sections,
			...(input.replyToFeedbackId ? { replyToFeedbackId: input.replyToFeedbackId } : {}),
			...(input.unlinkedFeedbackIds?.length ? { unlinkedFeedbackIds: input.unlinkedFeedbackIds } : {}),
		};
		const key = docKey(doc);
		const existing = state.documents.get(key);
		if (existing) {
			if (JSON.stringify(existing) !== JSON.stringify(doc)) throw new Error(`Reader document ${key} already exists; use a new revision`);
			return { doc: existing, created: false };
		}
		if (latest && !input.revision && JSON.stringify({ ...latest, revision: 0 }) === JSON.stringify({ ...doc, revision: 0 })) {
			return { doc: latest, created: false };
		}
		persist({ kind: "document", document: doc });
		if (autoOpen && !input.replyToFeedbackId) open(ctx, "read", key);
		return { doc, created: true };
	};

	pi.registerMessageRenderer(FEEDBACK_TYPE, (message, _options, theme) => {
		const heading = (message.details as { heading?: string } | undefined)?.heading ?? "section";
		return new Text(theme.fg("muted", `Reader feedback requested on ${displayLabel(heading)}`), 0, 0);
	});
	pi.registerTool({
		name: "reader_present",
		label: "Present Reader Document",
		description: "Publish a structured, sectioned explanation as bounded reader pages. For a response to section feedback, set replyToFeedbackId. Routine short replies can stay in chat.",
		promptSnippet: "Present long explanations as navigable reader pages when paced reading is useful",
		promptGuidelines: ["Use reader_present for requested long explanations or paced reading, not for every short reply. Set replyToFeedbackId when answering a reader section note."],
		parameters: documentSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!params.replyToFeedbackId && responseScope?.ids.size === 1 && !responseScope.otherInput) {
				throw new Error(`This turn is answering reader feedback ${[...responseScope.ids][0]}; set replyToFeedbackId so its reply appears on the original section.`);
			}
			// Mixed turns cannot be linked to one note; file them like the plain-text path.
			const unlinkedFeedbackIds = params.replyToFeedbackId ? undefined
				: [...(responseScope?.ids ?? [])].filter((id) => !state.replies(id).length);
			const { doc, created } = publish({ ...params, unlinkedFeedbackIds }, ctx);
			const text = `${created ? "Saved" : "Already saved"} reader document ${doc.id} revision ${doc.revision} (${doc.sections.length} sections). ${doc.replyToFeedbackId ? "Reply ready." : "Open with /reader."}`;
			return { content: [{ type: "text", text }], details: { documentId: doc.id, revision: doc.revision, replyToFeedbackId: doc.replyToFeedbackId } };
		},
		renderCall(args, theme) { return new Text(theme.fg("toolTitle", `Reader · ${args.title}`), 0, 0); },
		renderResult(result, _options, theme) {
			return new Text(theme.fg("muted", result.content.find((part) => part.type === "text")?.text ?? "Reader document saved"), 0, 0);
		},
	});
	pi.registerCommand("reader", {
		description: "Reopen the saved reader, list documents, or try a no-model demo (/reader demo)",
		handler: async (args, ctx) => {
			const action = args.trim();
			if (action === "demo") {
				publish({
					title: "A quiet reading example",
					sections: [
						{ heading: "One idea at a time", text: "This sample is saved in the session without calling a model. Right or Space moves forward; Left moves back. Nothing advances on a timer.\n\n- The header keeps the topic in view.\n- N opens a local section note.\n- Escape closes the reader at your place." },
						{ heading: "A longer section", text: Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}. Long sections continue over as many short pages as necessary. Narrowing the terminal never deletes the text or changes this section's saved note.`).join("\n\n") },
					],
				}, ctx);
				return;
			}
			if (action === "list") { open(ctx, "list"); return; }
			if (action) {
				ctx.ui.notify("Use /reader, /reader list, or /reader demo.", "warning");
				return;
			}
			open(ctx, "read");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		state = restoreReaderState(ctx.sessionManager.getBranch());
		state.markUnansweredAfterRestart();
		responseScope = undefined;
		pendingFeedbackIds = [];
		lastRunCompleted = false;
	});
	pi.on("session_tree", (_event, ctx) => {
		state = restoreReaderState(ctx.sessionManager.getBranch());
		state.markUnansweredAfterRestart();
		responseScope = undefined;
		pendingFeedbackIds = [];
		lastRunCompleted = false;
		if (state.order.length) {
			const key = state.lastKey ?? state.order.at(-1)!;
			persist({ kind: "cursor", key, anchor: state.cursors.get(key) ?? firstAnchor(state.documents.get(key)!) });
			active?.refreshBranch();
		} else active?.close(false);
	});
	pi.on("session_shutdown", () => {
		active?.close(false);
		active = undefined;
		opening = false;
		pendingFeedbackIds = [];
	});
	pi.on("agent_start", () => { lastRunCompleted = false; });
	pi.on("agent_end", (event) => {
		const final = [...event.messages].reverse().find((message) => message.role === "assistant");
		lastRunCompleted = final?.role === "assistant" && ["stop", "toolUse"].includes(final.stopReason);
	});
	pi.on("message_start", (event) => {
		const message = event.message;
		if (message.role !== "user" && message.role !== "custom") return;
		if (message.role === "custom" && message.customType === FEEDBACK_TYPE) {
			const id = (message.details as { feedbackId?: string } | undefined)?.feedbackId;
			if (id && state.feedback.has(id)) {
				responseScope ??= { ids: new Set(), otherInput: false };
				responseScope.ids.add(id);
				persist({ kind: "feedback-status", id, status: "entered" });
				return;
			}
		}
		responseScope ??= { ids: new Set(), otherInput: false };
		responseScope.otherInput = true;
	});
	pi.on("turn_end", (event, ctx) => {
		const message = event.message;
		if (message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted"
			|| message.stopReason === "deferred"
			|| event.toolResults.length
			|| message.content.some((part) => part.type === "toolCall")) return;
		const scope = responseScope;
		if (message.stopReason !== "length") responseScope = undefined;
		if (!scope?.ids.size) return;
		const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n\n").trim();
		if (!text) return;
		const ids = [...scope.ids];
		const unanswered = ids.filter((id) => !state.replies(id).length);
		if (unanswered.length === 1 && ids.length === 1 && !scope.otherInput && message.stopReason !== "length") {
			const feedback = state.feedback.get(unanswered[0])!;
			const heading = state.documents.get(feedback.key)?.sections.find((section) => section.id === feedback.sectionId)?.heading ?? "Section";
			publish({ title: `Reply to ${heading}`, sections: [{ heading: "Response", text }], replyToFeedbackId: feedback.id }, ctx, false);
		} else if (unanswered.length) {
			const doc: ReaderDocument = {
				id: randomUUID(), revision: 1,
				title: message.stopReason === "length" ? "Incomplete reader response" : "Unlinked reader response",
				sections: [{ id: "response", heading: "Response", text }],
				unlinkedFeedbackIds: unanswered,
				...(message.stopReason === "length" ? { incomplete: true } : {}),
			};
			persist({ kind: "document", document: doc });
		}
	});
	pi.on("agent_settled", () => {
		responseScope = undefined;
		const nextId = lastRunCompleted ? pendingFeedbackIds.shift() : undefined;
		if (!lastRunCompleted) {
			for (const id of pendingFeedbackIds.splice(0)) persist({ kind: "feedback-status", id, status: "interrupted" });
		}
		for (const [id, status] of state.statuses) {
			if (id !== nextId && !pendingFeedbackIds.includes(id) && status !== "unanswered" && status !== "interrupted"
				&& !state.replies(id).length) persist({ kind: "feedback-status", id, status: "unanswered" });
		}
		if (nextId) {
			lastRunCompleted = false;
			const feedback = state.feedback.get(nextId);
			if (!feedback || !dispatchFeedback(feedback)) {
				for (const id of pendingFeedbackIds.splice(0)) persist({ kind: "feedback-status", id, status: "interrupted" });
			}
		}
	});
}
