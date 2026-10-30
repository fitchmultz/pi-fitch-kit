import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clampThinkingLevel, contentText, type Message, type UserMessage } from "@earendil-works/pi-ai";
import {
	BorderedLoader,
	buildSessionContext,
	convertToLlm,
	copyToClipboard,
	DynamicBorder,
	getAgentDir,
	keyHint,
	rawKeyHint,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getKeybindings, SelectList, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { fitClaudeRequest, prepareClaudeImages, sharedImageCache } from "./anthropic-image-guard.ts";

export const WRITE_PROMPT_FILE = "write-prompt.json";
const WRITE_PROMPT_ACTIONS = ["Accept", "Copy prompt", "Tweak", "Restore original", "Deny"] as const;
const SIDE_QUESTION_ACTIONS = ["Copy answer", "Ask again", "Dismiss"] as const;
const SAVED_DRAFT = "fitch-kit.draft";
const SAVED_AMBITIOUS_DRAFT = "fitch-kit.ambitious";
const SAVED_UNREASONABLE_DRAFT = "fitch-kit.unreasonable";
const AMBITIOUS_MAX_CHARACTERS = 1800;

function savedDraft(ctx: ExtensionCommandContext, customType: string): { source: string; draft: string } | undefined {
	for (const entry of ctx.sessionManager.getBranch().toReversed()) {
		if (entry.type !== "custom" || entry.customType !== customType) continue;
		const data = entry.data;
		if (data && typeof data === "object" && "source" in data && "draft" in data
			&& typeof data.source === "string" && typeof data.draft === "string") {
			return { source: data.source, draft: data.draft };
		}
	}
}

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
- Altitude: state the outcome behind the task. For recurring toil, reports, or reviews, retain the requested deliverable and seek a reusable mechanism that achieves the underlying outcome; verify that its timing or triggers actually serve that outcome, rather than merely calling the artifact repeatable. For a deliberately bounded task, deepen execution rather than invent a standing workflow. Never replace the user's goal or override constraints.
- Depth: demand task-appropriate expert methods on primary evidence, adversarial checks of consequential assumptions, and concrete acceptance criteria verified by an external runnable check, not self-assessment. Seek useful blind spots when they help this outcome, not a mandatory extra discovery.
- Range: borrow a specific useful method from an adjacent discipline when it improves the result; omit forced disciplines, personas, and ceremony.
Keep supplied numeric targets. For improvement work, demand a challenging, testable target justified by a measured baseline, not a token speed-up or a promise of feasibility. Use exact correctness invariants where appropriate. Never invent arbitrary numbers, tools, environment details, or claimed findings. For unspecified semantic choices such as identity or conflict resolution, require establishing the existing contract rather than choosing a policy for the user.
Use compact direct prose, usually one to three short paragraphs. Every sentence must carry a necessary goal, constraint, method, or check. Omit ambition labels, repeated instructions, exhaustive speculative checklists, and commentary.
Maximum ${AMBITIOUS_MAX_CHARACTERS} Unicode characters including whitespace; use less whenever sufficient. Compress wording and optional elaboration, never drop constraints or truncate the prompt.
Preserve intent and every explicit constraint. Keep inferred details conditional rather than presenting assumptions as requirements; unconfirmed mechanisms and extra test dimensions apply only if inspection finds them in the project.
You are not the session agent. Output only the rewritten prompt. No preamble, quotes, or explanation. Do not call tools.`;
const UNREASONABLE_INSTRUCTION = `Rewrite the boxed text into an unreasonably demanding, outcome-driven agent prompt. Do not answer or execute the task.
Turn a kind, tentative request into a forceful mandate for exceptional completion. Demand materially better results, not just stronger adjectives: pursue the actual desired outcome, take ownership of the hard parts, challenge weak assumptions, and do not stop at a plausible first answer, superficial patch, or untested claim.
The boxed request defines the deliverable. Use project instructions and relevant session context to preserve the goal, latest settled decisions, explicit constraints, permissions, and current state. At conversation start, invent no prior work. Distinguish verified facts from proposals and unverified progress; ignore superseded or unrelated history. Make the rewrite standalone without a transcript recap or references to earlier turns. Challenge assumptions without re-litigating settled choices unless the request changes them.
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

export function parseModelRef(ref: string): { provider: string; id: string } | undefined {
	const trimmed = ref.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) return undefined;
	return { provider: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
}

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
type WriterConfig = { provider?: string; model?: string; thinkingLevel?: ThinkingLevel };

function configuredWriter(raw: string): WriterConfig {
	const value: unknown = JSON.parse(raw);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Expected an object with optional provider, model, and thinkingLevel fields");
	}
	const fields = value as Record<string, unknown>;
	for (const key of Object.keys(fields)) {
		if (!["provider", "model", "thinkingLevel"].includes(key)) throw new Error(`Unknown field: ${key}`);
	}
	const config: WriterConfig = {};
	for (const key of ["provider", "model"] as const) {
		if (!(key in fields)) continue;
		const text = fields[key];
		if (typeof text !== "string" || !text.trim()) throw new Error(`${key} must be a non-empty string`);
		config[key] = text.trim();
	}
	if ("thinkingLevel" in fields) {
		const level = THINKING_LEVELS.find((level) => level === fields.thinkingLevel);
		if (!level) throw new Error(`thinkingLevel must be one of: ${THINKING_LEVELS.join(", ")}`);
		config.thinkingLevel = level;
	}
	return config;
}

