import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const activePath = (process.env.PATH ?? "")
	.split(delimiter)
	.filter((entry) => resolve(entry) !== join(packageRoot, "node_modules/.bin"))
	.join(delimiter);
const piExecutable = execFileSync("which", ["pi"], {
	encoding: "utf8",
	env: { ...process.env, PATH: activePath },
}).trim();
const piPackageRoot = dirname(dirname(realpathSync(piExecutable)));
assert.equal(
	piPackageRoot === packageRoot || piPackageRoot.startsWith(`${packageRoot}${sep}`),
	false,
	"regression must target the active Pi installation, not the kit's dev dependency",
);
const interactiveModeSource = readFileSync(
	join(piPackageRoot, "dist/modes/interactive/interactive-mode.js"),
	"utf8",
);
const importFromPi = (path: string) =>
	import(pathToFileURL(join(piPackageRoot, path)).href);

const { AgentSession } = await importFromPi("dist/core/agent-session.js");
const { estimateContextTokens, prepareCompaction } = await importFromPi(
	"dist/core/compaction/compaction.js",
);
const { Agent } = await importFromPi(
	"node_modules/@earendil-works/pi-agent-core/dist/agent.js",
);
const { loadExtensions } = await importFromPi("dist/core/extensions/loader.js");

const activeAgentDir =
	process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent");
const models = JSON.parse(
	readFileSync(join(activeAgentDir, "models.json"), "utf8"),
);
const settings = JSON.parse(
	readFileSync(join(activeAgentDir, "settings.json"), "utf8"),
);
const targetProviders = ["openai", "openai-codex"];
const targetModelIds = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
const modelContextWindows: Record<string, number> = {};
for (const provider of targetProviders) {
	for (const id of targetModelIds) {
		const contextWindow =
			models.providers[provider].modelOverrides[id].contextWindow;
		assert.equal(
			typeof contextWindow,
			"number",
			`${provider}/${id} must have a context window`,
		);
		modelContextWindows[`${provider}/${id}`] = contextWindow;
	}
}
const fallbackContextWindow =
	modelContextWindows["openai-codex/gpt-5.6-sol"];
const xaiContextWindow =
	models.providers.xai.modelOverrides["grok-4.5"].contextWindow;
const compactionSettings = settings.compaction;
assert.equal(compactionSettings.enabled, true, "compaction must be enabled");
const defaultCompactionModels = [
	{ provider: "xai", model: "grok-4.5", thinkingLevel: "high" },
	{
		provider: "openai-codex",
		model: "gpt-5.6-luna",
		thinkingLevel: "high",
	},
];
const contextConfig = { compactionModels: defaultCompactionModels };
const extensionAgentDir = mkdtempSync(join(tmpdir(), "pi-codex-context-test-"));
process.on("exit", () =>
	rmSync(extensionAgentDir, { recursive: true, force: true }),
);
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = extensionAgentDir;
const extensionLoad = await loadExtensions(
	[fileURLToPath(new URL("../extensions/codex-context.ts", import.meta.url))],
	process.cwd(),
);
if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
assert.deepEqual(
	extensionLoad.errors,
	[],
	"pi-codex-context must load cleanly",
);
assert.equal(extensionLoad.extensions.length, 1);
const extension = extensionLoad.extensions[0] as {
	commands: Map<
		string,
		{ handler: (args: string, ctx: unknown) => Promise<void> }
	>;
	handlers: Map<string, unknown[]>;
};

