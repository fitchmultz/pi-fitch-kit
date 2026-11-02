import { randomUUID } from "node:crypto";
import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionContext,
	MessageStartEvent,
	SessionEntry,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import {
	docKey,
	ENTRY_TYPE,
	firstAnchor,
	ReaderState,
	restoreReaderState,
	type DocumentInput,
	type Feedback,
	type ReaderController,
	type ReaderDocument,
	type ReaderEvent,
	type Section,
	type SendResult,
} from "./paged-reader-core.ts";
import { ReaderOverlay } from "./paged-reader-overlay.ts";
import {
	fileTurnReply,
	type FinalMessage,
	type ReplyDeps,
	type ResponseScope,
} from "./paged-reader-replies.ts";

export const FEEDBACK_TYPE = "fitch-paged-reader-feedback";

export type PublishResult = { doc: ReaderDocument; created: boolean };

/** The message type a message_start event carries. */
type StartMessage = MessageStartEvent["message"];

/** Reads one string field from an untrusted message-details object. */
export const detailText = (details: unknown, key: string): string | undefined => {
	if (typeof details !== "object" || details === null || !(key in details)) {
		return undefined;
	}
	const record: Record<string, unknown> = { ...details };
	const value: unknown = record[key];
	return typeof value === "string" ? value : undefined;
};

/** The document id for one publish. */
const resolveDocumentId = (input: DocumentInput): string =>
	input.documentId ??
	(input.replyToFeedbackId !== undefined ? `reply-${input.replyToFeedbackId}` : randomUUID());

/** Assigns default section ids where the input omitted them. */
const normalizeSections = (
	sections: ReadonlyArray<{ id?: string | undefined; heading: string; text: string }>,
): Section[] => {
	const normalized = sections.map((section, index) => ({
		id: section.id ?? `section-${index + 1}`,
		heading: section.heading,
		text: section.text,
	}));
	if (new Set(normalized.map((section) => section.id)).size !== normalized.length) {
		throw new Error("Reader section IDs must be unique within a document");
	}
	return normalized;
};

/** Rejects blank titles, headings, section text, and unknown feedback ids. */
const validateInput = (input: DocumentInput, state: ReaderState): void => {
	if (
		input.title.trim() === "" ||
		input.sections.some((section) => section.heading.trim() === "" || section.text.trim() === "")
	) {
		throw new Error("Reader title, headings, and section text cannot be blank");
	}
	if (input.replyToFeedbackId !== undefined && !state.feedback.has(input.replyToFeedbackId)) {
		throw new Error(`Unknown reader feedback ID ${input.replyToFeedbackId} on this session branch`);
	}
};

/** The highest-revision saved document with this id, if any. */
const latestRevision = (state: ReaderState, id: string): ReaderDocument | undefined => {
	let latest: ReaderDocument | undefined;
	for (const key of state.order) {
		const saved = state.documents.get(key);
		if (
			saved !== undefined &&
			saved.id === id &&
			(latest === undefined || saved.revision > latest.revision)
		) {
			latest = saved;
		}
	}
	return latest;
};

/** True when two revisions of a document carry the same content. */
const sameContent = (a: ReaderDocument, b: ReaderDocument): boolean =>
	JSON.stringify({ ...a, revision: 0 }) === JSON.stringify({ ...b, revision: 0 });

/** Assembles the immutable document for one publish. */
const buildDocument = (
	input: DocumentInput,
	sections: Section[],
	id: string,
	latest: ReaderDocument | undefined,
): ReaderDocument => ({
	id,
	revision: input.revision ?? (latest?.revision ?? 0) + 1,
	title: input.title,
	sections,
	...(input.replyToFeedbackId !== undefined ? { replyToFeedbackId: input.replyToFeedbackId } : {}),
	...(input.unlinkedFeedbackIds !== undefined && input.unlinkedFeedbackIds.length > 0
		? { unlinkedFeedbackIds: input.unlinkedFeedbackIds }
		: {}),
});

/** The result when the exact document is already saved, if any. */
const existingResult = (
	state: ReaderState,
	doc: ReaderDocument,
	key: string,
): PublishResult | undefined => {
	const existing = state.documents.get(key);
	if (existing === undefined) {
		return undefined;
	}
	if (JSON.stringify(existing) !== JSON.stringify(doc)) {
		throw new Error(`Reader document ${key} already exists; use a new revision`);
	}
	return { doc: existing, created: false };
};

