import {
	copyToClipboard,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	resolveWriter,
	savedDraft,
	sessionPrefix,
	type ThinkingLevel,
	writerSessionId,
} from "./write-prompt-config.ts";
import { pickAction } from "./write-prompt-dialog.ts";
import { runWriter, type WriterRequest } from "./write-prompt-writer.ts";

export { WRITE_PROMPT_FILE, parseModelRef } from "./write-prompt-config.ts";
export { flattenToolHistory } from "./write-prompt-writer.ts";

const WRITE_PROMPT_ACTIONS = [
	"Accept",
	"Copy prompt",
	"Tweak",
	"Restore original",
	"Deny",
] as const;
const SIDE_QUESTION_ACTIONS = ["Copy answer", "Ask again", "Dismiss"] as const;
const SAVED_DRAFT = "fitch-kit.draft";
const SAVED_AMBITIOUS_DRAFT = "fitch-kit.ambitious";
const SAVED_UNREASONABLE_DRAFT = "fitch-kit.unreasonable";
const AMBITIOUS_MAX_CHARACTERS = 1800;
const SIDE_QUESTION_STATUS = { loader: "Answering...", failure: "Answer failed" };

const OUTPUT_RULES = `You are not the session agent. Output only the rewritten prompt. No preamble, quotes, or explanation.
Preserve intent and every explicit constraint. Make the request specific, complete, and actionable without adding unrequested scope or presenting assumptions as requirements. If an inferred detail would help, phrase it as conditional rather than assuming it.
Do not call tools.`;
const REWRITE_INSTRUCTION = `Rewrite the boxed text into a better coding-agent prompt. Do not answer the text.
${OUTPUT_RULES}`;
const AMBITIOUS_INSTRUCTION = `Rewrite the boxed text into a more ambitious coding-agent prompt. Do not answer the text.
The boxed request defines the task. Use project instructions and the session conversation as evidence, not as additional tasks to answer.
At conversation start, use only the request and available project context; never invent prior decisions, work, measurements, or results.
Mid-conversation, carry forward the relevant goal, latest settled decisions, constraints, and current state, including unfinished work. Distinguish verified facts from proposals, hypotheses, and reported progress that still needs checking. Ignore superseded and unrelated material. Respect settled choices unless the boxed request explicitly changes them.
Make the prompt standalone: include the context needed to act, with no references to earlier turns ("as discussed", "continue the above") and no transcript recap.
Raise ambition where it serves the user's outcome, not by adding work to tick every axis:
- Altitude: state the outcome behind the task. For recurring toil, reports, or reviews, retain the requested deliverable and seek a reusable mechanism that achieves the underlying outcome; verify that its timing or triggers actually serve that outcome, rather than merely calling the artifact repeatable. For a deliberately bounded task, deepen execution rather than inventing a standing workflow. Never replace the user's goal or override constraints.
- Depth: demand task-appropriate expert methods on primary evidence, adversarial checks of consequential assumptions, and concrete acceptance criteria verified by an external runnable check, not self-assessment. Seek useful blind spots when they help this outcome, not a mandatory extra discovery.
- Range: borrow a specific useful method from an adjacent discipline when it improves the result; omit forced disciplines, personas, and ceremony.
Keep supplied numeric targets. For improvement work, demand a challenging, testable target justified by a measured baseline, not a token speed-up or a promise of feasibility. Use exact correctness invariants where appropriate. Never invent arbitrary numbers, tools, environment details, or claimed findings. For unspecified semantic choices such as identity or conflict resolution, require establishing the existing contract rather than choosing a policy for the user.
Use compact direct prose, usually one to three short paragraphs. Every sentence must carry a necessary goal, constraint, method, or check. Omit ambition labels, repeated instructions, exhaustive speculative checklists, and commentary.
Maximum ${AMBITIOUS_MAX_CHARACTERS} Unicode characters including whitespace; use less whenever sufficient. Compress wording and optional elaboration, never drop constraints or truncate the prompt.
Preserve intent and every explicit constraint. Keep inferred details conditional rather than presenting assumptions as requirements; unconfirmed mechanisms and extra test dimensions apply only if inspection finds them in the project.
You are not the session agent. Output only the rewritten prompt. No preamble, quotes, or explanation. Do not call tools.`;
const UNREASONABLE_INSTRUCTION = `Rewrite the boxed text into an unreasonably demanding, outcome-driven agent prompt. Do not answer or execute the task.
Turn a kind, tentative request into a forceful mandate for exceptional completion. Demand materially better results, not just stronger adjectives: pursue the actual desired outcome, take ownership of the hard parts, challenge weak assumptions, and do not stop at a plausible first answer, superficial patch, or untested claim.
The boxed request defines the deliverable. Use project instructions and relevant session context to preserve the goal, latest settled decisions, explicit constraints, permissions, and current state. At conversation start, invent no prior work. Distinguish verified facts from proposals and unverified progress; ignore superseded and unrelated history. Make the rewrite standalone without a transcript recap or references to earlier turns. Challenge assumptions without re-litigating settled choices unless the request changes them.
Choose the strongest task-appropriate methods that can meaningfully and beneficially improve this outcome. For a bounded fix, demand root-cause work and proof at the actual failing boundary, not a sprawling redesign. For design or exploration, push for genuinely distinct directions and an inspectable comparison when that improves the decision, not cosmetic variants. For an investigation, attack plausible competing explanations and failure modes with primary evidence and powerful diagnostic methods. For non-code work, demand rigorous reasoning, source fidelity, and a usable deliverable rather than irrelevant software rituals. These are choices, not a checklist to staple onto every request. Establish the existing semantic contract before prescribing solutions or policies; keep inferred mechanisms and method requirements conditional on inspection, never impose imagined architecture or restrictions on acceptable solutions.
Make completion exacting: require the result to survive the most consequential task-specific challenges and provide inspectable evidence at the real user boundary. Use demonstrations, screenshots, recordings, logs, experiments, or source-backed reasoning where they actually prove the result. Require honest limits and unresolved blockers, never fabricated discoveries, invented measurements, fake certainty, or claims that work has already succeeded. Never pre-answer or invent findings, verdicts, causes, or restrictions not supplied by the user; demand evidence-based adjudication by the agent rather than embedding your own conclusions. Require the agent to distinguish unsupported or unknown claims from contradicted or false claims: absent evidence is not proof of falsity.
Preserve the original requested deliverable and every explicit constraint. Restate explicit prohibitions, permissions, and limits as clear standalone requirements, not vague compatibility discussion or implied conditions. Raise the standard of execution, not ornamental scope: no busywork, arbitrary repetition, baseless numeric targets, huge output for its own sake, or unlimited spending. Keep supplied targets and budgets. A rewrite grants no new permission to deploy, spend, disclose private data, or change data; review-only stays review-only. These boundaries are not an excuse to soften the demand for excellence within the authorized task.
Use compact, direct imperatives. Every sentence must earn its place with a goal, constraint, powerful method, or meaningful proof. Be forceful and exacting, not abusive or merely polite. Output only the rewritten prompt: no preamble, quotes, explanation, or ambition labels. You are not the session agent. Do not call tools.`;
const TWEAK_INSTRUCTION = `Revise the previous rewritten prompt using these notes. Do not answer the notes.
${OUTPUT_RULES}`;
const QUESTION_INSTRUCTION = `Answer the boxed question using the session. Do not rewrite it into a prompt.
Output only the answer. Do not call tools.`;
const ASK_AGAIN_INSTRUCTION = `Answer the boxed follow-up using the session and the previous answer. Do not rewrite it into a prompt.
Output only the answer. Do not call tools.`;