const legacyCheckout = join(
	extensionAgentDir,
	"git",
	"github.com",
	"fitchmultz",
	"pi-codex-context",
);
mkdirSync(legacyCheckout, { recursive: true });
writeFileSync(join(legacyCheckout, "package.json"), "{}\n");
const legacyFixture = join(extensionAgentDir, "legacy-codex-context.ts");
writeFileSync(
	legacyFixture,
	`export default function (pi) {
		pi.registerCommand("codex-fast", { handler: async () => {} });
		pi.on("before_provider_request", () => {});
		pi.on("session_before_compact", () => {
			globalThis.__legacyCompactionCalls = (globalThis.__legacyCompactionCalls ?? 0) + 1;
		});
	}\n`,
);
for (const source of [
	"git:fitchmultz/pi-codex-context",
	"git:github:fitchmultz/pi-codex-context",
	"git:github.com/fitchmultz/pi-codex-context",
	"git:github.com/fitchmultz/pi-codex-context@legacy-ref",
	"https://github.com/fitchmultz/pi-codex-context.git",
	"git:git@github.com:fitchmultz/pi-codex-context",
	"ssh://git@github.com/fitchmultz/pi-codex-context",
	"git://github.com/fitchmultz/pi-codex-context.git",
	"git:git://github.com/fitchmultz/pi-codex-context.git",
]) {
	writeFileSync(
		join(extensionAgentDir, "settings.json"),
		`${JSON.stringify({ packages: [source] })}\n`,
	);
	process.env.PI_CODING_AGENT_DIR = extensionAgentDir;
	const transitionLoad = await loadExtensions(
		[
			legacyFixture,
			fileURLToPath(new URL("../extensions/codex-context.ts", import.meta.url)),
		],
		process.cwd(),
	);
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	assert.deepEqual(transitionLoad.errors, [], `${source} transition must load cleanly`);
	assert.deepEqual(
		transitionLoad.extensions.flatMap(
			(loaded: { commands: Map<string, unknown> }) => [...loaded.commands.keys()],
		),
		["codex-fast"],
		`${source} must leave the legacy checkout as sole command owner`,
	);
	for (const event of ["before_provider_request", "session_before_compact"]) {
		const handlers = transitionLoad.extensions.flatMap(
			(loaded: { handlers: Map<string, unknown[]> }) => loaded.handlers.get(event) ?? [],
		);
		assert.equal(handlers.length, 1, `${source} ${event} must have one owner`);
		if (event === "session_before_compact") {
			await (handlers[0] as (event: unknown, ctx: unknown) => unknown)({}, {});
		}
	}
	assert.equal(
		(globalThis as { __legacyCompactionCalls?: number }).__legacyCompactionCalls,
		1,
		`${source} compaction must invoke one summary handler`,
	);
	delete (globalThis as { __legacyCompactionCalls?: number }).__legacyCompactionCalls;
}
writeFileSync(join(extensionAgentDir, "settings.json"), "{malformed\n");
process.env.PI_CODING_AGENT_DIR = extensionAgentDir;
const malformedSettingsLoad = await loadExtensions(
	[
		legacyFixture,
		fileURLToPath(new URL("../extensions/codex-context.ts", import.meta.url)),
	],
	process.cwd(),
);
if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
assert.deepEqual(malformedSettingsLoad.errors, []);
assert.deepEqual(
	malformedSettingsLoad.extensions.flatMap(
		(loaded: { commands: Map<string, unknown> }) => [...loaded.commands.keys()],
	),
	["codex-fast"],
	"malformed settings must keep the previous legacy owner single",
);
for (const event of ["before_provider_request", "session_before_compact"]) {
	assert.equal(
		malformedSettingsLoad.extensions.reduce(
			(total: number, loaded: { handlers: Map<string, unknown[]> }) =>
				total + (loaded.handlers.get(event)?.length ?? 0),
			0,
		),
		1,
		`malformed settings must keep one ${event} owner`,
	);
}
writeFileSync(
	join(extensionAgentDir, "settings.json"),
	`${JSON.stringify({ packages: [{ source: "git:github.com/fitchmultz/pi-codex-context", extensions: ["-index.ts"] }] })}\n`,
);
process.env.PI_CODING_AGENT_DIR = extensionAgentDir;
const filteredLegacyLoad = await loadExtensions(
	[fileURLToPath(new URL("../extensions/codex-context.ts", import.meta.url))],
	process.cwd(),
);
if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
assert.deepEqual(filteredLegacyLoad.errors, []);
assert.deepEqual(
	filteredLegacyLoad.extensions.flatMap(
		(loaded: { commands: Map<string, unknown> }) => [...loaded.commands.keys()],
	),
	["codex-fast"],
	"a filtered legacy extension must not suppress the kit",
);
rmSync(join(extensionAgentDir, "settings.json"), { force: true });
process.env.PI_CODING_AGENT_DIR = extensionAgentDir;
const staleCheckoutLoad = await loadExtensions(
	[fileURLToPath(new URL("../extensions/codex-context.ts", import.meta.url))],
	process.cwd(),
);
if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
assert.deepEqual(staleCheckoutLoad.errors, []);
assert.deepEqual(
	staleCheckoutLoad.extensions.flatMap(
		(loaded: { commands: Map<string, unknown> }) => [...loaded.commands.keys()],
	),
	["codex-fast"],
	"a stale checkout without a configured package source must not suppress the kit",
);
rmSync(legacyCheckout, { recursive: true, force: true });
rmSync(legacyFixture, { force: true });

const projectDir = mkdtempSync(join(tmpdir(), "pi-codex-project-"));
const projectLegacyCheckout = join(
	projectDir,
	".pi",
	"git",
	"github.com",
	"fitchmultz",
	"pi-codex-context",
);
mkdirSync(projectLegacyCheckout, { recursive: true });
writeFileSync(join(projectLegacyCheckout, "package.json"), "{}\n");
const previousCwd = process.cwd();
let untrustedProjectLoad;
try {
	process.chdir(projectDir);
	process.env.PI_CODING_AGENT_DIR = extensionAgentDir;
	untrustedProjectLoad = await loadExtensions(
		[fileURLToPath(new URL("../extensions/codex-context.ts", import.meta.url))],
		projectDir,
	);
} finally {
	process.chdir(previousCwd);
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
}
assert.deepEqual(untrustedProjectLoad.errors, []);
assert.deepEqual(
	untrustedProjectLoad.extensions.flatMap(
		(loaded: { commands: Map<string, unknown> }) => [...loaded.commands.keys()],
	),
	["codex-fast"],
	"an excluded project-local checkout must not suppress the user-scoped kit",
);
rmSync(projectDir, { recursive: true, force: true });

const fastCommand = extension.commands.get("codex-fast");
assert.ok(fastCommand, "pi-codex-context must own the /codex-fast command");
const notifications: string[] = [];
const statuses: Array<string | undefined> = [];
const commandContext = {
	model: { provider: "openai-codex" },
	hasUI: false,
	ui: {
		notify: (message: string) => notifications.push(message),
		setStatus: (_name: string, status: string | undefined) =>
			statuses.push(status),
	},
};
const statWatchers = () =>
	process
		.getActiveResourcesInfo()
		.filter((resource) => resource === "StatWatcher").length;
const watcherBaseline = statWatchers();
const watcherContext = {
	...commandContext,
	hasUI: true,
	ui: {
		...commandContext.ui,
		theme: { fg: (_color: string, text: string) => text },
	},
};
const sessionStartHandlers = extension.handlers.get("session_start") ?? [];
const sessionShutdownHandlers = extension.handlers.get("session_shutdown") ?? [];
assert.equal(sessionStartHandlers.length, 1);
assert.equal(sessionShutdownHandlers.length, 1);
await (sessionStartHandlers[0] as (event: unknown, ctx: unknown) => unknown)(
	{},
	watcherContext,
);
await (sessionStartHandlers[0] as (event: unknown, ctx: unknown) => unknown)(
	{},
	watcherContext,
);
await (sessionShutdownHandlers[0] as () => unknown)();
assert.equal(
	statWatchers(),
	watcherBaseline,
	"repeated session starts must not leak a state-file watcher",
);

await fastCommand.handler("on", commandContext);
assert.equal(
	JSON.parse(
		readFileSync(join(extensionAgentDir, "openai-codex-fast.json"), "utf8"),
	).enabled,
	true,
);
assert.equal(statuses.at(-1), "codex-fast:on");
await fastCommand.handler("off", commandContext);
assert.equal(
	JSON.parse(
		readFileSync(join(extensionAgentDir, "openai-codex-fast.json"), "utf8"),
	).enabled,
	false,
);
assert.equal(statuses.at(-1), "codex-fast:off");
assert.deepEqual(notifications, [
	"OpenAI fast mode enabled",
	"OpenAI fast mode disabled",
]);
commandContext.model.provider = "openai";
await fastCommand.handler("status", commandContext);
assert.equal(statuses.at(-1), "codex-fast:off");
assert.equal(notifications.at(-1), "OpenAI fast mode is OFF");
assert.deepEqual(
	extensionLoad.runtime.pendingProviderRegistrations,
	[],
	"fast mode must not replace native OpenAI provider streams",
);
const fastRequestHandlers =
	extension.handlers.get("before_provider_request") ?? [];
