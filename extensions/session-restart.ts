import { randomUUID } from "node:crypto";
import { accessSync, chmodSync, constants, lstatSync, mkdirSync, openSync, readSync, closeSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
	BorderedLoader, DynamicBorder, getPackageDir, getSelectListTheme, keyHint, parseArgs,
	type Args, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";

const HANDOFF = "PI_FITCH_RESTART_HANDOFF";
const STATE = Symbol.for("fitch-kit.session-restart");
const MAX_MESSAGE = 16_384;
const STATUS_TIMEOUT = 5_000;
const RESTART_TIMEOUT = 30_000;
const WRITER_STATUS = "fitch:write-prompt:status";
type ModelRef = { provider: string; id: string };
type Thinking = ReturnType<ExtensionAPI["getThinkingLevel"]>;
type NativeArgs = Args & { sessionCwd?: string };
// Older hosts may load the kit, but cannot safely restart without these public facts.
type RestartContext = ExtensionContext & { isBashRunning?: () => boolean; getPendingNextTurnCount?: () => number; getPendingInputCount?: () => number };

export function restartArgs(args: NativeArgs, file: string, model: ModelRef, thinking: Thinking, nativeCwd: string): string[] {
	const result = ["--session", file, "--provider", model.provider, "--model", model.id, "--thinking", thinking];
	if (args.mode) result.push("--mode", args.mode);
	for (const [key, flag] of [
		["apiKey", "--api-key"], ["systemPrompt", "--system-prompt"], ["sessionDir", "--session-dir"],
		["useTheme", "--use-theme"], ["tuiMode", "--tui-mode"],
	] as const) if (args[key] !== undefined) result.push(flag, args[key]);
	for (const [key, flag] of [
		["appendSystemPrompt", "--append-system-prompt"], ["extensions", "--extension"],
		["skills", "--skill"], ["promptTemplates", "--prompt-template"], ["themes", "--theme"],
	] as const) for (const value of args[key] ?? []) result.push(flag, value);
	for (const [key, flag] of [["models", "--models"], ["tools", "--tools"], ["excludeTools", "--exclude-tools"]] as const) {
		if (args[key] !== undefined) result.push(flag, args[key].join(","));
	}
	for (const [key, flag] of [
		["noTools", "--no-tools"], ["noBuiltinTools", "--no-builtin-tools"], ["noExtensions", "--no-extensions"],
		["noSkills", "--no-skills"], ["noPromptTemplates", "--no-prompt-templates"], ["noThemes", "--no-themes"],
		["noContextFiles", "--no-context-files"], ["offline", "--offline"], ["verbose", "--verbose"],
	] as const) if (args[key]) result.push(flag);
	if (args.projectTrustOverride !== undefined) result.push(args.projectTrustOverride ? "--approve" : "--no-approve");
	if ((parseArgs(["--session-cwd", nativeCwd]) as NativeArgs).sessionCwd === nativeCwd) result.push("--session-cwd", nativeCwd);
	for (const [key, value] of args.unknownFlags) result.push(typeof value === "string" ? `--${key}=${value}` : `--${key}`);
	return result;
}

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0 && !value.includes("\0"); }
function modelRef(value: unknown): value is ModelRef { return object(value) && text(value.provider) && text(value.id); }
function display(value: string): string { return value.replace(/[\x00-\x1f\x7f-\x9f]/g, " "); }

export type RestartRequest = { action: "restart"; version: 1; instance: string; file: string; id: string; stop: boolean };
export function validRequest(value: unknown): value is { action: "status"; version: 1 } | RestartRequest {
	if (!object(value) || value.version !== 1) return false;
	if (value.action === "status") return Object.keys(value).every((key) => ["action", "version"].includes(key));
	return value.action === "restart" && text(value.instance) && text(value.file) && text(value.id) && typeof value.stop === "boolean"
		&& Object.keys(value).every((key) => ["action", "version", "instance", "file", "id", "stop"].includes(key));
}

export type RestartStatus = {
	version: 1; instance: string; pid: number; file: string | null; id: string; name: string; cwd: string;
	busy: string[]; unavailable?: string; children: "checked" | "not-loaded" | "unknown"; ready: boolean; restartedFrom?: string;
};
export function validStatus(value: unknown): value is RestartStatus {
	return object(value) && value.version === 1 && text(value.instance) && Number.isSafeInteger(value.pid) && Number(value.pid) > 0
		&& (value.file === null || text(value.file)) && text(value.id) && typeof value.name === "string" && text(value.cwd)
		&& Array.isArray(value.busy) && value.busy.every(text) && (value.unavailable === undefined || text(value.unavailable))
		&& ["checked", "not-loaded", "unknown"].includes(String(value.children)) && typeof value.ready === "boolean"
		&& (value.restartedFrom === undefined || text(value.restartedFrom));
}

