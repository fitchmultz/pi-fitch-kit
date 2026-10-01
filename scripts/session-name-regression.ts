import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { getPackageDir, SessionManager, VERSION } from "@earendil-works/pi-coding-agent";

const { createExtensionRuntime, loadExtensions } = await import(
	pathToFileURL(join(getPackageDir(), "dist/core/extensions/loader.js")).href
);

const bundlePath = join(process.cwd(), "extensions/session-name.ts");
const bindTools = (runtime: ReturnType<typeof createExtensionRuntime>, loaded: {
	extensions: Array<{
		tools: Map<string, { definition: { name: string }; sourceInfo: unknown }>;
	}>;
}) => {
	runtime.getAllTools = () =>
		loaded.extensions.flatMap(({ tools }) =>
			[...tools.values()].map(({ definition, sourceInfo }) => ({
				...definition,
				sourceInfo,
			})),
		) as never;
};

const fixtureDir = mkdtempSync(join(tmpdir(), "pi-session-name-transition-"));
const legacyFixture = join(fixtureDir, "legacy-session-name.ts");
writeFileSync(
	legacyFixture,
	`export default function (pi) {
		pi.registerTool({
			name: "name_session",
			label: "Name Session",
			description: "legacy owner",
			parameters: { type: "object", properties: {} },
			execute: async () => ({ content: [{ type: "text", text: "legacy" }] }),
		});
	}\n`,
);
for (const paths of [
	[legacyFixture, bundlePath],
	[bundlePath, legacyFixture],
]) {
	const transitionRuntime = createExtensionRuntime();
	transitionRuntime.getActiveTools = () => ["name_session"];
	const transition = await loadExtensions(
		paths,
		process.cwd(),
		undefined,
		transitionRuntime,
	);
	assert.deepEqual(transition.errors, []);
	bindTools(transitionRuntime, transition);
	const bundled = transition.extensions[paths.indexOf(bundlePath)];
	const start = bundled.handlers.get("session_start")?.[0];
	assert.ok(start);
	await start({}, {});
	assert.deepEqual(
		transition.extensions.flatMap(({ tools }) => [...tools.values()].map(({ definition }) => definition.name)),
		["name_session"],
		"the effective standalone tool must remain the sole owner",
	);
	const bundledStart = bundled.handlers.get("before_agent_start")?.[0];
	assert.ok(bundledStart);
	assert.equal(await bundledStart({}, { sessionManager: { buildSessionProjection: () => ({ messages: [] }) } }), undefined);
}
rmSync(fixtureDir, { recursive: true, force: true });

const runtime = createExtensionRuntime();
let currentName: string | undefined;
const names: string[] = [];
runtime.getActiveTools = () => ["name_session"];
runtime.getSessionName = () => currentName;
runtime.setSessionName = (name: string) => {
	currentName = name.replace(/[\r\n]+/g, " ").trim();
	names.push(currentName);
};

const loaded = await loadExtensions([bundlePath], process.cwd(), undefined, runtime);
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
bindTools(runtime, loaded);

const extension = loaded.extensions[0];
assert.equal(extension.tools.size, 0);
const start = extension.handlers.get("session_start")?.[0];
assert.ok(start);
await start({}, {});
const tool = [...extension.tools.values()].find(({ definition }) => definition.name === "name_session")?.definition;
assert.ok(tool);
assert.equal(tool.executionMode, "sequential");

assert.match(tool.promptGuidelines?.join("\n") ?? "", /must call name_session/);
assert.match(tool.promptGuidelines?.join("\n") ?? "", /same tool-call batch rather than a separate naming-only round/);
assert.match(tool.promptGuidelines?.join("\n") ?? "", /Do not add unrelated work/);
assert.match(tool.promptGuidelines?.join("\n") ?? "", /overall purpose/);
assert.match(tool.promptGuidelines?.join("\n") ?? "", /When unsure, keep the current name/);
assert.match(tool.promptGuidelines?.join("\n") ?? "", /exact numbered subagent identifier/);
assert.match(tool.promptGuidelines?.join("\n") ?? "", /require the user to confirm/);
assert.match(tool.promptGuidelines?.join("\n") ?? "", /avoid spaces/);

const first = await tool.execute(
	"first",
	{ name: "  Fix auth refresh  " },
	new AbortController().signal,
	undefined,
	{} as never,
);
assert.deepEqual(names, ["Fix auth refresh"]);
assert.deepEqual(first.details, { name: "Fix auth refresh", previousName: undefined });

await tool.execute(
	"same",
	{ name: "Fix auth refresh" },
	new AbortController().signal,
	undefined,
	{} as never,
);
assert.deepEqual(names, ["Fix auth refresh"]);

await assert.rejects(
	tool.execute(
		"control-character",
		{ name: "Fix\nauth refresh" },
		new AbortController().signal,
		undefined,
		{} as never,
	),
	/control or formatting characters/,
);
await assert.rejects(
	tool.execute(
		"format-character",
		{ name: "auth-\u200Bcoordinator" },
		new AbortController().signal,
		undefined,
		{} as never,
	),
	/control or formatting characters/,
);
assert.deepEqual(names, ["Fix auth refresh"]);

