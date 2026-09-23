import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createAgentSession, DefaultResourceLoader, discoverAndLoadExtensions, getMarkdownTheme, initTheme,
	ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import * as tuiApi from "@earendil-works/pi-tui";
import { CURSOR_MARKER, getKeybindings, Markdown, stripTerminalSequences, TuiAltScreen, TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { paginateDocument, restoreReaderState } from "../extensions/paged-reader.ts";

const root = mkdtempSync(join(tmpdir(), "pi-reader-regression-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
initTheme("dark");
const nativeMouse = typeof tuiApi.MouseRegion === "function";
const hostTui = await import(pathToFileURL(createRequire(import.meta.resolve("@earendil-works/pi-coding-agent")).resolve("@earendil-works/pi-tui")).href);

class Terminal {
	columns = 100;
	rows = 28;
	kittyProtocolActive = false;
	inputHandler;
	writes = [];
	start(onInput) { this.inputHandler = onInput; }
	stop() { this.inputHandler = undefined; }
	write(data) { this.writes.push(data); }
	hideCursor() {}
	showCursor() {}
	clearLine() {}
	clearFromCursor() {}
	clearScreen() {}
	moveBy() {}
	setTitle() {}
	setProgress() {}
	input(data) { assert.ok(this.inputHandler, "native TUI input route is active"); this.inputHandler(data); }
	mouseClick(x, y) {
		this.input(`\x1b[<0;${x + 1};${y + 1}M`);
		this.input(`\x1b[<0;${x + 1};${y + 1}m`);
	}
}
const terminal = new Terminal();
let tui = new TuiAltScreen(terminal);
tui.start();
const theme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
};
let overlay;
let handle;
const ui = {
	notify() {},
	custom(factory, options) {
		let finish;
		const promise = new Promise((resolve) => { finish = resolve; });
		const component = factory(tui, theme, getKeybindings(), () => {
			handle?.hide();
			component.dispose?.();
			if (overlay === component) overlay = undefined;
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
assert.ok(sessionFile, "file-backed session must exist before reader publication on official Pi");
let currentSession = session;
let mockIdle = true;
const ctx = () => ({ mode: "tui", hasUI: true, ui, sessionManager: currentSession, isIdle: () => mockIdle });
const sent = [];
const loaded = await discoverAndLoadExtensions([fileURLToPath(new URL("../extensions/paged-reader.ts", import.meta.url))], root, root);
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
const extension = loaded.extensions[0];
const tool = [...extension.tools.values()].find(({ definition }) => definition.name === "reader_present")?.definition;
const command = extension.commands.get("reader");
assert.ok(tool && command);
loaded.runtime.appendEntry = (kind, data) => currentSession.appendCustomEntry(kind, data);
loaded.runtime.sendMessage = (message, options) => sent.push({ message, options });
const event = async (name, data = {}) => {
	for (const handler of extension.handlers.get(name) ?? []) await handler(data, ctx());
};
const execute = (args) => tool.execute("reader-test", args, undefined, undefined, ctx());
const lines = () => {
	assert.ok(overlay, "reader overlay is mounted");
	return overlay.render(terminal.columns).map(stripTerminalSequences);
};
const press = (input) => { terminal.input(input); tui.renderNow(); };
const clickText = (text) => {
	const screen = lines();
	const y = screen.findIndex((line) => line.includes(text));
	assert.ok(y >= 0, `visible action ${text} must be rendered`);
	if (!nativeMouse) {
		if (text === "Revised explanation" || text === "Immutable explanation") {
			const selected = screen.findIndex((line) => line.includes("› "));
			assert.ok(selected >= 0, "library selection must be visible");
			for (let row = selected; row !== y; row += Math.sign(y - selected)) press(y > selected ? "\x1b[B" : "\x1b[A");
			press("\r");
			return;
		}
		const keys = {
			"→ Next": ["\x1b[C"], "← Prev": ["\x1b[D"], "→": ["\x1b[C"],
			"N Note": ["n"], "CtrlS Save": ["\x13"], "CtrlEnter Send": ["\x1b[13;5u"],
			"Esc Read": ["\x1b"], "Esc Back": ["\x1b"], "Esc Close": ["\x1b"],
			"R Reply": ["r"], "L List": ["l"], "T Retry": ["t"],
		}[text];
		assert.ok(keys, `keyboard fallback for ${text}`);
		for (const key of keys) press(key);
		return;
	}
	const x = screen[y].indexOf(text) + Math.floor(text.length / 2);
	terminal.mouseClick(x, y);
	tui.renderNow();
};
const state = () => restoreReaderState(currentSession.getBranch());
const docs = () => [...state().documents.values()];
const lastCursor = () => [...currentSession.getBranch()].reverse().find((entry) => entry.type === "custom" && entry.customType === "fitch-paged-reader" && entry.data?.kind === "cursor")?.data;
const settle = () => new Promise((resolve) => setImmediate(resolve));

try {
	await event("session_start");
	const body = `${"Long readable sentence with context and emoji 🧭. ".repeat(30)}\n\n- Markdown **emphasis**\n- A second point\n\n| Topic | Detail |\n| --- | --- |\n| Table | A wide row with visible context 🧭 |\n\n\`\`\`ts\nconst longToken = "${"X".repeat(120)}";\n\`\`\`\n\n${"終端".repeat(80)}`;
	const sample = { id: "stable", revision: 1, title: "Immutable explanation", sections: [{ id: "scope", heading: "Original section", text: body }] };
	const compact = paginateDocument(sample, 21, 3);
	assert.ok(compact.length > 10, "long sections must continue through subpages");
	assert.ok(compact.every((page) => page.body.length <= 3 && page.body.every((line) => visibleWidth(line) <= 21)));
	const canonical = new Markdown(body, 0, 0, getMarkdownTheme()).render(70).map((line) => stripTerminalSequences(line).trimEnd()).join("").replace(/\s/gu, "");
	const paged = compact.flatMap((page) => page.body).map(stripTerminalSequences).join("").replace(/\s/gu, "");
	assert.equal(paged, canonical, "native Markdown content including wide characters must remain fully reachable");
	const prose = { ...sample, sections: [{ id: "scope", heading: "Word wrapping", text: `${"x".repeat(40)} deletes details.` }] };
	const wrappedWords = paginateDocument(prose, 44, 3).flatMap((page) => page.body).map(stripTerminalSequences);
	assert.ok(wrappedWords.some((line) => line.startsWith("deletes")), "a narrow panel wraps normal words rather than splitting them");
	assert.deepEqual(paginateDocument(sample, 70, 12).map((page) => page.anchor.sectionId), Array(paginateDocument(sample, 70, 12).length).fill("scope"));

	const result = await execute({ documentId: "stable", revision: 1, title: sample.title, sections: sample.sections });
	assert.ok(result.content[0].text.includes("stable revision 1"));
	assert.ok(!result.content[0].text.includes(body.slice(0, 30)), "tool result must not echo explanation body");
	assert.equal(docs().length, 1);
	assert.equal(overlay?.focused, true, "native overlay should own keyboard focus");
	if (nativeMouse) assert.deepEqual(handle?.getBounds(), { row: 0, col: 0, width: terminal.columns, height: terminal.rows });
	let screen = lines();
	assert.equal(screen.length, terminal.rows);
	assert.ok(screen.every((line) => visibleWidth(line) <= terminal.columns));
	assert.equal(screen[0].trim(), "", "the full-viewport overlay must blank the transcript behind the panel");
	assert.ok(screen.join("\n").includes("Immutable explanation"));
	assert.equal(sent.length, 0, "opening and rendering pages must make no model request");

	if (nativeMouse) {
		const footer = screen.findIndex((line) => line.includes("→ Next"));
		terminal.mouseClick(screen[footer].indexOf("→ Next") - 1, footer);
		tui.renderNow();
		assert.deepEqual(lastCursor().anchor, { sectionId: "scope", line: 0, column: 0 }, "separator cells cannot activate a hidden action");
	}
	clickText("→ Next");
	const firstMove = lastCursor();
	assert.ok(firstMove.anchor.line > 0 || firstMove.anchor.column > 0);
	press("\x1b[D");
	assert.deepEqual(lastCursor().anchor, { sectionId: "scope", line: 0, column: 0 }, "left returns to prior page");
	press(" ");
	assert.deepEqual(lastCursor().anchor, firstMove.anchor, "Space and clickable Next share navigation");
	assert.equal(sent.length, 0);

	let anchorBeforeResize = lastCursor();
	terminal.columns = 44;
	tui.renderNow();
	assert.deepEqual(lastCursor(), anchorBeforeResize, "resize must not mutate saved reading anchor");
	assert.ok(lines().every((line) => visibleWidth(line) <= 44));
	terminal.columns = 16;
	terminal.rows = 9;
	tui.renderNow();
	assert.deepEqual(lastCursor(), anchorBeforeResize, "narrow resize preserves a canonical content position");
	assert.ok(lines().every((line) => visibleWidth(line) <= 16));
	assert.ok(lines().join("\n").includes("Esc"), "compact action row retains a visible exit");
	clickText("→");
	assert.notDeepEqual(lastCursor().anchor, anchorBeforeResize.anchor, "compact clickable Next navigates rather than clipping a hidden action");
	anchorBeforeResize = lastCursor();
	terminal.columns = 100;
	terminal.rows = 28;
	tui.renderNow();
	assert.deepEqual(lastCursor(), anchorBeforeResize);

	const sectionHeaderRow = lines().findIndex((line) => line.includes("Original section"));
	const sectionHeader = lines()[sectionHeaderRow];
	clickText("N Note");
	assert.equal(lines()[sectionHeaderRow], sectionHeader, "opening a note must not shift the section heading behind status text");
	assert.ok(lines().some((line) => line.includes("Note · Immutable explanation")), "note mode is named explicitly");
	assert.equal(lines().filter((line) => /^─+$/.test(line.trim())).length, 2, "the native note editor has one top and one bottom border");
	terminal.columns = 44;
	tui.renderNow();
	assert.ok(lines().some((line) => line.includes("Original section")), "a narrow note keeps the section name visible");
	assert.ok(lines().some((line) => /Page \d+\/\d+/.test(line)), "page progress is labeled separately from the section");
	terminal.columns = 100;
	tui.renderNow();
	assert.ok(lines().join("\n").includes("Original section"), "note editor keeps section header");
	assert.ok(overlay.render(terminal.columns).some((line) => line.includes(CURSOR_MARKER)), "native Editor cursor marker reaches the focused overlay for IME");
	for (const letter of "Please clarify the implication.") press(letter);
	assert.equal(sent.length, 0, "typing a note does not enter model context");
	assert.equal(state().drafts.get("stable@1/scope"), "Please clarify the implication.");
	assert.ok(!JSON.stringify(currentSession.buildSessionContext().messages).includes("Please clarify the implication."));
	terminal.rows = 8;
	tui.renderNow();
	assert.ok(lines().join("\n").includes("Please clarify the implication."), "height-8 editor retains a visible content row");
	assert.ok(overlay.render(terminal.columns).some((line) => line.includes(CURSOR_MARKER)), "height-8 editor retains the IME cursor");
	terminal.rows = 28;
	tui.renderNow();
	press("\x13"); // Ctrl+S: local-only save.
	assert.equal(sent.length, 0);
	assert.equal(lines()[sectionHeaderRow], sectionHeader, "saving a note keeps the section heading fixed");
	press("\x1b");
	clickText("N Note");
	assert.ok(lines().join("\n").includes("Please clarify the implication."));
	press("\x1b[13;5u"); // Ctrl+Enter explicitly requests a main-agent response.
	assert.equal(sent.length, 1);
	const request = sent[0];
	assert.deepEqual(request.options, { triggerTurn: true });
	const feedbackId = request.message.details.feedbackId;
	assert.ok(request.message.content.includes(`Reader feedback ID: ${feedbackId}`));
	assert.ok(request.message.content.includes("stable · immutable revision: 1"));
	assert.ok(request.message.content.includes("Section ID: scope · heading: Original section"));
	assert.ok(request.message.content.includes(JSON.stringify({ originalSectionText: body, note: "Please clarify the implication." })));
	assert.deepEqual(lastCursor(), anchorBeforeResize, "sending cannot move original reading position");
	assert.equal(lines()[sectionHeaderRow], sectionHeader, "sending feedback keeps the section heading fixed");
	assert.ok(lines().join("\n").includes("Queued for agent"), "click alone does not claim agent delivery");
	clickText("N Note");
	press("\x1b[13;5u");
	assert.equal(sent.length, 1, "unchanged note cannot be resubmitted by the same key");
	press("\x1b");

	await event("message_start", { message: { role: "custom", customType: "fitch-paged-reader-feedback", details: request.message.details } });
	assert.ok(lines().join("\n").includes("Sent to agent"));
	await event("turn_end", { outcome: "completed", toolResults: [], message: fauxAssistantMessage("The implication is narrower than the initial claim. Here is the full response." ) });
	assert.equal(sent.length, 1);
	assert.equal(docs().length, 2, "ordinary final text becomes a stored reader reply");
	assert.equal(docs()[1].replyToFeedbackId, feedbackId);
	assert.deepEqual(lastCursor(), anchorBeforeResize, "incoming reply cannot replace current page");
	assert.ok(lines().join("\n").includes("Reply ready"));
	assert.equal(lines()[sectionHeaderRow], sectionHeader, "a ready reply cannot displace the section heading");
	clickText("R Reply");
	assert.ok(lines().join("\n").includes("The implication is narrower"));
	press("b");
	assert.deepEqual(lastCursor().anchor, anchorBeforeResize.anchor, "Back restores original document and cursor");
	assert.ok(lines().join("\n").includes("Original section"));

	const oldDraft = state().drafts.get("stable@1/scope");
	await execute({ documentId: "stable", revision: 2, title: "Revised explanation", sections: [{ id: "scope", heading: "Revised section", text: "Changed content in revision two." }] });
	assert.equal(docs().length, 3);
	assert.equal(docs()[0].sections[0].text, body, "new revision cannot overwrite the original text");
	assert.equal(state().drafts.get("stable@1/scope"), oldDraft, "notes are keyed to immutable revision");
	assert.equal(state().drafts.has("stable@2/scope"), false);
	assert.ok(lines().join("\n").includes("Original section"), "new publication cannot replace active page");
	await assert.rejects(execute({ documentId: "stable", revision: 1, title: "Bad overwrite", sections: [{ id: "scope", heading: "Changed", text: "Overwritten" }] }), /already exists/);
	await assert.rejects(execute({ title: "Bad reply", sections: [{ heading: "Response", text: "wrong" }], replyToFeedbackId: "unknown" }), /Unknown reader feedback ID/);

	const saved = lastCursor();
	press("\x1b");
	await settle();
	assert.equal(overlay, undefined);
	currentSession = SessionManager.open(sessionFile);
	await event("session_start");
	assert.equal(sent.length, 1, "restart must not auto-resend feedback");
	await command.handler("", ctx());
	assert.deepEqual(lastCursor().anchor, saved.anchor, "/reader reopens at persisted cursor after file-backed restart");
	assert.ok(lines().join("\n").includes("Original section"));
	clickText("N Note");
	assert.ok(lines().join("\n").includes("Please clarify the implication."), "note draft survives file-backed restart");
	press("\x1b");
	clickText("L List");
	assert.ok(lines().join("\n").includes("Revised explanation"));
	clickText("Revised explanation");
	assert.ok(lines().join("\n").includes("Revised section"), "native pointer opens a library row");
	clickText("L List");
	clickText("Immutable explanation");
	assert.ok(lines().join("\n").includes("Original section"));
	press("\x1b");
	await settle();

	const beforeDemo = sent.length;
	await command.handler("demo", ctx());
	assert.equal(sent.length, beforeDemo, "built-in demo is entirely local");
	assert.ok(lines().join("\n").includes("A quiet reading example"));
	assert.ok(docs().length >= 4);

	clickText("N Note");
	for (const letter of "A second note.") press(letter);
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
	for (const letter of " More detail.") press(letter);
	press("\x1b[13;5u");
	assert.equal(sent.length, beforeDemo + 2, "an edited note can explicitly request a new response");
	await event("agent_settled");
	assert.ok(lines().join("\n").includes("No saved reply"));
	clickText("N Note");
	for (const letter of " UNSENT") press(letter);
	press("\x1b");
	const unsentDraft = state().drafts.get(`${lastCursor().key}/${lastCursor().anchor.sectionId}`);
	assert.ok(unsentDraft?.endsWith(" UNSENT"));
	clickText("T Retry");
	assert.equal(sent.length, beforeDemo + 3, "an explicit Retry may request again after an unanswered turn");
	assert.ok(!sent.at(-1).message.content.includes("UNSENT"), "Retry sends only the prior submitted note, never a newer local draft");
	press("t");
	assert.equal(sent.length, beforeDemo + 3, "repeated Retry does not duplicate an outstanding request");
	const secondFeedbackId = sent.at(-1).message.details.feedbackId;
	const demoCursor = lastCursor();
	await execute({
		title: "Answer to the example",
		sections: [{ id: "answer", heading: "Response", text: "The local note was explicitly delivered." }],
		replyToFeedbackId: secondFeedbackId,
	});
	assert.deepEqual(lastCursor(), demoCursor, "structured reply only updates the badge");
	assert.ok(lines().join("\n").includes("Reply ready"));
	press("r");
	assert.ok(lines().join("\n").includes("The local note was explicitly delivered."));
	press("b");
	assert.deepEqual(lastCursor().anchor, demoCursor.anchor);

	press("\x1b");
	await settle();
	tui.stop();
	tui = new TuiMainScreen(terminal);
	tui.start();
	assert.equal(tui.mode, "regular");
	await command.handler("", ctx());
	const regularStart = lastCursor();
	press("\x1b[C");
	assert.notDeepEqual(lastCursor().anchor, regularStart.anchor, "regular-mode keyboard still advances a page");
	assert.equal(sent.length, beforeDemo + 3, "regular navigation makes no model call");
	press("\x1b");
	await settle();

	const firstDocumentEntry = currentSession.getBranch().find((entry) =>
		entry.type === "custom" && entry.data?.kind === "document" && entry.data.document.id === "stable");
	assert.ok(firstDocumentEntry);
	currentSession.branch(firstDocumentEntry.id);
	await event("session_tree");
	assert.deepEqual(docs().map((doc) => `${doc.id}@${doc.revision}`), ["stable@1"]);
	assert.equal(lastCursor().key, "stable@1", "tree navigation persists a cursor on the selected branch");
	const resumedTree = SessionManager.open(sessionFile);
	assert.deepEqual(restoreReaderState(resumedTree.getBranch()).order, ["stable@1"], "resuming cannot jump to the abandoned branch");

	currentSession = SessionManager.create(join(root, "print"), join(root, "print-sessions"));
	currentSession.appendMessage(fauxAssistantMessage("Print-mode baseline"));
	await event("session_start");
	const printCtx = { mode: "print", hasUI: false, ui: { notify() {} }, sessionManager: currentSession };
	await tool.execute("print-publish", {
		title: "Print-mode explanation", sections: [{ heading: "Still saved", text: "Non-interactive publication remains available." }],
	}, undefined, undefined, printCtx);
	assert.equal(docs().length, 1);
	assert.equal(overlay, undefined, "non-TUI publication never opens a terminal component");

	currentSession = SessionManager.create(join(root, "ambiguous"), join(root, "ambiguous-sessions"));
	currentSession.appendMessage(fauxAssistantMessage("Ambiguous reply baseline"));
	await event("session_start");
	await execute({ title: "Two questions", sections: [
		{ id: "first", heading: "First section", text: "First original." },
		{ id: "second", heading: "Second section", text: "Second original." },
	] });
	const sentBeforeAmbiguous = sent.length;
	press("n");
	press("A");
	press("\x1b[13;5u");
	press("\x1b[C");
	press("n");
	press("B");
	press("\x1b[13;5u");
	assert.equal(sent.length, sentBeforeAmbiguous + 2);
	for (const request of sent.slice(-2)) {
		await event("message_start", { message: { role: "custom", customType: "fitch-paged-reader-feedback", details: request.message.details } });
	}
	await event("turn_end", { outcome: "completed", toolResults: [], message: fauxAssistantMessage("A combined answer that cannot safely be assigned to one note.") });
	assert.equal(docs().length, 2);
	assert.equal(docs()[1].replyToFeedbackId, undefined);
	assert.equal(docs()[1].unlinkedFeedbackIds.length, 2);
	assert.ok(lines().join("\n").includes("Unlinked response in L List"));
	press("l");
	press("\x1b[B");
	press("\r");
	assert.ok(lines().join("\n").includes("A combined answer"), "ambiguous response remains readable from the library");
	press("\x1b");
	await settle();
	await event("agent_settled");
	const ambiguousFile = currentSession.getSessionFile();
	currentSession = SessionManager.open(ambiguousFile);
	await event("session_start");
	assert.equal(sent.length, sentBeforeAmbiguous + 2, "restart never auto-resends ambiguous or unanswered feedback");
	assert.equal(docs()[1].unlinkedFeedbackIds.length, 2);

	currentSession = SessionManager.create(join(root, "partial"), join(root, "partial-sessions"));
	currentSession.appendMessage(fauxAssistantMessage("Length-stopped baseline"));
	await event("session_start");
	await execute({ title: "Needs a complete reply", sections: [{ heading: "Question", text: "Full original section." }] });
	press("n");
	press("Q");
	press("\x1b[13;5u");
	const partialId = sent.at(-1).message.details.feedbackId;
	await event("message_start", { message: { role: "custom", customType: "fitch-paged-reader-feedback", details: { feedbackId: partialId } } });
	await event("turn_end", { outcome: "completed", toolResults: [], message: fauxAssistantMessage("TRUNCATED BEFORE END", { stopReason: "length" }) });
	assert.equal(docs()[1].incomplete, true);
	assert.equal(docs()[1].replyToFeedbackId, undefined, "a length-stopped answer must never be linked as a complete reply");
	assert.equal(state().replies(partialId).length, 0);
	assert.ok(lines().join("\n").includes("Incomplete response in L List"));
	assert.ok(!lines().join("\n").includes("Reply ready"));
	await event("turn_end", { outcome: "completed", toolResults: [], message: fauxAssistantMessage("COMPLETE AFTER RECOVERY") });
	await event("agent_settled");
	assert.equal(state().replies(partialId).length, 1, "native recovery retains correlation without re-emitting feedback input");
	assert.ok(lines().join("\n").includes("Reply ready"));
	press("l");
	press("\x1b[B");
	press("\r");
	assert.ok(lines().join("\n").includes("TRUNCATED BEFORE END"), "partial text remains accessible without claiming completion");
	press("\x1b");
	await settle();

	console.log("paged-reader regression: bounded native pages, fullscreen clicks and regular keys, durable drafts/cursors, explicit feedback, linked and unlinked replies, revisions, tree and file-backed resume passed");
} finally {
	if (overlay) overlay.close(false);
	tui.stop();
}

const originalCapabilities = hostTui.getCapabilities();
const imageTerminal = new Terminal();
let imageTui;
try {
	hostTui.setCapabilities({ ...originalCapabilities, images: "kitty" });
	imageTui = new hostTui.TuiAltScreen(imageTerminal);
	imageTui.start();
	const transcript = new hostTui.Container();
	transcript.addChild(new hostTui.Image("AA==", "image/png", { fallbackColor: (text) => text },
		{ maxWidthCells: 10, maxHeightCells: 2 }, { widthPx: 2, heightPx: 2 }));
	imageTui.addChild(transcript);
	imageTui.renderNow();
	assert.ok(imageTui.previousScreen.some((line) => line.includes("\x1b_G")), "native transcript contains an inline image before opening reader");
	tui = imageTui;
	await command.handler("", ctx());
	imageTui.renderNow();
	assert.equal(hostTui.getCapabilities().images, null, "fullscreen reader temporarily suppresses native image rendering");
	assert.ok(imageTui.previousScreen.every((line) => !line.includes("\x1b_G")), "the reader masks image rows as well as text");
	assert.ok(imageTerminal.writes.some((part) => part.includes("a=d,d=a") || part.includes("a=d,d=A")), "native fullscreen repaint clears Kitty placements");
	overlay.handleInput("\x1b");
	await settle();
	imageTui.renderNow();
	assert.equal(hostTui.getCapabilities().images, "kitty", "closing restores the exact image protocol");
	assert.ok(imageTui.previousScreen.some((line) => line.includes("\x1b_G")), "native image rows render again after closing");
	console.log("paged-reader native image overlay: Kitty rows masked, placements cleared, capabilities restored");
} finally {
	if (overlay) overlay.close(false);
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
let sdkOverlay;
let sdkHandle;
let finishOverlay;
const nativeUi = {
	custom(factory, options) {
		const promise = new Promise((resolve) => { finishOverlay = resolve; });
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
const faux = fauxProvider({ models: [{ id: "reader-model", contextWindow: 64_000, reasoning: false }] });
const model = faux.getModel();
const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
runtime.registerProvider(model.provider, {
	api: model.api, baseUrl: model.baseUrl, apiKey: "test-only", models: faux.models,
	streamSimple: faux.provider.streamSimple,
});
const sdkManager = SessionManager.create(sdkCwd, join(root, "sdk-sessions"));
sdkManager.appendMessage({ ...fauxAssistantMessage("Synthetic baseline"), api: model.api, provider: model.provider, model: model.id });
const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const loader = new DefaultResourceLoader({
	cwd: sdkCwd, agentDir: sdkAgentDir, settingsManager: settings,
	additionalExtensionPaths: [fileURLToPath(new URL("../extensions/paged-reader.ts", import.meta.url))],
	noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
});
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
const { session: sdkSession } = await createAgentSession({
	cwd: sdkCwd, agentDir: sdkAgentDir, model, modelRuntime: runtime,
	settingsManager: settings, sessionManager: sdkManager, resourceLoader: loader, tools: [],
});
try {
	const baseUi = sdkSession.extensionRunner.createContext().ui;
	await sdkSession.bindExtensions({
		mode: "tui", uiContext: { ...baseUi, ...nativeUi },
		onError(error) { throw new Error(`${error.event}: ${error.error}`); },
	});
	await sdkSession.prompt("/reader demo");
	assert.ok(sdkOverlay, "real command dispatch opens a reader overlay");
	let releaseUnrelated;
	let startedUnrelated;
	const started = new Promise((resolve) => { startedUnrelated = resolve; });
	let nativeFeedback;
	faux.setResponses([
		async () => {
			startedUnrelated();
			await new Promise((resolve) => { releaseUnrelated = resolve; });
			return fauxAssistantMessage("Unrelated task finished first.");
		},
		async (context) => {
			nativeFeedback = JSON.stringify(context.messages);
			return fauxAssistantMessage("A correlated answer from the native follow-up.");
		},
	]);
	const unrelated = sdkSession.prompt("An unrelated task is already running");
	await started;
	sdkOverlay.handleInput("n");
	for (const key of "Native note") sdkOverlay.handleInput(key);
	sdkOverlay.handleInput("\x1b[13;5u");
	assert.equal(faux.state.callCount, 1, "feedback stays queued while the unrelated model turn runs");
	releaseUnrelated();
	await unrelated;
	await sdkSession.waitForIdle();
	assert.equal(faux.state.callCount, 2, "the main agent, not a nested client, handles explicit feedback");
	assert.ok(nativeFeedback.includes("Native note"));
	assert.ok(nativeFeedback.includes("Document ID:"));
	assert.ok(nativeFeedback.includes("One idea at a time"));
	const nativeState = restoreReaderState(sdkManager.getBranch());
	const nativeReply = [...nativeState.documents.values()].find((doc) => doc.replyToFeedbackId);
	assert.ok(nativeReply, "native assistant final text must become a linked reader reply");
	assert.match(nativeReply.sections[0].text, /correlated answer/);
	assert.equal(nativeState.cursors.get(nativeState.order[0]).sectionId, "section-1");
	assert.ok(sdkOverlay.render(sdkTerminal.columns).map(stripTerminalSequences).join("\n").includes("Reply ready"));

	let startedAbort;
	const abortStarted = new Promise((resolve) => { startedAbort = resolve; });
	faux.setResponses([async (_context, options) => {
		startedAbort();
		await new Promise((resolve) => {
			if (options?.signal?.aborted) resolve();
			else options?.signal?.addEventListener("abort", resolve, { once: true });
		});
		return fauxAssistantMessage("", { stopReason: "aborted" });
	}]);
	const interruptedWork = sdkSession.prompt("A different busy task that will be canceled");
	await abortStarted;
	sdkOverlay.handleInput("n");
	for (const key of " Private note") sdkOverlay.handleInput(key);
	sdkOverlay.handleInput("\x1b[13;5u");
	const pendingPrivate = restoreReaderState(sdkManager.getBranch()).latestFeedback(nativeState.order[0], "section-1");
	assert.ok(pendingPrivate?.note.endsWith("Private note"));
	const callsAtAbort = faux.state.callCount;
	await sdkSession.abort();
	await Promise.allSettled([interruptedWork]);
	await sdkSession.waitForIdle();
	assert.equal(faux.state.callCount, callsAtAbort, "native abort cannot secretly deliver a session-local pending note");
	const afterAbort = restoreReaderState(sdkManager.getBranch());
	assert.equal(afterAbort.statuses.get(pendingPrivate.id), "interrupted");
	assert.equal(afterAbort.replies(pendingPrivate.id).length, 0);
	assert.ok(sdkOverlay.render(sdkTerminal.columns).map(stripTerminalSequences).join("\n").includes("Queued request canceled"));
	let nextRequestContext;
	faux.setResponses([async (context) => {
		nextRequestContext = JSON.stringify(context.messages);
		return fauxAssistantMessage("The next unrelated task is complete.");
	}]);
	await sdkSession.prompt("An unrelated question after cancellation");
	await sdkSession.waitForIdle();
	assert.equal(faux.state.callCount, callsAtAbort + 1, "canceled reader work cannot drain on a later prompt");
	assert.ok(!nextRequestContext.includes("Private note"), "an unsent draft stays outside model context after cancellation");
	assert.equal(restoreReaderState(sdkManager.getBranch()).replies(pendingPrivate.id).length, 0);
	sdkOverlay.handleInput("\x1b");
	await new Promise((resolve) => setImmediate(resolve));
	console.log("paged-reader native SDK: busy feedback, abort/no-ghost delivery, exact section context and final-text correlation passed without a paid model");
} finally {
	if (sdkOverlay) sdkOverlay.close(false);
	await sdkSession.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	sdkSession.dispose();
	sdkTui.stop();
}