export function privateRuntimeDir(directory = process.env.PI_FITCH_RESTART_DIR ?? join(tmpdir(), `pi-restart-${process.getuid?.()}`)): string {
	if (!isAbsolute(directory)) throw new Error("PI_FITCH_RESTART_DIR must be absolute");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const stat = lstatSync(directory);
	if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
		throw new Error("Restart directory must be a private, user-owned directory, not a symlink");
	}
	if (Buffer.byteLength(join(directory, `${process.pid}.sock`)) > 100) {
		throw new Error("Restart socket path is too long; set PI_FITCH_RESTART_DIR to a shorter private directory");
	}
	return directory;
}

export function socketRequest(path: string, request: unknown, signal?: AbortSignal, timeout = STATUS_TIMEOUT): Promise<unknown> {
	return new Promise((resolveReply, reject) => {
		const socket = createConnection(path);
		let data = "";
		let settled = false;
		const finish = (error?: Error, value?: unknown) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", abort);
			socket.destroy();
			if (error) reject(error); else resolveReply(value);
		};
		const abort = () => finish(new Error("Cancelled; an already accepted restart may still finish"));
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) { abort(); return; }
		socket.setTimeout(timeout, () => finish(new Error("Helper did not respond")));
		socket.setEncoding("utf8");
		socket.on("error", () => finish(new Error("Helper is unreachable")));
		socket.on("close", () => finish(new Error("Helper closed before replying")));
		socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
		socket.on("data", (chunk: string) => {
			data += chunk;
			if (Buffer.byteLength(data) > MAX_MESSAGE) { finish(new Error("Invalid helper response")); return; }
			const end = data.indexOf("\n");
			if (end < 0) return;
			try { finish(undefined, JSON.parse(data.slice(0, end))); }
			catch { finish(new Error("Invalid helper response")); }
		});
	});
}

export async function waitForRestart(path: string, previous: RestartStatus, signal?: AbortSignal, timeout = RESTART_TIMEOUT): Promise<RestartStatus> {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		signal?.throwIfAborted();
		let value: unknown;
		try { value = await socketRequest(path, { action: "status", version: 1 }, signal, Math.min(STATUS_TIMEOUT, deadline - Date.now())); }
		catch { /* The socket is absent while the process image is replaced. */ }
		if (validStatus(value) && value.instance !== previous.instance) {
			if (value.file !== previous.file || value.id !== previous.id || value.pid !== previous.pid || value.restartedFrom !== previous.instance) {
				throw new Error("Replacement identity did not match the selected session");
			}
			if (value.unavailable) throw new Error(value.unavailable);
			if (value.ready) return value;
		}
		await delay(100, undefined, { signal });
	}
	throw new Error("Restart not confirmed: no fresh startup for the exact saved session");
}

type ChildRun = { id: string; state: string; pendingInput: boolean; interruptible: boolean; liveChild?: boolean };
export type ChildStatus = { kind: "checked" | "not-loaded"; runs: ChildRun[] };

export function subagentRequest(pi: Pick<ExtensionAPI, "events">, params: object, signal?: AbortSignal): Promise<unknown | undefined> {
	return new Promise((resolveReply, reject) => {
		const requestId = randomUUID();
		let acknowledged = false;
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const unsubscribes: (() => void)[] = [];
		const finish = (error?: Error, value?: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			for (const unsubscribe of unsubscribes) unsubscribe();
			signal?.removeEventListener("abort", abort);
			if (error) reject(error); else resolveReply(value);
		};
		const abort = () => finish(new Error("Subagent status cancelled"));
		unsubscribes.push(pi.events.on("subagent:slash:started", (data) => {
			if (object(data) && data.requestId === requestId) acknowledged = true;
		}));
		unsubscribes.push(pi.events.on("subagent:slash:response", (data) => {
			if (!object(data) || data.requestId !== requestId) return;
			acknowledged = true;
			if (data.isError !== false || !object(data.result)) finish(new Error("Subagent management failed"));
			else finish(undefined, data.result.details);
		}));
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) { abort(); return; }
		pi.events.emit("subagent:slash:request", { requestId, params });
		// The supported bridge acknowledges synchronously, even with filtered/inactive tools.
		if (!acknowledged) finish();
		else if (!settled) timer = setTimeout(() => finish(new Error("Subagent status timed out")), STATUS_TIMEOUT);
	});
}

