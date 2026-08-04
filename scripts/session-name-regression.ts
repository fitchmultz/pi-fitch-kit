import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const piExecutable = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
const piPackageRoot = dirname(dirname(realpathSync(piExecutable)));
const { createExtensionRuntime, loadExtensions } = await import(
	pathToFileURL(join(piPackageRoot, "dist/core/extensions/loader.js")).href
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
		transition.extensions.flatMap(({ tools }) => [...tools.keys()]),
		["name_session"],
		"the effective standalone tool must remain the sole owner",
	);
	const bundledContext = bundled.handlers.get("context")?.[0];
	assert.ok(bundledContext);
	assert.equal(await bundledContext({ messages: [] }, {}), undefined);
}
rmSync(fixtureDir, { recursive: true, force: true });

const runtime = createExtensionRuntime();
let active = true;
let currentName: string | undefined;
const names: string[] = [];
runtime.getActiveTools = () => (active ? ["name_session"] : []);
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
assert.equal(extension.tools.has("name_session"), false);
const start = extension.handlers.get("session_start")?.[0];
assert.ok(start);
await start({}, {});
const tool = extension.tools.get("name_session")?.definition;
assert.ok(tool);
assert.equal(tool.executionMode, "sequential");
type ContextResult = {
	messages: Array<{ role?: string; content?: unknown }>;
};
const context = extension.handlers.get("context")?.[0] as
	| ((event: { messages: unknown[] }) => ContextResult | undefined)
	| undefined;
assert.ok(context);
assert.match(tool.promptGuidelines?.join("\n") ?? "", /must call name_session/);
assert.match(tool.promptGuidelines?.join("\n") ?? "", /overall purpose/);
assert.match(tool.promptGuidelines?.join("\n") ?? "", /When unsure, keep the current name/);
assert.match(tool.promptGuidelines?.join("\n") ?? "", /exact numbered subagent identifier/);
assert.match(tool.promptGuidelines?.join("\n") ?? "", /require the user to confirm/);
assert.match(tool.promptGuidelines?.join("\n") ?? "", /avoid spaces/);

const userMessage = { role: "user", content: "task", timestamp: 1 };
const unnamedContext = await context({ messages: [userMessage] });
assert.equal(unnamedContext?.messages[0]?.role, "custom");
assert.match(String(unnamedContext?.messages[0]?.content), /"currentName":null/);
assert.deepEqual(unnamedContext?.messages.slice(1), [userMessage]);

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

const followUpMessages = [
	userMessage,
	{ role: "assistant", content: [{ type: "toolCall", name: "name_session" }] },
	{ role: "toolResult", toolName: "name_session" },
];
const namedContext = await context({ messages: followUpMessages });
assert.match(String(namedContext?.messages[0]?.content), /"currentName":"Fix auth refresh"/);
assert.deepEqual(namedContext?.messages.slice(1), followUpMessages);

await tool.execute(
	"rename",
	{ name: "Ship auth migration" },
	new AbortController().signal,
	undefined,
	{} as never,
);
assert.deepEqual(names, ["Fix auth refresh", "Ship auth migration"]);
assert.match(
	String((await context({ messages: followUpMessages }))?.messages[0]?.content),
	/"currentName":"Ship auth migration"/,
);

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

active = false;
assert.equal(await context({ messages: [userMessage] }), undefined);

console.log("kit session-name checks passed");