/** The result when an earlier revision already has this content, if any. */
const contentResult = (
	input: DocumentInput,
	doc: ReaderDocument,
	latest: ReaderDocument | undefined,
): PublishResult | undefined => {
	if (input.revision !== undefined || latest === undefined || !sameContent(latest, doc)) {
		return undefined;
	}
	return { doc: latest, created: false };
};

/** True when the latest note for a section can be retried. */
const retryableNote = (state: ReaderState, previous: Feedback | undefined): boolean =>
	previous !== undefined &&
	["unanswered", "interrupted"].includes(state.statuses.get(previous.id) ?? "") &&
	state.replies(previous.id).length === 0;

/** True when a send would repeat an already-active note. */
const duplicateSend = (
	state: ReaderState,
	note: { key: string; sectionId: string; text: string; retry: boolean },
): boolean => {
	const previous = state.latestFeedback(note.key, note.sectionId);
	if (note.retry) {
		return !retryableNote(state, previous);
	}
	return previous?.note === note.text;
};

/** The final assistant message of a turn, when it is a plain text reply. */
const finalTextMessage = (event: TurnEndEvent): FinalMessage | undefined => {
	const message = event.message;
	if (
		message.role !== "assistant" ||
		message.stopReason === "error" ||
		message.stopReason === "aborted" ||
		message.stopReason === "deferred" ||
		event.toolResults.length > 0 ||
		message.content.some((part) => part.type === "toolCall")
	) {
		return undefined;
	}
	return message;
};

/** The runtime surface the entry extension wires to Pi. */
export type ReaderRuntime = {
	state: () => ReaderState;
	publish: (input: DocumentInput, ctx: ExtensionContext, autoOpen?: boolean) => PublishResult;
	open: (ctx: ExtensionContext, initial: "read" | "list", key?: string) => void;
	/** The single feedback id this turn is answering, when unambiguous. */
	soleFeedbackId: () => string | undefined;
	/** Unanswered feedback ids this turn touched, for unlinked filing. */
	unlinkedIds: () => string[];
	resetForBranch: (entries: readonly SessionEntry[]) => void;
	refreshBranch: (ctx: ExtensionContext) => void;
	handleShutdown: () => void;
	handleAgentStart: () => void;
	handleAgentEnd: (event: AgentEndEvent) => void;
	handleMessageStart: (event: MessageStartEvent) => void;
	handleTurnEnd: (event: TurnEndEvent, ctx: ExtensionContext) => void;
	handleAgentSettled: () => void;
};

/** Mutable reader session state plus the Pi wiring the entry extension uses. */
export class RuntimeSession implements ReaderRuntime {
	private readonly pi: ExtensionAPI;
	private reader = new ReaderState();
	private active: ReaderOverlay | undefined;
	private opening = false;
	private responseScope: ResponseScope | undefined;
	private pendingFeedbackIds: string[] = [];
	private lastRunCompleted = false;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	state(): ReaderState {
		return this.reader;
	}

	persist(event: ReaderEvent): void {
		this.reader.apply(event);
		this.pi.appendEntry(ENTRY_TYPE, event);
		if (event.kind === "document") {
			this.active?.clearStatus();
		} else {
			this.active?.requestRender();
		}
	}

	/** Sends one feedback note to the agent as a custom message. */
	private dispatchFeedback(feedback: Feedback): boolean {
		const doc = this.reader.documents.get(feedback.key);
		const section = doc?.sections.find((item) => item.id === feedback.sectionId);
		if (doc === undefined || section === undefined) {
			return false;
		}
		const context = [
			`Reader feedback ID: ${feedback.id}`,
			`Document ID: ${doc.id} · immutable revision: ${doc.revision}`,
			`Section ID: ${section.id} · heading: ${section.heading}`,
			"The complete original section and the user's note follow as JSON data:",
			JSON.stringify({ originalSectionText: section.text, note: feedback.note }),
			`Answer the note. For a paged response call reader_present with replyToFeedbackId: "${feedback.id}". A normal text response is also okay.`,
		].join("\n\n");
		try {
			this.pi.sendMessage(
				{
					customType: FEEDBACK_TYPE,
					content: context,
					display: true,
					details: { feedbackId: feedback.id, heading: section.heading },
				},
				{ triggerTurn: true },
			);
		} catch {
			this.persist({ kind: "feedback-status", id: feedback.id, status: "interrupted" });
			return false;
		}
		return true;
	}