export async function readChildren(pi: Pick<ExtensionAPI, "events">, expected: boolean, signal?: AbortSignal): Promise<ChildStatus> {
	const runs: ChildRun[] = [];
	const seen = new Set<string>();
	let offset = 0;
	let total: number | undefined;
	while (true) {
		const details = await subagentRequest(pi, { action: "status", offset, limit: 100 }, signal);
		if (details === undefined && offset === 0 && !expected) return { kind: "not-loaded", runs: [] };
		if (!object(details) || !Array.isArray(details.runs) || !object(details.runList) || !Array.isArray(details.managementControls)) {
			throw new Error("Subagent activity is unknown: expected status bridge unavailable or incomplete");
		}
		const page = details.runList;
		if (!Number.isSafeInteger(page.total) || Number(page.total) < 0 || page.offset !== offset || page.limit !== 100
			|| (total !== undefined && total !== page.total)) throw new Error("Subagent list changed or is incomplete; try again");
		total = Number(page.total);
		for (const run of details.runs) {
			if (!object(run) || !text(run.runId) || seen.has(run.runId) || !["live", "completed", "failed", "paused", "unknown"].includes(String(run.state))
				|| !Array.isArray(run.attention) || !run.attention.every(text)) throw new Error("Subagent list changed or is incomplete; try again");
			seen.add(run.runId);
			const control = details.managementControls.find((value) => object(value) && value.runId === run.runId);
			runs.push({ id: run.runId, state: String(run.state), pendingInput: run.attention.includes("awaiting_input"),
				interruptible: object(control) && Array.isArray(control.capabilities) && control.capabilities.includes("interrupt") });
		}
		if (page.nextOffset === undefined) {
			if (seen.size !== total) throw new Error("Subagent list is incomplete");
			// Flat lists suppress interrupt capability for failed/paused labels. Before
			// declaring idle, ask the same owner for its full live-control/child view.
			if (!runs.some((run) => run.state === "live" || run.pendingInput || run.interruptible)) {
				for (const run of runs) {
					const details = await subagentRequest(pi, { action: "status", id: run.id }, signal);
					if (!object(details)) throw new Error("Detailed subagent activity is unavailable");
					const view = details.run;
					if (object(view) && view.runId === run.id && typeof view.canInterrupt === "boolean" && Array.isArray(view.children)
						&& view.children.every((child) => object(child) && ["live", "completed", "failed", "paused", "unknown"].includes(String(child.state)))
						&& Array.isArray(view.attention) && view.attention.every(text)
						&& ["live", "completed", "failed", "paused", "unknown"].includes(String(view.state))) {
						run.state = String(view.state);
						run.interruptible = view.canInterrupt;
						run.pendingInput = view.attention.includes("awaiting_input");
						run.liveChild = view.children.some((child) => object(child) && child.state === "live");
					} else if (object(details.managementControl) && details.managementControl.runId === run.id && details.managementControl.state === "live" && Array.isArray(details.managementControl.capabilities)) {
						run.state = "live";
						run.interruptible = details.managementControl.capabilities.includes("interrupt");
					} else throw new Error("Detailed subagent activity is incomplete");
					if (activeChild(run)) break;
				}
			}
			return { kind: "checked", runs };
		}
		if (page.nextOffset !== offset + details.runs.length || Number(page.nextOffset) <= offset || Number(page.nextOffset) >= total) {
			throw new Error("Invalid subagent pagination");
		}
		offset = Number(page.nextOffset);
	}
}

function activeChild(run: ChildRun): boolean { return run.state === "live" || run.state === "unknown" || run.pendingInput || run.interruptible || run.liveChild === true; }
export async function stopChildren(pi: Pick<ExtensionAPI, "events">, initial: ChildStatus, signal?: AbortSignal): Promise<void> {
	if (initial.kind === "not-loaded") return;
	const interrupted = new Set<string>();
	let status = initial;
	const deadline = Date.now() + RESTART_TIMEOUT;
	while (true) {
		const active = status.runs.filter(activeChild);
		if (!active.length) return;
		for (const run of active) {
			if (interrupted.has(run.id)) continue;
			if (!run.interruptible) throw new Error("Owned subagent work cannot be confirmed stopped; session left running");
			if (await subagentRequest(pi, { action: "interrupt", id: run.id }, signal) === undefined) throw new Error("Subagent interrupt bridge disappeared");
			interrupted.add(run.id);
		}
		if (Date.now() >= deadline) throw new Error("Owned subagents have not stopped; session left running");
		await delay(100, undefined, { signal });
		status = await readChildren(pi, true, signal);
	}
}

type Launch = { args: NativeArgs; cli: string; executable: string; nodeArgs: string[]; cwd: string };
type Handoff = { version: 1; pid: number; from: string; file: string; id: string; cwd: string; name: string; model: ModelRef; thinking: Thinking; keyModel?: ModelRef; summary?: string };
type ProcessState = { instance: string; launch: Launch; keyModel?: ModelRef; sessionId?: string; bridgeSeen: boolean; handoff?: Handoff; error?: string };

function nodeLaunch(): Launch | undefined {
	if (process.release.name !== "node" || process.versions.bun || !process.execve || !process.stdin.isTTY || !process.stdout.isTTY || !["darwin", "linux", "freebsd"].includes(process.platform)) return;
	try {
		const root = getPackageDir();
		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		const cli = resolve(process.argv[1]);
		if (realpathSync(cli) !== realpathSync(join(root, pkg.bin.pi))) return;
		const args = parseArgs(process.argv.slice(2));
		if (args.print || (args.mode && args.mode !== "text") || args.export || args.help || args.version || args.listModels !== undefined) return;
		return { args, cli, executable: process.execPath, nodeArgs: [...process.execArgv], cwd: process.cwd() };
	} catch { return; }
}

