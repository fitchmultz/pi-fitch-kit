#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	initTheme,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

const root = fileURLToPath(new URL("..", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "pi-clean-footer-"));
const previousHome = process.env.HOME;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousOffline = process.env.PI_OFFLINE;
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
	const manager = SessionManager.inMemory(cwd);
	manager.appendSessionInfo("Original");
	const leaf = manager.appendMessage(assistant(20, 80));
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
	const loader = new DefaultResourceLoader({
		cwd, agentDir, settingsManager,
		additionalExtensionPaths: [join(root, "extensions/clean-footer.ts")],
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
	});
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
	const entries = mock.method(manager, "getEntries");
	const initial = render();
	assert.match(initial, /Original/);
	assert.match(initial, /CH80\.0%/);
	const initialScans = entries.mock.callCount();
	entries.mock.resetCalls();
	for (let i = 0; i < 3; i++) {
		footer.invalidate();
		assert.equal(render(), initial);
	}
	const redrawScans = entries.mock.callCount();
	const hasRevision = typeof manager.getEntriesRevision === "function";

	// Live context can grow before another journal entry is persisted.
	const beforeUsage = session.getContextUsage();
	session.agent.state.messages = [...session.agent.state.messages, { role: "user", content: "x".repeat(40_000), timestamp: 1 }];
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
	manager.appendMessage(assistant(100, 0));
	manager.appendSessionInfo("Renamed\nbranch");
	manager.branch(leaf);
	assert.equal(manager.getLeafId(), leaf);
	assert.match(render(), /Renamed branch/);
	assert.match(render(), /CH0\.0%/);
	manager.appendSessionInfo(" \n ");
	manager.appendMessage(assistant(0, 0));
	manager.branch(leaf);
	assert.doesNotMatch(render(), /Renamed|Original|CH/);

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
	assert.match(render(), /Reloaded/);
	assert.match(render(), /CH75\.0%/);
	manager.newSession();
	assert.doesNotMatch(render(), /Reloaded|Original|CH/);

	// The checkpoint hook persists only the instance toggle, not derived footer data.
	await session.prompt("/clean-footer");
	assert.equal(footer, undefined);
	const barrier = loader.getExtensions().extensions[0].handlers.get("session_checkpoint");
	assert.equal(barrier?.length, 1);
	const event = { type: "session_checkpoint", boundary: "settled", signal: new AbortController().signal, invalidate() {} };
	assert.deepEqual(await barrier[0](event, session.extensionRunner.createContext()), { sleepReady: true });
	assert.deepEqual(manager.getEntries().at(-1).data, { sessionId: manager.getSessionId(), enabled: false });
	await session.reload();
	assert.ok(footer, "Warm reload retains the existing reset-to-enabled behavior");

	assert.equal(faux.state.callCount, 0, "No provider calls");
	assert.equal(initialScans, 1, "Name and cache data use one entry pass");
	assert.equal(redrawScans, hasRevision ? 0 : 3, "Unchanged entries are cached only when the host supplies a revision");
	console.log(JSON.stringify({ ok: true, hasRevision, initialScans, redrawScans, providerCalls: faux.state.callCount }));
} finally {
	await session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	footer?.dispose?.();
	session?.dispose();
	mock.restoreAll();
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	if (previousOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = previousOffline;
	rmSync(temp, { recursive: true, force: true });
}
