#!/usr/bin/env node
import assert from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { findPackageJSON, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// As with write-prompt-boundary, an optional package root supports a focused
// read-only host probe. Normal checks consume the selected node_modules graph.
const sdkPath = process.argv[2] ? pathToFileURL(join(process.argv[2], "dist/index.js")).href : import.meta.resolve("@earendil-works/pi-coding-agent");
const hostRoot = fileURLToPath(new URL("..", sdkPath));
if (process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR) assert.equal(realpathSync(hostRoot), realpathSync(process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR));
if (process.env.PI_HOST_INDEX) assert.equal(realpathSync(fileURLToPath(sdkPath)), realpathSync(process.env.PI_HOST_INDEX));
const hostVersion = JSON.parse(readFileSync(join(hostRoot, "package.json"), "utf8")).version;
if (process.env.PI_COMPAT_EXPECTED_VERSION) assert.equal(hostVersion, process.env.PI_COMPAT_EXPECTED_VERSION);
const { createAgentSession, DefaultResourceLoader, initTheme, ModelRuntime, SessionManager, SettingsManager } = await import(sdkPath);
const aiManifest = pathToFileURL(findPackageJSON("@earendil-works/pi-ai", sdkPath));
const tuiManifest = pathToFileURL(findPackageJSON("@earendil-works/pi-tui", sdkPath));
const { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } = await import(new URL(JSON.parse(readFileSync(aiManifest, "utf8")).exports["."].import, aiManifest).href);
const { getCapabilities, setCapabilities, stripTerminalSequences, visibleWidth } = await import(new URL(JSON.parse(readFileSync(tuiManifest, "utf8")).main, tuiManifest).href);
console.log(JSON.stringify({ host: process.env.PI_COMPAT_HOST ?? "local", version: hostVersion, sdkPath }));

const root = fileURLToPath(new URL("..", import.meta.url));
// Location text containing CH must not be mistaken for the cache indicator.
const temp = mkdtempSync(join(tmpdir(), "pi-clean-footer-CH-"));
const previousHome = process.env.HOME;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousOffline = process.env.PI_OFFLINE;
const previousCapabilities = getCapabilities();
let session;
let footer;

try {
	const cwd = join(temp, "project");
	const agentDir = join(temp, "agent");
	mkdirSync(cwd);
	mkdirSync(agentDir);
	process.env.HOME = temp;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_OFFLINE = "1";
	// Keep theme changes visible instead of quantizing both dim colors to the same palette entry.
	setCapabilities({ ...previousCapabilities, trueColor: true });
	initTheme("dark", false);

	const faux = fauxProvider({ models: [{ id: "footer-model", contextWindow: 200_000, reasoning: true }] });
	const model = faux.getModel();
	const assistant = (input, cacheRead, cacheWrite = 0) => ({
		...fauxAssistantMessage("ok"),
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input, output: 10, cacheRead, cacheWrite, totalTokens: input + cacheRead + cacheWrite + 10,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	});
	const saved = SessionManager.inMemory(cwd);
	const named = saved.appendSessionInfo("Original");
	// An abandoned branch must contribute file-wide facts, not force its payloads into the footer.
	const historyEntries = Number(process.env.FOOTER_HISTORY_ENTRIES ?? 256);
	const historyBytes = Number(process.env.FOOTER_HISTORY_BYTES ?? 8192);
	for (let i = 0; i < historyEntries; i++) saved.appendMessage({ ...assistant(100, 0), content: [{ type: "text", text: "x".repeat(historyBytes) }] });
	saved.branch(named);
	const leaf = saved.appendMessage(assistant(20, 80));
	const initialPath = join(temp, "initial.jsonl");
	writeFileSync(initialPath, `${[saved.getHeader(), ...saved.getEntries()].map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	const manager = SessionManager.open(initialPath);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
	const resourceOptions = {
		cwd, agentDir, settingsManager,
		additionalExtensionPaths: [join(root, "extensions/clean-footer.ts")],
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
	};
	const loader = new DefaultResourceLoader(resourceOptions);
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
	({ session } = await createAgentSession({ cwd, agentDir, model, modelRuntime, settingsManager, sessionManager: manager, resourceLoader: loader, tools: [] }));
	const ui = session.extensionRunner.createContext().ui;
	const statuses = new Map();
	let providerCount = 1;
	await session.bindExtensions({
		mode: "tui",
		uiContext: {
			...ui,
			setFooter(factory) {
				footer?.dispose?.();
				footer = factory?.({ requestRender() {} }, ui.theme, {
					getGitBranch: () => null,
					getAvailableProviderCount: () => providerCount,
					getExtensionStatuses: () => statuses,
					onBranchChange: () => () => {},
				});
			},
		},
		onError(error) { throw new Error(error.error); },
	});
	assert.ok(footer, "Native session_start installs the footer");
	const render = (width = 120) => footer.render(width).map(stripTerminalSequences).join("\n");
	session.getContextUsage();
	const entries = mock.method(manager, "getEntries");
	session.getContextUsage();
	const usageScans = entries.mock.callCount();
	entries.mock.resetCalls();
	const reads = mock.method(fs, "readSync");
	syncBuiltinESMExports();
	const initial = render();
	const initialBodyBytes = reads.mock.calls.reduce((sum, call) => sum + call.result, 0);
	reads.mock.restore();
	syncBuiltinESMExports();
	assert.match(initial, /Original/);
	assert.match(initial, /CH80\.0%/);
	const initialScans = entries.mock.callCount();
	entries.mock.resetCalls();
	for (let i = 0; i < 100; i++) {
		footer.invalidate();
		assert.equal(render(), initial);
	}
	const redrawScans = entries.mock.callCount();

	for (const [percent, expected] of [[45.2, "45.2%/200k"], [0, "0.0%/200k"], [null, "?/200k"]]) {
		await session.extensionRunner.emit({ type: "model_select", model, previousModel: model, source: "set" });
		const contextUsage = mock.method(session, "getContextUsage", () => ({
			tokens: percent === null ? null : percent * 2000, contextWindow: 200_000, percent,
		}));
		assert.equal(render().split("\n")[1], `${expected} • CH80.0%`);
		assert.equal(contextUsage.mock.callCount(), 1, "A dirty snapshot acquires native usage once");
		for (const line of footer.render(12)) assert.ok(visibleWidth(line) <= 12);
		contextUsage.mock.restore();
	}

	// Non-triggering messages update both session history and live context.
	const beforeUsage = session.getContextUsage();
	await session.sendCustomMessage({ customType: "footer-test", content: "x".repeat(40_000), display: false }, { triggerTurn: false });
	const afterUsage = session.getContextUsage();
	assert.ok(afterUsage.percent > beforeUsage.percent);
	assert.ok(render().includes(`${afterUsage.percent.toFixed(1)}%/200k`));
	providerCount = 2;
	statuses.set("status", "Working\nnow");
	session.agent.state.model = { ...model, id: "other-model" };
	session.agent.state.thinkingLevel = "high";
	const dark = footer.render(120);
	initTheme("light", false);
	footer.invalidate();
	assert.notDeepEqual(footer.render(120), dark);
	assert.match(render(), /other-model • high/);
	assert.ok(render().includes(`(${model.provider})`));
	assert.match(render(), /Working now/);
	const narrow = render(30);
	assert.match(narrow, /Original/);
	assert.match(narrow, /CH80\.0%/);
	for (const line of footer.render(30)) assert.ok(visibleWidth(line) <= 30);

	const original = [manager.getHeader(), ...manager.getEntries()];
	await session.extensionRunner.emit({ type: "message_end", message: assistant(100, 0) });
	manager.appendMessage(assistant(100, 0));
	session.setSessionName("Renamed\nbranch");
	manager.branch(leaf);
	assert.equal(manager.getLeafId(), leaf);
	assert.match(render(), /Renamed branch/);
	assert.match(render(), /CH0\.0%/);
	session.setSessionName(" \n ");
	await session.extensionRunner.emit({ type: "message_end", message: assistant(0, 0) });
	manager.appendMessage(assistant(0, 0));
	manager.branch(leaf);
	assert.doesNotMatch(render(), /Renamed|Original|• CH/);

	manager.createBranchedSession(leaf);
	assert.match(render(), /Original/);
	assert.match(render(), /CH80\.0%/);
	const path = join(temp, "session.jsonl");
	writeFileSync(path, `${original.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	manager.setSessionFile(path);
	assert.match(render(), /Original/);
	const replacement = original.map((entry) => entry.type === "session_info"
		? { ...entry, name: "Reloaded" }
		: entry.type === "message" ? { ...entry, message: assistant(50, 150) } : entry);
	writeFileSync(path, `${replacement.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	manager.setSessionFile(path);
	// Official has no external journal-edit event: the SDK owner must reconcile lifecycle explicitly.
	await session.extensionRunner.emit({ type: "session_start", reason: "reload" });
	assert.match(render(), /Reloaded/);
	assert.match(render(), /CH75\.0%/);
	manager.newSession();
	session.refreshContext();
	assert.doesNotMatch(render(), /Reloaded|Original|• CH/);

	// Exercise message_end-before-append through the actual host, not just a handler fixture.
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.refresh({ allowNetwork: false });
	await session.setModel(model);
	faux.setResponses([assistant(25, 75)]);
	await session.prompt("offline finalized-message footer check");
	await session.waitForIdle();
	const finalized = manager.getBranch().findLast((entry) => entry.type === "message" && entry.message.role === "assistant").message.usage;
	const finalizedRate = finalized.cacheRead / (finalized.input + finalized.cacheRead + finalized.cacheWrite) * 100;
	assert.ok(render().includes(`CH${finalizedRate.toFixed(1)}%`), "File-wide facts follow the actually persisted native response");
	const settledUsage = session.getContextUsage();
	assert.ok(render().includes(`${settledUsage.percent.toFixed(1)}%/200k`), "Finalized usage is reconciled after persistence");
	entries.mock.resetCalls();
	for (let i = 0; i < 100; i++) render();
	assert.equal(entries.mock.callCount(), 0, "Settled redraws remain bounded after native append events");

	// Fresh SDK startup reads a saved journal, not the previous extension's live toggle.
	for (const matchingId of [true, false]) {
		const saved = SessionManager.inMemory(cwd);
		saved.appendCustomEntry("clean-footer-checkpoint", {
			sessionId: matchingId ? saved.getSessionId() : "copied-parent-session",
			enabled: false,
		});
		const savedPath = join(temp, `cold-${matchingId}.jsonl`);
		writeFileSync(savedPath, `${[saved.getHeader(), ...saved.getEntries()].map((entry) => JSON.stringify(entry)).join("\n")}\n`);
		const coldLoader = new DefaultResourceLoader(resourceOptions);
		await coldLoader.reload();
		assert.deepEqual(coldLoader.getExtensions().errors, []);
		const { session: coldSession } = await createAgentSession({
			cwd, agentDir, model, modelRuntime, settingsManager,
			sessionManager: SessionManager.open(savedPath), resourceLoader: coldLoader, tools: [],
		});
		let coldFooter;
		try {
			await coldSession.bindExtensions({
				mode: "tui",
				uiContext: { ...coldSession.extensionRunner.createContext().ui, setFooter(factory) { coldFooter = factory; } },
				onError(error) { throw new Error(error.error); },
			});
			if (matchingId) assert.equal(coldFooter, undefined, "Cold startup restores the matching session's disabled footer");
			else assert.equal(typeof coldFooter, "function", "Cold startup ignores a copied checkpoint from another session");
		} finally {
			await coldSession.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			coldSession.dispose();
		}
	}

	// The instance toggle remains live-only; old checkpoint entries above are recovery data.
	await session.prompt("/clean-footer");
	assert.equal(footer, undefined);

	await session.reload();
	assert.ok(footer, "Warm reload retains the existing reset-to-enabled behavior");

	assert.equal(faux.state.callCount, 1, "Only the offline faux lifecycle turn; no paid provider calls");
	assert.equal(initialScans - usageScans, 1, "File-wide facts bootstrap once through the public host API");
	assert.equal(redrawScans, 0, "100 unchanged redraws acquire neither usage nor full history on either host");
	console.log(JSON.stringify({ ok: true, historyEntries, initialBodyBytes, usageScans, initialScans, redrawScans, providerCalls: faux.state.callCount }));
} finally {
	await session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	footer?.dispose?.();
	session?.dispose();
	mock.restoreAll();
	syncBuiltinESMExports();
	setCapabilities(previousCapabilities);
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	if (previousOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = previousOffline;
	rmSync(temp, { recursive: true, force: true });
}