function readHandoff(raw: string): Handoff {
	const value: unknown = JSON.parse(raw);
	if (!object(value) || value.version !== 1 || value.pid !== process.pid || !text(value.from) || !text(value.file) || !text(value.id)
		|| !text(value.cwd) || typeof value.name !== "string" || !modelRef(value.model) || !text(value.thinking) || parseArgs(["--thinking", value.thinking]).thinking !== value.thinking
		|| (value.keyModel !== undefined && !modelRef(value.keyModel)) || (value.summary !== undefined && typeof value.summary !== "string")) throw new Error("Invalid restart handoff");
	return value as Handoff;
}

function validateLaunch(launch: Launch): void {
	accessSync(launch.executable, constants.X_OK);
	accessSync(launch.cli, constants.R_OK);
	accessSync(launch.cwd, constants.X_OK);
	if (!statSync(launch.executable).isFile() || !statSync(launch.cli).isFile() || !statSync(launch.cwd).isDirectory()) {
		throw new Error("Launch executable, CLI, or cwd is unavailable");
	}
}

function savedFile(ctx: ExtensionContext): string {
	const file = ctx.sessionManager.getSessionFile();
	if (!file) throw new Error("Ephemeral session: nothing was saved to resume");
	if (!isAbsolute(file)) throw new Error("Session file is not absolute");
	let fd: number | undefined;
	try {
		if (!statSync(file).isFile()) throw new Error();
		fd = openSync(file, "r");
		const buffer = Buffer.alloc(16_384);
		const header = JSON.parse(buffer.subarray(0, readSync(fd, buffer)).toString("utf8").split("\n", 1)[0]);
		if (header.type !== "session" || header.id !== ctx.sessionManager.getSessionId()) throw new Error();
	} catch { throw new Error("Session file is missing, not yet saved, or no longer matches this session"); }
	finally { if (fd !== undefined) closeSync(fd); }
	return file;
}

function initialKeyModel(args: Args, ctx: ExtensionContext): ModelRef | undefined {
	if (!args.apiKey || !args.model) return;
	const models = ctx.modelRegistry.getAll();
	const exact = models.filter((model) => (!args.provider || args.provider === model.provider)
		&& [model.id, `${model.provider}/${model.id}`].some((ref) => args.model === ref || args.model?.startsWith(`${ref}:`) && parseArgs(["--thinking", args.model.slice(ref.length + 1)]).thinking !== undefined));
	if (exact.length === 1) return { provider: exact[0].provider, id: exact[0].id };
	// An explicit provider still fixes key ownership even if the old model pattern was fuzzy.
	const sameProvider = args.provider && models.find((model) => model.provider === args.provider);
	return sameProvider ? { provider: sameProvider.provider, id: sameProvider.id } : undefined;
}

