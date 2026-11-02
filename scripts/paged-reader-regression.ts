import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	discoverAndLoadExtensions,
	getMarkdownTheme,
	initTheme,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import * as tuiApi from "@earendil-works/pi-tui";
import {
	CURSOR_MARKER,
	getKeybindings,
	Markdown,
	stripTerminalSequences,
	TuiAltScreen,
	TuiMainScreen,
	visibleWidth,
	type OverlayHandle,
	type ProgramStatus,
	type Terminal as TerminalInterface,
} from "@earendil-works/pi-tui";
import {
	commandFor,
	drivenCommands,
	drivenHandlers,
	gate,
	isRecord,
	requireRecord,
	soleExtension,
	toolContextFrom,
	toolFor,
} from "./test-harness.ts";
import { paginateDocument, restoreReaderState } from "../extensions/paged-reader.ts";

const root = mkdtempSync(join(tmpdir(), "pi-reader-regression-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
initTheme("dark");
const nativeMouse = typeof tuiApi.MouseRegion === "function";
/** The host-selected pi-tui surface this regression drives. */
type HostTui = Pick<
	typeof tuiApi,
	"getCapabilities" | "setCapabilities" | "Container" | "Image" | "TuiAltScreen"
>;
const isHostTui = (module: unknown): module is HostTui =>
	typeof module === "object" &&
	module !== null &&
	"getCapabilities" in module &&
	"setCapabilities" in module &&
	"Container" in module &&
	"Image" in module &&
	"TuiAltScreen" in module;
const hostTuiModule: unknown = await import(
	pathToFileURL(
		createRequire(import.meta.resolve("@earendil-works/pi-coding-agent")).resolve(
			"@earendil-works/pi-tui",
		),
	).href
);
if (!isHostTui(hostTuiModule)) {
	throw new Error("host pi-tui did not expose the expected surface");
}
const hostTui = hostTuiModule;

class Terminal implements TerminalInterface {
	columns = 100;
	rows = 28;
	kittyProtocolActive = false;
	inputHandler: ((data: string) => void) | undefined;
	writes: string[] = [];
	start(onInput: (data: string) => void, _onResize: () => void) {
		this.inputHandler = onInput;
	}
	stop() {
		this.inputHandler = undefined;
	}
	restoreOnExit(_before: string, _after: string) {
		return;
	}
	async drainInput(_maxMs?: number, _idleMs?: number) {
		return;
	}
	write(data: string) {
		this.writes.push(data);
	}
	hideCursor() {
		return;
	}
	showCursor() {
		return;
	}
	clearLine() {
		return;
	}
	clearFromCursor() {
		return;
	}
	clearScreen() {
		return;
	}
	moveBy(_lines: number) {
		return;
	}
	setTitle(_title: string) {
		return;
	}
	setProgress(_active: boolean) {
		return;
	}
	setProgramStatus(_status: ProgramStatus) {
		return;
	}
	input(data: string) {
		assert.ok(this.inputHandler !== undefined, "native TUI input route is active");
		this.inputHandler(data);
	}
	mouseClick(x: number, y: number) {
		this.input(`\x1b[<0;${x + 1};${y + 1}M`);
		this.input(`\x1b[<0;${x + 1};${y + 1}m`);
	}
}
const terminal = new Terminal();
let tui: TuiAltScreen | TuiMainScreen = new TuiAltScreen(terminal);
tui.start();
const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

/** A reader overlay component as this regression drives it. */
type ReaderComponent = {
	render: (width: number) => string[];
	handleInput?: (data: string) => void;
	invalidate: () => void;
	dispose?: () => void;
	focused?: boolean;
	close?: (interactive: boolean) => void;
};

/** The widget factory the reader hands to ui.custom, typed at the fixture boundary. */
type ReaderFactory = (
	tui: unknown,
	theme: unknown,
	keybindings: unknown,
	onDone: () => void,
) => ReaderComponent;

/** The custom-dialog options the reader passes along. */
type ReaderCustomOptions = {
	overlayOptions?: Parameters<TuiAltScreen["showOverlay"]>[1];
	onHandle?: (handle: OverlayHandle) => void;
};

let overlay: ReaderComponent | undefined;
/** The latest overlay a custom callback created, if any, read across a call boundary. */
const latestOverlay = (): ReaderComponent | undefined => overlay;
let handle: OverlayHandle | undefined;
const ui = {
	notify() {
		return;
	},
	custom(factory: ReaderFactory, options: ReaderCustomOptions) {
		let finish: () => void = () => {
			throw new Error("custom dialog finished before construction");
		};
		const promise = new Promise<void>((resolve) => {
			finish = () => {
				resolve();
			};
		});
		const component = factory(tui, theme, getKeybindings(), () => {
			handle?.hide();
			component.dispose?.();
			if (overlay === component) {
				overlay = undefined;
			}
			finish();
		});
		handle = tui.showOverlay(component, options.overlayOptions);
		options.onHandle?.(handle);
		overlay = component;
		tui.renderNow();
		return promise;
	},
};
const session = SessionManager.create(root, join(root, "sessions"));
session.appendMessage(fauxAssistantMessage("Reader test baseline"));
const sessionFile = session.getSessionFile();
assert.ok(
	sessionFile !== undefined && sessionFile !== "",
	"file-backed session must exist before reader publication on official Pi",
);
let currentSession = session;
const mockIdle = true;
const ctx = () => ({
	mode: "tui",
	hasUI: true,
	ui,
	sessionManager: currentSession,
	isIdle: () => mockIdle,
});
const sent: Array<{ message: unknown; options: unknown }> = [];
const loaded = await discoverAndLoadExtensions(
	[fileURLToPath(new URL("../extensions/paged-reader.ts", import.meta.url))],
	root,
	root,
);
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
const extension = soleExtension(loaded);
const readerTool = toolFor(extension, "reader_present");
const readerCommand = commandFor(drivenCommands(extension), "reader");
const handlers = drivenHandlers(extension);
type AppendEntrySignature = typeof loaded.runtime.appendEntry;
type SendMessageSignature = typeof loaded.runtime.sendMessage;
loaded.runtime.appendEntry = (
	kind: Parameters<AppendEntrySignature>[0],
	data: Parameters<AppendEntrySignature>[1],
) => currentSession.appendCustomEntry(kind, data);
loaded.runtime.sendMessage = (
	message: Parameters<SendMessageSignature>[0],
	options: Parameters<SendMessageSignature>[1],
) => {
	sent.push({ message, options });
};
const event = async (name: string, data: Record<string, unknown> = {}) => {
	for (const handler of handlers[name] ?? []) {
		await handler(data, ctx());
	}
};
const execute = (args: unknown) =>
	readerTool.execute("reader-test", args, undefined, undefined, toolContextFrom(ctx()));
const lines = () => {
	const current = latestOverlay();
	assert.ok(current !== undefined, "reader overlay is mounted");
	return current.render(terminal.columns).map(stripTerminalSequences);
};
const press = (input: string) => {
	terminal.input(input);
	tui.renderNow();
};
const clickText = (text: string) => {
	const screen = lines();
	const y = screen.findIndex((line) => line.includes(text));
	assert.ok(y >= 0, `visible action ${text} must be rendered`);
	if (!nativeMouse) {
		if (text === "Revised explanation" || text === "Immutable explanation") {
			const selected = screen.findIndex((line) => line.includes("› "));
			assert.ok(selected >= 0, "library selection must be visible");
			for (let row = selected; row !== y; row += Math.sign(y - selected)) {
				press(y > selected ? "\x1b[B" : "\x1b[A");
			}
			press("\r");
			return;
		}
		const keys = {
			"→ Next": ["\x1b[C"],
			"← Prev": ["\x1b[D"],
			"→": ["\x1b[C"],
			"N Note": ["n"],
			"CtrlS Save": ["\x13"],
			"CtrlEnter Send": ["\x1b[13;5u"],
			"Esc Read": ["\x1b"],
			"Esc Back": ["\x1b"],
			"Esc Close": ["\x1b"],
			"R Reply": ["r"],
			"L List": ["l"],
			"T Retry": ["t"],
		}[text];
		assert.ok(keys, `keyboard fallback for ${text}`);
		for (const key of keys) {
			press(key);
		}
		return;
	}
	const target = screen.at(y);
	assert.ok(target !== undefined, `visible action ${text} must be on a rendered line`);
	const x = target.indexOf(text) + Math.floor(text.length / 2);
	terminal.mouseClick(x, y);
	tui.renderNow();
};
const state = () => restoreReaderState(currentSession.getBranch());
const docs = () => [...state().documents.values()];
const lastCursor = (): Record<string, unknown> | undefined => {
	const entry = [...currentSession.getBranch()]
		.reverse()
		.find(
			(candidate) =>
				candidate.type === "custom" &&
				candidate.customType === "fitch-paged-reader" &&
				isRecord(candidate.data) &&
				candidate.data.kind === "cursor",
		);
	const data = entry?.type === "custom" ? entry.data : undefined;
	return isRecord(data) ? data : undefined;
};

/** The first text line of a reader tool result, failing loudly when absent. */
const resultText = (result: unknown): string => {
	const record = requireRecord(result, "reader tool result");
	const content = record.content;
	if (!Array.isArray(content) || content.length === 0) {
		throw new Error("expected array content in the reader tool result");
	}
	const line = requireRecord(content[0], "first result content item");
	if (typeof line.text !== "string") {
		throw new Error("expected text content in the reader tool result");
	}
	return line.text;
};

/** The text content of a sent reader feedback message, failing loudly when absent. */
const feedbackText = (message: Record<string, unknown>): string => {
	const content = message.content;
	if (typeof content !== "string") {
		throw new Error("expected string content in the feedback message");
	}
	return content;
};

/** The last reader cursor entry, failing loudly when absent. */
const requireCursor = (): Record<string, unknown> => {
	const cursor = lastCursor();
	if (cursor === undefined) {
		throw new Error("expected a reader cursor entry");
	}
	return cursor;
};

/* oxlint-disable typescript/no-unsafe-type-assertion -- QX-002: TuiAltScreen keeps its rendered
 * screen buffer private; this regression inspects it white-box to verify image masking. */
/** The last rendered screen buffer of a TUI, read white-box for image verification. */
const renderedScreen = (screen: TuiAltScreen): string[] =>
	(screen as unknown as { previousScreen: string[] }).previousScreen;
/* oxlint-enable typescript/no-unsafe-type-assertion */

const settle = (): Promise<void> =>
	new Promise<void>((resolve) => {
		setImmediate(resolve);
	});

try {
	await event("session_start");
	const body = `${"Long readable sentence with context and emoji 🧭. ".repeat(30)}\n\n- Markdown **emphasis**\n- A second point\n\n| Topic | Detail |\n| --- | --- |\n| Table | A wide row with visible context 🧭 |\n\n\`\`\`ts\nconst longToken = "${"X".repeat(120)}";\n\`\`\`\n\n${"終端".repeat(80)}`;
	const sample = {
		id: "stable",
		revision: 1,
		title: "Immutable explanation",
		sections: [{ id: "scope", heading: "Original section", text: body }],
	};
	const compact = paginateDocument(sample, 21, 3);
	assert.ok(compact.length > 10, "long sections must continue through subpages");
	assert.ok(
		compact.every(
			(page) => page.body.length <= 3 && page.body.every((line) => visibleWidth(line) <= 21),
		),
	);
	const canonical = new Markdown(body, 0, 0, getMarkdownTheme())
		.render(70)
		.map((line) => stripTerminalSequences(line).trimEnd())
		.join("")
		.replace(/\s/gu, "");
	const paged = compact
		.flatMap((page) => page.body)
		.map(stripTerminalSequences)
		.join("")
		.replace(/\s/gu, "");
	assert.equal(
		paged,
		canonical,
		"native Markdown content including wide characters must remain fully reachable",
	);
	const prose = {
		...sample,
		sections: [
			{ id: "scope", heading: "Word wrapping", text: `${"x".repeat(40)} deletes details.` },
		],
	};
	const wrappedWords = paginateDocument(prose, 44, 3)
		.flatMap((page) => page.body)
		.map(stripTerminalSequences);
	assert.ok(
		wrappedWords.some((line) => line.startsWith("deletes")),
		"a narrow panel wraps normal words rather than splitting them",
	);
	assert.deepEqual(
		paginateDocument(sample, 70, 12).map((page) => page.anchor.sectionId),
		Array(paginateDocument(sample, 70, 12).length).fill("scope"),
	);

	const result = await execute({
		documentId: "stable",
		revision: 1,
		title: sample.title,
		sections: sample.sections,
	});
	assert.ok(resultText(result).includes("stable revision 1"));
	assert.ok(
		!resultText(result).includes(body.slice(0, 30)),
		"tool result must not echo explanation body",
	);
	assert.equal(docs().length, 1);
	assert.equal(latestOverlay()?.focused, true, "native overlay should own keyboard focus");
	if (nativeMouse) {
		assert.deepEqual(handle?.getBounds(), {
			row: 0,
			col: 0,
			width: terminal.columns,
			height: terminal.rows,
		});
	}
	const screen = lines();
	assert.equal(screen.length, terminal.rows);
	assert.ok(screen.every((line) => visibleWidth(line) <= terminal.columns));
	assert.equal(
		screen.at(0)?.trim(),
		"",
		"the full-viewport overlay must blank the transcript behind the panel",
	);
	assert.ok(screen.join("\n").includes("Immutable explanation"));
	assert.equal(sent.length, 0, "opening and rendering pages must make no model request");

	if (nativeMouse) {
		const footer = screen.findIndex((line) => line.includes("→ Next"));
		const footerLine = screen.at(footer);
		assert.ok(footerLine !== undefined, "pagination footer must be rendered");
		terminal.mouseClick(footerLine.indexOf("→ Next") - 1, footer);
		tui.renderNow();
		assert.deepEqual(
			requireCursor().anchor,
			{ sectionId: "scope", line: 0, column: 0 },
			"separator cells cannot activate a hidden action",
		);
	}
	clickText("→ Next");
	const firstMove = requireCursor();
	const firstAnchor = requireRecord(firstMove.anchor, "cursor anchor");
	assert.ok(
		typeof firstAnchor.line === "number" && typeof firstAnchor.column === "number",
		"cursor anchor must be numeric",
	);
	assert.ok(firstAnchor.line > 0 || firstAnchor.column > 0);
	press("\x1b[D");
	assert.deepEqual(
		requireCursor().anchor,
		{ sectionId: "scope", line: 0, column: 0 },
		"left returns to prior page",
	);
	press(" ");
	assert.deepEqual(
		requireCursor().anchor,
		firstMove.anchor,
		"Space and clickable Next share navigation",
	);
	assert.equal(sent.length, 0);

	let anchorBeforeResize = requireCursor();
	terminal.columns = 44;
	tui.renderNow();
	assert.deepEqual(lastCursor(), anchorBeforeResize, "resize must not mutate saved reading anchor");
	assert.ok(lines().every((line) => visibleWidth(line) <= 44));
	terminal.columns = 16;
	terminal.rows = 9;
	tui.renderNow();
	assert.deepEqual(
		lastCursor(),
		anchorBeforeResize,
		"narrow resize preserves a canonical content position",
	);
	assert.ok(lines().every((line) => visibleWidth(line) <= 16));
	assert.ok(lines().join("\n").includes("Esc"), "compact action row retains a visible exit");
	clickText("→");
	assert.notDeepEqual(
		requireCursor().anchor,
		requireRecord(anchorBeforeResize.anchor, "saved anchor"),
		"compact clickable Next navigates rather than clipping a hidden action",
	);
	anchorBeforeResize = requireCursor();
	terminal.columns = 100;
	terminal.rows = 28;
	tui.renderNow();
	assert.deepEqual(lastCursor(), anchorBeforeResize);

	const sectionHeaderRow = lines().findIndex((line) => line.includes("Original section"));
	const sectionHeader = lines()[sectionHeaderRow];
	clickText("N Note");
	assert.equal(
		lines()[sectionHeaderRow],
		sectionHeader,
		"opening a note must not shift the section heading behind status text",
	);
	assert.ok(
		lines().some((line) => line.includes("Note · Immutable explanation")),
		"note mode is named explicitly",
	);
	assert.equal(
		lines().filter((line) => /^─+$/.test(line.trim())).length,
		2,
		"the native note editor has one top and one bottom border",
	);
	terminal.columns = 44;
	tui.renderNow();
	assert.ok(
		lines().some((line) => line.includes("Original section")),
		"a narrow note keeps the section name visible",
	);
	assert.ok(
		lines().some((line) => /Page \d+\/\d+/.test(line)),
		"page progress is labeled separately from the section",
	);
	terminal.columns = 100;
	tui.renderNow();
	assert.ok(lines().join("\n").includes("Original section"), "note editor keeps section header");
	const focusedOverlay = latestOverlay();
	assert.ok(focusedOverlay !== undefined, "note editor overlay must be mounted");
	assert.ok(
		focusedOverlay.render(terminal.columns).some((line) => line.includes(CURSOR_MARKER)),
		"native Editor cursor marker reaches the focused overlay for IME",
	);
	for (const letter of "Please clarify the implication.") {
		press(letter);
	}
	assert.equal(sent.length, 0, "typing a note does not enter model context");
	assert.equal(state().drafts.get("stable@1/scope"), "Please clarify the implication.");
	assert.ok(
		!JSON.stringify(currentSession.buildSessionContext().messages).includes(
			"Please clarify the implication.",
		),
	);
	terminal.rows = 8;
	tui.renderNow();
	assert.ok(
		lines().join("\n").includes("Please clarify the implication."),
		"height-8 editor retains a visible content row",
	);
	assert.ok(
		focusedOverlay.render(terminal.columns).some((line) => line.includes(CURSOR_MARKER)),
		"height-8 editor retains the IME cursor",
	);
	terminal.rows = 28;
	tui.renderNow();
	press("\x13"); // Ctrl+S: local-only save.
	assert.equal(sent.length, 0);
	assert.equal(
		lines()[sectionHeaderRow],
		sectionHeader,
		"saving a note keeps the section heading fixed",
	);
	press("\x1b");
	clickText("N Note");
	assert.ok(lines().join("\n").includes("Please clarify the implication."));
	press("\x1b[13;5u"); // Ctrl+Enter explicitly requests a main-agent response.
	assert.equal(sent.length, 1);
	const request = sent.at(0);
	assert.ok(request !== undefined, "feedback send must be recorded");
	const feedbackMessage = requireRecord(request.message, "feedback message");
	assert.deepEqual(requireRecord(request.options, "feedback options"), { triggerTurn: true });
	const feedbackId = requireRecord(feedbackMessage.details, "feedback details").feedbackId;
	assert.ok(typeof feedbackId === "string", "feedback id must be a string");
	assert.ok(feedbackText(feedbackMessage).includes(`Reader feedback ID: ${feedbackId}`));
	assert.ok(feedbackText(feedbackMessage).includes("stable · immutable revision: 1"));
	assert.ok(
		feedbackText(feedbackMessage).includes("Section ID: scope · heading: Original section"),
	);
	assert.ok(
		feedbackText(feedbackMessage).includes(
			JSON.stringify({ originalSectionText: body, note: "Please clarify the implication." }),
		),
	);
	assert.deepEqual(
		lastCursor(),
		anchorBeforeResize,
		"sending cannot move original reading position",
	);
	assert.equal(
		lines()[sectionHeaderRow],
		sectionHeader,
		"sending feedback keeps the section heading fixed",
	);
	assert.ok(
		lines().join("\n").includes("Queued for agent"),
		"click alone does not claim agent delivery",
	);
	clickText("N Note");
	press("\x1b[13;5u");
	assert.equal(sent.length, 1, "unchanged note cannot be resubmitted by the same key");
	press("\x1b");

	await event("message_start", {
		message: {
			role: "custom",
			customType: "fitch-paged-reader-feedback",
			details: feedbackMessage.details,
		},
	});
	assert.ok(lines().join("\n").includes("Sent to agent"));
	await event("turn_end", {
		outcome: "completed",
		toolResults: [],
		message: fauxAssistantMessage(
			"The implication is narrower than the initial claim. Here is the full response.",
		),
	});
	assert.equal(sent.length, 1);
	assert.equal(docs().length, 2, "ordinary final text becomes a stored reader reply");
	const replyDoc = docs().at(1);
	assert.ok(replyDoc !== undefined, "reply document must be stored");
	assert.equal(replyDoc.replyToFeedbackId, feedbackId);
	assert.deepEqual(lastCursor(), anchorBeforeResize, "incoming reply cannot replace current page");
	assert.ok(lines().join("\n").includes("Reply ready"));
	assert.equal(
		lines()[sectionHeaderRow],
		sectionHeader,
		"a ready reply cannot displace the section heading",
	);
	clickText("R Reply");
	assert.ok(lines().join("\n").includes("The implication is narrower"));
	press("b");
	assert.deepEqual(
		requireCursor().anchor,
		requireRecord(anchorBeforeResize.anchor, "saved anchor"),
		"Back restores original document and cursor",
	);
	assert.ok(lines().join("\n").includes("Original section"));

	const oldDraft = state().drafts.get("stable@1/scope");
	await execute({
		documentId: "stable",
		revision: 2,
		title: "Revised explanation",
		sections: [
			{ id: "scope", heading: "Revised section", text: "Changed content in revision two." },
		],
	});
	assert.equal(docs().length, 3);
	const originalDoc = docs().at(0);
	assert.ok(originalDoc !== undefined, "original document must be stored");
	const originalSection = originalDoc.sections.at(0);
	assert.ok(originalSection !== undefined, "original section must be stored");
	assert.equal(originalSection.text, body, "new revision cannot overwrite the original text");
	assert.equal(
		state().drafts.get("stable@1/scope"),
		oldDraft,
		"notes are keyed to immutable revision",
	);
	assert.equal(state().drafts.has("stable@2/scope"), false);
	assert.ok(
		lines().join("\n").includes("Original section"),
		"new publication cannot replace active page",
	);
	await assert.rejects(
		execute({
			documentId: "stable",
			revision: 1,
			title: "Bad overwrite",
			sections: [{ id: "scope", heading: "Changed", text: "Overwritten" }],
		}),
		/already exists/,
	);
	await assert.rejects(
		execute({
			title: "Bad reply",
			sections: [{ heading: "Response", text: "wrong" }],
			replyToFeedbackId: "unknown",
		}),
		/Unknown reader feedback ID/,
	);

	const saved = requireCursor();
	press("\x1b");
	await settle();
	assert.equal(latestOverlay(), undefined);
	currentSession = SessionManager.open(sessionFile);
	await event("session_start");
	assert.equal(sent.length, 1, "restart must not auto-resend feedback");
	await readerCommand.handler("", ctx());
	assert.deepEqual(
		requireCursor().anchor,
		saved.anchor,
		"/reader reopens at persisted cursor after file-backed restart",
	);
	assert.ok(lines().join("\n").includes("Original section"));
	clickText("N Note");
	assert.ok(
		lines().join("\n").includes("Please clarify the implication."),
		"note draft survives file-backed restart",
	);
	press("\x1b");
	clickText("L List");
	assert.ok(lines().join("\n").includes("Revised explanation"));
	clickText("Revised explanation");
	assert.ok(lines().join("\n").includes("Revised section"), "native pointer opens a library row");
	// The note editor was last opened on stable@1. Retry must follow the
	// document on screen: stable@2 has no note on this section, so T cannot
	// dispatch stable@1's note against the reader's current document.
	const crossDocBefore = sent.length;
	press("t");
	assert.equal(
		sent.length,
		crossDocBefore,
		"Retry follows the document on screen, not the last-opened note editor",
	);
	clickText("L List");
	clickText("Immutable explanation");
	assert.ok(lines().join("\n").includes("Original section"));
	press("\x1b");
	await settle();

	const beforeDemo: number = sent.length;
	await readerCommand.handler("demo", ctx());
	assert.equal(sent.length, beforeDemo, "built-in demo is entirely local");
	assert.ok(lines().join("\n").includes("A quiet reading example"));
	assert.ok(docs().length >= 4);

	clickText("N Note");
	for (const letter of "A second note.") {
		press(letter);
	}
	clickText("CtrlS Save");
	assert.equal(sent.length, beforeDemo, "clicking Save remains local");
	clickText("Esc Read");
	clickText("N Note");
	clickText("CtrlEnter Send");
	assert.equal(sent.length, beforeDemo + 1, "clickable Send requests one main-agent turn");
	clickText("N Note");
	clickText("CtrlEnter Send");
	assert.equal(sent.length, beforeDemo + 1, "repeat click cannot resubmit unchanged note");
	press("\x1b");
	clickText("N Note");
	for (const letter of " More detail.") {
		press(letter);
	}
	press("\x1b[13;5u");
	assert.equal(sent.length, beforeDemo + 2, "an edited note can explicitly request a new response");
	await event("agent_settled");
	assert.ok(lines().join("\n").includes("No saved reply"));
	clickText("N Note");
	for (const letter of " UNSENT") {
		press(letter);
	}
	press("\x1b");
	const unsentCursor = requireCursor();
	const unsentKeyRaw = unsentCursor.key;
	const unsentSectionRaw = requireRecord(unsentCursor.anchor, "cursor anchor").sectionId;
	const unsentKey = typeof unsentKeyRaw === "string" ? unsentKeyRaw : "";
	const unsentSectionId = typeof unsentSectionRaw === "string" ? unsentSectionRaw : "";
	const unsentDraft = state().drafts.get(`${unsentKey}/${unsentSectionId}`);
	assert.ok(unsentDraft !== undefined, "unsent draft must be stored");
	assert.ok(unsentDraft.endsWith(" UNSENT"));
	clickText("T Retry");
	assert.equal(
		sent.length,
		beforeDemo + 3,
		"an explicit Retry may request again after an unanswered turn",
	);
	const retryRequest = sent.at(-1);
	assert.ok(retryRequest !== undefined, "retry request must be recorded");
	assert.ok(
		!feedbackText(requireRecord(retryRequest.message, "retry message")).includes("UNSENT"),
		"Retry sends only the prior submitted note, never a newer local draft",
	);
	press("t");
	assert.equal(
		sent.length,
		beforeDemo + 3,
		"repeated Retry does not duplicate an outstanding request",
	);
	const secondFeedbackId = requireRecord(
		requireRecord(retryRequest.message, "retry message").details,
		"retry details",
	).feedbackId;
	const demoCursor = requireCursor();
	await execute({
		title: "Answer to the example",
		sections: [
			{ id: "answer", heading: "Response", text: "The local note was explicitly delivered." },
		],
		replyToFeedbackId: secondFeedbackId,
	});
	assert.deepEqual(lastCursor(), demoCursor, "structured reply only updates the badge");
	assert.ok(lines().join("\n").includes("Reply ready"));
	press("r");
	assert.ok(lines().join("\n").includes("The local note was explicitly delivered."));
	press("b");
	assert.deepEqual(requireCursor().anchor, demoCursor.anchor);

	press("\x1b");
	await settle();
	tui.stop();
	tui = new TuiMainScreen(terminal);
	tui.start();
	assert.equal(tui.mode, "regular");
	await readerCommand.handler("", ctx());
	const regularStart = requireCursor();
	press("\x1b[C");
	assert.notDeepEqual(
		requireCursor().anchor,
		regularStart.anchor,
		"regular-mode keyboard still advances a page",
	);
	assert.equal(sent.length, beforeDemo + 3, "regular navigation makes no model call");
	press("\x1b");
	await settle();

	const firstDocumentEntry = currentSession.getBranch().find((entry) => {
		if (entry.type !== "custom" || !isRecord(entry.data)) {
			return false;
		}
		const data = entry.data;
		return data.kind === "document" && isRecord(data.document) && data.document.id === "stable";
	});
	assert.ok(firstDocumentEntry !== undefined);
	currentSession.branch(firstDocumentEntry.id);
	await event("session_tree");
	assert.deepEqual(
		docs().map((doc) => `${doc.id}@${doc.revision}`),
		["stable@1"],
	);
	assert.equal(
		requireCursor().key,
		"stable@1",
		"tree navigation persists a cursor on the selected branch",
	);
	const resumedTree = SessionManager.open(sessionFile);
	assert.deepEqual(
		restoreReaderState(resumedTree.getBranch()).order,
		["stable@1"],
		"resuming cannot jump to the abandoned branch",
	);

	currentSession = SessionManager.create(join(root, "print"), join(root, "print-sessions"));
	currentSession.appendMessage(fauxAssistantMessage("Print-mode baseline"));
	await event("session_start");
	const printCtx = {
		mode: "print",
		hasUI: false,
		ui: {
			notify() {
				return;
			},
		},
		sessionManager: currentSession,
	};
	await readerTool.execute(
		"print-publish",
		{
			title: "Print-mode explanation",
			sections: [
				{ heading: "Still saved", text: "Non-interactive publication remains available." },
			],
		},
		undefined,
		undefined,
		printCtx,
	);
	assert.equal(docs().length, 1);
	assert.equal(overlay, undefined, "non-TUI publication never opens a terminal component");

	currentSession = SessionManager.create(join(root, "ambiguous"), join(root, "ambiguous-sessions"));
	currentSession.appendMessage(fauxAssistantMessage("Ambiguous reply baseline"));
	await event("session_start");
	await execute({
		title: "Two questions",
		sections: [
			{ id: "first", heading: "First section", text: "First original." },
			{ id: "second", heading: "Second section", text: "Second original." },
		],
	});
	const sentBeforeAmbiguous: number = sent.length;
	press("n");
	press("A");
	press("\x1b[13;5u");
	press("\x1b[C");
	press("n");
	press("B");
	press("\x1b[13;5u");
	assert.equal(sent.length, sentBeforeAmbiguous + 2);
	for (const delivery of sent.slice(-2)) {
		const requestMessage = requireRecord(delivery.message, "request message");
		await event("message_start", {
			message: {
				role: "custom",
				customType: "fitch-paged-reader-feedback",
				details: requestMessage.details,
			},
		});
	}
	await event("turn_end", {
		outcome: "completed",
		toolResults: [],
		message: fauxAssistantMessage("A combined answer that cannot safely be assigned to one note."),
	});
	assert.equal(docs().length, 2);
	const unlinkedDoc = docs().at(1);
	assert.ok(unlinkedDoc !== undefined, "unlinked reply must be stored");
	assert.ok(unlinkedDoc.unlinkedFeedbackIds !== undefined, "unlinked ids must be recorded");
	assert.equal(unlinkedDoc.replyToFeedbackId, undefined);
	assert.equal(unlinkedDoc.unlinkedFeedbackIds.length, 2);
	assert.ok(lines().join("\n").includes("Unlinked response in L List"));
	press("l");
	press("\x1b[B");
	press("\r");
	assert.ok(
		lines().join("\n").includes("A combined answer"),
		"ambiguous response remains readable from the library",
	);
	press("\x1b");
	await settle();
	await event("agent_settled");
	const ambiguousFile = currentSession.getSessionFile();
	assert.ok(ambiguousFile !== undefined, "ambiguous session file must exist");
	currentSession = SessionManager.open(ambiguousFile);
	await event("session_start");
	assert.equal(
		sent.length,
		sentBeforeAmbiguous + 2,
		"restart never auto-resends ambiguous or unanswered feedback",
	);
	// A freshly mounted overlay must retry a restart-unanswered note without
	// first opening the note editor: the T hint is advertised, so T cannot be
	// a silent no-op in a newly mounted overlay instance.
	await command.handler("", ctx());
	press("l");
	press("\x1b[A");
	press("\r");
	press("\x1b");
	await settle();
	await command.handler("", ctx());
	assert.ok(
		lines().join("\n").includes("T Retry"),
		"retry hint is advertised on the fresh overlay",
	);
	const freshRetryBefore = sent.length;
	press("t");
	assert.equal(
		sent.length,
		freshRetryBefore + 1,
		"fresh overlay retries the restart-unanswered note without opening the editor",
	);
	await event("agent_settled");
	// Cross-document retry: the note editor must not pin Retry to the document
	// where it was last opened. Both documents share the section id, and both
	// notes are retryable, so T must carry the on-screen document's note.
	await execute({
		title: "Cross target",
		sections: [
			{
				id: "second",
				heading: "Shared section",
				text: "Same section id as the original question.",
			},
		],
	});
	press("l");
	press("\x1b[B");
	press("\x1b[B");
	press("\r");
	assert.ok(lines().join("\n").includes("Shared section"), "cross-target document is on screen");
	press("n");
	for (const letter of "Retry target note.") press(letter);
	press("\x1b[13;5u");
	await event("agent_settled");
	press("l");
	press("\x1b[A");
	press("\x1b[A");
	press("\r");
	press("n");
	press("\x1b");
	press("l");
	press("\x1b[B");
	press("\x1b[B");
	press("\r");
	assert.ok(lines().join("\n").includes("Shared section"), "cross-target document is on screen");
	assert.ok(
		lines().join("\n").includes("T Retry"),
		"retry hint is advertised for the on-screen document",
	);
	const sharedRetryBefore = sent.length;
	press("t");
	assert.equal(
		sent.length,
		sharedRetryBefore + 1,
		"T dispatches the on-screen document's retryable note",
	);
	const sharedRetryRequest = sent.at(-1);
	assert.ok(sharedRetryRequest !== undefined, "cross-document retry must be recorded");
	assert.ok(
		feedbackText(requireRecord(sharedRetryRequest.message, "cross-document retry message")).includes(
			"Retry target note.",
		),
		"retry carries the on-screen document's note, not the last-opened editor's note",
	);
	press("\x1b");
	await settle();

	currentSession = SessionManager.create(
		join(root, "steered-tool"),
		join(root, "steered-tool-sessions"),
	);
	currentSession.appendMessage(fauxAssistantMessage("Steered tool baseline"));
	await event("session_start");
	await execute({ title: "Steered", sections: [{ heading: "Question", text: "Original." }] });
	press("n");
	press("S");
	press("\x1b[13;5u");
	const steeredRequest = sent.at(-1);
	assert.ok(steeredRequest !== undefined, "steered request must be recorded");
	const steeredId = requireRecord(
		requireRecord(steeredRequest.message, "steered message").details,
		"steered details",
	).feedbackId;
	press("\x1b");
	await settle();
	await event("message_start", {
		message: {
			role: "custom",
			customType: "fitch-paged-reader-feedback",
			details: { feedbackId: steeredId },
		},
	});
	await event("message_start", { message: { role: "user", content: "steer", timestamp: 1 } });
	await execute({
		title: "Mixed answer",
		sections: [{ heading: "Response", text: "Answers the note and the steer." }],
	});
	const mixed = docs().find((doc) => doc.title === "Mixed answer");
	assert.ok(mixed !== undefined, "mixed reply must be stored");
	assert.equal(mixed.replyToFeedbackId, undefined);
	assert.deepEqual(
		mixed.unlinkedFeedbackIds,
		[steeredId],
		"a tool reply on a mixed turn is filed like the text path, not as an orphan",
	);
	press("\x1b");
	await settle();
	await event("agent_settled");

	currentSession = SessionManager.create(join(root, "partial"), join(root, "partial-sessions"));
	currentSession.appendMessage(fauxAssistantMessage("Length-stopped baseline"));
	await event("session_start");
	await execute({
		title: "Needs a complete reply",
		sections: [{ heading: "Question", text: "Full original section." }],
	});
	press("n");
	press("Q");
	press("\x1b[13;5u");
	const partialRequest = sent.at(-1);
	assert.ok(partialRequest !== undefined, "partial request must be recorded");
	const partialId = requireRecord(
		requireRecord(partialRequest.message, "partial message").details,
		"partial details",
	).feedbackId;
	assert.ok(typeof partialId === "string", "partial feedback id must be a string");
	await event("message_start", {
		message: {
			role: "custom",
			customType: "fitch-paged-reader-feedback",
			details: { feedbackId: partialId },
		},
	});
	await event("turn_end", {
		outcome: "completed",
		toolResults: [],
		message: fauxAssistantMessage("TRUNCATED BEFORE END", { stopReason: "length" }),
	});
	const partialDoc = docs().at(1);
	assert.ok(partialDoc !== undefined, "partial reply must be stored");
	assert.equal(partialDoc.incomplete, true);
	assert.equal(
		partialDoc.replyToFeedbackId,
		undefined,
		"a length-stopped answer must never be linked as a complete reply",
	);
	assert.ok(typeof partialId === "string", "partial feedback id must be a string");
	assert.equal(state().replies(partialId).length, 0);
	assert.ok(lines().join("\n").includes("Incomplete response in L List"));
	assert.ok(!lines().join("\n").includes("Reply ready"));
	await event("turn_end", {
		outcome: "completed",
		toolResults: [],
		message: fauxAssistantMessage("COMPLETE AFTER RECOVERY"),
	});
	await event("agent_settled");
	assert.equal(
		state().replies(partialId).length,
		1,
		"native recovery retains correlation without re-emitting feedback input",
	);
	assert.ok(lines().join("\n").includes("Reply ready"));
	press("l");
	press("\x1b[B");
	press("\r");
	assert.ok(
		lines().join("\n").includes("TRUNCATED BEFORE END"),
		"partial text remains accessible without claiming completion",
	);
	press("\x1b");
	await settle();

	console.log(
		"paged-reader regression: bounded native pages, fullscreen clicks and regular keys, durable drafts/cursors, explicit feedback, linked and unlinked replies, revisions, tree and file-backed resume passed",
	);
} finally {
	latestOverlay()?.close?.(false);
	tui.stop();
}

const originalCapabilities = hostTui.getCapabilities();
const imageTerminal = new Terminal();
let imageTui: TuiAltScreen | undefined;
try {
	hostTui.setCapabilities({ ...originalCapabilities, images: "kitty" });
	imageTui = new hostTui.TuiAltScreen(imageTerminal);
	imageTui.start();
	const transcript = new hostTui.Container();
	transcript.addChild(
		new hostTui.Image(
			"AA==",
			"image/png",
			{ fallbackColor: (text: string) => text },
			{ maxWidthCells: 10, maxHeightCells: 2 },
			{ widthPx: 2, heightPx: 2 },
		),
	);
	imageTui.addChild(transcript);
	imageTui.renderNow();
	assert.ok(
		renderedScreen(imageTui).some((line: string) => line.includes("\x1b_G")),
		"native transcript contains an inline image before opening reader",
	);
	tui = imageTui;
	await readerCommand.handler("", ctx());
	imageTui.renderNow();
	assert.equal(
		hostTui.getCapabilities().images,
		null,
		"fullscreen reader temporarily suppresses native image rendering",
	);
	assert.ok(
		renderedScreen(imageTui).every((line: string) => !line.includes("\x1b_G")),
		"the reader masks image rows as well as text",
	);
	assert.ok(
		imageTerminal.writes.some((part) => part.includes("a=d,d=a") || part.includes("a=d,d=A")),
		"native fullscreen repaint clears Kitty placements",
	);
	const imageOverlay = latestOverlay();
	assert.ok(imageOverlay !== undefined, "image-mode reader overlay must be mounted");
	imageOverlay.handleInput?.("\x1b");
	await settle();
	imageTui.renderNow();
	assert.equal(
		hostTui.getCapabilities().images,
		"kitty",
		"closing restores the exact image protocol",
	);
	assert.ok(
		renderedScreen(imageTui).some((line: string) => line.includes("\x1b_G")),
		"native image rows render again after closing",
	);
	console.log(
		"paged-reader native image overlay: Kitty rows masked, placements cleared, capabilities restored",
	);
} finally {
	latestOverlay()?.close?.(false);
	imageTui?.stop();
	hostTui.setCapabilities(originalCapabilities);
}

// The native session runner (not a mocked send callback) must actually deliver
// a busy follow-up after unrelated work and pair only its own final answer.
const sdkCwd = join(root, "sdk-project");
const sdkAgentDir = join(root, "sdk-agent");
mkdirSync(sdkCwd);
mkdirSync(sdkAgentDir);
const sdkTerminal = new Terminal();
const sdkTui = new TuiAltScreen(sdkTerminal);
sdkTui.start();
let sdkOverlay: ReaderComponent | undefined;
/** The latest sdk overlay a custom callback created, if any, read across a call boundary. */
const latestSdkOverlay = (): ReaderComponent | undefined => sdkOverlay;
let sdkHandle: OverlayHandle | undefined;
let finishOverlay: () => void = () => {
	throw new Error("overlay finished before construction");
};
const nativeUi = {
	custom(factory: ReaderFactory, options: ReaderCustomOptions) {
		const promise = new Promise<void>((resolve) => {
			finishOverlay = () => {
				resolve();
			};
		});
		const component = factory(sdkTui, theme, getKeybindings(), () => {
			sdkHandle?.hide();
			component.dispose?.();
			sdkOverlay = undefined;
			finishOverlay();
		});
		sdkOverlay = component;
		sdkHandle = sdkTui.showOverlay(component, options.overlayOptions);
		options.onHandle?.(sdkHandle);
		sdkTui.renderNow();
		return promise;
	},
};
const faux = fauxProvider({
	models: [{ id: "reader-model", contextWindow: 64_000, reasoning: false }],
});
const model = faux.getModel();
const runtime = await ModelRuntime.create({
	credentials: new InMemoryCredentialStore(),
	modelsPath: null,
	refreshOnCreate: false,
});
runtime.registerProvider(model.provider, {
	api: model.api,
	baseUrl: model.baseUrl,
	apiKey: "test-only",
	models: faux.models,
	streamSimple: faux.provider.streamSimple.bind(faux.provider),
});
const sdkManager = SessionManager.create(sdkCwd, join(root, "sdk-sessions"));
sdkManager.appendMessage({
	...fauxAssistantMessage("Synthetic baseline"),
	api: model.api,
	provider: model.provider,
	model: model.id,
});
const settings = SettingsManager.inMemory({
	compaction: { enabled: false },
	retry: { enabled: false },
});
const loader = new DefaultResourceLoader({
	cwd: sdkCwd,
	agentDir: sdkAgentDir,
	settingsManager: settings,
	additionalExtensionPaths: [
		fileURLToPath(new URL("../extensions/paged-reader.ts", import.meta.url)),
	],
	noExtensions: true,
	noSkills: true,
	noPromptTemplates: true,
	noThemes: true,
	noContextFiles: true,
});
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
const { session: sdkSession } = await createAgentSession({
	cwd: sdkCwd,
	agentDir: sdkAgentDir,
	model,
	modelRuntime: runtime,
	settingsManager: settings,
	sessionManager: sdkManager,
	resourceLoader: loader,
	tools: [],
});
try {
	const baseUi = sdkSession.extensionRunner.createContext().ui;
	/* oxlint-disable typescript/no-unsafe-type-assertion -- QX-002: the native ui fixture's
	 * custom signature is intentionally narrower than ExtensionUIContext.custom. */
	await sdkSession.bindExtensions({
		mode: "tui",
		uiContext: { ...baseUi, ...nativeUi } as unknown as ExtensionUIContext,
		onError(error) {
			throw new Error(`${error.event}: ${error.error}`);
		},
	});
	/* oxlint-enable typescript/no-unsafe-type-assertion */
	await sdkSession.prompt("/reader demo");
	const demoOverlay = latestSdkOverlay();
	assert.ok(demoOverlay !== undefined, "real command dispatch opens a reader overlay");
	let releaseUnrelated: () => void = () => {
		throw new Error("unrelated release before the response started");
	};
	const unrelatedGate = gate();
	let nativeFeedback: string | undefined;
	faux.setResponses([
		async () => {
			unrelatedGate.open();
			await new Promise<void>((resolve) => {
				releaseUnrelated = () => {
					resolve();
				};
			});
			return fauxAssistantMessage("Unrelated task finished first.");
		},
		async (context) => {
			nativeFeedback = JSON.stringify(context.messages);
			return fauxAssistantMessage("A correlated answer from the native follow-up.");
		},
	]);
	const unrelated = sdkSession.prompt("An unrelated task is already running");
	await unrelatedGate.promise;
	demoOverlay.handleInput?.("n");
	for (const key of "Native note") {
		demoOverlay.handleInput?.(key);
	}
	demoOverlay.handleInput?.("\x1b[13;5u");
	assert.equal(
		faux.state.callCount,
		1,
		"feedback stays queued while the unrelated model turn runs",
	);
	releaseUnrelated();
	await unrelated;
	await sdkSession.waitForIdle();
	assert.equal(
		faux.state.callCount,
		2,
		"the main agent, not a nested client, handles explicit feedback",
	);
	assert.ok(nativeFeedback !== undefined, "native feedback must reach the model context");
	assert.ok(nativeFeedback.includes("Native note"));
	assert.ok(nativeFeedback.includes("Document ID:"));
	assert.ok(nativeFeedback.includes("One idea at a time"));
	const nativeState = restoreReaderState(sdkManager.getBranch());
	const nativeReply = [...nativeState.documents.values()].find(
		(doc) => doc.replyToFeedbackId !== undefined,
	);
	assert.ok(
		nativeReply !== undefined,
		"native assistant final text must become a linked reader reply",
	);
	assert.match(nativeReply.sections.at(0)?.text ?? "", /correlated answer/);
	const nativeFirstOrder = nativeState.order.at(0);
	assert.ok(nativeFirstOrder !== undefined, "native document order must exist");
	assert.equal(nativeState.cursors.get(nativeFirstOrder)?.sectionId, "section-1");
	assert.ok(
		demoOverlay
			.render(sdkTerminal.columns)
			.map(stripTerminalSequences)
			.join("\n")
			.includes("Reply ready"),
	);

	const abortGate = gate();
	faux.setResponses([
		async (_context, options) => {
			abortGate.open();
			await new Promise<void>((resolve) => {
				if (options?.signal?.aborted === true) {
					resolve();
				} else {
					options?.signal?.addEventListener(
						"abort",
						() => {
							resolve();
						},
						{ once: true },
					);
				}
			});
			return fauxAssistantMessage("", { stopReason: "aborted" });
		},
	]);
	const interruptedWork = sdkSession.prompt("A different busy task that will be canceled");
	await abortGate.promise;
	demoOverlay.handleInput?.("n");
	for (const key of " Private note") {
		demoOverlay.handleInput?.(key);
	}
	demoOverlay.handleInput?.("\x1b[13;5u");
	const pendingPrivate = restoreReaderState(sdkManager.getBranch()).latestFeedback(
		nativeFirstOrder,
		"section-1",
	);
	assert.ok(pendingPrivate !== undefined, "pending private note must be recorded");
	assert.ok(pendingPrivate.note.endsWith("Private note"));
	const callsAtAbort: number = faux.state.callCount;
	await sdkSession.abort();
	await Promise.allSettled([interruptedWork]);
	await sdkSession.waitForIdle();
	assert.equal(
		faux.state.callCount,
		callsAtAbort,
		"native abort cannot secretly deliver a session-local pending note",
	);
	const afterAbort = restoreReaderState(sdkManager.getBranch());
	assert.equal(afterAbort.statuses.get(pendingPrivate.id), "interrupted");
	assert.equal(afterAbort.replies(pendingPrivate.id).length, 0);
	assert.ok(
		demoOverlay
			.render(sdkTerminal.columns)
			.map(stripTerminalSequences)
			.join("\n")
			.includes("Queued request canceled"),
	);
	let nextRequestContext: string | undefined;
	faux.setResponses([
		async (context) => {
			nextRequestContext = JSON.stringify(context.messages);
			return fauxAssistantMessage("The next unrelated task is complete.");
		},
	]);
	await sdkSession.prompt("An unrelated question after cancellation");
	await sdkSession.waitForIdle();
	assert.equal(
		faux.state.callCount,
		callsAtAbort + 1,
		"canceled reader work cannot drain on a later prompt",
	);
	assert.ok(nextRequestContext !== undefined, "next request context must be captured");
	assert.ok(
		!nextRequestContext.includes("Private note"),
		"an unsent draft stays outside model context after cancellation",
	);
	assert.equal(restoreReaderState(sdkManager.getBranch()).replies(pendingPrivate.id).length, 0);
	demoOverlay.handleInput?.("\x1b");
	await settle();
	console.log(
		"paged-reader native SDK: busy feedback, abort/no-ghost delivery, exact section context and final-text correlation passed without a paid model",
	);
} finally {
	latestSdkOverlay()?.close?.(false);
	await sdkSession.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	sdkSession.dispose();
	sdkTui.stop();
}