assert.equal(
	fastRequestHandlers.length,
	1,
	"pi-codex-context must register one request-boundary fast-mode handler",
);
const fastRequestHandler = fastRequestHandlers[0] as (
	event: { type: "before_provider_request"; payload: unknown },
	ctx: { model: { provider: string } },
) => unknown;
const originalPayload = { model: "test", service_tier: "default" };
for (const provider of ["openai", "openai-codex"]) {
	assert.equal(
		await fastRequestHandler(
			{ type: "before_provider_request", payload: originalPayload },
			{ model: { provider } },
		),
		undefined,
		`${provider} must stay standard while fast mode is off`,
	);
}
writeFileSync(
	join(extensionAgentDir, "openai-codex-fast.json"),
	`${JSON.stringify({ enabled: true })}\n`,
);
for (const provider of ["openai", "openai-codex"]) {
	assert.deepEqual(
		await fastRequestHandler(
			{ type: "before_provider_request", payload: originalPayload },
			{ model: { provider } },
		),
		{ model: "test", service_tier: "priority" },
		`${provider} must use priority service while fast mode is on`,
	);
}
assert.equal(
	await fastRequestHandler(
		{ type: "before_provider_request", payload: originalPayload },
		{ model: { provider: "xai" } },
	),
	undefined,
	"fast mode must not rewrite non-OpenAI requests",
);
assert.deepEqual(
	originalPayload,
	{ model: "test", service_tier: "default" },
	"fast mode must not mutate the provider payload",
);
writeFileSync(
	join(extensionAgentDir, "openai-codex-fast.json"),
	`${JSON.stringify({ enabled: false })}\n`,
);

const customCompactionHandlers =
	extension.handlers.get("session_before_compact") ?? [];
assert.equal(
	customCompactionHandlers.length,
	1,
	"pi-codex-context must register one custom compaction handler",
);
const customCompactionHandler = customCompactionHandlers[0] as (
	event: unknown,
	ctx: unknown,
) => Promise<
	| {
			cancel?: boolean;
			compaction?: {
				summary: string;
				usage?: { totalTokens: number };
				details?: unknown;
			};
	  }
	| undefined
>;