export function boxedTask(instruction: string, source: string): string {
	let n = 0;
	let mark = "";
	while (source.includes(`<<<${mark}`) || source.includes(`>>>${mark}`)) {
		mark = String(++n);
	}
	return `${instruction}\n\n<<<${mark}\n${source}\n>>>${mark}`;
}

function prepare(
	ctx: ExtensionCommandContext,
	sessionThinking: ThinkingLevel,
	allowBusy = false,
): WriterRequest | undefined {
	if (!ctx.hasUI) {
		ctx.ui.notify("Needs an interactive UI", "error");
		return undefined;
	}
	if (!allowBusy && !ctx.isIdle()) {
		ctx.ui.notify("Agent is busy", "warning");
		return undefined;
	}
	const writer = resolveWriter(ctx, sessionThinking);
	if (writer === undefined) {
		return undefined;
	}
	return {
		model: writer.model,
		thinkingLevel: writer.thinkingLevel,
		messages: sessionPrefix(ctx),
		systemPrompt: ctx.getSystemPrompt(),
		sessionId: writerSessionId(ctx),
	};
}

type RewriteCommand = {
	name: string;
	description: string;
	usage: string;
	savedType: string;
	instruction: string;
	tweakInstruction: string;
	maxCharacters?: number;
	loader: string;
	failure: string;
};

