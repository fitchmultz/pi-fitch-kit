#!/usr/bin/env node
import assert from "node:assert/strict";
import fs, {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { findPackageJSON, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
	AgentSession,
	createAgentSession as CreateAgentSessionFn,
	DefaultResourceLoader,
	ExtensionAPI,
	ExtensionUIContext,
	initTheme as InitThemeFn,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	fauxAssistantMessage as FauxAssistantMessageFn,
	fauxProvider as FauxProviderFn,
	InMemoryCredentialStore as InMemoryCredentialStoreCtor,
} from "@earendil-works/pi-ai";
import type {
	getCapabilities as GetCapabilitiesFn,
	setCapabilities as SetCapabilitiesFn,
	stripTerminalSequences as StripTerminalSequencesFn,
	visibleWidth as VisibleWidthFn,
} from "@earendil-works/pi-tui";
import { jsonField, jsonString, requireRecord } from "./test-harness.ts";

/** The host-selected Pi SDK surface this footer regression drives. */
type HostSdk = {
	createAgentSession: typeof CreateAgentSessionFn;
	DefaultResourceLoader: typeof DefaultResourceLoader;
	initTheme: typeof InitThemeFn;
	ModelRuntime: typeof ModelRuntime;
	SessionManager: typeof SessionManager;
	SettingsManager: typeof SettingsManager;
};
const isHostSdk = (module: unknown): module is HostSdk =>
	typeof module === "object" &&
	module !== null &&
	"createAgentSession" in module &&
	"DefaultResourceLoader" in module &&
	"initTheme" in module &&
	"ModelRuntime" in module &&
	"SessionManager" in module &&
	"SettingsManager" in module;

/** The host-selected pi-ai surface the offline faux provider needs. */
type HostAi = {
	fauxAssistantMessage: typeof FauxAssistantMessageFn;
	fauxProvider: typeof FauxProviderFn;
	InMemoryCredentialStore: typeof InMemoryCredentialStoreCtor;
};
const isHostAi = (module: unknown): module is HostAi =>
	typeof module === "object" &&
	module !== null &&
	"fauxAssistantMessage" in module &&
	"fauxProvider" in module &&
	"InMemoryCredentialStore" in module;

/** The host-selected pi-tui surface the footer assertions need. */
type HostTui = {
	getCapabilities: typeof GetCapabilitiesFn;
	setCapabilities: typeof SetCapabilitiesFn;
	stripTerminalSequences: typeof StripTerminalSequencesFn;
	visibleWidth: typeof VisibleWidthFn;
};
const isHostTui = (module: unknown): module is HostTui =>
	typeof module === "object" &&
	module !== null &&
	"getCapabilities" in module &&
	"setCapabilities" in module &&
	"stripTerminalSequences" in module &&
	"visibleWidth" in module;

/** The subset of the installed footer component this regression exercises. */
type FooterComponent = {
	render: (width: number) => string[];
	invalidate: () => void;
	dispose?: () => void;
};
// As with write-prompt-boundary, an optional package root supports a focused
// read-only host probe. Normal checks consume the selected node_modules graph.
const sdkPath =
	process.argv[2] !== undefined
		? pathToFileURL(join(process.argv[2], "dist/index.js")).href
		: import.meta.resolve("@earendil-works/pi-coding-agent");
const hostRoot = fileURLToPath(new URL("..", sdkPath));
if (process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR !== undefined) {
	assert.equal(realpathSync(hostRoot), realpathSync(process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR));
}
if (process.env.PI_HOST_INDEX !== undefined) {
	assert.equal(realpathSync(fileURLToPath(sdkPath)), realpathSync(process.env.PI_HOST_INDEX));
}
const hostVersion = requireRecord(
	JSON.parse(readFileSync(join(hostRoot, "package.json"), "utf8")),
	"host package.json",
).version;
if (process.env.PI_COMPAT_EXPECTED_VERSION !== undefined) {
	assert.equal(hostVersion, process.env.PI_COMPAT_EXPECTED_VERSION);
}
const sdkModule: unknown = await import(sdkPath);
if (!isHostSdk(sdkModule)) {
	throw new Error("host Pi SDK did not expose the expected session surface");
}
const {
	createAgentSession,
	DefaultResourceLoader: HostLoader,
	initTheme,
	ModelRuntime: HostModelRuntime,
	SessionManager: HostSessionManager,
	SettingsManager: HostSettingsManager,
} = sdkModule;
const aiPackageJson = findPackageJSON("@earendil-works/pi-ai", sdkPath);
if (aiPackageJson === undefined) {
	throw new Error("could not locate the host pi-ai package");
}
const tuiPackageJson = findPackageJSON("@earendil-works/pi-tui", sdkPath);
if (tuiPackageJson === undefined) {
	throw new Error("could not locate the host pi-tui package");
}
const aiManifest = pathToFileURL(aiPackageJson);
const tuiManifest = pathToFileURL(tuiPackageJson);
const aiManifestRecord = requireRecord(
	JSON.parse(readFileSync(aiManifest, "utf8")),
	"pi-ai manifest",
);
const aiDotExport = requireRecord(
	jsonField(aiManifestRecord, "exports", "pi-ai exports")["."],
	"pi-ai dot export",
);
const aiModule: unknown = await import(
	new URL(jsonString(aiDotExport.import, "pi-ai import"), aiManifest).href
);
if (!isHostAi(aiModule)) {
	throw new Error("host pi-ai did not expose the faux provider surface");
}
const { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } = aiModule;
const tuiManifestRecord = requireRecord(
	JSON.parse(readFileSync(tuiManifest, "utf8")),
	"pi-tui manifest",
);
const tuiModule: unknown = await import(
	new URL(jsonString(tuiManifestRecord.main, "pi-tui main"), tuiManifest).href
);
if (!isHostTui(tuiModule)) {
	throw new Error("host pi-tui did not expose the terminal surface");
}
const { getCapabilities, setCapabilities, stripTerminalSequences, visibleWidth } = tuiModule;
console.log(
	JSON.stringify({ host: process.env.PI_COMPAT_HOST ?? "local", version: hostVersion, sdkPath }),
);

const root = fileURLToPath(new URL("..", import.meta.url));
// Location text containing CH must not be mistaken for the cache indicator.
const temp = mkdtempSync(join(tmpdir(), "pi-clean-footer-CH-"));
const previousHome = process.env.HOME;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousOffline = process.env.PI_OFFLINE;
const previousCapabilities = getCapabilities();
let session: AgentSession | undefined;
let footer: FooterComponent | undefined;

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

	const faux = fauxProvider({
		models: [{ id: "footer-model", contextWindow: 200_000, reasoning: true }],
	});
	const model = faux.getModel();
	const assistant = (input: number, cacheRead: number, cacheWrite = 0) => ({
		...fauxAssistantMessage("ok"),
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input,
			output: 10,
			cacheRead,
			cacheWrite,
			totalTokens: input + cacheRead + cacheWrite + 10,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	});
	const saved = HostSessionManager.inMemory(cwd);
	const named = saved.appendSessionInfo("Original");
	// An abandoned branch must contribute file-wide facts, not force its payloads into the footer.
	const historyEntries = Number(process.env.FOOTER_HISTORY_ENTRIES ?? 256);
	const historyBytes = Number(process.env.FOOTER_HISTORY_BYTES ?? 8192);
	for (let i = 0; i < historyEntries; i++) {
		saved.appendMessage({
			...assistant(100, 0),
			content: [{ type: "text", text: "x".repeat(historyBytes) }],
		});
	}
	saved.branch(named);
	const leaf = saved.appendMessage(assistant(20, 80));
	const initialPath = join(temp, "initial.jsonl");
	writeFileSync(
		initialPath,
		`${[saved.getHeader(), ...saved.getEntries()].map((entry) => JSON.stringify(entry)).join("\n")}\n`,
	);
	const manager = HostSessionManager.open(initialPath);
	const settingsManager = HostSettingsManager.inMemory({ compaction: { enabled: false } });
	let observeArmed = false;
	const resourceOptions: ConstructorParameters<typeof HostLoader>[0] = {
		cwd,
		agentDir,
		settingsManager,
		additionalExtensionPaths: [join(root, "extensions/clean-footer.ts")],
		extensionFactories: [
			(pi: ExtensionAPI): void => {
				pi.on("message_end", (event) => {
					if (!observeArmed || event.message.role !== "assistant") {
						return;
					}
					pi.appendEntry("footer-finalization-marker", null);
					observeBeforePersist();
					return {
						message: {
							...event.message,
							usage: {
								...event.message.usage,
								input: 1,
								cacheRead: 999,
								cacheWrite: 0,
								totalTokens: 1000 + event.message.usage.output,
							},
						},
					};
				});
			},
		],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	};
	const loader = new HostLoader(resourceOptions);
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const modelRuntime = await HostModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		refreshOnCreate: false,
	});
	({ session } = await createAgentSession({
		cwd,
		agentDir,
		model,
		modelRuntime,
		settingsManager,
		sessionManager: manager,
		resourceLoader: loader,
		tools: [],
	}));
	const ui = session.extensionRunner.createContext().ui;
	/** The footer factory signature the clean-footer extension installs. */
	type FooterFactory = (
		tui: { requestRender: () => void },
		theme: typeof ui.theme,
		footerData: {
			getGitBranch: () => string | null;
			getAvailableProviderCount: () => number;
			getExtensionStatuses: () => Map<string, string>;
			onBranchChange: (listener: () => void) => () => void;
		},
	) => FooterComponent;
	const statuses = new Map<string, string>();
	let providerCount = 1;
	/* oxlint-disable typescript/no-unsafe-type-assertion -- QX-002: the setFooter stub
	 * drives the real footer factory with partial TUI/footer-data fixtures; the cast
	 * lives only at this boundary, matching the harness allowance. */
	await session.bindExtensions({
		mode: "tui",
		uiContext: {
			...ui,
			setFooter: (factory: FooterFactory | undefined) => {
				footer?.dispose?.();
				footer = factory?.(
					{
						requestRender: () => {
							return;
						},
					},
					ui.theme,
					{
						getGitBranch: () => null,
						getAvailableProviderCount: () => providerCount,
						getExtensionStatuses: () => statuses,
						onBranchChange: (_listener: () => void) => () => {
							return;
						},
					},
				);
			},
		} as unknown as ExtensionUIContext,
		onError: (error: { error: string }) => {
			throw new Error(error.error);
		},
	});
	/* oxlint-enable typescript/no-unsafe-type-assertion */
	const currentFooter = (): FooterComponent => {
		if (footer === undefined) {
			throw new Error("footer not installed");
		}
		return footer;
	};
	assert.ok(footer !== undefined, "Native session_start installs the footer");
	const render = (width = 120): string =>
		currentFooter().render(width).map(stripTerminalSequences).join("\n");
	session.getContextUsage();
	const entries = mock.method(manager, "getEntries");
	session.getContextUsage();
	const usageScans = entries.mock.callCount();
	entries.mock.resetCalls();
	const reads = mock.method(fs, "readSync");
	syncBuiltinESMExports();
	const initial = render();
	const initialBodyBytes = reads.mock.calls.reduce(
		(sum, call) => sum + (typeof call.result === "number" ? call.result : 0),
		0,
	);
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

	const usageCases: Array<[number | null, string]> = [
		[45.2, "45.2%/200k"],
		[0, "0.0%/200k"],
		[null, "?/200k"],
	];
	for (const [percent, expected] of usageCases) {
		await session.extensionRunner.emit({
			type: "model_select",
			model,
			previousModel: model,
			source: "set",
		});
		const contextUsage: { mock: { callCount: () => number; restore: () => void } } = mock.method(
			session,
			"getContextUsage",
			(): { tokens: number | null; contextWindow: number; percent: number | null } => ({
				tokens: percent === null ? null : percent * 2000,
				contextWindow: 200_000,
				percent,
			}),
		);
		assert.equal(render().split("\n")[1], `${expected} • CH80.0%`);
		assert.equal(contextUsage.mock.callCount(), 1, "A dirty snapshot acquires native usage once");
		for (const line of footer.render(12)) {
			assert.ok(visibleWidth(line) <= 12);
		}
		contextUsage.mock.restore();
	}

	// Non-triggering messages update both session history and live context.
	const beforeUsage = session.getContextUsage();
	await session.sendCustomMessage(
		{ customType: "footer-test", content: "x".repeat(40_000), display: false },
		{ triggerTurn: false },
	);
	const afterUsage = session.getContextUsage();
	if (
		beforeUsage === undefined ||
		afterUsage === undefined ||
		beforeUsage.percent === null ||
		afterUsage.percent === null
	) {
		throw new Error("context usage unavailable");
	}
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
	for (const line of footer.render(30)) {
		assert.ok(visibleWidth(line) <= 30);
	}

	const original = [manager.getHeader(), ...manager.getEntries()];
	await session.extensionRunner.emitMessageEnd({ type: "message_end", message: assistant(100, 0) });
	manager.appendMessage(assistant(100, 0));
	session.setSessionName("Renamed\nbranch");
	manager.branch(leaf);
	assert.equal(manager.getLeafId(), leaf);
	assert.match(render(), /Renamed branch/);
	assert.match(render(), /CH0\.0%/);
	session.setSessionName(" \n ");
	await session.extensionRunner.emitMessageEnd({ type: "message_end", message: assistant(0, 0) });
	manager.appendMessage(assistant(0, 0));
	manager.branch(leaf);
	await session.extensionRunner.emit({ type: "session_tree", oldLeafId: leaf, newLeafId: leaf });
	assert.doesNotMatch(render(), /Renamed|Original|• CH/);

	manager.createBranchedSession(leaf);
	assert.match(render(), /Original/);
	assert.match(render(), /CH80\.0%/);
	const path = join(temp, "session.jsonl");
	writeFileSync(path, `${original.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	manager.setSessionFile(path);
	assert.match(render(), /Original/);
	const replacement = original.map((entry) => {
		if (entry === null) {
			return entry;
		}
		if (entry.type === "session_info") {
			return Object.assign({}, entry, { name: "Reloaded" });
		}
		if (entry.type === "message") {
			return Object.assign({}, entry, { message: assistant(50, 150) });
		}
		return entry;
	});
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
	render();
	let prePersistFooter: string | undefined;
	let prePersistReads: number | undefined;
	const observeBeforePersist = (): void => {
		prePersistFooter = render();
		entries.mock.resetCalls();
		for (let i = 0; i < 100; i++) {
			render();
		}
		prePersistReads = entries.mock.callCount();
	};
	observeArmed = true;
	faux.setResponses([assistant(25, 75)]);
	await session.prompt("offline finalized-message footer check");
	await session.waitForIdle();
	if (prePersistFooter === undefined || prePersistReads === undefined) {
		throw new Error("pre-persist observation missing");
	}
	assert.doesNotMatch(
		prePersistFooter,
		/• CH/,
		"An earlier handler must not publish unfinished assistant facts",
	);
	assert.equal(prePersistReads, 0, "Pre-append redraws do not repeatedly reconcile pending facts");
	const finalizedEntry = manager
		.getBranch()
		.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
	if (
		finalizedEntry === undefined ||
		finalizedEntry.type !== "message" ||
		finalizedEntry.message.role !== "assistant"
	) {
		throw new Error("finalized assistant entry missing");
	}
	const finalized = finalizedEntry.message.usage;
	assert.equal(finalized.cacheRead, 999, "The later message_end replacement is actually persisted");
	const finalizedRate =
		(finalized.cacheRead / (finalized.input + finalized.cacheRead + finalized.cacheWrite)) * 100;
	assert.ok(
		render().includes(`CH${finalizedRate.toFixed(1)}%`),
		"File-wide facts follow the actually persisted native response",
	);
	assert.match(render(), /CH99\.9%/, "Later message_end replacements own the cache statistics");
	const settledUsage = session.getContextUsage();
	if (settledUsage === undefined || settledUsage.percent === null) {
		throw new Error("settled usage unavailable");
	}
	assert.ok(
		render().includes(`${settledUsage.percent.toFixed(1)}%/200k`),
		"Finalized usage is reconciled after persistence",
	);
	entries.mock.resetCalls();
	for (let i = 0; i < 100; i++) {
		render();
	}
	assert.equal(
		entries.mock.callCount(),
		0,
		"Settled redraws remain bounded after native append events",
	);

	// Fresh SDK startup reads a saved journal, not the previous extension's live toggle.
	for (const matchingId of [true, false]) {
		const checkpoint = HostSessionManager.inMemory(cwd);
		checkpoint.appendCustomEntry("clean-footer-checkpoint", {
			sessionId: matchingId ? checkpoint.getSessionId() : "copied-parent-session",
			enabled: false,
		});
		const savedPath = join(temp, `cold-${matchingId}.jsonl`);
		writeFileSync(
			savedPath,
			`${[checkpoint.getHeader(), ...checkpoint.getEntries()].map((entry) => JSON.stringify(entry)).join("\n")}\n`,
		);
		const coldLoader = new HostLoader(resourceOptions);
		await coldLoader.reload();
		assert.deepEqual(coldLoader.getExtensions().errors, []);
		const { session: coldSession } = await createAgentSession({
			cwd,
			agentDir,
			model,
			modelRuntime,
			settingsManager,
			sessionManager: HostSessionManager.open(savedPath),
			resourceLoader: coldLoader,
			tools: [],
		});
		let coldFooter;
		try {
			await coldSession.bindExtensions({
				mode: "tui",
				uiContext: {
					...coldSession.extensionRunner.createContext().ui,
					setFooter(factory) {
						coldFooter = factory;
					},
				},
				onError(error) {
					throw new Error(error.error);
				},
			});
			if (matchingId) {
				assert.equal(
					coldFooter,
					undefined,
					"Cold startup restores the matching session's disabled footer",
				);
			} else {
				assert.equal(
					typeof coldFooter,
					"function",
					"Cold startup ignores a copied checkpoint from another session",
				);
			}
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

	assert.equal(
		faux.state.callCount,
		1,
		"Only the offline faux lifecycle turn; no paid provider calls",
	);
	assert.equal(
		initialScans - usageScans,
		1,
		"File-wide facts bootstrap once through the public host API",
	);
	assert.equal(
		redrawScans,
		0,
		"100 unchanged redraws acquire neither usage nor full history on either host",
	);
	console.log(
		JSON.stringify({
			ok: true,
			historyEntries,
			initialBodyBytes,
			usageScans,
			initialScans,
			redrawScans,
			providerCalls: faux.state.callCount,
		}),
	);
} finally {
	await session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	footer?.dispose?.();
	session?.dispose();
	mock.restoreAll();
	syncBuiltinESMExports();
	setCapabilities(previousCapabilities);
	if (previousHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = previousHome;
	}
	if (previousAgentDir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	}
	if (previousOffline === undefined) {
		delete process.env.PI_OFFLINE;
	} else {
		process.env.PI_OFFLINE = previousOffline;
	}
	rmSync(temp, { recursive: true, force: true });
}