	/** Sends or queues one note from the overlay. */
	private sendFeedback(note: {
		key: string;
		sectionId: string;
		text: string;
		retry: boolean;
		agentIdle: boolean;
	}): SendResult {
		const doc = this.reader.documents.get(note.key);
		if (doc === undefined || !doc.sections.some((section) => section.id === note.sectionId)) {
			return "unavailable";
		}
		if (note.text.trim() === "") {
			return "empty";
		}
		if (duplicateSend(this.reader, note)) {
			return "duplicate";
		}
		const feedback: Feedback = {
			id: randomUUID(),
			key: note.key,
			sectionId: note.sectionId,
			note: note.text,
		};
		this.persist({ kind: "feedback", feedback });
		if (!note.agentIdle || this.pendingFeedbackIds.length > 0) {
			this.pendingFeedbackIds.push(feedback.id);
			return "queued";
		}
		return this.dispatchFeedback(feedback) ? "requested" : "unavailable";
	}

	/** The controller the overlay reads state and persists events through. */
	private controller(): ReaderController {
		return {
			state: () => this.reader,
			persist: (event) => this.persist(event),
			send: (note) => this.sendFeedback(note),
		};
	}

	/** Opens the fullscreen reader overlay and tracks its lifetime. */
	private async openOverlay(
		ctx: ExtensionContext,
		initial: "read" | "list",
		key: string | undefined,
	): Promise<void> {
		let overlay: ReaderOverlay | undefined;
		try {
			await ctx.ui.custom<null>(
				(tui, theme, _keybindings, done) => {
					overlay = new ReaderOverlay({
						tui,
						theme,
						done: () => done(null),
						controller: this.controller(),
						isAgentIdle: () => ctx.isIdle(),
						initial,
						key,
					});
					this.active = overlay;
					return overlay;
				},
				{
					overlay: true,
					overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left" },
					onHandle: () => overlay?.maskInlineImages(),
				},
			);
		} finally {
			if (this.active === overlay) {
				this.active = undefined;
			}
			this.opening = false;
		}
	}

	open(ctx: ExtensionContext, initial: "read" | "list", key?: string): void {
		if (ctx.mode !== "tui") {
			ctx.ui.notify(
				"Reader pages require interactive Pi; the documents are saved in this session.",
				"info",
			);
			return;
		}
		if (this.reader.order.length === 0) {
			ctx.ui.notify("No reader documents yet. Try /reader demo.", "info");
			return;
		}
		if (this.active !== undefined) {
			if (initial === "list") {
				this.active.showList();
			}
			return;
		}
		if (this.opening) {
			return;
		}
		this.opening = true;
		// Report reader open failures without blocking the command that opened it.
		void this.openOverlay(ctx, initial, key).catch((error: unknown) => {
			ctx.ui.notify(`Reader could not open: ${String(error)}`, "error");
		});
	}

	publish(input: DocumentInput, ctx: ExtensionContext, autoOpen = true): PublishResult {
		validateInput(input, this.reader);
		const sections = normalizeSections(input.sections);
		const id = resolveDocumentId(input);
		const latest = latestRevision(this.reader, id);
		const doc = buildDocument(input, sections, id, latest);
		const saved =
			existingResult(this.reader, doc, docKey(doc)) ?? contentResult(input, doc, latest);
		if (saved !== undefined) {
			return saved;
		}
		this.persist({ kind: "document", document: doc });
		if (autoOpen && doc.replyToFeedbackId === undefined) {
			this.open(ctx, "read", docKey(doc));
		}
		return { doc, created: true };
	}

	/** The turn's response scope, created on first touch. */
	private ensureScope(): ResponseScope {
		this.responseScope ??= { ids: new Set(), otherInput: false };
		return this.responseScope;
	}

	handleMessageStart(event: MessageStartEvent): void {
		const message = event.message;
		if (message.role !== "user" && message.role !== "custom") {
			return;
		}
		const feedback = this.customFeedbackId(message);
		if (feedback !== undefined) {
			const scope = this.ensureScope();
			scope.ids.add(feedback);
			this.persist({ kind: "feedback-status", id: feedback, status: "entered" });
			return;
		}
		this.ensureScope().otherInput = true;
	}

	/** The feedback id a custom feedback message carries, when valid. */
	private customFeedbackId(message: StartMessage): string | undefined {
		if (message.role !== "custom" || message.customType !== FEEDBACK_TYPE) {
			return undefined;
		}
		const id = detailText(message.details, "feedbackId");
		return id !== undefined && this.reader.feedback.has(id) ? id : undefined;
	}

