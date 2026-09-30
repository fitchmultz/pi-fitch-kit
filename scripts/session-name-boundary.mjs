#!/usr/bin/env node
// Optional host root: exercise native SDK lifecycle and HTTP serialization, without network or model charges.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const host = process.argv[2] ? resolve(process.argv[2]) : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const hostRequire = createRequire(join(host, "package.json"));
const aiRoot = hostRequire.resolve.paths("@earendil-works/pi-ai").map((base) => join(base, "@earendil-works/pi-ai")).find((base) => existsSync(join(base, "package.json")));
const temp = mkdtempSync(join(tmpdir(), "pi-name-boundary-"));
const cwd = join(temp, "project");
mkdirSync(cwd);
process.env.PI_CODING_AGENT_DIR = temp;
process.env.PI_PACKAGE_DIR = host;
process.env.PI_OFFLINE = "1";
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
globalThis.WebSocket = undefined;
const requests = [];
let requestedName;
let boundaryInput;
let renameAfterBoundary;
let retainNoneNextTurn = false;
let overflowNextRequest = false;
globalThis.fetch = async (url, init) => {
	assert.equal(String(url), "https://naming.invalid/v1/responses", "no network may leave the fixture");
	requests.push(JSON.parse(init.body));
	if (overflowNextRequest) {
		overflowNextRequest = false;
		return new Response(JSON.stringify({ error: { message: "maximum context length exceeded", code: "context_length_exceeded", type: "invalid_request_error" } }), { status: 400, headers: { "content-type": "application/json" } });
	}
	const item = requestedName || boundaryInput ? {
		type: "function_call", id: `fc_${requests.length}`, call_id: `call_${requests.length}`,
		name: boundaryInput ? "boundary_case" : "name_session", arguments: JSON.stringify(boundaryInput ?? { name: requestedName }), status: "completed",
	} : { id: `msg_${requests.length}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "DONE", annotations: [] }] };
	requestedName = boundaryInput ? renameAfterBoundary : undefined;
	renameAfterBoundary = undefined;
	boundaryInput = undefined;
	const events = [
		{ type: "response.output_item.added", output_index: 0, item: { ...item, ...(item.type === "message" ? { content: [] } : { arguments: "" }) } },
		{ type: "response.output_item.done", output_index: 0, item },
		{ type: "response.completed", response: { id: `resp_${requests.length}`, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } },
	];
	return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
};
let session;
try {
	const sdk = await import(pathToFileURL(join(host, "dist/index.js")));
	const ai = await import(pathToFileURL(join(aiRoot, "dist/index.js")));
	const runtime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
	const registry = new sdk.ModelRegistry(runtime);
	registry.registerProvider("naming-boundary", { api: "openai-responses", baseUrl: "https://naming.invalid/v1", apiKey: "offline", models: [{ id: "naming", name: "naming", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsMidConvoSystemMessages: true } }] });
	const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false } });
	const namingPath = process.env.PI_NAMING_EXTENSION ?? join(root, "extensions/session-name.ts");
	const makeLoader = (paths) => new sdk.DefaultResourceLoader({ cwd, agentDir: temp, settingsManager,
		additionalExtensionPaths: paths,
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionFactories: [(pi) => {
			pi.on("turn_end", (event) => {
				if (!retainNoneNextTurn) return;
				retainNoneNextTurn = false;
				return { entries: [...event.entries, { type: "compaction", summary: "", firstKeptEntryId: null }] };
			});
			// Replace only the summarizer, not compaction dispatch, persistence or projection.
			pi.on("session_before_compact", (event) => ({ compaction: { summary: "OFFLINE_SUMMARY", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: 10 } }));
		}],
	});
	async function open(manager, paths = [namingPath]) {
		const loader = makeLoader(paths);
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.ok(loader.getExtensions().extensions.some((e) => e.path.endsWith("session-name.ts")), JSON.stringify(loader.getExtensions().extensions.map((e) => e.path)));
		assert.deepEqual(loader.getExtensions().extensions.filter((e) => paths.includes(e.path)).map((e) => e.path), paths, "resource paths must exercise the requested extension order");
		({ session } = await sdk.createAgentSession({ cwd, agentDir: temp, model: registry.find("naming-boundary", "naming"), modelRuntime: runtime, resourceLoader: loader, settingsManager, sessionManager: manager, noTools: true }));
		await session.bindExtensions({ onError: (error) => { throw new Error(error.error); } });
	}
	async function close() { session.dispose(); session = undefined; }
	const metadata = () => session.sessionManager.buildSessionProjection().messages.filter((m) => m.role === "custom" && m.customType === "pi-session-name");
	const latestName = (body = requests.at(-1)) => {
		const matches = [...JSON.stringify(body.input).matchAll(/currentName\\":(null|\\"(.*?)\\")/g)];
		assert.ok(matches.length, `request must report the current name: ${JSON.stringify(body.input)}`);
		return matches.at(-1)[1] === "null" ? null : matches.at(-1)[2];
	};
	function extendsPrefix(previous, next = requests.at(-1)) {
		assert.equal(next.instructions, previous.instructions);
		assert.deepEqual(next.input.slice(0, previous.input.length), previous.input, "introducing or changing naming metadata must preserve every prior serialized input item");
	}
	async function prompt(text) { await session.prompt(text); await session.waitForIdle(); }
	await open(sdk.SessionManager.inMemory(cwd));
	// A long conversation need not be reproduced: every old serialized item must survive.
	session.setActiveToolsByName([]);
	await prompt("before naming enabled");
	const beforeEnable = requests.at(-1);
	session.setActiveToolsByName(["name_session"]);
	assert.ok(session.getActiveToolNames().includes("name_session"), JSON.stringify(session.getAllTools()));
	await prompt("naming enabled");
	extendsPrefix(beforeEnable);
	assert.equal(latestName(), null);
	assert.equal(metadata().length, 1);
	const unnamed = requests.at(-1);
	requestedName = "cache-stable-session";
	await prompt("name this session");
	assert.equal(session.sessionManager.getSessionName(), "cache-stable-session");
	extendsPrefix(unnamed);
	assert.equal(latestName(), "cache-stable-session", "tool-loop follow-up sees the actual new name");
	assert.equal(metadata().length, 2);
	const named = requests.at(-1);
	await prompt("ordinary followup");
	extendsPrefix(named);
	assert.equal(metadata().length, 2, "unchanged names do not grow metadata");
	const branchTarget = session.sessionManager.getLeafId();
	session.setSessionName("manual-name"); // Same native operation as /name.
	await prompt("after manual rename");
	extendsPrefix(named);
	assert.equal(latestName(), "manual-name");
	assert.equal(metadata().length, 3);
	await session.reload();
	await prompt("after reload");
	assert.equal(metadata().length, 3, "reload reconstructs from native history");
	await session.navigateTree(branchTarget, { summarize: false });
	await prompt("after tree navigation");
	assert.equal(latestName(), "manual-name", "global display name wins over old branch metadata");
	assert.equal(metadata().length, 3);
	const lastMetadata = session.sessionManager.getBranch().findLast((e) => e.type === "custom_message" && e.customType === "pi-session-name");
	session.sessionManager.appendContextEdit(lastMetadata.id, null);
	session.refreshContext();
	await prompt("after context omission");
	assert.equal(latestName(), "manual-name");
	await session.compact();
	await prompt("after native compaction");
	assert.equal(latestName(), "manual-name");
	assert.equal(metadata().length, 1, "compacted-away metadata is restored exactly once");
	await prompt("create a compactable next turn");
	session.setAutoCompactionEnabled(true);
	overflowNextRequest = true;
	const beforeOverflow = requests.length;
	await prompt("overflow and retry");
	session.setAutoCompactionEnabled(false);
	assert.equal(requests.length, beforeOverflow + 2, "native overflow recovery retries once");
	assert.equal(latestName(), "manual-name", "first overflow retry sees restored metadata without before_agent_start");
	assert.equal(metadata().length, 1);
	const file = join(temp, "saved.jsonl");
	writeFileSync(file, [session.sessionManager.getHeader(), ...session.sessionManager.getEntries()].map((e) => JSON.stringify(e)).join("\n") + "\n");
	await close();
	await open(sdk.SessionManager.open(file, temp));
	await prompt("after reopen");
	assert.equal(latestName(), "manual-name");
	assert.equal(metadata().length, 1);
	await close();
	await open(sdk.SessionManager.forkFrom(file, cwd, temp));
	await prompt("after native file fork");
	assert.equal(latestName(), session.sessionManager.getSessionName() ?? null);
	retainNoneNextTurn = true;
	await prompt("RETAIN_NONE_DISCARDED_TURN");
	const retained = session.sessionManager.getBranch().at(-1);
	assert.equal(retained.type, "compaction");
	assert.equal(retained.firstKeptEntryId, retained.id, "native retain-none compaction keeps no preceding entries");
	assert.equal(retained.summary, "");
	assert.equal(metadata().length, 0, "the boundary really discards old name metadata");
	const beforeRetainNoneRequest = requests.length;
	await prompt("after summary-free retain-none compaction");
	assert.equal(requests.length, beforeRetainNoneRequest + 1, "first request needs no extra naming round");
	assert.equal(latestName(), session.sessionManager.getSessionName() ?? null);
	assert.equal(metadata().length, 1, "first request restores truthful name metadata exactly once");
	assert.doesNotMatch(JSON.stringify(requests.at(-1)), /RETAIN_NONE_DISCARDED_TURN|OFFLINE_SUMMARY|before naming enabled/);
	const fresh = requests.at(-1);
	await prompt("retain-none followup");
	extendsPrefix(fresh);
	assert.equal(metadata().length, 1, "unchanged name keeps the restored prefix stable");
	console.log("PASS native summary-free retain-none compaction: first request metadata and stable followup prefix");
	await close();
	await open(sdk.SessionManager.inMemory(cwd));
	await prompt("fresh unnamed");
	assert.equal(latestName(), null);
	assert.equal(metadata().length, 1);
	assert.ok(requests.length < 30, "metadata must not trigger extra model loops");
	console.log("PASS serialized prefix: late enable, naming tool loop, unchanged and /name; native reload/tree/edit/compact/overflow-retry/reopen/fork/fresh");
	await close();
	const producer = join(temp, "boundary-producer.ts");
	writeFileSync(producer, `export default function (pi) {
		pi.registerTool({ name: "late_tool", label: "Late tool", description: "Offline loadout fixture",
			promptSnippet: "LATE_TOOL_PROMPT_UPDATE", parameters: { type: "object", properties: {} },
			execute: async () => ({ content: [{ type: "text", text: "Unused" }], details: undefined })
		});
		pi.registerTool({ name: "boundary_case", label: "Boundary case", description: "Offline boundary fixture",
			parameters: { type: "object", properties: { name: { type: "string" }, rollover: { type: "boolean" }, summary: { type: "string" } }, required: ["name", "rollover", "summary"] },
			execute: async (_id, args) => { pi.setSessionName(args.name); return { content: [{ type: "text", text: "BOUNDARY_TOOL_RESULT" }], details: args }; }
		});
		pi.on("turn_end", (event, ctx) => {
			const result = event.toolResults.find((item) => item.toolName === "boundary_case");
			if (!result) return;
			const target = ctx.sessionManager.getBranch().findLast((entry) => entry.type === "custom_message" && entry.customType === "boundary-edit-target");
			return { entries: [...event.entries,
				{ type: "context_edit", targetId: target.id, replacement: null },
				{ type: "custom", customType: "boundary-receipt", data: result.details },
				...(result.details.rollover ? [{ type: "compaction", summary: result.details.summary, firstKeptEntryId: null }] : []),
				{ type: "custom_message", customType: "boundary-survivor", content: "BOUNDARY_SURVIVOR", display: false }
			], continue: true };
		});
	}`);
	for (const order of ["producer-first", "kit-first"]) {
		if (process.env.PI_NAMING_ORDER && process.env.PI_NAMING_ORDER !== order) continue;
		const paths = order === "producer-first" ? [producer, namingPath] : [namingPath, producer];
		for (const [mode, rollover, summary] of [["drafts", false, ""], ["empty", true, ""], ["handoff", true, "POSTHORSE_HANDOFF"], ["in-run-rename", true, "POSTHORSE_HANDOFF"]]) {
			if (process.env.PI_NAMING_CASE && process.env.PI_NAMING_CASE !== mode) continue;
			await open(sdk.SessionManager.create(cwd, temp), paths);
			session.setActiveToolsByName(["name_session", "boundary_case"]);
			session.setSessionName(`${order}-${mode}-initial`);
			await prompt("OLD_BOUNDARY_HISTORY");
			await session.sendCustomMessage({ customType: "boundary-edit-target", content: "EDIT_TARGET", display: false });
			const start = requests.length;
			const name = `${order}-${mode}-updated`;
			const finalName = mode === "in-run-rename" ? `${name}-tool-renamed` : name;
			boundaryInput = { name, rollover, summary };
			renameAfterBoundary = mode === "in-run-rename" ? finalName : undefined;
			await prompt("execute boundary fixture");
			assert.equal(requests.length, start + (mode === "in-run-rename" ? 3 : 2), `${order}/${mode}: only requested tool calls and their followup`);
			const branch = session.sessionManager.getBranch();
			const compactions = branch.filter((e) => e.type === "compaction");
			assert.equal(compactions.length, rollover ? 1 : 0, `${order}/${mode}: actual compaction must commit`);
			assert.equal(branch.filter((e) => e.type === "custom" && e.customType === "boundary-receipt").length, 1, `${order}/${mode}: preserve producer receipt`);
			assert.equal(branch.filter((e) => e.type === "context_edit").length, 1, `${order}/${mode}: preserve producer context edit`);
			assert.equal(branch.filter((e) => e.type === "custom_message" && e.customType === "boundary-survivor").length, 1, `${order}/${mode}: preserve producer message`);
			if (rollover) {
				assert.equal(compactions[0].firstKeptEntryId, compactions[0].id);
				assert.equal(compactions[0].summary, summary);
			}
			const continued = requests[start + 1];
			assert.equal(latestName(continued), name, `${order}/${mode}: first in-run request reports the current name`);
			assert.match(JSON.stringify(continued.input), /BOUNDARY_SURVIVOR/);
			assert.doesNotMatch(JSON.stringify(continued.input), /EDIT_TARGET/);
			if (rollover) {
				assert.doesNotMatch(JSON.stringify(continued.input), /OLD_BOUNDARY_HISTORY|BOUNDARY_TOOL_RESULT|execute boundary fixture/);
				assert.equal([...JSON.stringify(continued.input).matchAll(/currentName\\":/g)].length, 1);
				assert.equal(metadata().length, mode === "in-run-rename" ? 2 : 1, "only recovery and any explicit rename are persisted");
			}
			assert.equal(latestName(), finalName);
			if (mode === "in-run-rename") extendsPrefix(continued);
			const beforeFollowup = requests.at(-1);
			await prompt("after in-run boundary");
			extendsPrefix(beforeFollowup);
			assert.equal(latestName(), finalName);
			const branchTarget = session.sessionManager.getLeafId();
			const beforeRename = requests.at(-1);
			session.setSessionName(`${finalName}-renamed`);
			await prompt("after boundary rename");
			extendsPrefix(beforeRename);
			assert.equal(latestName(), `${finalName}-renamed`);
			const renamed = requests.at(-1);
			await session.reload();
			await prompt("after boundary reload");
			extendsPrefix(renamed);
			await session.navigateTree(branchTarget, { summarize: false });
			await prompt("after boundary branch");
			extendsPrefix(continued);
			assert.equal(latestName(), `${finalName}-renamed`);
			const saved = session.sessionManager.getSessionFile();
			assert.ok(saved && existsSync(saved), "native file persistence");
			const persisted = readFileSync(saved, "utf8").split("\n").filter((line) => line.trim()).map(JSON.parse);
			assert.equal(persisted.filter((e) => e.type === "compaction").length, rollover ? 1 : 0);
			const beforeReopen = requests.at(-1);
			await close();
			await open(sdk.SessionManager.open(saved, temp), paths);
			await prompt("after boundary reopen");
			extendsPrefix(beforeReopen);
			assert.equal(latestName(), `${finalName}-renamed`);
			const beforeLoadout = requests.at(-1);
			session.setActiveToolsByName(["name_session", "boundary_case", "late_tool"]);
			await prompt("after post-boundary tool activation");
			extendsPrefix(beforeLoadout);
			assert.equal(requests.at(-1).input[0].role, "system", "preserve the native system head at index zero");
			assert.deepEqual(requests.at(-1).input[0], beforeLoadout.input[0], "tool updates must not rebuild the submitted system head");
			assert.ok(requests.at(-1).input.slice(beforeLoadout.input.length).some((item) => item.role === "system" && JSON.stringify(item).includes("LATE_TOOL_PROMPT_UPDATE")), "native tool update is appended mid-conversation");
			const afterLoadout = requests.at(-1);
			await prompt("steady after tool activation");
			extendsPrefix(afterLoadout);
			console.log(`PASS ${order}/${mode}: producer drafts, first in-run wire, stable followup/rename/reload/branch/reopen and native persistence`);
			console.log(`PASS ${order}/${mode}: mid-conversation tool update preserves full system/input prefix`);
			await close();
		}
	}
	console.log(JSON.stringify({ host, version: JSON.parse(readFileSync(join(host, "package.json"))).version, aiRoot, requests: requests.length, network: "fixture only" }));
} finally {
	if (session) session.dispose();
	globalThis.fetch = originalFetch;
	globalThis.WebSocket = originalWebSocket;
	rmSync(temp, { recursive: true, force: true });
}
