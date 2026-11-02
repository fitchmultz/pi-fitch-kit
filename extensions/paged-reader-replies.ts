import { randomUUID } from "node:crypto";
import type { ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";
import type {
	DocumentInput,
	Feedback,
	ReaderDocument,
	ReaderEvent,
	ReaderState,
} from "./paged-reader-core.ts";

/** Feedback ids a turn is responding to. */
export type ResponseScope = { ids: Set<string>; otherInput: boolean };

/** The final assistant message type for turn-end publishing. */
export type FinalMessage = Extract<TurnEndEvent["message"], { role: "assistant" }>;

/** Publishing dependencies for turn-end replies. */
export type ReplyDeps = {
	state: () => ReaderState;
	persist: (event: ReaderEvent) => void;
	publish: (input: DocumentInput, ctx: ExtensionContext, autoOpen?: boolean) => void;
};

/** The reply's plain text, joined and trimmed. */
const replyText = (message: FinalMessage): string =>
	message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n\n")
		.trim();

/** True when the whole turn answers exactly one note and can be linked to it. */
const soleUnanswered = (
	scope: ResponseScope,
	message: FinalMessage,
	unanswered: string[],
): boolean =>
	unanswered.length === 1 &&
	scope.ids.size === 1 &&
	!scope.otherInput &&
	message.stopReason !== "length";

/** The heading of the section a feedback note targets. */
const sectionHeading = (state: ReaderState, feedback: Feedback): string =>
	state.documents.get(feedback.key)?.sections.find((section) => section.id === feedback.sectionId)
		?.heading ?? "Section";

/** Publishes the reply as a linked reply document on the original section. */
const linkedReply = (deps: ReplyDeps, id: string, text: string, ctx: ExtensionContext): void => {
	const feedback = deps.state().feedback.get(id);
	if (feedback === undefined) {
		return;
	}
	deps.publish(
		{
			title: `Reply to ${sectionHeading(deps.state(), feedback)}`,
			sections: [{ heading: "Response", text }],
			replyToFeedbackId: feedback.id,
		},
		ctx,
		false,
	);
};

/** Publishes the reply as an unlinked document filed against the notes. */
const unlinkedReply = (deps: ReplyDeps, ids: string[], text: string, incomplete: boolean): void => {
	const doc: ReaderDocument = {
		id: randomUUID(),
		revision: 1,
		title: incomplete ? "Incomplete reader response" : "Unlinked reader response",
		sections: [{ id: "response", heading: "Response", text }],
		unlinkedFeedbackIds: ids,
		...(incomplete ? { incomplete: true } : {}),
	};
	deps.persist({ kind: "document", document: doc });
};

/** Files a final text reply against the notes the turn was answering. */
export const fileTurnReply = (
	deps: ReplyDeps,
	scope: ResponseScope,
	message: FinalMessage,
	ctx: ExtensionContext,
): void => {
	const text = replyText(message);
	const unanswered = [...scope.ids].filter((id) => deps.state().replies(id).length === 0);
	if (text === "" || unanswered.length === 0) {
		return;
	}
	if (soleUnanswered(scope, message, unanswered)) {
		const id = unanswered[0];
		if (id !== undefined) {
			linkedReply(deps, id, text, ctx);
		}
		return;
	}
	unlinkedReply(deps, unanswered, text, message.stopReason === "length");
};