function readWriterConfig(): WriterConfig {
	try {
		return configuredWriter(readFileSync(join(getAgentDir(), WRITE_PROMPT_FILE), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

function resolveWriter(ctx: ExtensionCommandContext, sessionThinking: ThinkingLevel) {
	try {
		const config = readWriterConfig();
		const legacy = config.provider === undefined && config.model ? parseModelRef(config.model) : undefined;
		const provider = config.provider ?? legacy?.provider ?? ctx.model?.provider;
		const id = legacy?.id ?? config.model ?? ctx.model?.id;
		const override = config.provider !== undefined || config.model !== undefined;
		if (override && (!provider || !id)) throw new Error("Set both provider and model when no session model is selected");
		const model = override && provider && id ? ctx.modelRegistry.find(provider, id) : ctx.model;
		if (!model) throw new Error(override ? `Unknown model: ${provider}/${id}` : "No model selected");
		if (override && !ctx.modelRegistry.hasConfiguredAuth(model)) {
			throw new Error(`No auth for ${model.provider}/${model.id}; configure it with /login`);
		}
		const requested = config.thinkingLevel ?? sessionThinking;
		const thinkingLevel = clampThinkingLevel(model, requested);
		if (thinkingLevel !== requested) {
			ctx.ui.notify(`${model.provider}/${model.id} does not support ${requested} thinking; using ${thinkingLevel}`, "warning");
		}
		if (override || config.thinkingLevel !== undefined) {
			ctx.ui.notify(`Using ${model.provider}/${model.id} (${thinkingLevel} thinking)`, "info");
		}
		return { model, thinkingLevel };
	} catch (error) {
		ctx.ui.notify(`${WRITE_PROMPT_FILE}: ${error instanceof Error ? error.message : String(error)}`, "error");
		return undefined;
	}
}

function sessionPrefix(ctx: ExtensionCommandContext): Message[] {
	return convertToLlm(
		buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages,
	);
}

// One provider session per Pi session keeps prompt-cache affinity and accounting
// across writer commands: resume keeps it, new and forked sessions change it.
// Hashing keeps writer traffic out of the main agent's provider session, and the
// fixed-length UUID survives native 64-character cache-key clamping.
function writerSessionId(ctx: ExtensionCommandContext): string {
	const bytes = createHash("sha256").update(`fitch-kit.writer:${ctx.sessionManager.getSessionId()}`).digest();
	bytes[6] = (bytes[6]! & 0x0f) | 0x80;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString("hex", 0, 16);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function flattenToolHistory(messages: Message[]): Message[] {
	const out: Message[] = [];
	for (const message of messages) {
		// Current instructions come from getSystemPrompt(), once. Transcript hosts
		// also retain historical system messages with tool declarations; those are
		// not conversation and must not enable tools in this off-transcript writer.
		if (message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult") continue;
		if (message.role === "toolResult") {
			const label = message.isError ? `${message.toolName} error` : `${message.toolName} result`;
			out.push({
				role: "user",
				content: [{ type: "text", text: `[${label}]` }, ...message.content],
				timestamp: message.timestamp,
			});
			continue;
		}
		if (message.role === "assistant" && Array.isArray(message.content)) {
			const parts = message.content.filter((part) => part.type !== "toolCall");
			const calls = message.content
				.filter((part) => part.type === "toolCall")
				.map((part) => {
					const args = part.arguments;
					const extra = args && Object.keys(args).length ? ` ${JSON.stringify(args)}` : "";
					return `${part.name}${extra}`;
				});
			if (calls.length) parts.push({ type: "text", text: `[called ${calls.join(", ")}]` });
			out.push({
				...message,
				content: parts.length ? parts : [{ type: "text", text: "[empty]" }],
			});
			continue;
		}
		// Image preparation replaces only message.content; a shallow copy keeps history intact.
		out.push({ ...message });
	}
	return out;
}

async function completeWriter(
	ctx: ExtensionCommandContext,
	model: NonNullable<ExtensionCommandContext["model"]>,
	thinkingLevel: ThinkingLevel,
	systemPrompt: string,
	messages: Message[],
	userText: string,
	sessionId: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const pending: UserMessage = {
		role: "user",
		content: [{ type: "text", text: userText }],
		timestamp: Date.now(),
	};
	const outgoing = flattenToolHistory([...messages, pending]);
	await prepareClaudeImages(model, outgoing, sharedImageCache());
	if (signal?.aborted) return undefined;
	const context = { systemPrompt, messages: outgoing };
	const options = {
		signal, cacheRetention: "short" as const, sessionId,
		reasoning: thinkingLevel === "off" ? undefined : thinkingLevel,
		onPayload: (payload: unknown) => fitClaudeRequest(model, payload, sharedImageCache()),
	};
	const response = await ctx.modelRegistry.streamSimple(model, context, options).result();
	if (response.stopReason === "aborted") return undefined;
	if (response.stopReason !== "stop") {
		ctx.ui.notify(response.errorMessage ?? `Writer stopped (${response.stopReason})`, "error");
		return undefined;
	}
	const text = contentText(response.content).trim();
	if (!text) {
		ctx.ui.notify("Writer returned no text", "error");
		return undefined;
	}
	messages.push(pending, response);
	return text;
}

async function runWriter(
	ctx: ExtensionCommandContext,
	model: NonNullable<ExtensionCommandContext["model"]>,
	thinkingLevel: ThinkingLevel,
	systemPrompt: string,
	messages: Message[],
	userText: string,
	sessionId: string,
	loader: string,
	failed: string,
): Promise<string | undefined> {
	if (ctx.mode === "tui") {
		return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
			const view = new BorderedLoader(tui, theme, loader);
			view.onAbort = () => done(undefined);
			completeWriter(ctx, model, thinkingLevel, systemPrompt, messages, userText, sessionId, view.signal)
				.then(done)
				.catch((error: unknown) => {
					if (view.signal.aborted) return;
					ctx.ui.notify(error instanceof Error ? error.message : failed, "error");
					done(undefined);
				});
			return view;
		});
	}
	try {
		return await completeWriter(ctx, model, thinkingLevel, systemPrompt, messages, userText, sessionId, ctx.signal);
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : failed, "error");
		return undefined;
	}
}

function pickAction(ctx: ExtensionCommandContext, draft: string, actions: readonly string[]) {
	if (ctx.mode !== "tui") return ctx.ui.select(draft, [...actions]);
	return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
		// The dialog must stay fully readable in small terminals: the draft is
		// clipped to the viewport and scrolled with PageUp/PageDown instead of
		// being cut off by the TUI with no way back. Select keys are unchanged.
		const topBorder = new DynamicBorder((s) => theme.fg("border", s));
		const bottomBorder = new DynamicBorder((s) => theme.fg("border", s));
		const draftText = new Text(theme.fg("text", draft), 1, 0);
		const scrollHint = new Text(theme.fg("muted", ""), 1, 0);
		const spacer = new Spacer(1);
		const list = new SelectList(
			actions.map((value) => ({ value, label: value })),
			actions.length,
			{
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("muted", text),
				noMatch: (text) => theme.fg("muted", text),
			},
		);
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(undefined);
		const hints = new Text(
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
		const children = [topBorder, draftText, scrollHint, spacer, list, hints, bottomBorder];
		// The dialog renders inside the TUI's editor dock slot below the chat
		// transcript (minimum one line) and the footer (two lines built-in,
		// up to about four with extension statuses). The slot height is not
		// queryable, so the budget reserves for those dock-mates; if a footer
		// ever exceeds the reserve, the bottom border is the first line lost.
		const DOCK_RESERVE = 5;
		let scrollTop = 0;
		let viewportLines = 1;
		let contentLines = 0;
		const scrollPage = (direction: 1 | -1) => {
			const step = Math.max(1, viewportLines);
			scrollTop = Math.max(0, Math.min(Math.max(0, contentLines - viewportLines), scrollTop + direction * step));
			tui.requestRender();
		};
		return {
			render: (width: number) => {
				const rows = Number.isFinite(tui.terminal.rows) ? tui.terminal.rows : Number.POSITIVE_INFINITY;
				const content = draftText.render(width);
				contentLines = content.length;
				const chrome = [
					...topBorder.render(width),
					...spacer.render(width),
					...list.render(width),
					...spacer.render(width),
					...hints.render(width),
					...bottomBorder.render(width),
				];
				const free = rows - chrome.length - (Number.isFinite(rows) ? DOCK_RESERVE : 0);
				if (!Number.isFinite(free) || content.length <= free) {
					// Everything fits (or no viewport is reported): original layout.
					viewportLines = Number.isFinite(free) ? Math.max(1, free) : content.length;
					scrollTop = 0;
					return [chrome[0], ...content, ...chrome.slice(1)];
				}
				// One line of the free budget goes to the position indicator.
				// It is truncated to a single line so it can never wrap and
				// push the render past the budget on narrow terminals.
				viewportLines = Math.max(1, free - 1);
				scrollTop = Math.min(scrollTop, content.length - viewportLines);
				const above = scrollTop;
				const below = content.length - scrollTop - viewportLines;
				const indicator = `${above > 0 ? `↑ ${above} line${above === 1 ? "" : "s"} above · ` : ""}${below > 0 ? `↓ ${below} line${below === 1 ? "" : "s"} below · ` : ""}${rawKeyHint("PgUp/PgDn", "scroll")}`;
				scrollHint.setText(
					theme.fg("muted", truncateToWidth(indicator, Math.max(1, width - 2), "")),
				);
				return [
					chrome[0],
					...content.slice(scrollTop, scrollTop + viewportLines),
					...scrollHint.render(width),
					...chrome.slice(1),
				];
			},
			invalidate: () => {
				for (const child of children) child.invalidate();
			},
			handleInput: (data: string) => {
				const kb = getKeybindings();
				if (kb.matches(data, "tui.select.pageUp")) return scrollPage(-1);
				if (kb.matches(data, "tui.select.pageDown")) return scrollPage(1);
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

function prepare(ctx: ExtensionCommandContext, sessionThinking: ThinkingLevel, allowBusy = false) {
	if (!ctx.hasUI) {
		ctx.ui.notify("Needs an interactive UI", "error");
		return;
	}
	if (!allowBusy && !ctx.isIdle()) {
		ctx.ui.notify("Agent is busy", "warning");
		return;
	}
	const writer = resolveWriter(ctx, sessionThinking);
	if (!writer) return;
	return {
		...writer,
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

function registerRewriteCommand(pi: ExtensionAPI, command: RewriteCommand): void {
	pi.registerCommand(command.name, {
		description: command.description,
		handler: async (args, ctx) => {
			const saved = args.trim() ? undefined : savedDraft(ctx, command.savedType);
			const source = saved?.source ?? args;
			if (!source.trim()) {
				ctx.ui.notify(`Usage: ${command.usage}`, "warning");
				return;
			}
			if (saved && !ctx.hasUI) {
				ctx.ui.notify("Needs an interactive UI", "error");
				return;
			}
			let ready: ReturnType<typeof prepare>;
			const rewrite = async (task: string) => {
				ready ??= prepare(ctx, ctx.thinkingLevel ?? pi.getThinkingLevel(), true);
				if (!ready) return;
				const { model, thinkingLevel, messages, systemPrompt, sessionId } = ready;
				const originalTask = task;
				for (let attempt = 0; attempt < 2; attempt++) {
					const next = await runWriter(ctx, model, thinkingLevel, systemPrompt, messages, task, sessionId, command.loader, command.failure);
					if (!next || !command.maxCharacters || [...next].length <= command.maxCharacters) return next;
					task = `${originalTask}\n\nThe last draft exceeded ${command.maxCharacters} Unicode characters. Shorten it to fit. Preserve the boxed request, relevant session context, and revision notes. Remove optional elaboration, not requirements. Do not truncate.`;
				}
				ctx.ui.notify(`/${command.name} exceeded ${command.maxCharacters} characters twice; no new draft offered. Retry with a narrower request or use /draft for a longer prompt.`, "error");
			};
			let draft = saved?.draft ?? await rewrite(boxedTask(command.instruction, source));
			if (!draft) return;

			while (true) {
				const action = await pickAction(ctx, draft, WRITE_PROMPT_ACTIONS);
				if (!action || action === "Deny") {
					ctx.ui.notify("Denied", "info");
					return;
				}
				if (action === "Accept") {
					try {
					// sendUserMessage is fire-and-forget: native async failures cannot
					// be caught here. Keep both inputs off-model for rewrite recovery.
					pi.appendEntry(command.savedType, { source, draft });
					if (ctx.isIdle()) pi.sendUserMessage(draft);
					else pi.sendUserMessage(draft, { deliverAs: "steer" });
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : "Send failed", "error");
					continue;
				}
				return;
				}
				if (action === "Restore original") {
					ctx.ui.setEditorText(`/${command.name} ${source}`);
					ctx.ui.notify("Original restored to editor", "info");
					return;
				}
				if (action === "Copy prompt") {
					try {
						await copyToClipboard(draft);
						ctx.ui.notify("Copied prompt", "info");
					} catch (error) {
						ctx.ui.notify(error instanceof Error ? error.message : "Copy failed", "error");
					}
					continue;
				}

				const notes = await ctx.ui.editor("Tweak notes");
				if (!notes?.trim()) continue;
				const next = await rewrite(
					boxedTask(command.tweakInstruction, `Original request:\n${source}\n\nCurrent draft:\n${draft}\n\nRevision notes:\n${notes.trim()}`),
				);
				if (!next) continue;
				draft = next;
			}
		},
	});
}

export default function writePrompt(pi: ExtensionAPI): void {
	registerRewriteCommand(pi, {
		name: "draft",
		description: "Rewrite text into a better agent request; omit text to reopen the last accepted draft",
		usage: "/draft <text>",
		savedType: SAVED_DRAFT,
		instruction: REWRITE_INSTRUCTION,
		tweakInstruction: TWEAK_INSTRUCTION,
		loader: "Drafting...",
		failure: "Draft failed",
	});
	registerRewriteCommand(pi, {
		name: "ambitious",
		description: "Rewrite text into a more ambitious agent request; omit text to reopen the last accepted draft",
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
		description: "Rewrite text into an unreasonably demanding, outcome-driven request; omit text to reopen the last accepted draft",
		usage: "/unreasonable <text>",
		savedType: SAVED_UNREASONABLE_DRAFT,
		instruction: UNREASONABLE_INSTRUCTION,
		tweakInstruction: `${UNREASONABLE_INSTRUCTION}\nRevise the current draft using the revision notes.`,
		loader: "Drafting...",
		failure: "Draft failed",
	});

	pi.registerCommand("side-question", {
		description: "Ask a question off-transcript using the current session, then copy, ask again, or dismiss",
		handler: async (args, ctx) => {
			const source = args.trim();
			if (!source) {
				ctx.ui.notify("Usage: /side-question <text>", "warning");
				return;
			}
			const ready = prepare(ctx, ctx.thinkingLevel ?? pi.getThinkingLevel());
			if (!ready) return;
			const { model, thinkingLevel, messages, systemPrompt, sessionId } = ready;
			let answer = await runWriter(
				ctx,
				model,
				thinkingLevel,
				systemPrompt,
				messages,
				boxedTask(QUESTION_INSTRUCTION, source),
				sessionId,
				"Answering...",
				"Answer failed",
			);
			if (!answer) return;

			while (true) {
				const action = await pickAction(ctx, answer, SIDE_QUESTION_ACTIONS);
				if (!action || action === "Dismiss") {
					ctx.ui.notify("Dismissed", "info");
					return;
				}
				if (action === "Copy answer") {
					try {
						await copyToClipboard(answer);
						ctx.ui.notify("Copied answer", "info");
					} catch (error) {
						ctx.ui.notify(error instanceof Error ? error.message : "Copy failed", "error");
					}
					continue;
				}
				const notes = await ctx.ui.editor("Ask again");
				if (!notes?.trim()) continue;
				const next = await runWriter(
					ctx,
					model,
					thinkingLevel,
					systemPrompt,
					messages,
					boxedTask(ASK_AGAIN_INSTRUCTION, notes.trim()),
					sessionId,
					"Answering...",
					"Answer failed",
				);
				if (!next) continue;
				answer = next;
			}
		},
	});
}
