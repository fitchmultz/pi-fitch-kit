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
let requestWindow = false;
let overflowNextRequest = false;
globalThis.fetch = async (url, init) => {
	assert.equal(String(url), "https://naming.invalid/v1/responses", "no network may leave the fixture");
	requests.push(JSON.parse(init.body));
	if (overflowNextRequest) {
		overflowNextRequest = false;
		return new Response(JSON.stringify({ error: { message: "maximum context length exceeded", code: "context_length_exceeded", type: "invalid_request_error" } }), { status: 400, headers: { "content-type": "application/json" } });
	}
	const item = requestedName || requestWindow ? {
		type: "function_call", id: `fc_${requests.length}`, call_id: `call_${requests.length}`,
		name: requestWindow ? "fresh_window" : "name_session", arguments: JSON.stringify(requestWindow ? {} : { name: requestedName }), status: "completed",
	} : { id: `msg_${requests.length}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "DONE", annotations: [] }] };
	requestedName = undefined;
	requestWindow = false;
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
	registry.registerProvider("naming-boundary", { api: "openai-responses", baseUrl: "https://naming.invalid/v1", apiKey: "offline", models: [{ id: "naming", name: "naming", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
	const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false } });
	const loader = new sdk.DefaultResourceLoader({ cwd, agentDir: temp, settingsManager,
		additionalExtensionPaths: [process.env.PI_NAMING_EXTENSION ?? join(root, "extensions/session-name.ts")],
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		systemPromptOverride: () => "NAMING_BOUNDARY",
		extensionFactories: [(pi) => {
			pi.registerTool({ name: "fresh_window", label: "Fresh Window", description: "Start a native fresh window", parameters: { type: "object", properties: {} }, execute: async (_id, _args, _signal, _update, ctx) => {
				ctx.newContext({ handoff: "IN_RUN_FRESH_WINDOW" });
				return { content: [{ type: "text", text: "Window requested" }] };
			} });
			// Replace only the summarizer, not compaction dispatch, persistence or projection.
			pi.on("session_before_compact", (event) => ({ compaction: { summary: "OFFLINE_SUMMARY", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: 10 } }));
		}],
	});
	async function open(manager) {
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.ok(loader.getExtensions().extensions.some((e) => e.path.endsWith("session-name.ts")), JSON.stringify(loader.getExtensions().extensions.map((e) => e.path)));
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
	if (typeof session.newContext === "function") {
		session.newContext({ handoff: "FRESH_WINDOW" });
		await prompt("after fresh window");
		assert.equal(latestName(), session.sessionManager.getSessionName() ?? null);
		assert.equal(metadata().length, 1, "fresh window restores metadata exactly once");
		assert.match(JSON.stringify(requests.at(-1)), /FRESH_WINDOW/);
		assert.doesNotMatch(JSON.stringify(requests.at(-1)), /before naming enabled/);
		const fresh = requests.at(-1);
		await prompt("fresh followup");
		extendsPrefix(fresh);
		assert.equal(metadata().length, 1);
		session.setActiveToolsByName(["name_session", "fresh_window"]);
		requestWindow = true;
		const beforeWindow = requests.length;
		await prompt("replace context inside this run");
		assert.equal(requests.length, beforeWindow + 2, "fresh-window tool creates exactly one follow-up");
		assert.match(JSON.stringify(requests.at(-1)), /IN_RUN_FRESH_WINDOW/);
		assert.equal(latestName(), session.sessionManager.getSessionName() ?? null, "first in-run fresh-window request has truthful name metadata");
		assert.equal(metadata().length, 1);
		console.log("PASS native idle and in-run fresh windows, first request and subsequent prefix");
	} else console.log("SKIP fork-only newContext: absent on official host");
	await close();
	await open(sdk.SessionManager.inMemory(cwd));
	await prompt("fresh unnamed");
	assert.equal(latestName(), null);
	assert.equal(metadata().length, 1);
	assert.ok(requests.length < 30, "metadata must not trigger extra model loops");
	console.log("PASS serialized prefix: late enable, naming tool loop, unchanged and /name; native reload/tree/edit/compact/overflow-retry/reopen/fork/fresh");
	console.log(JSON.stringify({ host, version: JSON.parse(readFileSync(join(host, "package.json"))).version, aiRoot, requests: requests.length, network: "fixture only" }));
} finally {
	if (session) session.dispose();
	globalThis.fetch = originalFetch;
	globalThis.WebSocket = originalWebSocket;
	rmSync(temp, { recursive: true, force: true });
}
