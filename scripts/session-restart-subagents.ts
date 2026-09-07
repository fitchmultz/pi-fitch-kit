import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { readChildren, stopChildren } from "../extensions/session-restart.ts";

// Pi's real loader supplies peer-package aliases to the external source checkout.
export default async function (): Promise<void> {
// Exercise the owning package's real bridge/executor/restore code, without launching an agent.
const source = process.env.PI_SUBAGENTS_SOURCE;
if (!source) throw new Error("Set PI_SUBAGENTS_SOURCE to a local pi-subagents checkout");
assert.equal(JSON.parse(readFileSync(join(source, "package.json"), "utf8")).name, "pi-subagents");
const root = mkdtempSync(join(tmpdir(), "restart-owner-"));
process.env.PI_SUBAGENT_TEMP_ROOT = join(root, "pi-subagents-fixture");
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_PACKAGE_DIR = resolve("node_modules/@earendil-works/pi-coding-agent");
const load = (path: string) => import(pathToFileURL(join(source, "src", path)).href);
const { registerSlashSubagentBridge } = await load("slash/slash-bridge.ts");
const { createSubagentExecutor } = await load("runs/foreground/subagent-executor.ts");
const { restoreOwnedRuns } = await load("runs/shared/run-records.ts");
const { getRunMetadataDir } = await load("runs/shared/supervisor-questions.ts");
const { ASYNC_DIR } = await load("shared/types.ts");
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const owner = randomUUID();
const liveId = randomUUID();
const foreignId = randomUUID();
const children: ChildProcess[] = [];
const closed: Promise<void>[] = [];
const events = createEventBus();
const calls: Array<{ action: string; offset?: number; id?: string }> = [];
const acknowledgements: string[] = [];
let bridge: { dispose(): void } | undefined;
try {
	const state = { ownedRuns: new Map(), foregroundRuns: new Map(), foregroundControls: new Map(), asyncJobs: new Map(), currentSessionId: owner, baseCwd: root };
	const run = (runId: string, ownerSessionId = owner) => ({ runId, ownerSessionId, rootRunId: runId, source: "foreground", mode: "single", cwd: root, task: "Synthetic owned work", startedAt: 1, children: [{ agent: "fixture", index: 0 }] });
	const owned = [...Array.from({ length: 100 }, () => run(randomUUID())), run(liveId)];
	const entries = [...owned, run(foreignId, randomUUID())].map((data, index) => ({ type: "custom", customType: "subagent-run", id: String(index), parentId: null, timestamp: "2026-01-01T00:00:00Z", data }));
	for (const item of owned.slice(0, 100)) {
		const dir = getRunMetadataDir(item.runId);
		mkdirSync(dir, { recursive: true });
		json(join(dir, "foreground.json"), { runId: item.runId, mode: "single", cwd: root, updatedAt: 1, error: "Completed synthetic failure", children: [{ agent: "fixture", index: 0, status: "completed", summary: "finished" }] });
	}
	const ctx = { cwd: root, sessionManager: { getSessionId: () => owner, getEntries: () => entries, getHeader: () => undefined, getSessionFile: () => undefined } };
	restoreOwnedRuns(state, ctx);
	assert.equal(state.ownedRuns.size, 101);
	assert.equal(state.ownedRuns.has(foreignId), false, "restoration cannot acquire another parent's child");

	const abort = new AbortController();
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: root, stdio: "ignore", signal: abort.signal });
	children.push(child);
	child.on("error", (error) => { assert.equal(error.name, "AbortError"); });
	const childClosed = new Promise<void>((done) => child.on("close", () => {
		state.foregroundControls.delete(liveId);
		const dir = getRunMetadataDir(liveId);
		mkdirSync(dir, { recursive: true });
		json(join(dir, "foreground.json"), { runId: liveId, mode: "single", cwd: root, updatedAt: Date.now(), children: [{ agent: "fixture", index: 0, status: "paused" }] });
		done();
	}));
	closed.push(childClosed);
	state.foregroundControls.set(liveId, { runId: liveId, mode: "single", currentAgent: "fixture", currentIndex: 0, activeChildren: new Set([0]), updatedAt: 1,
		interrupt: () => { abort.abort(); return true; } });
	const foreign = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: root, stdio: "ignore" });
	children.push(foreign);
	closed.push(new Promise<void>((done) => foreign.on("close", () => done())));
	const pi = { events, getSessionName: () => "synthetic-owner" };
	const executor = createSubagentExecutor({ state, pi, config: {}, expandTilde: (value: string) => value });
	bridge = registerSlashSubagentBridge({ events, getContext: () => ctx, execute: async (id: string, params: { action: string; offset?: number; id?: string }, ...rest: unknown[]) => {
		calls.push(params);
		const result = await executor.execute(id, params, ...rest);
		if (params.action === "interrupt") acknowledgements.push(result.details.managementControl?.state);
		return result;
	} });
	const paged = await readChildren(pi, true);
	assert.deepEqual(calls.map((call) => call.offset), [0, 100]);
	assert.equal(paged.runs.at(-1)?.id, liveId, "terminal failure attention sorts ahead of live work in the real owner");
	assert.equal(paged.runs.at(-1)?.state, "live");
	state.ownedRuns.get(liveId).error = "Earlier synthetic failure with a still-active foreground control";
	const failedButLive = await readChildren(pi, true);
	const controlled = failedButLive.runs.find((item) => item.id === liveId);
	assert.equal(controlled?.state, "failed");
	assert.equal(controlled?.interruptible, true, "real owner failed-labeled active control must remain busy");
	await stopChildren(pi, failedButLive);
	await childClosed;
	assert.equal(child.signalCode, "SIGTERM");
	assert.equal(foreign.exitCode, null);
	assert.equal(foreign.signalCode, null, "unrelated child remains alive");
	assert.deepEqual(calls.filter((call) => call.action === "interrupt").map((call) => call.id), [liveId]);
	assert.deepEqual(acknowledgements, ["live"], "the real interrupt reply precedes terminal ownership status");
	assert.equal(state.ownedRuns.size, 101, "stopping must retain ownership/history");

	// A detached/background run can be restored without a parent receipt. Use the real async control file.
	const asyncId = randomUUID();
	const asyncDir = join(ASYNC_DIR, asyncId);
	mkdirSync(asyncDir, { recursive: true });
	const statusPath = join(asyncDir, "status.json");
	const controlPath = join(asyncDir, "control-request.json");
	const background = spawn(process.execPath, ["-e", `
		const fs = require('node:fs');
		const [status, control, id] = process.argv.slice(1);
		setInterval(() => {
			if (!fs.existsSync(control)) return;
			const request = JSON.parse(fs.readFileSync(control));
			if (request.action !== 'interrupt' || request.runId !== id) process.exit(2);
			const old = JSON.parse(fs.readFileSync(status));
			fs.writeFileSync(status, JSON.stringify({...old, state: 'paused', steps: [{agent:'fixture', status:'paused'}], endedAt: Date.now()}));
			process.exit(0);
		}, 10);
	`, statusPath, controlPath, asyncId], { cwd: root, stdio: "ignore" });
	children.push(background);
	const backgroundClosed = new Promise<void>((done) => background.on("close", () => done()));
	closed.push(backgroundClosed);
	json(statusPath, { runId: asyncId, sessionId: owner, mode: "single", state: "running", pid: background.pid, cwd: root, startedAt: 1, steps: [{ agent: "fixture", status: "running" }] });
	restoreOwnedRuns(state, ctx);
	state.asyncJobs.set(asyncId, { asyncId, asyncDir, status: "running", pid: background.pid, sessionId: owner });
	assert.equal(state.ownedRuns.get(asyncId).source, "async");
	assert.equal(entries.some((entry) => entry.data.runId === asyncId), false, "fixture deliberately has no prior parent receipt");
	const recovered = await readChildren(pi, true);
	assert.equal(recovered.runs.find((item) => item.id === asyncId)?.state, "live");
	await stopChildren(pi, recovered);
	await backgroundClosed;
	assert.equal(background.exitCode, 0);
	assert.equal(JSON.parse(readFileSync(controlPath, "utf8")).runId, asyncId);
	assert.ok(state.ownedRuns.has(asyncId));
	assert.equal(foreign.signalCode, null);
	console.log(JSON.stringify({ ok: true, ownerSource: source, pages: [0, 100], foregroundPid: child.pid, backgroundPid: background.pid,
		foregroundStopped: true, backgroundStopped: true, unrelatedPid: foreign.pid, unrelatedUnaffected: true, ownershipRetained: true }));
} finally {
	bridge?.dispose();
	for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
	await Promise.all(closed);
	rmSync(root, { recursive: true, force: true });
}
}