await tool.execute(
	"rename",
	{ name: "Ship auth migration" },
	new AbortController().signal,
	undefined,
	{} as never,
);
assert.deepEqual(names, ["Fix auth refresh", "Ship auth migration"]);

await tool.execute(
	"coordinator",
	{ name: "release-coordinator" },
	new AbortController().signal,
	undefined,
	{} as never,
);
await assert.rejects(
	tool.execute(
		"remove-coordinator-without-ui",
		{ name: "release-planning" },
		new AbortController().signal,
		undefined,
		{} as never,
	),
	/ask the user to rename it with \/name/,
);
assert.equal(currentName, "release-coordinator");
let confirmations = 0;
const removalContext = (confirmed: boolean) =>
	({
		hasUI: true,
		ui: {
			confirm: async (_title: string, message: string) => {
				confirmations++;
				assert.doesNotMatch(message, /release-coordinator/);
				return confirmed;
			},
		},
	}) as never;
await assert.rejects(
	tool.execute(
		"decline-coordinator-removal",
		{ name: "release-planning" },
		new AbortController().signal,
		undefined,
		removalContext(false),
	),
	/Protected name change was not confirmed by the user/,
);
assert.equal(currentName, "release-coordinator");
await tool.execute(
	"confirm-coordinator-removal",
	{ name: "release-planning" },
	new AbortController().signal,
	undefined,
	removalContext(true),
);
assert.equal(confirmations, 2);
assert.equal(currentName, "release-planning");

currentName = "subagent-1-subagent-2";
await assert.rejects(
	tool.execute(
		"remove-one-of-multiple-subagent-identifiers",
		{ name: "subagent-1" },
		new AbortController().signal,
		undefined,
		{} as never,
	),
	/protected role or identifier/,
);
assert.equal(currentName, "subagent-1-subagent-2");
currentName = "release-planning";

await tool.execute(
	"set-subagent-identifier",
	{ name: "release-Subagent-1" },
	new AbortController().signal,
	undefined,
	{} as never,
);
await tool.execute(
	"keep-subagent-identifier",
	{ name: "auth-subagent-1" },
	new AbortController().signal,
	undefined,
	{} as never,
);
await assert.rejects(
	tool.execute(
		"change-subagent-identifier-without-ui",
		{ name: "auth-subagent-10" },
		new AbortController().signal,
		undefined,
		{} as never,
	),
	/protected role or identifier/,
);
assert.equal(currentName, "auth-subagent-1");
await tool.execute(
	"confirm-subagent-identifier-change",
	{ name: "auth-subagent-10" },
	new AbortController().signal,
	undefined,
	removalContext(true),
);
assert.equal(confirmations, 3);
assert.equal(currentName, "auth-subagent-10");

const abortController = new AbortController();
const abortContext = {
	hasUI: true,
	ui: {
		confirm: async (_title: string, _message: string, options: { signal?: AbortSignal }) => {
			assert.equal(options.signal, abortController.signal);
			abortController.abort();
			return true;
		},
	},
} as never;
await assert.rejects(
	tool.execute(
		"abort-subagent-identifier-removal",
		{ name: "release-planning" },
		abortController.signal,
		undefined,
		abortContext,
	),
	/Protected name change was cancelled/,
);
assert.equal(currentName, "auth-subagent-10");

await assert.rejects(
	tool.execute(
		"blank",
		{ name: "   " },
		new AbortController().signal,
		undefined,
		{} as never,
	),
	/Session name cannot be blank/,
);

// Request-time boundary lookup must stop at a nearby compaction and remember absence.
// This exercises the registered handler with real native entries, not exported cache internals.
const contextHook = extension.handlers.get("context_with_system")?.[0];
assert.ok(contextHook);
for (const count of [781, 43_000]) {
	const manager = SessionManager.inMemory(process.cwd());
	for (let i = 0; i < count; i++) manager.appendCustomEntry("history-fixture", {});
	let visits = 0;
	const getEntry = manager.getEntry.bind(manager);
	manager.getEntry = (id: string) => { visits++; return getEntry(id); };
	const event = { messages: [{ role: "assistant" }] };
	const ctx = { sessionManager: manager };
	await extension.handlers.get("session_tree")?.[0]({}, ctx as never);
	await contextHook(event as never, ctx as never);
	assert.equal(visits, count, "Cold absence walks ancestry once");
	visits = 0;
	for (let i = 0; i < 100; i++) await contextHook(event as never, ctx as never);
	assert.equal(visits, 0, "Unchanged absent boundary does not rescan history");
	manager.appendCompaction("", null, 0);
	manager.appendCustomEntry("new-tail", {});
	visits = 0;
	await contextHook({ messages: [{ role: "assistant" }] } as never, ctx as never);
	assert.equal(visits, 2, "Retain-none draft discovered from the next committed leaf stops at its compaction");
	visits = 0;
	for (let i = 0; i < 100; i++) await contextHook(event as never, ctx as never);
	assert.equal(visits, 0);
	console.log(JSON.stringify({ historyEntries: count, coldAbsentVisits: count, unchangedVisits: visits, newBoundaryVisits: 2 }));
}

console.log(`kit session-name checks passed (${VERSION})`);
execFileSync(process.execPath, [join(process.cwd(), "scripts/session-name-boundary.mjs"), getPackageDir()], { stdio: "inherit" });