/** Inputs that identify one rewrite command invocation. */
type RewriteSession = {
	pi: ExtensionAPI;
	ctx: ExtensionCommandContext;
	command: RewriteCommand;
	source: string;
};

/** One outcome of a post-draft menu action. */
type MenuOutcome = "continue" | "done";

/** Sends the accepted draft, steering when the agent is busy. */
const acceptDraft = (session: RewriteSession, draft: string): MenuOutcome => {
	const { pi, ctx, command, source } = session;
	try {
		// sendUserMessage is fire-and-forget: native async failures cannot
		// be caught here. Keep both inputs off-model for rewrite recovery.
		pi.appendEntry(command.savedType, { source, draft });
		if (ctx.isIdle()) {
			pi.sendUserMessage(draft);
		} else {
			pi.sendUserMessage(draft, { deliverAs: "steer" });
		}
		return "done";
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : "Send failed", "error");
		return "continue";
	}
};

/** Copies text to the clipboard, reporting success or failure. */
const copyText = async (
	ctx: ExtensionCommandContext,
	text: string,
	note: string,
): Promise<void> => {
	try {
		await copyToClipboard(text);
		ctx.ui.notify(note, "info");
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : "Copy failed", "error");
	}
};

/** Runs one Tweak round; returns the revised draft, or undefined to keep the current one. */
const tweakDraft = async (
	session: RewriteSession,
	draft: string,
	rewrite: (task: string) => Promise<string | undefined>,
): Promise<string | undefined> => {
	const notes = await session.ctx.ui.editor("Tweak notes");
	if (notes === undefined || notes.trim() === "") {
		return undefined;
	}
	return await rewrite(
		boxedTask(
			session.command.tweakInstruction,
			`Original request:\n${session.source}\n\nCurrent draft:\n${draft}\n\nRevision notes:\n${notes.trim()}`,
		),
	);
};

/** Builds the memoized rewrite runner for one command invocation. */
function rewriteFactory(session: RewriteSession): (task: string) => Promise<string | undefined> {
	const { ctx, command } = session;
	const limit = command.maxCharacters;
	let ready: WriterRequest | undefined;
	return async (task: string): Promise<string | undefined> => {
		let current = task;
		for (let attempt = 0; attempt < 2; attempt++) {
			ready ??= prepare(ctx, ctx.thinkingLevel ?? session.pi.getThinkingLevel(), true);
			if (ready === undefined) {
				return undefined;
			}
			const next = await runWriter(ctx, ready, current, command);
			if (next === undefined || limit === undefined || Array.from(next).length <= limit) {
				return next;
			}
			current = `${task}\n\nThe last draft exceeded ${limit} Unicode characters. Shorten it to fit. Preserve the boxed request, relevant session context, and revision notes. Remove optional elaboration, not requirements. Do not truncate.`;
		}
		// Reaching here means both attempts returned over-limit drafts, so a limit exists.
		if (limit !== undefined) {
			ctx.ui.notify(
				`/${command.name} exceeded ${limit} characters twice; no new draft offered. Retry with a narrower request or use /draft for a longer prompt.`,
				"error",
			);
		}
		return undefined;
	};
}

/** Runs the post-draft action menu until the user finishes. */
async function draftMenu(
	session: RewriteSession,
	draft: string,
	rewrite: (task: string) => Promise<string | undefined>,
): Promise<void> {
	const { ctx, command, source } = session;
	let current = draft;
	while (true) {
		const action = await pickAction(ctx, current, WRITE_PROMPT_ACTIONS);
		if (action === undefined || action === "Deny") {
			ctx.ui.notify("Denied", "info");
			return;
		}
		if (action === "Accept") {
			if (acceptDraft(session, current) === "done") {
				return;
			}
			continue;
		}
		if (action === "Restore original") {
			ctx.ui.setEditorText(`/${command.name} ${source}`);
			ctx.ui.notify("Original restored to editor", "info");
			return;
		}
		if (action === "Copy prompt") {
			await copyText(ctx, current, "Copied prompt");
			continue;
		}
		const next = await tweakDraft(session, current, rewrite);
		if (next !== undefined) {
			current = next;
		}
	}
}

