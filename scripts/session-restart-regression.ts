import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEventBus, initTheme, parseArgs } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	privateRuntimeDir, readChildren, restartArgs, selectSessions,
	socketRequest, stopChildren, validRequest, validStatus, waitForRestart,
	type RestartStatus,
} from "../extensions/session-restart.ts";

const raw = [
	"--continue", "--resume", "--session", "old", "--session-id", "old-id", "--fork", "old-fork", "--name", "old name",
	"--provider", "old-provider", "--model", "old-model", "--thinking", "low", "--api-key", "synthetic-key",
	"--system-prompt", "system text", "--append-system-prompt", "first", "--append-system-prompt", "second",
	"--extension", "./one.ts", "-e", "./two.ts", "--skill", "./skill", "--prompt-template", "./prompt.md", "--theme", "./theme.json",
	"--session-dir", "./sessions", "--models", "provider/*,other/model:high", "--tools", "read,custom", "--exclude-tools", "bash",
	"--no-tools", "--no-builtin-tools", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
	"--offline", "--verbose", "--use-theme", "light", "--tui-mode", "fullscreen", "--mode", "text", "--no-approve",
	"--custom=two words = value", "--leading=-option", "--at=@not-a-file", "--boolean", "--false-text=false",
	"@initial-file", "initial prompt",
];
const literalDash = parseArgs(["--system-prompt", "--", "--append-system-prompt", "--"]);
assert.equal(literalDash.systemPrompt, "--", "native flag values must not be mistaken for separators");
assert.deepEqual(literalDash.appendSystemPrompt, ["--"]);
const args = parseArgs(raw);
const parsed = parseArgs(restartArgs(args, "/saved/exact.jsonl", { provider: "current", id: "namespace/model" }, "high", "/native"));
assert.deepEqual(parsed.messages, []);
assert.deepEqual(parsed.fileArgs, []);
assert.equal(parsed.session, "/saved/exact.jsonl");
assert.equal(parsed.provider, "current");
assert.equal(parsed.model, "namespace/model");
assert.equal(parsed.thinking, "high");
for (const key of ["continue", "resume", "sessionId", "fork", "name"] as const) assert.equal(parsed[key], undefined);
for (const key of [
	"apiKey", "systemPrompt", "appendSystemPrompt", "extensions", "skills", "promptTemplates", "themes", "sessionDir",
	"models", "tools", "excludeTools", "noTools", "noBuiltinTools", "noExtensions", "noSkills", "noPromptTemplates",
	"noThemes", "noContextFiles", "offline", "verbose", "useTheme", "tuiMode", "mode", "unknownFlags",
] as const) assert.deepEqual(parsed[key], args[key], key);
assert.equal(parsed.unknownFlags.has("session-cwd"), false, "an unsupported native-cwd flag must not be passed as an extension flag");
for (const trust of [undefined, true, false]) {
	const roundtrip = parseArgs(restartArgs({ ...args, projectTrustOverride: trust }, "/saved", { provider: "p", id: "m" }, "off", "/native"));
	assert.equal(roundtrip.projectTrustOverride, trust);
}

const previous: RestartStatus = {
	version: 1, instance: "old-image", pid: 123, file: "/saved", id: "saved-id", name: "fixture", cwd: "/native",
	busy: [], children: "not-loaded", ready: true,
};
assert.ok(validStatus(previous));
assert.ok(validRequest({ action: "status", version: 1 }));
const request = { action: "restart", version: 1, instance: "old-image", file: "/saved", id: "saved-id", stop: false };
assert.ok(validRequest(request));
for (const value of [null, [], {}, { ...request, stop: "true" }, { ...request, file: "\0" }, { ...request, executable: "/bin/sh" }, { action: "status", version: 1, env: {} }]) assert.equal(validRequest(value), false);
assert.equal(validStatus({ ...previous, busy: [null] }), false);

