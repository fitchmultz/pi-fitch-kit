import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Editor, Text, truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import {
	displayLabel,
	docKey,
	type Feedback,
	type FeedbackStatus,
	type ReaderDocument,
	noteKey,
	type ReaderController,
	type ReaderState,
	type Section,
} from "./paged-reader-core.ts";
import type { ReaderPage } from "./paged-reader-pagination.ts";

/** Status line for one send outcome. */
export const sendStatus = (outcome: SendOutcome): string => {
	if (outcome === "requested" || outcome === "queued") {
		return "";
	}
	if (outcome === "duplicate") {
		return "Already requested · edit note to send again";
	}
	if (outcome === "empty") {
		return "Write a note first";
	}
	return "No saved reply · request not sent";
};

export type SendOutcome = "requested" | "queued" | "duplicate" | "empty" | "unavailable";

/** Status line for the note editor when it opens. */
export const noteStatus = (
	draft: string,
	previous: Feedback | undefined,
	previousStatus: FeedbackStatus | undefined,
	replyCount: number,
): string => {
	if (previous?.note !== draft) {
		return "Draft autosaved locally";
	}
	if (replyCount > 0) {
		return "Sent · reply saved";
	}
	if (previousStatus === "entered") {
		return "Sent to agent · awaiting reply";
	}
	if (previousStatus === "unanswered") {
		return "Sent request · no saved reply";
	}
	if (previousStatus === "interrupted") {
		return "Queued request canceled · not sent";
	}
	return "Queued for agent · awaiting reply";
};

/** Status line for a sent note that has no reply yet. */
export const noteAwaitStatus = (status: FeedbackStatus | undefined): string => {
	if (status === "unanswered") {
		return "No saved reply · T to retry deliberately";
	}
	if (status === "interrupted") {
		return "Queued request canceled · T to retry";
	}
	if (status === "entered") {
		return "Sent to agent · awaiting reply";
	}
	return "Queued for agent · awaiting reply";
};

/** The unlinked document that references the note, when one exists. */
export const unlinkedReplyFor = (state: ReaderState, note: Feedback): ReaderDocument | undefined =>
	state.order
		.map((key) => state.documents.get(key))
		.filter((doc): doc is ReaderDocument => doc !== undefined)
		.find((doc) => doc.unlinkedFeedbackIds?.includes(note.id) === true);

/** Status line for a section that already has a note. */
export const noteReadingStatus = (
	state: ReaderState,
	key: string,
	note: Feedback,
	sectionId: string,
): string => {
	const reply = state.latestReply(key, sectionId);
	if (
		reply !== undefined &&
		!state.readReplies.has(docKey(reply)) &&
		state.replies(note.id).length > 0
	) {
		return "Reply ready · R to read";
	}
	if (state.replies(note.id).length > 0) {
		return "Reply saved · R to reopen";
	}
	const unlinked = unlinkedReplyFor(state, note);
	if (unlinked !== undefined) {
		return `${unlinked.incomplete === true ? "Incomplete" : "Unlinked"} response in L List · T to retry`;
	}
	return noteAwaitStatus(state.statuses.get(note.id));
};

/** Status line for the reading view, before the note-specific cases. */
export const readingStatus = (
	status: string,
	state: ReaderState,
	key: string | undefined,
	section: Section | undefined,
): string => {
	if (status !== "") {
		return status;
	}
	if (key === undefined || section === undefined) {
		return "";
	}
	const note = state.latestFeedback(key, section.id);
	if (note === undefined) {
		return state.drafts.has(noteKey(key, section.id)) ? "Draft saved" : "";
	}
	return noteReadingStatus(state, key, note, section.id);
};

/** The panel title for the current mode. */
export const panelTitle = (
	mode: "read" | "list" | "note",
	doc: ReaderDocument | undefined,
): string => {
	if (mode === "list") {
		return "Reader library";
	}
	let kind = "Reader";
	if (mode === "note") {
		kind = "Note";
	} else if (doc?.replyToFeedbackId !== undefined) {
		kind = "Reply";
	}
	return `${kind} · ${displayLabel(doc?.title ?? "")}`;
};

/** Inputs for the panel subtitle. */
export type SubtitleInput = {
	mode: "read" | "list" | "note";
	orderLength: number;
	current: ReaderPage | undefined;
	doc: ReaderDocument | undefined;
	section: Section | undefined;
};

/** The panel subtitle for the current page. */
export const panelSubtitle = (input: SubtitleInput): string => {
	if (input.mode === "list") {
		return `${input.orderLength} saved documents · latest at bottom`;
	}
	if (input.current === undefined) {
		return "";
	}
	return `Section ${input.current.sectionIndex + 1}/${input.doc?.sections.length ?? 0} · ${displayLabel(
		input.section?.heading ?? "",
	)}`;
};

/** The panel detail line: page number and status. */
export const panelDetail = (
	mode: "read" | "list" | "note",
	current: ReaderPage | undefined,
	status: string,
	contentWidth: number,
): string => {
	if (mode === "list") {
		return "─".repeat(contentWidth);
	}
	const parts = [
		current === undefined ? "" : `Page ${current.sectionPage}/${current.sectionPages}`,
		status,
	];
	return parts.filter((part) => part !== "").join(" · ");
};

/** Renders the current reading page rows. */
export const pageBody = (current: ReaderPage | undefined, bodyRows: number): Component => ({
	render: (width: number) =>
		Array.from({ length: bodyRows }, (_, index) => {
			const line = current?.body[index] ?? "";
			return truncateToWidth(line, width, "", true);
		}),
	invalidate(): void {
		// Reading pages re-render from the page cache; there is nothing to invalidate.
	},
});

/** Inputs for the panel's header text components. */
export type HeaderInput = {
	theme: Theme;
	title: string;
	subtitle: string;
	detail: string;
	contentWidth: number;
};

/** Builds the panel's header text components. */
export const panelHeader = (input: HeaderInput): Component[] => [
	new Text(
		input.theme.fg("accent", input.theme.bold(truncateToWidth(input.title, input.contentWidth))),
		0,
		0,
	),
	new Text(truncateToWidth(input.subtitle, input.contentWidth), 0, 0),
	new Text(input.theme.fg("muted", truncateToWidth(input.detail, input.contentWidth)), 0, 0),
];

/** Inputs for creating a section's note editor. */
export type NoteEditorOptions = {
	tui: TUI;
	theme: Theme;
	controller: ReaderController;
	key: string;
	sectionId: string;
	onDraft: () => void;
};

/** Creates the note editor for a section, autosaving edits as drafts. */
export const noteEditor = (options: NoteEditorOptions): Editor => {
	const { tui, theme, controller, key, sectionId, onDraft } = options;
	const editor = new Editor(
		tui,
		{
			borderColor: (text) => theme.fg("border", text),
			selectList: getSelectListTheme(),
		},
		{ paddingX: 0 },
	);
	editor.disableSubmit = true;
	editor.setText(controller.state().drafts.get(noteKey(key, sectionId)) ?? "");
	editor.onChange = (text) => {
		if (controller.state().drafts.get(noteKey(key, sectionId)) !== text) {
			controller.persist({ kind: "draft", key, sectionId, text });
			onDraft();
		}
	};
	return editor;
};
