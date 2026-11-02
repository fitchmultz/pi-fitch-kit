import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

export const ENTRY_TYPE = "fitch-paged-reader";

export const displayBody = (text: string): string =>
	stripTerminalSequences(text.replace(/\r\n?/g, "\n")).replace(
		/[\u0000-\u0008\u000b-\u001f\u007f]/g,
		"",
	);
export const displayLabel = (text: string): string => displayBody(text).replace(/\s+/g, " ").trim();

export type Section = { id: string; heading: string; text: string };
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
export type Feedback = { id: string; key: string; sectionId: string; note: string };
export type FeedbackStatus = "requested" | "entered" | "unanswered" | "interrupted";
export type ReaderEvent =
	| { kind: "document"; document: ReaderDocument }
	| { kind: "cursor"; key: string; anchor: ReaderAnchor }
	| { kind: "draft"; key: string; sectionId: string; text: string }
	| { kind: "feedback"; feedback: Feedback }
	| { kind: "feedback-status"; id: string; status: FeedbackStatus }
	| { kind: "reply-read"; key: string };

export const docKey = (doc: ReaderDocument): string => `${doc.id}@${doc.revision}`;
export const noteKey = (key: string, sectionId: string): string => `${key}/${sectionId}`;
export const firstAnchor = (doc: ReaderDocument): ReaderAnchor => ({
	sectionId: doc.sections[0]?.id ?? "",
	line: 0,
	column: 0,
});

/** True when the value is a string. */
const isString = (value: unknown): boolean => typeof value === "string";

/** True when the value is a safe non-negative integer. */
const safeNonNegative = (value: unknown): boolean =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Validates an untrusted section payload. */
const isSection = (value: unknown): value is Section =>
	typeof value === "object" &&
	value !== null &&
	"id" in value &&
	isString(value.id) &&
	"heading" in value &&
	isString(value.heading) &&
	"text" in value &&
	isString(value.text);

/** Validates an untrusted document's scalar fields. */
const hasDocumentScalars = (value: object): boolean =>
	"id" in value &&
	isString(value.id) &&
	"revision" in value &&
	typeof value.revision === "number" &&
	Number.isSafeInteger(value.revision) &&
	value.revision >= 1;

/** Validates an untrusted document event payload before it enters reader state. */
const isReaderDocument = (value: unknown): value is ReaderDocument => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	if (!hasDocumentScalars(value) || !("title" in value) || typeof value.title !== "string") {
		return false;
	}
	if (!("sections" in value) || !Array.isArray(value.sections)) {
		return false;
	}
	return value.sections.length > 0 && value.sections.every(isSection);
};

export class ReaderState {
	readonly documents = new Map<string, ReaderDocument>();
	readonly order: string[] = [];
	readonly cursors = new Map<string, ReaderAnchor>();
	readonly drafts = new Map<string, string>();
	readonly feedback = new Map<string, Feedback>();
	readonly statuses = new Map<string, FeedbackStatus>();
	readonly readReplies = new Set<string>();
	lastKey: string | undefined;
	private readonly notesBySection = new Map<string, Feedback[]>();
	private readonly repliesByFeedback = new Map<string, ReaderDocument[]>();

	apply(event: ReaderEvent): void {
		switch (event.kind) {
			case "document":
				this.applyDocument(event.document);
				break;
			case "cursor":
				this.applyCursor(event);
				break;
			case "draft":
				this.applyDraft(event);
				break;
			case "feedback":
				this.applyFeedback(event.feedback);
				break;
			case "feedback-status":
				this.applyFeedbackStatus(event);
				break;
			case "reply-read":
				this.applyReplyRead(event);
				break;
		}
	}

	latestFeedback(key: string, sectionId: string): Feedback | undefined {
		return this.notesBySection.get(noteKey(key, sectionId))?.at(-1);
	}

	replies(id: string): ReaderDocument[] {
		return [...(this.repliesByFeedback.get(id) ?? [])];
	}

	latestReply(key: string, sectionId: string): ReaderDocument | undefined {
		const notes = [...(this.notesBySection.get(noteKey(key, sectionId)) ?? [])].reverse();
		for (const note of notes) {
			const unread = this.replies(note.id).findLast((doc) => !this.readReplies.has(docKey(doc)));
			if (unread !== undefined) {
				return unread;
			}
		}
		for (const note of notes) {
			const latest = this.replies(note.id).at(-1);
			if (latest !== undefined) {
				return latest;
			}
		}
		return undefined;
	}

	markUnansweredAfterRestart(): void {
		for (const id of this.feedback.keys()) {
			if (this.replies(id).length === 0 && this.statuses.get(id) !== "interrupted") {
				this.statuses.set(id, "unanswered");
			}
		}
	}

	private applyDocument(document: unknown): void {
		if (!isReaderDocument(document)) {
			return;
		}
		const key = docKey(document);
		if (this.documents.has(key)) {
			return;
		}
		this.documents.set(key, document);
		this.order.push(key);
		const replyId = document.replyToFeedbackId;
		if (replyId !== undefined) {
			const replies = this.repliesByFeedback.get(replyId) ?? [];
			replies.push(document);
			this.repliesByFeedback.set(replyId, replies);
		}
	}