const events = createEventBus();
const pi = { events };
assert.deepEqual(await readChildren(pi, false), { kind: "not-loaded", runs: [] });
await assert.rejects(readChildren(pi, true), /unknown/);
let live = true;
let reportedState = "live";
let readsAfterInterrupt = 0;
const calls: Array<{ action: string; offset?: number; id?: string }> = [];
const stopBridge = events.on("subagent:slash:request", async (raw) => {
	const { requestId, params } = raw as { requestId: string; params: { action: string; offset?: number; id?: string } };
	calls.push(params);
	events.emit("subagent:slash:started", { requestId });
	await Promise.resolve();
	if (params.action === "interrupt") {
		assert.equal(params.id, "owned-live");
		readsAfterInterrupt = 1;
		events.emit("subagent:slash:response", { requestId, isError: false, result: { details: { managementControl: { state: "live" } } } });
		return;
	}
	if (params.id) {
		const active = params.id === "owned-live" && live;
		events.emit("subagent:slash:response", { requestId, isError: false, result: { details: { run: {
			runId: params.id, state: active ? reportedState : params.id === "owned-live" ? "paused" : "completed",
			canInterrupt: active, attention: [], children: [{ state: active ? "live" : "completed" }],
		} } } });
		return;
	}
	if (readsAfterInterrupt && params.offset === 100 && ++readsAfterInterrupt >= 3) live = false;
	const runs = params.offset === 0
		? Array.from({ length: 100 }, (_, index) => ({ runId: `completed-${index}`, state: "completed", attention: ["unreviewed"] }))
		: [{ runId: "owned-live", state: live ? reportedState : "paused", attention: live && reportedState === "live" ? ["awaiting_input"] : [] }];
	events.emit("subagent:slash:response", { requestId, isError: false, result: { details: {
		runs, managementControls: runs.map((run) => ({ runId: run.runId, capabilities: run.runId === "owned-live" && live ? ["interrupt"] : [] })),
		runList: { total: 101, offset: params.offset, limit: 100, ...(params.offset === 0 ? { nextOffset: 100 } : {}) },
	} } });
});
const children = await readChildren(pi, false);
assert.equal(children.kind, "checked");
assert.equal(children.runs.length, 101);
assert.deepEqual(calls.map((call) => call.offset), [0, 100]);
assert.equal(children.runs.at(-1)?.pendingInput, true);
reportedState = "failed";
const failedButControlled = await readChildren(pi, true);
assert.equal(failedButControlled.runs.at(-1)?.state, "failed");
assert.equal(failedButControlled.runs.at(-1)?.interruptible, true);
await stopChildren(pi, failedButControlled);
assert.equal(live, false);
assert.ok(readsAfterInterrupt >= 3, "interrupt acknowledgement is not terminal status");
assert.deepEqual(calls.filter((call) => call.action === "interrupt").map((call) => call.id), ["owned-live"]);
stopBridge();
await assert.rejects(readChildren(pi, true), /unknown/);
for (const details of [
	{ runs: [], runList: { total: 1, offset: 0, limit: 100 }, managementControls: [] },
	{ runs: [], runList: { total: 1, offset: 0, limit: 100, nextOffset: 0 }, managementControls: [] },
]) {
	const off = events.on("subagent:slash:request", (raw) => {
		const { requestId } = raw as { requestId: string };
		events.emit("subagent:slash:response", { requestId, isError: false, result: { details } });
	});
	await assert.rejects(readChildren(pi, true), /incomplete|pagination/);
	off();
}
const offError = events.on("subagent:slash:request", (raw) => {
	const { requestId } = raw as { requestId: string };
	events.emit("subagent:slash:response", { requestId, isError: true, result: {}, errorText: "not idle" });
});
await assert.rejects(readChildren(pi, true), /management failed/);
offError();

const directory = mkdtempSync(join(process.env.PI_RESTART_TEST_RUNTIME_ROOT ?? tmpdir(), "rst-"));
const socketPath = join(directory, "peer.sock");
let response: unknown = previous;
const server = createServer((socket) => {
	socket.once("data", () => socket.end(`${JSON.stringify(response)}\n`));
	socket.on("error", () => {});
});
try {
	assert.equal(privateRuntimeDir(directory), directory);
	const link = join(directory, "link");
	symlinkSync(directory, link);
	assert.throws(() => privateRuntimeDir(link), /private/);
	chmodSync(directory, 0o755);
	assert.throws(() => privateRuntimeDir(directory), /private/);
	chmodSync(directory, 0o700);
	await new Promise<void>((resolve) => server.listen(socketPath, resolve));
	assert.deepEqual(await socketRequest(socketPath, { action: "status", version: 1 }), previous);
	await assert.rejects(waitForRestart(socketPath, previous, undefined, 150), /not confirmed/, "reload of the same image is not a restart");
	response = { ...previous, instance: "new-image", restartedFrom: previous.instance };
	assert.equal((await waitForRestart(socketPath, previous)).instance, "new-image");
	response = { ...previous, instance: "wrong-image", restartedFrom: previous.instance, id: "other-session" };
	await assert.rejects(waitForRestart(socketPath, previous), /identity/);
	response = { ...previous, instance: "new-image", restartedFrom: previous.instance, unavailable: "Model restore failed" };
	await assert.rejects(waitForRestart(socketPath, previous), /Model restore failed/);
} finally {
	await new Promise<void>((resolve) => server.close(() => resolve()));
	rmSync(directory, { recursive: true, force: true });
}

initTheme("dark");
const peers = [previous, { ...previous, instance: "second", pid: 456 }, { ...previous, instance: "third", pid: 789 }];
for (const [keys, expected] of [
	[["\x1b[B", "\r"], ["old-image"]],
	[["\x1b[B", " ", "\x1b[B", " ", "\r"], ["old-image", "second"]],
	[["\r"], ["old-image", "second", "third"]],
	[["\x1b"], undefined],
] as const) {
	const selected = await selectSessions({ ui: { custom: async (factory: Function) => {
		let result: RestartStatus[] | undefined;
		const component = factory({ requestRender() {} }, { fg: (_color: string, value: string) => value }, {}, (value: RestartStatus[] | undefined) => { result = value; });
		for (const line of component.render(80)) assert.ok(visibleWidth(line) <= 80);
		for (const key of keys) component.handleInput(key);
		return result;
	} } } as never, peers);
	assert.deepEqual(selected?.map((peer) => peer.instance), expected);
}
if (process.env.PI_SUBAGENTS_SOURCE) {
	const { DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
	const root = mkdtempSync(join(tmpdir(), "restart-real-owner-"));
	try {
		const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager: SettingsManager.inMemory(),
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			additionalExtensionPaths: [fileURLToPath(new URL("./session-restart-subagents.ts", import.meta.url))] });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
	} finally { rmSync(root, { recursive: true, force: true }); }
}
console.log("session-restart regression ok: argument preservation, paged ownership, protocol identity, native selection");
