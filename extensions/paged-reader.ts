import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { displayLabel, type DocumentInput } from "./paged-reader-core.ts";
import {
	createReaderRuntime,
	detailText,
	FEEDBACK_TYPE,
	type ReaderRuntime,
} from "./paged-reader-runtime.ts";

export { restoreReaderState } from "./paged-reader-core.ts";
export { paginateDocument } from "./paged-reader-pagination.ts";
export type { ReaderDocument } from "./paged-reader-core.ts";
export type { ReaderPage } from "./paged-reader-pagination.ts";

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

/** The no-model demo document /reader demo publishes. */
const demoDocument = (): DocumentInput => ({
	title: "A quiet reading example",
	sections: [
		{
			heading: "One idea at a time",
			text: "This sample is saved in the session without calling a model. Right or Space moves forward; Left moves back. Nothing advances on a timer.\n\n- The header keeps the topic in view.\n- N opens a local section note.\n- Escape closes the reader at your place.",
		},
		{
			heading: "A longer section",
			text: Array.from(
				{ length: 12 },
				(_, i) =>
					`Paragraph ${i + 1}. Long sections continue over as many short pages as necessary. Narrowing the terminal never deletes the text or changes this section's saved note.`,
			).join("\n\n"),
		},
	],
});

/** Renders the custom feedback message Pi streams for a note. */
const registerFeedbackRenderer = (pi: ExtensionAPI): void => {
	pi.registerMessageRenderer(FEEDBACK_TYPE, (message, _options, theme) => {
		const heading = detailText(message.details, "heading") ?? "section";
		return new Text(
			theme.fg("muted", `Reader feedback requested on ${displayLabel(heading)}`),
			0,
			0,
		);
	});
};

/** Registers the reader_present tool. */
const registerReaderTool = (pi: ExtensionAPI, runtime: ReaderRuntime): void => {
	pi.registerTool({
		name: "reader_present",
		label: "Present Reader Document",
		description:
			"Publish a structured, sectioned explanation as bounded reader pages. For a response to section feedback, set replyToFeedbackId. Routine short replies can stay in chat.",
		promptSnippet:
			"Present long explanations as navigable reader pages when paced reading is useful",
		promptGuidelines: [
			"Use reader_present for requested long explanations or paced reading, not for every short reply. Set replyToFeedbackId when answering a reader section note.",
		],
		parameters: documentSchema,
		// oxlint-disable-next-line eslint/max-params -- QX-001: Pi's documented five-parameter tool execute callback.
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const sole = params.replyToFeedbackId !== undefined ? undefined : runtime.soleFeedbackId();
			if (sole !== undefined) {
				throw new Error(
					`This turn is answering reader feedback ${sole}; set replyToFeedbackId so its reply appears on the original section.`,
				);
			}
			// Mixed turns cannot be linked to one note; file them like the plain-text path.
			const unlinkedFeedbackIds =
				params.replyToFeedbackId !== undefined ? undefined : runtime.unlinkedIds();
			const { doc, created } = runtime.publish({ ...params, unlinkedFeedbackIds }, ctx);
			const text = `${created ? "Saved" : "Already saved"} reader document ${doc.id} revision ${doc.revision} (${doc.sections.length} sections). ${doc.replyToFeedbackId !== undefined ? "Reply ready." : "Open with /reader."}`;
			return {
				content: [{ type: "text", text }],
				details: {
					documentId: doc.id,
					revision: doc.revision,
					replyToFeedbackId: doc.replyToFeedbackId,
				},
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", `Reader · ${args.title}`), 0, 0);
		},
		renderResult(result, _options, theme) {
			return new Text(
				theme.fg(
					"muted",
					result.content.find((part) => part.type === "text")?.text ?? "Reader document saved",
				),
				0,
				0,
			);
		},
	});
};

/** Registers the /reader command. */
const registerReaderCommand = (pi: ExtensionAPI, runtime: ReaderRuntime): void => {
	pi.registerCommand("reader", {
		description: "Reopen the saved reader, list documents, or try a no-model demo (/reader demo)",
		handler: async (args, ctx) => {
			const action = args.trim();
			if (action === "demo") {
				runtime.publish(demoDocument(), ctx);
				return;
			}
			if (action === "list") {
				runtime.open(ctx, "list");
				return;
			}
			if (action !== "") {
				ctx.ui.notify("Use /reader, /reader list, or /reader demo.", "warning");
				return;
			}
			runtime.open(ctx, "read");
		},
	});
};

/** Wires the reader runtime to Pi's session and agent lifecycle events. */
const registerReaderEvents = (pi: ExtensionAPI, runtime: ReaderRuntime): void => {
	pi.on("session_start", (_event, ctx) => {
		runtime.resetForBranch(ctx.sessionManager.getBranch());
	});
	pi.on("session_tree", (_event, ctx) => {
		runtime.refreshBranch(ctx);
	});
	pi.on("session_shutdown", () => {
		runtime.handleShutdown();
	});
	pi.on("agent_start", () => {
		runtime.handleAgentStart();
	});
	pi.on("agent_end", (event) => {
		runtime.handleAgentEnd(event);
	});
	pi.on("message_start", (event) => {
		runtime.handleMessageStart(event);
	});
	pi.on("turn_end", (event, ctx) => {
		runtime.handleTurnEnd(event, ctx);
	});
	pi.on("agent_settled", () => {
		runtime.handleAgentSettled();
	});
};

export default function pagedReader(pi: ExtensionAPI): void {
	const runtime = createReaderRuntime(pi);
	registerFeedbackRenderer(pi);
	registerReaderTool(pi, runtime);
	registerReaderCommand(pi, runtime);
	registerReaderEvents(pi, runtime);
}