	private applyCursor(event: Extract<ReaderEvent, { kind: "cursor" }>): void {
		if (
			isCursorAnchor(event.anchor) &&
			hasSection(this.documents, event.key, event.anchor.sectionId)
		) {
			this.cursors.set(event.key, event.anchor);
			this.lastKey = event.key;
		}
	}

	private applyDraft(event: Extract<ReaderEvent, { kind: "draft" }>): void {
		if (typeof event.text === "string" && hasSection(this.documents, event.key, event.sectionId)) {
			this.drafts.set(noteKey(event.key, event.sectionId), event.text);
		}
	}

	private applyFeedback(feedback: unknown): void {
		if (
			!isFeedback(feedback) ||
			!hasSection(this.documents, feedback.key, feedback.sectionId) ||
			this.feedback.has(feedback.id)
		) {
			return;
		}
		this.feedback.set(feedback.id, feedback);
		const key = noteKey(feedback.key, feedback.sectionId);
		const notes = this.notesBySection.get(key) ?? [];
		notes.push(feedback);
		this.notesBySection.set(key, notes);
		this.statuses.set(feedback.id, "requested");
	}

	private applyFeedbackStatus(event: Extract<ReaderEvent, { kind: "feedback-status" }>): void {
		if (this.feedback.has(event.id) && FEEDBACK_STATUS_SET.has(event.status)) {
			this.statuses.set(event.id, event.status);
		}
	}

	private applyReplyRead(event: Extract<ReaderEvent, { kind: "reply-read" }>): void {
		if (this.documents.has(event.key)) {
			this.readReplies.add(event.key);
		}
	}
}

/** True when the key's document contains the section. */
const hasSection = (
	documents: ReadonlyMap<string, ReaderDocument>,
	key: string,
	sectionId: string,
): boolean => {
	const doc = documents.get(key);
	return doc !== undefined && doc.sections.some((section) => section.id === sectionId);
};

/** Validates an untrusted cursor anchor. */
const isCursorAnchor = (value: unknown): value is ReaderAnchor =>
	typeof value === "object" &&
	value !== null &&
	"sectionId" in value &&
	isString(value.sectionId) &&
	"line" in value &&
	safeNonNegative(value.line) &&
	"column" in value &&
	safeNonNegative(value.column);

/** Validates an untrusted feedback event payload. */
const isFeedback = (value: unknown): value is Feedback =>
	typeof value === "object" &&
	value !== null &&
	"id" in value &&
	isString(value.id) &&
	"key" in value &&
	isString(value.key) &&
	"sectionId" in value &&
	isString(value.sectionId) &&
	"note" in value &&
	isString(value.note);

export const FEEDBACK_STATUSES = ["requested", "entered", "unanswered", "interrupted"] as const;

export type SendResult = "requested" | "queued" | "duplicate" | "empty" | "unavailable";

/** One document publish request, as validated by the tool schema. */
export type DocumentInput = {
	title: string;
	sections: Array<{ id?: string | undefined; heading: string; text: string }>;
	documentId?: string | undefined;
	revision?: number | undefined;
	replyToFeedbackId?: string | undefined;
	unlinkedFeedbackIds?: string[] | undefined;
};

/** Everything the overlay needs from its host session. */
export type ReaderController = {
	state: () => ReaderState;
	persist: (event: ReaderEvent) => void;
	send: (note: {
		key: string;
		sectionId: string;
		text: string;
		retry: boolean;
		agentIdle: boolean;
	}) => SendResult;
};
const FEEDBACK_STATUS_SET: ReadonlySet<FeedbackStatus> = new Set(FEEDBACK_STATUSES);

/** Per-kind payload validators for untrusted persisted events. */
const EVENT_VALIDATORS: Readonly<Record<string, (value: object) => boolean>> = {
	document: (value) => "document" in value && isReaderDocument(value.document),
	cursor: (value) =>
		"key" in value && isString(value.key) && "anchor" in value && isCursorAnchor(value.anchor),
	draft: (value) =>
		"key" in value &&
		isString(value.key) &&
		"sectionId" in value &&
		isString(value.sectionId) &&
		"text" in value &&
		isString(value.text),
	feedback: (value) => "feedback" in value && isFeedback(value.feedback),
	"feedback-status": (value) =>
		"id" in value &&
		isString(value.id) &&
		"status" in value &&
		isString(value.status) &&
		FEEDBACK_STATUSES.some((status) => status === value.status),
	"reply-read": (value) => "key" in value && isString(value.key),
};

/** Recognizes a persisted reader event from an untrusted session entry payload. */
export const isReaderEvent = (value: unknown): value is ReaderEvent => {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	if (!("kind" in value) || typeof value.kind !== "string") {
		return false;
	}
	const validate = EVENT_VALIDATORS[value.kind];
	return validate !== undefined && validate(value);
};

export function restoreReaderState(entries: readonly SessionEntry[]): ReaderState {
	const state = new ReaderState();
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
			const data: unknown = entry.data;
			if (isReaderEvent(data)) {
				state.apply(data);
			}
		}
	}
	return state;
}