	handleTurnEnd(event: TurnEndEvent, ctx: ExtensionContext): void {
		const message = finalTextMessage(event);
		if (message === undefined) {
			return;
		}
		const scope = this.responseScope;
		if (message.stopReason !== "length") {
			this.responseScope = undefined;
		}
		if (scope !== undefined && scope.ids.size > 0) {
			fileTurnReply(this.replyDeps(), scope, message, ctx);
		}
	}

	/** The reply-publishing dependencies. */
	private replyDeps(): ReplyDeps {
		return {
			state: () => this.reader,
			persist: (event) => this.persist(event),
			publish: (input, ctx, autoOpen) => this.publish(input, ctx, autoOpen),
		};
	}

	handleAgentSettled(): void {
		this.responseScope = undefined;
		const nextId = this.lastRunCompleted ? this.pendingFeedbackIds.shift() : undefined;
		if (!this.lastRunCompleted) {
			this.markPendingInterrupted();
		}
		this.markStaleUnanswered(nextId);
		if (nextId !== undefined) {
			this.lastRunCompleted = false;
			this.dispatchNext(nextId);
		}
	}

	/** Marks every queued note interrupted after a failed run. */
	private markPendingInterrupted(): void {
		for (const id of this.pendingFeedbackIds.splice(0)) {
			this.persist({ kind: "feedback-status", id, status: "interrupted" });
		}
	}

	/** Marks entered notes with no reply and no pending dispatch unanswered. */
	private markStaleUnanswered(nextId: string | undefined): void {
		for (const [id, status] of this.reader.statuses) {
			if (this.staleStatus(id, status, nextId)) {
				this.persist({ kind: "feedback-status", id, status: "unanswered" });
			}
		}
	}

	/** True when an entered note is stale, undipatched, and has no reply. */
	private staleStatus(id: string, status: string, nextId: string | undefined): boolean {
		return (
			id !== nextId &&
			!this.pendingFeedbackIds.includes(id) &&
			status !== "unanswered" &&
			status !== "interrupted" &&
			this.reader.replies(id).length === 0
		);
	}

	/** Dispatches the next queued note, or interrupts the queue on failure. */
	private dispatchNext(nextId: string): void {
		const feedback = this.reader.feedback.get(nextId);
		if (feedback === undefined || !this.dispatchFeedback(feedback)) {
			this.markPendingInterrupted();
		}
	}

	resetForBranch(entries: readonly SessionEntry[]): void {
		this.reader = restoreReaderState(entries);
		this.reader.markUnansweredAfterRestart();
		this.responseScope = undefined;
		this.pendingFeedbackIds = [];
		this.lastRunCompleted = false;
	}

	refreshBranch(ctx: ExtensionContext): void {
		this.resetForBranch(ctx.sessionManager.getBranch());
		if (this.reader.order.length > 0) {
			const key = this.reader.lastKey ?? this.reader.order.at(-1);
			const doc = key !== undefined ? this.reader.documents.get(key) : undefined;
			if (key !== undefined && doc !== undefined) {
				this.persist({
					kind: "cursor",
					key,
					anchor: this.reader.cursors.get(key) ?? firstAnchor(doc),
				});
			}
			this.active?.refreshBranch();
		} else {
			this.active?.close(false);
		}
	}

	handleShutdown(): void {
		this.active?.close(false);
		this.active = undefined;
		this.opening = false;
		this.pendingFeedbackIds = [];
	}

	handleAgentStart(): void {
		this.lastRunCompleted = false;
	}

	handleAgentEnd(event: AgentEndEvent): void {
		const final = [...event.messages].reverse().find((message) => message.role === "assistant");
		this.lastRunCompleted =
			final?.role === "assistant" && ["stop", "toolUse"].includes(final.stopReason);
	}

	soleFeedbackId(): string | undefined {
		if (
			this.responseScope === undefined ||
			this.responseScope.ids.size !== 1 ||
			this.responseScope.otherInput
		) {
			return undefined;
		}
		return [...this.responseScope.ids][0];
	}

	unlinkedIds(): string[] {
		return [...(this.responseScope?.ids ?? [])].filter(
			(id) => this.reader.replies(id).length === 0,
		);
	}
}

/** Creates the reader runtime session for one Pi extension instance. */
export const createReaderRuntime = (pi: ExtensionAPI): ReaderRuntime => new RuntimeSession(pi);