function assistant(
	totalTokens: number,
	timestamp = 1_000,
	provider = "openai-codex",
	model = "gpt-5.6-sol",
) {
	return {
		role: "assistant",
		content: [],
		api:
			provider === "openai-codex"
				? "openai-codex-responses"
				: "openai-responses",
		provider,
		model,
		usage: {
			input: totalTokens,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

function toolResult(chars: number, timestamp = 2_000) {
	return {
		role: "toolResult",
		toolCallId: "call",
		toolName: "read",
		content: [{ type: "text", text: "x".repeat(chars) }],
		isError: false,
		timestamp,
	};
}

function boundaryUsageTokensFor(
	provider: string,
	model: string,
	contextWindow = modelContextWindows[`${provider}/${model}`] ??
		fallbackContextWindow,
): number {
	return (
		contextWindow -
		compactionSettings.reserveTokens -
		estimateContextTokens([
			assistant(1, 1_000, provider, model),
			toolResult(400),
		]).trailingTokens
	);
}

const boundaryUsageTokens = boundaryUsageTokensFor(
	"openai-codex",
	"gpt-5.6-sol",
);

assert.doesNotMatch(
	interactiveModeSource,
	/rebuildChatFromMessages\(\);\s*this\.addMessageToChat\(createCompactionSummaryMessage/,
	"successful compaction must not render its persisted summary twice",
);

function harness(
	branch: unknown[] = [],
	createCompaction = true,
	provider = "openai-codex",
	model = "gpt-5.6-sol",
	contextWindow =
		modelContextWindows[`${provider}/${model}`] ?? fallbackContextWindow,
) {
	let compactions = 0;
	const session = Object.create(AgentSession.prototype);
	session.agent = {
		state: {
			model: {
				provider,
				id: model,
				contextWindow,
			},
		},
	};
	session.settingsManager = {
		getCompactionSettings: () => compactionSettings,
	};
	session.sessionManager = { getBranch: () => branch };
	session._runAutoCompaction = async () => {
		compactions++;
		if (createCompaction) {
			branch.push({
				type: "compaction",
				id: `compaction-${compactions}`,
				timestamp: new Date(10_000 + compactions).toISOString(),
			});
		}
	};
	return {
		session,
		compactions: () => compactions,
	};
}

function unavailableManualCompactionHarness(autoCompacting = false) {
	let aborts = 0;
	let disconnects = 0;
	const events: unknown[] = [];
	const session = Object.create(AgentSession.prototype);
	session._autoCompactionAbortController = autoCompacting
		? new AbortController()
		: undefined;
	session.sessionManager = {
		getBranch: () => [
			{
				type: "compaction",
				id: "latest-compaction",
				timestamp: new Date(1_000).toISOString(),
			},
		],
	};
	session.settingsManager = {
		getCompactionSettings: () => compactionSettings,
	};
	session._disconnectFromAgent = () => disconnects++;
	session._reconnectToAgent = () => undefined;
	session.abort = async () => {
		aborts++;
	};
	session._emit = (event: unknown) => events.push(event);
	return {
		session,
		aborts: () => aborts,
		disconnects: () => disconnects,
		events,
	};
}

{
	const { session, aborts, disconnects, events } =
		unavailableManualCompactionHarness();
	await assert.rejects(session.compact(), /Already compacted/);
	assert.equal(aborts(), 0, "an unavailable manual compaction must not abort");
	assert.equal(
		disconnects(),
		0,
		"an unavailable manual compaction must not disconnect",
	);
	assert.equal(
		events.some(
			(event: { type?: string; errorMessage?: string }) =>
				event.type === "compaction_end" &&
				event.errorMessage === "Compaction failed: Already compacted",
		),
		true,
		"the unavailable manual compaction must still emit its error",
	);
}

{
	const { session, aborts, disconnects } =
		unavailableManualCompactionHarness(true);
	await assert.rejects(session.compact(), /Compaction already in progress/);
	assert.equal(aborts(), 0, "a concurrent manual compaction must not abort");
	assert.equal(
		disconnects(),
		0,
		"a concurrent manual compaction must not disconnect",
	);
}

{
	const { session, compactions } = harness();
	const baseline = assistant(148_861) as ReturnType<typeof assistant> & {
		thinkingSignature: string;
	};
	baseline.thinkingSignature = "s".repeat(1_100_000);
	await session._compactBeforeProviderRequest([baseline, toolResult(4_000)]);
	assert.equal(
		compactions(),
		0,
		"large provider metadata must not trigger compaction",
	);
}

const boundaryRoutes = targetProviders.flatMap((provider) =>
	targetModelIds.map((model) => ({
		provider,
		model,
		contextWindow: modelContextWindows[`${provider}/${model}`],
	})),
);
boundaryRoutes.push(
	{
		provider: "openai",
		model: "gpt-5.5",
		contextWindow: fallbackContextWindow,
	},
	{ provider: "xai", model: "grok-4.5", contextWindow: xaiContextWindow },
);

for (const { provider, model, contextWindow } of boundaryRoutes) {
	const usageAtBoundary = boundaryUsageTokensFor(
		provider,
		model,
		contextWindow,
	);
	const { session, compactions } = harness(
		[],
		true,
		provider,
		model,
		contextWindow,
	);
	await session._compactBeforeProviderRequest([
		assistant(usageAtBoundary, 1_000, provider, model),
		toolResult(400),
	]);
	assert.equal(
		compactions(),
		0,
		`${provider}/${model} must not compact at the configured boundary`,
	);
	await session._compactBeforeProviderRequest([
		assistant(usageAtBoundary, 1_000, provider, model),
		toolResult(1_000),
	]);
	assert.equal(
		compactions(),
		1,
		`${provider}/${model} must compact above its configured boundary`,
	);
}

{
	const { session, compactions } = harness();
	session.agent.state.model = undefined;
	await session._compactBeforeProviderRequest([assistant(1_000_000)]);
	assert.equal(compactions(), 0, "a request without a model must not compact");
}

{
	const { session, compactions } = harness();
	session.settingsManager.getCompactionSettings = () => ({
		...compactionSettings,
		enabled: false,
	});
	await session._compactBeforeProviderRequest([assistant(1_000_000)]);
	assert.equal(compactions(), 0, "disabled compaction must skip request checks");
}

for (const [model, contextWindow] of [
	["gpt-4", 8_192],
	["small-32k", 32_000],
	[
		"retention-boundary",
		compactionSettings.reserveTokens + compactionSettings.keepRecentTokens,
	],
] as const) {
	const { session, compactions } = harness(
		[],
		true,
		"openai",
		model,
		contextWindow,
	);
	await session._compactBeforeProviderRequest([
		assistant(1_000_000, 1_000, "openai", model),
	]);
	assert.equal(
		compactions(),
		0,
		`${model} must skip an unusable global compaction budget`,
	);
}

{
	const { session, compactions } = harness([], false);
	await assert.rejects(
		session._compactBeforeProviderRequest([
			assistant(boundaryUsageTokens),
			toolResult(1_000),
		]),
		/Provider request blocked/,
	);
	assert.equal(compactions(), 1, "failed compaction must be attempted once");
}

{
	const branch = [
		{
			type: "compaction",
			id: "existing",
			timestamp: new Date(2_000).toISOString(),
		},
	];
	const { session, compactions } = harness(branch);
	await session._compactBeforeProviderRequest([
		assistant(260_000, 1_000),
		{
			role: "user",
			content: "The conversation history before this point was compacted.",
			timestamp: 2_000,
		},
		toolResult(1_000, 3_000),
	]);
	assert.equal(compactions(), 0, "stale pre-compaction usage must be ignored");
}

{
	const { session, compactions } = harness();
	await session._compactBeforeProviderRequest([
		{
			role: "user",
			content: "The conversation history before this point was compacted.",
			timestamp: 2_000,
		},
		assistant(260_000, 1_000),
		toolResult(1_000, 3_000),
	]);
	assert.equal(
		compactions(),
		0,
		"usage older than a summary prefix must be ignored",
	);
}

function compactionEntries(toolResultChars: number[]) {
	const user = {
		type: "message",
		id: "user",
		parentId: null,
		timestamp: new Date(1_000).toISOString(),
		message: { role: "user", content: "task", timestamp: 1_000 },
	};
	const toolCalls = toolResultChars.map((_, index) => ({
		type: "toolCall",
		id: `call-${index}`,
		name: "read",
		arguments: {},
	}));
	const assistantEntry = {
		type: "message",
		id: "assistant",
		parentId: user.id,
		timestamp: new Date(2_000).toISOString(),
		message: {
			...assistant(230_000, 2_000),
			content: toolCalls,
			stopReason: "toolUse",
		},
	};
	let parentId = assistantEntry.id;
	const results = toolResultChars.map((chars, index) => {
		const entry = {
			type: "message",
			id: `tool-${index}`,
			parentId,
			timestamp: new Date(3_000 + index).toISOString(),
			message: {
				...toolResult(chars, 3_000 + index),
				toolCallId: `call-${index}`,
			},
		};
		parentId = entry.id;
		return entry;
	});
	return [user, assistantEntry, ...results];
}

for (const toolResultChars of [
	[compactionSettings.keepRecentTokens * 4],
	[
		compactionSettings.keepRecentTokens * 2,
		compactionSettings.keepRecentTokens * 2,
	],
]) {
	const preparation = prepareCompaction(
		compactionEntries(toolResultChars),
		compactionSettings,
	);
	assert.ok(
		preparation,
		"a trailing tool-result block at or above keepRecentTokens must compact",
	);
	assert.equal(
		preparation.firstKeptEntryId,
		"assistant",
		"the assistant and its trailing tool results must stay together",
	);
	assert.equal(preparation.turnPrefixMessages.length, 1);
}

{
	const preparation = prepareCompaction(
		[
			{
				type: "compaction",
				id: "previous-compaction",
				parentId: null,
				timestamp: new Date(500).toISOString(),
				summary: "previous summary",
				firstKeptEntryId: "user",
				tokensBefore: 200_000,
				details: {
					readFiles: ["/previous/read.ts"],
					modifiedFiles: ["/previous/edited.ts"],
				},
				fromHook: true,
			},
			...compactionEntries([compactionSettings.keepRecentTokens * 4]),
		],
		compactionSettings,
	);
	assert.ok(preparation);
	assert.deepEqual([...preparation.fileOps.read], ["/previous/read.ts"]);
	assert.deepEqual([...preparation.fileOps.edited], ["/previous/edited.ts"]);
}

{
	const branch = compactionEntries([compactionSettings.keepRecentTokens * 4]);
	let resolveAbort: (() => void) | undefined;
	let disconnects = 0;
	let aborts = 0;
	const session = Object.create(AgentSession.prototype);
	session.agent = {
		state: {
			model: { provider: "openai-codex", id: "gpt-5.6-sol" },
		},
	};
	session.settingsManager = {
		getCompactionSettings: () => compactionSettings,
	};
	session.sessionManager = { getBranch: () => branch };
	session._emit = () => undefined;
	session._disconnectFromAgent = () => disconnects++;
	session._reconnectToAgent = () => undefined;
	session.abort = async () => {
		aborts++;
		await new Promise<void>((resolve) => {
			resolveAbort = resolve;
		});
	};
	session._getSummarizationRequestAuth = async () => {
		throw new Error("manual test complete");
	};

	const manualCompaction = session.compact();
	await Promise.resolve();
	assert.ok(
		session._compactionAbortController,
		"manual compaction must claim ownership before awaiting abort",
	);
	await assert.rejects(session.compact(), /Compaction already in progress/);
	assert.equal(
		disconnects,
		1,
		"only the owning manual compaction may disconnect",
	);
	assert.equal(aborts, 1, "only the owning manual compaction may abort");
	resolveAbort?.();
	await assert.rejects(manualCompaction, /manual test complete/);
}

{
	const branch = compactionEntries([compactionSettings.keepRecentTokens * 4]);
	const events: Array<{ type?: string; errorMessage?: string }> = [];
	let reconnects = 0;
	const session = Object.create(AgentSession.prototype);
	session.settingsManager = {
		getCompactionSettings: () => compactionSettings,
	};
	session.sessionManager = { getBranch: () => branch };
	session._emit = (event: { type?: string; errorMessage?: string }) =>
		events.push(event);
	session._disconnectFromAgent = () => undefined;
	session._reconnectToAgent = () => reconnects++;
	session.abort = async () => {
		throw new Error("abort failed");
	};

	await assert.rejects(session.compact(), /abort failed/);
	assert.equal(session._compactionAbortController, undefined);
	assert.equal(reconnects, 1, "failed abort must reconnect the agent");
	assert.deepEqual(
		events.map((event) => [event.type, event.errorMessage]),
		[
			["compaction_start", undefined],
			["compaction_end", "Compaction failed: abort failed"],
		],
		"failed abort must emit balanced compaction events",
	);
}

{
	const branch = compactionEntries([compactionSettings.keepRecentTokens * 4]);
	const events: Array<{ type?: string; errorMessage?: string }> = [];
	let disconnects = 0;
	let aborts = 0;
	let reconnects = 0;
	const session = Object.create(AgentSession.prototype);
	session.settingsManager = {
		getCompactionSettings: () => compactionSettings,
	};
	session.sessionManager = { getBranch: () => branch };
	session._emit = (event: { type?: string; errorMessage?: string }) => {
		events.push(event);
		if (event.type === "compaction_start") {
			assert.ok(
				session._compactionAbortController,
				"manual compaction must own its controller before the start event",
			);
			throw new Error("start listener failed");
		}
	};
	session._disconnectFromAgent = () => disconnects++;
	session._reconnectToAgent = () => reconnects++;
	session.abort = async () => {
		aborts++;
	};

	await assert.rejects(session.compact(), /start listener failed/);
	assert.equal(session._compactionAbortController, undefined);
	assert.equal(disconnects, 0);
	assert.equal(aborts, 0);
	assert.equal(reconnects, 1, "failed start event must restore the connection");
	assert.deepEqual(
		events.map((event) => [event.type, event.errorMessage]),
		[
			["compaction_start", undefined],
			["compaction_end", "Compaction failed: start listener failed"],
		],
		"failed start event must still emit compaction_end",
	);
}

{
	const branch = compactionEntries([compactionSettings.keepRecentTokens * 4]);
	const events: Array<{ type?: string; errorMessage?: string }> = [];
	let authRequests = 0;
	const session = Object.create(AgentSession.prototype);
	session.agent = {
		state: {
			model: { provider: "openai-codex", id: "gpt-5.6-sol" },
		},
	};
	session.settingsManager = {
		getCompactionSettings: () => compactionSettings,
	};
	session.sessionManager = { getBranch: () => branch };
	session._emit = (event: { type?: string; errorMessage?: string }) => {
		events.push(event);
		if (event.type === "compaction_start") {
			assert.ok(
				session._autoCompactionAbortController,
				"automatic compaction must own its controller before the start event",
			);
			throw new Error("start listener failed");
		}
	};
	session._getSummarizationRequestAuth = async () => {
		authRequests++;
		return { apiKey: "test" };
	};

	assert.equal(await session._runAutoCompaction("threshold", false), false);
	assert.equal(session._autoCompactionAbortController, undefined);
	assert.equal(authRequests, 0, "failed start event must not request auth");
	assert.deepEqual(
		events.map((event) => [event.type, event.errorMessage]),
		[
			["compaction_start", undefined],
			["compaction_end", "Auto-compaction failed: start listener failed"],
		],
		"failed automatic start event must still emit compaction_end",
	);
}

{
	const branch = compactionEntries([compactionSettings.keepRecentTokens * 4]);
	let resolveAuth: ((auth: unknown) => void) | undefined;
	let disconnects = 0;
	let aborts = 0;
	const session = Object.create(AgentSession.prototype);
	session.agent = {
		streamFn: () => undefined,
		state: {
			messages: [],
			model: { provider: "openai-codex", id: "gpt-5.6-sol" },
			thinkingLevel: "off",
		},
		hasQueuedMessages: () => false,
	};
	session.settingsManager = {
		getCompactionSettings: () => compactionSettings,
	};
	session.sessionManager = {
		getBranch: () => branch,
		getEntries: () => branch,
		appendCompaction: (
			summary: string,
			firstKeptEntryId: string,
			tokensBefore: number,
			details: unknown,
		) => {
			branch.push({
				type: "compaction",
				id: "auto-compaction",
				parentId: branch.at(-1)?.id,
				timestamp: new Date(10_000).toISOString(),
				summary,
				firstKeptEntryId,
				tokensBefore,
				details,
			});
		},
		buildSessionContext: () => ({
			messages: [{ role: "user", content: "summary", timestamp: 10_000 }],
		}),
	};
	session._getSummarizationRequestAuth = () =>
		new Promise((resolve) => {
			resolveAuth = resolve;
		});
	session._extensionRunner = {
		hasHandlers: (type: string) => type === "session_before_compact",
		emit: async (event: {
			type: string;
			preparation?: {
				firstKeptEntryId: string;
				tokensBefore: number;
			};
		}) =>
			event.type === "session_before_compact"
				? {
						compaction: {
							summary: "summary",
							firstKeptEntryId: event.preparation?.firstKeptEntryId,
							tokensBefore: event.preparation?.tokensBefore,
							details: {},
						},
					}
				: undefined,
	};
	session._emit = () => undefined;
	session._disconnectFromAgent = () => disconnects++;
	session._reconnectToAgent = () => undefined;
	session.abort = async () => {
		aborts++;
	};

	const autoCompaction = session._runAutoCompaction("threshold", false);
	await Promise.resolve();
	assert.ok(
		session._autoCompactionAbortController,
		"automatic compaction must claim ownership before awaiting auth",
	);
	await assert.rejects(session.compact(), /Compaction already in progress/);
	assert.equal(
		disconnects,
		0,
		"concurrent manual compaction must not disconnect",
	);
	assert.equal(aborts, 0, "concurrent manual compaction must not abort");
	resolveAuth?.({ apiKey: "test" });
	await autoCompaction;
	assert.equal(
		branch.filter((entry) => entry.type === "compaction").length,
		1,
		"the automatic compaction must persist exactly once",
	);
}

function responseStream(message: unknown) {
	return {
		async *[Symbol.asyncIterator]() {
			yield { type: "done" };
		},
		async result() {
			return message;
		},
	};
}

function customCompactionModel(provider: string, id: string) {
	return {
		id,
		name: id,
		api: provider === "xai" ? "openai-responses" : "openai-codex-responses",
		provider,
		baseUrl: "https://example.invalid",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow:
			provider === "xai"
				? xaiContextWindow
				: (modelContextWindows[`${provider}/${id}`] ??
					fallbackContextWindow),
		maxTokens: 16_384,
	};
}

async function runCustomCompaction(
	outcomes: Record<string, string | Error>,
	authFailures: Record<string, string> = {},
	signal = new AbortController().signal,
	headerOnlyProviders = new Set<string>(),
	availableModels = contextConfig.compactionModels,
) {
	const calls: string[] = [];
	const notifications: string[] = [];
	const finds: string[] = [];
	const requestOptions: Array<{
		cacheRetention?: string;
		headers?: Record<string, string>;
		onPayload?: (payload: unknown, model: unknown) => unknown | Promise<unknown>;
		sessionId?: string;
	}> = [];
	const requestPayloads: unknown[] = [];
	const payloadPromises: Promise<void>[] = [];
	const models = new Map(
		availableModels.map(
			(candidate: { provider: string; model: string }) => [
				`${candidate.provider}/${candidate.model}`,
				customCompactionModel(candidate.provider, candidate.model),
			],
		),
	);
	const ctx = {
		hasUI: true,
		ui: {
			notify: (message: string) => notifications.push(message),
		},
		modelRegistry: {
			find: (provider: string, model: string) => {
				finds.push(`${provider}/${model}`);
				return models.get(`${provider}/${model}`);
			},
			getRegisteredProviderConfig: (provider: string) => ({
				streamSimple: (
					model: { provider: string; id: string },
					_context: unknown,
					options: {
						cacheRetention?: string;
						headers?: Record<string, string>;
						onPayload?: (payload: unknown, model: unknown) => unknown | Promise<unknown>;
						reasoning?: string;
						sessionId?: string;
					},
				) => {
					const key = `${model.provider}/${model.id}`;
					calls.push(`${key}:${options.reasoning}`);
					requestOptions.push(options);
					const outcome = outcomes[key];
					if (outcome instanceof Error) throw outcome;
					const initialPayload = { provider };
					payloadPromises.push(
						Promise.resolve(options.onPayload?.(initialPayload, model)).then(
							(payload) => {
								requestPayloads.push(
									payload === undefined ? initialPayload : payload,
								);
							},
						),
					);
					return responseStream({
						...assistant(1),
						content: [{ type: "text", text: outcome ?? `${provider} summary` }],
					});
				},
			}),
			getApiKeyAndHeaders: async (model: { provider: string; id: string }) => {
				const key = `${model.provider}/${model.id}`;
				if (authFailures[key]) return { ok: false, error: authFailures[key] };
				return headerOnlyProviders.has(key)
					? { ok: true, headers: { Authorization: "Bearer test" } }
					: { ok: true, apiKey: "test" };
			},
		},
	};
	const result = await customCompactionHandler(
		{
			type: "session_before_compact",
			preparation: {
				firstKeptEntryId: "kept",
				messagesToSummarize: [
					{ role: "user", content: "summarize me", timestamp: 1 },
				],
				turnPrefixMessages: [],
				isSplitTurn: false,
				tokensBefore: 10_000,
				fileOps: {
					read: new Set(["read-only.txt"]),
					written: new Set(["changed.txt"]),
					edited: new Set<string>(),
				},
				settings: compactionSettings,
			},
			reason: "threshold",
			willRetry: false,
			signal,
		},
		ctx,
	);
	await Promise.all(payloadPromises);
	return {
		result,
		calls,
		finds,
		notifications,
		requestOptions,
		requestPayloads,
	};
}

function writeCompactionConfig(config: unknown): void {
	writeFileSync(
		join(extensionAgentDir, "pi-codex-context.json"),
		`${JSON.stringify(config, null, 2)}\n`,
		"utf8",
	);
}

// Default-off: no cross-provider routing without explicit opt-in.
for (const [label, setup] of [
	["absent", () => rmSync(join(extensionAgentDir, "pi-codex-context.json"), { force: true })],
	["malformed", () => writeFileSync(join(extensionAgentDir, "pi-codex-context.json"), "{not-json\n", "utf8")],
	["false", () => writeCompactionConfig({ customCompactionEnabled: false })],
	["string true", () => writeCompactionConfig({ customCompactionEnabled: "true" })],
	["numeric one", () => writeCompactionConfig({ customCompactionEnabled: 1 })],
	["empty object", () => writeCompactionConfig({})],
] as const) {
	setup();
	const { result, calls, finds, notifications } = await runCustomCompaction({
		"xai/grok-4.5": "must not run",
		"openai-codex/gpt-5.6-luna": "must not run",
	});
	assert.equal(result, undefined, `${label} config must not custom-compact`);
	assert.deepEqual(calls, [], `${label} config must not stream to alternate models`);
	assert.deepEqual(finds, [], `${label} config must not query alternate models`);
	assert.deepEqual(notifications, [], `${label} config must stay silent`);
}

writeCompactionConfig({ customCompactionEnabled: true });

{
	const { result, calls, requestOptions } = await runCustomCompaction({
		"xai/grok-4.5": "xAI summary",
	});
	const secondRun = await runCustomCompaction({
		"xai/grok-4.5": "second xAI summary",
	});
	assert.match(result?.compaction?.summary ?? "", /xAI summary/);
	assert.deepEqual(calls, ["xai/grok-4.5:high"]);
	assert.equal(result?.compaction?.usage?.totalTokens, 1);
	assert.equal(requestOptions[0]?.cacheRetention, "none");
	assert.equal(secondRun.requestOptions[0]?.cacheRetention, "none");
	assert.match(requestOptions[0]?.sessionId ?? "", /^[0-9a-f-]{36}$/);
	assert.notEqual(
		requestOptions[0]?.sessionId,
		secondRun.requestOptions[0]?.sessionId,
		"each routed compaction must use a fresh session ID",
	);
	assert.deepEqual(result?.compaction?.details, {
		readFiles: ["read-only.txt"],
		modifiedFiles: ["changed.txt"],
	});
}

{
	writeCompactionConfig({
		customCompactionEnabled: true,
		compactionModels: [
			{
				provider: "openai-codex",
				model: "gpt-5.6-luna",
				thinkingLevel: "medium",
			},
		],
	});
	const overrideModels = [
		{ provider: "openai-codex", model: "gpt-5.6-luna", thinkingLevel: "medium" },
	];
	writeFileSync(
		join(extensionAgentDir, "openai-codex-fast.json"),
		`${JSON.stringify({ enabled: true })}\n`,
	);
	const { result, calls, requestPayloads } = await runCustomCompaction(
		{ "openai-codex/gpt-5.6-luna": "override summary" },
		{},
		new AbortController().signal,
		new Set(),
		overrideModels,
	);
	assert.match(result?.compaction?.summary ?? "", /override summary/);
	assert.deepEqual(calls, ["openai-codex/gpt-5.6-luna:medium"]);
	assert.equal(
		(requestPayloads[0] as { service_tier?: string } | undefined)
			?.service_tier,
		"priority",
		"custom OpenAI compaction must honor fast mode",
	);
	writeFileSync(
		join(extensionAgentDir, "openai-codex-fast.json"),
		`${JSON.stringify({ enabled: false })}\n`,
	);

	for (const compactionModels of [[], [{ provider: "xai" }]]) {
		writeCompactionConfig({
			customCompactionEnabled: true,
			compactionModels,
		});
		const invalid = await runCustomCompaction({
			"xai/grok-4.5": "must not run after invalid list",
		});
		assert.equal(invalid.result, undefined);
		assert.deepEqual(invalid.finds, []);
		assert.deepEqual(invalid.calls, []);
	}
}

writeCompactionConfig({ customCompactionEnabled: true });

{
	const { result, calls, notifications } = await runCustomCompaction({
		"xai/grok-4.5": new Error("xAI unavailable"),
		"openai-codex/gpt-5.6-luna": "luna summary",
	});
	assert.match(result?.compaction?.summary ?? "", /luna summary/);
	assert.deepEqual(calls, [
		"xai/grok-4.5:high",
		"openai-codex/gpt-5.6-luna:high",
	]);
	assert.match(notifications.join("\n"), /xAI unavailable/);
}

{
	const { result, calls } = await runCustomCompaction(
		{ "openai-codex/gpt-5.6-luna": "luna summary" },
		{ "xai/grok-4.5": "no xAI auth" },
	);
	assert.match(result?.compaction?.summary ?? "", /luna summary/);
	assert.deepEqual(calls, ["openai-codex/gpt-5.6-luna:high"]);
}

{
	const { result, calls, requestOptions } = await runCustomCompaction(
		{ "xai/grok-4.5": "header-only summary" },
		{},
		new AbortController().signal,
		new Set(["xai/grok-4.5"]),
	);
	assert.match(result?.compaction?.summary ?? "", /header-only summary/);
	assert.deepEqual(calls, ["xai/grok-4.5:high"]);
	assert.equal(requestOptions[0]?.headers?.Authorization, "Bearer test");
}

{
	const { result, notifications } = await runCustomCompaction({
		"xai/grok-4.5": new Error("xAI unavailable"),
		"openai-codex/gpt-5.6-luna": new Error("luna unavailable"),
	});
	assert.equal(
		result,
		undefined,
		"all custom failures must use native fallback",
	);
	assert.match(notifications.join("\n"), /using the active model/);
}

{
	const controller = new AbortController();
	controller.abort();
	const { result, calls } = await runCustomCompaction(
		{},
		{},
		controller.signal,
	);
	assert.equal(result?.cancel, true);
	assert.deepEqual(calls, []);
}

function integrationHarness(
	streamFn: (...args: unknown[]) => unknown,
	createCompaction = true,
) {
	const branch: unknown[] = [];
	let compactions = 0;
	const agent = new Agent({
		initialState: {
			model: {
				id: "gpt-5.6-sol",
				name: "GPT-5.6 Sol",
				api: "openai-codex-responses",
				provider: "openai-codex",
				baseUrl: "https://example.invalid",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: fallbackContextWindow,
				maxTokens: 128_000,
			},
			tools: [
				{
					name: "grow",
					label: "Grow",
					description: "Return text",
					parameters: {
						type: "object",
						properties: { chars: { type: "number" } },
						required: ["chars"],
						additionalProperties: false,
					},
					execute: async (_id: string, args: { chars: number }) => ({
						content: [{ type: "text", text: "x".repeat(args.chars) }],
						details: {},
					}),
				},
			],
		},
		streamFn,
	});
	const session = Object.create(AgentSession.prototype);
	session.agent = agent;
	session.settingsManager = {
		getCompactionSettings: () => compactionSettings,
	};
	session.sessionManager = { getBranch: () => branch };
	session._runAutoCompaction = async () => {
		compactions++;
		if (createCompaction) {
			const timestamp = Date.now() + 1_000;
			branch.push({
				type: "compaction",
				id: `integration-compaction-${compactions}`,
				timestamp: new Date(timestamp).toISOString(),
			});
			agent.state.messages = [
				{
					role: "user",
					content: "The conversation history before this point was compacted.",
					timestamp,
				},
				...agent.state.messages.slice(-2),
			];
		}
	};
	session._installAgentRequestCompaction();
	return { agent, compactions: () => compactions };
}

function streamedAssistant(
	content: unknown[],
	totalTokens: number,
	stopReason: string,
	sequence: number,
) {
	return {
		...assistant(totalTokens, Date.now() + sequence),
		content,
		stopReason,
	};
}

{
	let request = 0;
	const { agent, compactions } = integrationHarness(() => {
		request++;
		if (request === 1) {
			return responseStream(
				streamedAssistant(
					[
						{
							type: "toolCall",
							id: "call-1",
							name: "grow",
							arguments: { chars: 1_000 },
						},
					],
					boundaryUsageTokens,
					"toolUse",
					1,
				),
			);
		}
		if (request === 2) {
			return responseStream(
				streamedAssistant(
					[
						{
							type: "toolCall",
							id: "call-2",
							name: "grow",
							arguments: { chars: 10 },
						},
					],
					100,
					"toolUse",
					2,
				),
			);
		}
		return responseStream(
			streamedAssistant(
				[{ type: "text", text: "tool-loop-finished" }],
				100,
				"stop",
				3,
			),
		);
	});
	await agent.prompt("start tool loop");
	assert.equal(
		compactions(),
		1,
		"the oversized tool continuation must compact once",
	);
	assert.equal(
		agent.state.messages.filter(
			(message: { role: string; content?: unknown[] }) =>
				message.role === "assistant" &&
				message.content?.some(
					(block: { type?: string; id?: string }) =>
						block.type === "toolCall" && block.id === "call-2",
				),
		).length,
		1,
		"post-compaction assistant messages must not be duplicated",
	);
	assert.equal(
		agent.state.messages.filter(
			(message: { role: string; toolCallId?: string }) =>
				message.role === "toolResult" && message.toolCallId === "call-2",
		).length,
		1,
		"post-compaction tool results must not be duplicated",
	);
}

{
	let requests = 0;
	const { agent, compactions } = integrationHarness(() => {
		requests++;
		return responseStream(
			requests === 1
				? streamedAssistant(
						[
							{
								type: "toolCall",
								id: "blocked-call",
								name: "grow",
								arguments: { chars: 1_000 },
							},
						],
						boundaryUsageTokens,
						"toolUse",
						1,
					)
				: streamedAssistant(
						[{ type: "text", text: "must-not-be-sent" }],
						100,
						"stop",
						2,
					),
		);
	}, false);
	await agent.prompt("start blocked flow");
	assert.equal(compactions(), 1, "failed compaction must be attempted");
	assert.equal(
		requests,
		1,
		"failed compaction must block the provider request",
	);
}

{
	let request = 0;
	const secondRequestContexts: unknown[][] = [];
	const { agent, compactions } = integrationHarness(
		(_model: unknown, context: { messages: unknown[] }) => {
			request++;
			if (request === 2) secondRequestContexts.push(context.messages);
			return responseStream(
				request === 1
					? streamedAssistant(
							[{ type: "text", text: "first" }],
							boundaryUsageTokens,
							"stop",
							1,
						)
					: streamedAssistant(
							[{ type: "text", text: "second" }],
							100,
							"stop",
							2,
						),
			);
		},
	);
	agent.subscribe((event: { type: string; message?: { role?: string } }) => {
		if (
			request === 1 &&
			event.type === "message_end" &&
			event.message?.role === "assistant"
		) {
			agent.followUp({
				role: "user",
				content: `queued-marker-${"x".repeat(1_000)}`,
				timestamp: Date.now() + 10,
			});
		}
	});
	await agent.prompt("start queued flow");
	assert.equal(
		compactions(),
		1,
		"a queued message crossing the configured boundary must compact",
	);
	assert.equal(secondRequestContexts.length, 1);
	assert.equal(
		JSON.stringify(secondRequestContexts[0]).includes("queued-marker"),
		true,
		"queued messages must be present when the request-boundary check runs",
	);
}

console.log("kit codex-context core and custom compaction checks passed");