export function selectSessions(ctx: ExtensionCommandContext, peers: RestartStatus[]): Promise<RestartStatus[] | undefined> {
	return ctx.ui.custom((tui, theme, _keys, done) => {
		const selected = new Set<string>();
		const items: SelectItem[] = [{ value: "all", label: "All helper-enabled sessions" }, ...peers.map((peer) => ({
			value: peer.instance, label: `[ ] ${display(peer.name || peer.id)}${peer.pid === process.pid ? " (this session)" : ""}`,
			description: display(peer.unavailable ?? (peer.busy.join("; ") || "Idle")),
		}))];
		const root = new Container();
		root.addChild(new DynamicBorder((value) => theme.fg("border", value)));
		root.addChild(new Text("Restart Pi sessions — Space marks several; Enter chooses marked or highlighted", 1, 0));
		const list = new SelectList(items, Math.min(12, items.length), getSelectListTheme());
		list.onCancel = () => done(undefined);
		list.onSelect = (item) => done(item.value === "all" ? peers : peers.filter((peer) => selected.size ? selected.has(peer.instance) : peer.instance === item.value));
		root.addChild(list);
		const detail = new Text("", 1, 0);
		list.onSelectionChange = (item) => {
			const peer = peers.find((entry) => entry.instance === item.value);
			const childStatus = peer?.children === "not-loaded" ? "pi-subagents not loaded; external jobs not checked" : `Owned child activity: ${peer?.children}`;
			detail.setText(peer ? display(`${peer.unavailable ?? (peer.busy.join("; ") || "Idle")}\n${peer.cwd}\n${peer.file ?? "Ephemeral session"}\n${childStatus}`) : "Only sessions with this helper loaded are listed.");
		};
		root.addChild(detail);
		root.addChild(new Text(keyHint("tui.select.confirm", "choose") + "  " + keyHint("tui.select.cancel", "cancel"), 1, 0));
		root.addChild(new DynamicBorder((value) => theme.fg("border", value)));
		return {
			render: (width) => root.render(width), invalidate: () => root.invalidate(),
			handleInput: (data) => {
				const item = list.getSelectedItem();
				if (matchesKey(data, "space") && item && item.value !== "all") {
					if (selected.has(item.value)) selected.delete(item.value); else selected.add(item.value);
					item.label = `[${selected.has(item.value) ? "x" : " "}]${item.label.slice(3)}`;
				} else list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

export default function sessionRestart(pi: ExtensionAPI): void {
	const launch = nodeLaunch();
	if (!launch) return; // No sockets or restart command in SDK/RPC/print hosts or non-Node launchers.
	const store = globalThis as typeof globalThis & { [STATE]?: ProcessState };
	const state = store[STATE] ??= { instance: randomUUID(), launch, bridgeSeen: false };
	if (process.env[HANDOFF]) {
		try { state.handoff = readHandoff(process.env[HANDOFF]); state.keyModel = state.handoff.keyModel; }
		catch { state.error = "Restart handoff could not be restored"; }
		delete process.env[HANDOFF];
	}
	let ctx: RestartContext | undefined;
	let server: ReturnType<typeof createServer> | undefined;
	let socketPath: string | undefined;
	let ready = false;
	let socketError: string | undefined;
	let restoring = false;
	let preparing = false;
	let coordinating = false;
	let shutdownComplete = false;
	let ownSignalPending = false;
	let exitRestart: ((code: number) => void) | undefined;
	const lifetime = new AbortController();
	const connections = new Set<Socket>();
	pi.events.on("subagent:slash:started", () => { state.bridgeSeen = true; });
	pi.events.on("subagent:slash:response", () => { state.bridgeSeen = true; });

	const disarm = () => {
		if (exitRestart) process.off("exit", exitRestart);
		exitRestart = undefined;
		ownSignalPending = false;
		process.off("SIGTERM", onTerm);
		process.off("SIGHUP", disarm);
	};
	const onTerm = () => { if (ownSignalPending) ownSignalPending = false; else disarm(); };
	const removeSocket = () => {
		if (!socketPath) return;
		try { if (lstatSync(socketPath).isSocket()) unlinkSync(socketPath); } catch { /* Already closed by Node. */ }
	};
	const cleanup = async () => {
		ready = false;
		lifetime.abort();
		for (const socket of connections) if (!socket.writableEnded) socket.destroy();
		if (server?.listening) await new Promise<void>((done) => server!.close(() => done()));
		removeSocket();
		process.off("exit", removeSocket);
	};
	function expectedChildren(current: ExtensionContext): boolean {
		return state.bridgeSeen || [...pi.getAllTools(), ...pi.getCommands()].some((item) =>
			["subagent", "delegate", "agent_runs"].includes(item.name) || item.sourceInfo.source.includes("pi-subagents"))
			|| current.sessionManager.getEntries().some((entry) => entry.type === "custom" && entry.customType === "subagent-run"
				|| entry.type === "message" && entry.message.role === "toolResult" && ["subagent", "delegate", "agent_runs"].includes(entry.message.toolName)
				|| entry.type === "custom_message" && entry.customType === "subagent-slash-result");
	}
	function nativeBusy(current: RestartContext, own = false): string[] {
		let writer: number | undefined;
		pi.events.emit(WRITER_STATUS, { reply: (active: number) => { if (Number.isSafeInteger(active) && active >= 0) writer = active; } });
		const writerExpected = pi.getCommands().some((command) => ["draft", "side-question"].includes(command.name));
		return [
			...(!current.isIdle() ? ["Agent, retry, compaction, or tree work is running"] : []),
			...(current.isBashRunning?.() ? ["Shell work is running"] : []),
			...(current.getPendingNextTurnCount?.() ? ["Queued nextTurn context"] : []),
			...(current.getPendingInputCount?.() ? ["Submitted input is pending"] : []),
			...(current.hasPendingMessages() ? ["Queued input"] : []),
			...(current.ui.getEditorText().length ? ["Editor draft"] : []),
			...(writer ? ["Draft/side-question command or dialog is active"] : writerExpected && writer === undefined ? ["Draft/side-question activity is unknown"] : []),
			...(!own && coordinating ? ["Restart selection is active"] : []),
		];
	}
	async function status(own = false): Promise<RestartStatus> {
		const current = ctx;
		if (!current) throw new Error("Session is not ready");
		let unavailable = state.error ?? socketError;
		try { savedFile(current); } catch (error) { unavailable = (error as Error).message; }
		if (state.launch.args.apiKey && !state.keyModel) unavailable = "Original --api-key provider is unknown; start Pi fresh before restarting";
		if (!(parseArgs(["--session-cwd", current.cwd]) as NativeArgs).sessionCwd && current.sessionManager.getHeader()?.cwd !== current.cwd) {
			unavailable = "This Pi version cannot preserve the session's native cwd override";
		}
		const busy = nativeBusy(current, own);
		if (preparing && !own) busy.push("Restart is being prepared");
		let children: RestartStatus["children"] = "unknown";
		try {
			const result = await readChildren(pi, expectedChildren(current), lifetime.signal);
			children = result.kind;
			if (result.kind === "checked") state.bridgeSeen = true;
			if (result.runs.some(activeChild)) busy.push("Owned subagents are active, awaiting input, or completion-unconfirmed");
		} catch { unavailable ??= "Subagent activity is unknown; session left running"; }
		return { version: 1, instance: state.instance, pid: process.pid, file: current.sessionManager.getSessionFile() ?? null,
			id: current.sessionManager.getSessionId(), name: pi.getSessionName() ?? "", cwd: current.cwd, busy,
			children, ready, ...(unavailable ? { unavailable } : {}), ...(state.handoff ? { restartedFrom: state.handoff.from } : {}) };
	}
	async function prepareRestart(request: RestartRequest, own = false, summary?: string): Promise<() => void> {
		if (!ready || !ctx || preparing || (!own && coordinating)) throw new Error(state.error ?? socketError ?? "A restart or session change is already in progress");
		const current = ctx;
		const identity = () => {
			if (ctx !== current || lifetime.signal.aborted || request.instance !== state.instance || request.file !== current.sessionManager.getSessionFile()
				|| request.id !== current.sessionManager.getSessionId()) throw new Error("Selected session identity changed; select it again");
		};
		identity();
		preparing = true;
		try {
			const first = await status(true);
			if (first.unavailable) throw new Error(first.unavailable);
			validateLaunch(state.launch);
			if (!request.stop && first.busy.length) throw new Error(`Busy: ${first.busy.join("; ")}`);
			let children = await readChildren(pi, expectedChildren(current), lifetime.signal);
			if (children.kind === "checked") state.bridgeSeen = true;
			if (request.stop) await stopChildren(pi, children, lifetime.signal);
			else if (children.runs.some(activeChild)) throw new Error("Busy: owned subagents");
			identity();
			const busy = nativeBusy(current, true);
			if (!request.stop && busy.length) throw new Error(`Busy: ${busy.join("; ")}`);
			const file = savedFile(current);
			const selectedModel = current.model;
			if (!selectedModel) throw new Error("No current model to restore");
			const desired = { provider: selectedModel.provider, id: selectedModel.id };
			const binding = state.launch.args.apiKey && state.keyModel?.provider !== desired.provider ? state.keyModel : desired;
			if (!binding) throw new Error("Original --api-key provider is unknown");
			const args = restartArgs(state.launch.args, file, binding, pi.getThinkingLevel(), current.cwd);
			const handoff: Handoff = { version: 1, pid: process.pid, from: state.instance, file, id: request.id, cwd: current.cwd, name: pi.getSessionName() ?? "",
				model: desired, thinking: pi.getThinkingLevel(), keyModel: state.keyModel, summary };
			const argv = [state.launch.executable, ...state.launch.nodeArgs, state.launch.cli, ...args];
			const env = { ...process.env, [HANDOFF]: JSON.stringify(handoff) };
			if (argv.some((value) => value.includes("\0")) || Object.entries(env).some(([key, value]) => key.includes("\0") || value?.includes("\0"))) throw new Error("Launch state cannot be safely restored");
			return () => {
				try {
				identity();
				validateLaunch(state.launch);
				if (!request.stop && nativeBusy(current, true).length) { preparing = false; throw new Error("Activity changed before restart; session left running"); }
				savedFile(current);
				// Native /tree can leave an unpersisted leaf. Anchor only an approved actual restart.
				if (current.sessionManager.getLeafId() !== (current.sessionManager.getEntries().at(-1)?.id ?? null)) pi.appendEntry("session-restart");
				exitRestart = (code) => {
					let disposed = false;
					try { void current.cwd; } catch { disposed = true; }
					if (code !== 0 || !shutdownComplete || !disposed || process.stdin.isRaw) return;
					try {
						process.chdir(state.launch.cwd);
						process.execve!(state.launch.executable, argv, env);
					} catch {
						writeSync(2, "Restart failed after shutdown; resume the saved session manually.\n");
						process.exitCode = 1;
					}
				};
				process.once("exit", exitRestart);
				process.on("SIGTERM", onTerm);
				process.once("SIGHUP", disarm);
				if (request.stop) {
					// Pi's native signal shutdown also stops Bash, summaries, retry waits, and the agent.
					ownSignalPending = true;
					try { process.kill(process.pid, "SIGTERM"); } catch { disarm(); preparing = false; throw new Error("Native stop request failed"); }
				} else current.shutdown();
				} catch (error) { preparing = false; disarm(); throw error; }
			};
		} catch (error) { preparing = false; throw error; }
	}
	pi.on("model_select", (event) => {
		if (!state.sessionId && state.launch.args.apiKey && !state.keyModel && event.previousModel) state.keyModel = { provider: event.previousModel.provider, id: event.previousModel.id };
	});
	pi.on("session_start", async (event, current) => {
		if (current.mode !== "tui") return;
		ctx = current;
		if (["new", "resume", "fork"].includes(event.reason)) { state.handoff = undefined; state.error = undefined; }
		restoring = Boolean(state.handoff && event.reason === "startup");
		if (state.sessionId !== current.sessionManager.getSessionId()) state.bridgeSeen = false;
		if (typeof ctx.isBashRunning !== "function" || typeof ctx.getPendingNextTurnCount !== "function" || typeof ctx.getPendingInputCount !== "function") {
			state.error = "Restart requires the Pi fork's native Bash, input and nextTurn activity APIs; update Pi and start it fresh";
		}
		if (state.launch.args.apiKey && !state.keyModel) {
			state.keyModel = event.reason === "startup" && current.model
				? { provider: current.model.provider, id: current.model.id } : initialKeyModel(state.launch.args, current);
		}
		state.sessionId = current.sessionManager.getSessionId();
		if (state.handoff && event.reason === "startup") {
			const handoff = state.handoff;
			try {
				if (handoff.file !== savedFile(current) || handoff.id !== state.sessionId || handoff.cwd !== current.cwd) throw new Error();
				const model = current.modelRegistry.find(handoff.model.provider, handoff.model.id);
				if (!model || (current.model?.provider !== model.provider || current.model.id !== model.id) && !await pi.setModel(model)) throw new Error();
				pi.setThinkingLevel(handoff.thinking);
				if ((pi.getSessionName() ?? "") !== handoff.name) pi.setSessionName(handoff.name);
				if (pi.getThinkingLevel() !== handoff.thinking) throw new Error();
			} catch { state.error = "Restart loaded, but the exact session/model/thinking/cwd could not be restored"; }
		}
		try {
			const directory = privateRuntimeDir();
			socketPath = join(directory, `${process.pid}.sock`);
			try { if (!lstatSync(socketPath).isSocket()) throw new Error("Restart socket path is occupied"); unlinkSync(socketPath); }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
			server = createServer((socket) => {
				connections.add(socket);
				socket.on("close", () => connections.delete(socket));
				socket.on("error", () => socket.destroy());
				socket.setTimeout(RESTART_TIMEOUT + STATUS_TIMEOUT, () => socket.destroy());
				socket.setEncoding("utf8");
				let data = "";
				let received = false;
				const send = (value: unknown) => socket.end(`${JSON.stringify(value)}\n`, () => socket.destroy());
				socket.on("data", async (chunk: string) => {
					if (received) return;
					data += chunk;
					if (Buffer.byteLength(data) > MAX_MESSAGE) { received = true; send({ error: "Invalid helper request" }); return; }
					const end = data.indexOf("\n");
					if (end < 0) return;
					received = true;
					try {
						let request: unknown;
						try { request = JSON.parse(data.slice(0, end)); }
						catch { send({ error: "Invalid helper request" }); return; }
						if (!validRequest(request)) { send({ error: "Invalid helper request" }); return; }
						if (request.action === "status") { send(await status()); return; }
						const restart = await prepareRestart(request);
						if (socket.destroyed) { preparing = false; return; }
						restart();
						send({ accepted: true });
					} catch (error) { send({ error: error instanceof Error ? display(error.message) : "Restart failed" }); }
				});
			});
			await new Promise<void>((done, reject) => { server!.once("error", reject); server!.listen(socketPath, () => { server!.off("error", reject); done(); }); });
			server.on("error", () => { ready = false; socketError = "Restart socket stopped"; });
			chmodSync(socketPath, 0o600);
			process.once("exit", removeSocket);
		} catch (error) { socketError = error instanceof Error ? error.message : "Restart helper unavailable"; current.ui.notify(socketError, "warning"); }
	});
	pi.on("resources_discover", (_event, current) => {
		if (!server?.listening) return;
		if (state.handoff && restoring) {
			const expected = state.handoff;
			if (current.model?.provider !== expected.model.provider || current.model.id !== expected.model.id
				|| pi.getThinkingLevel() !== expected.thinking || (pi.getSessionName() ?? "") !== expected.name) {
				state.error = "Restart loaded, but startup changed the requested model/thinking/name";
			}
		}
		ready = !state.error && !socketError;
		if (state.error) current.ui.notify(state.error, "error");
		else if (state.handoff && restoring) current.ui.notify(`Restarted this exact session.${state.handoff.summary ? ` ${state.handoff.summary}` : ""}`, "info");
		restoring = false;
	});
	pi.on("session_shutdown", async (event) => {
		if (event.reason !== "quit") disarm();
		await cleanup();
		shutdownComplete = true;
		if (!exitRestart) disarm();
	});
	pi.registerCommand("restart", {
		description: "Restart selected or all helper-enabled Pi sessions in place; skip busy unless explicitly stopped",
		getArgumentCompletions: (prefix) => "all".startsWith(prefix) ? [{ value: "all", label: "all", description: "Select all helper-enabled sessions" }] : [],
		handler: async (args, commandCtx) => {
			if (args.trim() && args.trim() !== "all") { commandCtx.ui.notify("Usage: /restart [all]", "warning"); return; }
			if (coordinating || preparing || !socketPath) { commandCtx.ui.notify(state.error ?? socketError ?? "Restart helper is not ready", "warning"); return; }
			coordinating = true;
			try {
				const directory = privateRuntimeDir();
				const peers: RestartStatus[] = [];
				let unreachable = 0;
				await Promise.all(readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isSocket() && /^\d+\.sock$/.test(entry.name)).map(async (entry) => {
					try {
						const path = join(directory, entry.name);
						const value = path === socketPath ? await status(true) : await socketRequest(path, { version: 1, action: "status" }, lifetime.signal);
						if (!validStatus(value) || `${value.pid}.sock` !== entry.name) throw new Error();
						peers.push(value);
					} catch { unreachable++; }
				}));
				if (unreachable) commandCtx.ui.notify(`${unreachable} helper endpoint(s) unreachable or invalid; not treated as idle`, "warning");
				peers.sort((a, b) => a.pid - b.pid);
				if (!peers.length) { commandCtx.ui.notify("No responding restart helpers", "warning"); return; }
				const selected = args.trim() === "all" ? peers : await selectSessions(commandCtx, peers);
				if (!selected?.length) return;
				const mode = await commandCtx.ui.select("Restart selected sessions", ["Restart idle (skip busy)", "Stop work and restart", "Cancel"]);
				if (!mode || mode === "Cancel") return;
				const stop = mode === "Stop work and restart";
				if (stop && !await commandCtx.ui.confirm("Stop selected sessions' work?", "Stops agent, shell, summary, draft/side-question work and reported owned subagents, including background runs. Unsaved editor drafts, queued input/context and unfinished output may be discarded. This is not a live checkpoint. Completed session/child history remains. Continue?")) return;
				const outcomes: string[] = [];
				const controller = new AbortController();
				const signal = AbortSignal.any([controller.signal, lifetime.signal]);
				await commandCtx.ui.custom<void>((tui, theme, _kb, done) => {
					const loader = new BorderedLoader(tui, theme, "Restarting selected sessions — Esc cancels remaining requests");
					loader.onAbort = () => controller.abort();
					(async () => {
						for (const peer of selected.filter((value) => value.pid !== process.pid)) {
							if (signal.aborted) break;
							const name = display(peer.name || peer.id);
							if (peer.unavailable || !stop && peer.busy.length) { outcomes.push(`Skipped ${name}: ${peer.unavailable ?? peer.busy.join("; ")}`); continue; }
							try {
								const path = join(directory, `${peer.pid}.sock`);
								const reply = await socketRequest(path, { action: "restart", version: 1, instance: peer.instance, file: peer.file, id: peer.id, stop }, signal, RESTART_TIMEOUT + STATUS_TIMEOUT);
								if (!object(reply) || reply.accepted !== true) throw new Error(object(reply) && text(reply.error) ? reply.error : "Restart request was not accepted");
								await waitForRestart(path, peer, signal);
								outcomes.push(`Restarted ${name}`);
							} catch (error) { outcomes.push(`Not confirmed ${name}: ${error instanceof Error ? display(error.message) : "restart failed"}`); }
						}
					})().finally(() => done());
					return loader;
				});
				for (const outcome of outcomes) commandCtx.ui.notify(outcome, outcome.startsWith("Restarted") ? "info" : "warning");
				if (signal.aborted) { commandCtx.ui.notify("Cancelled remaining restarts; an accepted request may still finish", "warning"); return; }
				const self = selected.find((peer) => peer.pid === process.pid);
				if (self) {
					try {
						const restart = await prepareRestart({ action: "restart", version: 1, instance: self.instance, file: self.file ?? "", id: self.id, stop }, true,
							`${outcomes.filter((value) => value.startsWith("Restarted")).length} other session(s) confirmed; ${outcomes.filter((value) => !value.startsWith("Restarted")).length} skipped or unconfirmed.`);
						restart();
					} catch (error) { commandCtx.ui.notify(`Skipped this session: ${error instanceof Error ? display(error.message) : "restart failed"}`, "warning"); }
				}
			} catch (error) { if (!lifetime.signal.aborted) commandCtx.ui.notify(error instanceof Error ? display(error.message) : "Restart failed", "error"); }
			finally { coordinating = false; }
		},
	});
}