function registerRewriteCommand(pi: ExtensionAPI, command: RewriteCommand): void {
	pi.registerCommand(command.name, {
		description: command.description,
		handler: async (args, ctx) => {
			const saved = args.trim() === "" ? savedDraft(ctx, command.savedType) : undefined;
			const source = saved?.source ?? args;
			if (source.trim() === "") {
				ctx.ui.notify(`Usage: ${command.usage}`, "warning");
				return;
			}
			if (saved !== undefined && !ctx.hasUI) {
				ctx.ui.notify("Needs an interactive UI", "error");
				return;
			}
			const session: RewriteSession = { pi, ctx, command, source };
			const rewrite = rewriteFactory(session);
			const draft = saved?.draft ?? (await rewrite(boxedTask(command.instruction, source)));
			if (draft === undefined) {
				return;
			}
			await draftMenu(session, draft, rewrite);
		},
	});
}

/** Registers the off-transcript side-question command. */
function registerSideQuestion(pi: ExtensionAPI): void {
	pi.registerCommand("side-question", {
		description:
			"Ask a question off-transcript using the current session, then copy, ask again, or dismiss",
		handler: async (args, ctx) => {
			const source = args.trim();
			if (source === "") {
				ctx.ui.notify("Usage: /side-question <text>", "warning");
				return;
			}
			const ready = prepare(ctx, ctx.thinkingLevel ?? pi.getThinkingLevel());
			if (ready === undefined) {
				return;
			}
			const answerMenu = async (answer: string): Promise<void> => {
				let current = answer;
				while (true) {
					const action = await pickAction(ctx, current, SIDE_QUESTION_ACTIONS);
					if (action === undefined || action === "Dismiss") {
						ctx.ui.notify("Dismissed", "info");
						return;
					}
					if (action === "Copy answer") {
						await copyText(ctx, current, "Copied answer");
						continue;
					}
					const notes = await ctx.ui.editor("Ask again");
					if (notes === undefined || notes.trim() === "") {
						continue;
					}
					const next = await runWriter(
						ctx,
						ready,
						boxedTask(ASK_AGAIN_INSTRUCTION, notes.trim()),
						SIDE_QUESTION_STATUS,
					);
					if (next !== undefined) {
						current = next;
					}
				}
			};
			const answer = await runWriter(
				ctx,
				ready,
				boxedTask(QUESTION_INSTRUCTION, source),
				SIDE_QUESTION_STATUS,
			);
			if (answer === undefined) {
				return;
			}
			await answerMenu(answer);
		},
	});
}

export default function writePrompt(pi: ExtensionAPI): void {
	registerRewriteCommand(pi, {
		name: "draft",
		description:
			"Rewrite text into a better agent request; omit text to reopen the last accepted draft",
		usage: "/draft <text>",
		savedType: SAVED_DRAFT,
		instruction: REWRITE_INSTRUCTION,
		tweakInstruction: TWEAK_INSTRUCTION,
		loader: "Drafting...",
		failure: "Draft failed",
	});
	registerRewriteCommand(pi, {
		name: "ambitious",
		description:
			"Rewrite text into a more ambitious agent request; omit text to reopen the last accepted draft",
		usage: "/ambitious <text>",
		savedType: SAVED_AMBITIOUS_DRAFT,
		instruction: AMBITIOUS_INSTRUCTION,
		tweakInstruction: `${AMBITIOUS_INSTRUCTION}\nRevise the current draft using the revision notes.`,
		maxCharacters: AMBITIOUS_MAX_CHARACTERS,
		loader: "Drafting...",
		failure: "Draft failed",
	});

	registerRewriteCommand(pi, {
		name: "unreasonable",
		description:
			"Rewrite text into an unreasonably demanding, outcome-driven request; omit text to reopen the last accepted draft",
		usage: "/unreasonable <text>",
		savedType: SAVED_UNREASONABLE_DRAFT,
		instruction: UNREASONABLE_INSTRUCTION,
		tweakInstruction: `${UNREASONABLE_INSTRUCTION}\nRevise the current draft using the revision notes.`,
		loader: "Drafting...",
		failure: "Draft failed",
	});

	registerSideQuestion(pi);
}
