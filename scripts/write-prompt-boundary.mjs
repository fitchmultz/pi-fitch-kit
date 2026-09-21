#!/usr/bin/env node
// Optional argument: another installed/built pi-coding-agent package root.
// Use the host's native extension loader and completion/HTTP serializer, not a mocked complete().
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const host = process.argv[2] ? resolve(process.argv[2]) : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const hostRequire = createRequire(join(host, "package.json"));
const sdkPath = join(host, "dist/index.js");
if (process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR) assert.equal(realpathSync(host), realpathSync(process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR));
if (process.env.PI_HOST_INDEX) assert.equal(realpathSync(sdkPath), realpathSync(process.env.PI_HOST_INDEX));
if (process.env.PI_COMPAT_EXPECTED_VERSION) assert.equal(JSON.parse(readFileSync(join(host, "package.json"), "utf8")).version, process.env.PI_COMPAT_EXPECTED_VERSION);
const aiRoot = hostRequire.resolve.paths("@earendil-works/pi-ai").map((base) => join(base, "@earendil-works/pi-ai")).find((base) => existsSync(join(base, "package.json")));
const aiPath = realpathSync(join(aiRoot, "dist/index.js"));
const temp = mkdtempSync(join(tmpdir(), "pi-writer-boundary-"));
const agentDir = join(temp, "agent");
const cwd = join(temp, "project");
mkdirSync(agentDir);
mkdirSync(cwd);
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_PACKAGE_DIR = host;
process.env.PI_OFFLINE = "1";
const sdk = await import(pathToFileURL(sdkPath).href);
const ai = await import(pathToFileURL(aiPath).href);
const requests = [];
const originalFetch = globalThis.fetch;
// No request can leave the process. Only the fake endpoint is accepted.
globalThis.fetch = async (url, init) => {
	assert.equal(String(url), "https://writer.invalid/v1/chat/completions");
	requests.push(JSON.parse(init.body));
	const chunk = { id: "writer-response", object: "chat.completion.chunk", created: 1, model: "writer", choices: [{ index: 0, delta: { role: "assistant", content: "WRITER_REPLY" }, finish_reason: "stop" }] };
	return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
};
let session;
let loader;
const notices = [];
const actions = [];
const lifecycle = [];
const sentinel = "CURRENT_WRITER_INSTRUCTIONS";
const historicalTool = { name: "historical_tool", description: "OLD_SCHEMA_SENTINEL", parameters: { type: "object", properties: {} } };
try {
	const runtime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
	const registry = new sdk.ModelRegistry(runtime);
	registry.registerProvider("writer-boundary", {
		api: "openai-completions", baseUrl: "https://writer.invalid/v1", apiKey: "synthetic",
		models: ["writer", "override"].map((id) => ({ id, name: id, reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
	});
	const model = registry.find("writer-boundary", "writer");
	assert.ok(model);
	// Positive control: this native serializer really exposes supplied schemas.
	const control = await registry.complete(model, { systemPrompt: sentinel, tools: [historicalTool], messages: [{ role: "user", content: "control", timestamp: 0 }] });
	assert.equal(control.stopReason, "stop");
	assert.equal(requests.at(-1).tools[0].function.name, "historical_tool");
	assert.match(JSON.stringify(requests.at(-1)), /CURRENT_WRITER_INSTRUCTIONS/);
	const manager = sdk.SessionManager.inMemory(cwd);
	// System entries are supported only by transcript-capable hosts. Legacy hosts
	// exercise the same conversational history without unsupported journal inputs.
	const supportsSystemMessages = typeof ai.getCurrentSystemMessage === "function";
	if (supportsSystemMessages) {
		manager.appendMessage({ role: "system", content: "", sections: { preamble: "OLD_INSTRUCTIONS" }, toolsAdded: [historicalTool], timestamp: 1 });
		manager.appendMessage({ role: "system", content: "", sections: { preamble: sentinel }, toolsRemoved: [{ name: "historical_tool" }], timestamp: 2 });
	}
	manager.appendMessage({ role: "user", content: "CONVERSATION_SENTINEL", timestamp: 3 });
	const assistant = { ...ai.fauxAssistantMessage("HISTORY_REPLY"), api: model.api, provider: model.provider, model: model.id };
	manager.appendMessage({ ...assistant, content: [{ type: "text", text: "HISTORY_REPLY" }, { type: "toolCall", id: "call-1", name: "historical_tool", arguments: { query: "ARG_SENTINEL" } }], stopReason: "toolUse" });
	manager.appendMessage({ role: "toolResult", toolName: "historical_tool", toolCallId: "call-1", content: [{ type: "text", text: "RESULT_SENTINEL" }], isError: true, timestamp: 4 });
	if (supportsSystemMessages) manager.appendMessage({ role: "system", content: "", toolsAdded: [historicalTool], timestamp: 5 });
	const branchLeaf = manager.getLeafId();
	manager.appendMessage({ role: "user", content: "OFF_BRANCH_SENTINEL", timestamp: 6 });
	manager.branch(branchLeaf);
	const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	loader = new sdk.DefaultResourceLoader({
		cwd, agentDir, settingsManager,
		additionalExtensionPaths: [join(root, "extensions/write-prompt.ts")],
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		systemPromptOverride: () => sentinel,
		extensionFactories: [(pi) => {
			pi.on("session_start", (event) => { lifecycle.push(event.reason); });
			pi.on("session_shutdown", (event) => { lifecycle.push(`shutdown:${event.reason}`); });
		}],
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	async function open(sm) {
		({ session } = await sdk.createAgentSession({ cwd, agentDir, model, modelRuntime: runtime, resourceLoader: loader, settingsManager, sessionManager: sm, tools: [] }));
		const ui = session.extensionRunner.createContext().ui;
		await session.bindExtensions({ mode: "rpc", uiContext: {
			...ui,
			notify: (text, level) => { notices.push({ text, level }); },
			select: async (text) => { assert.equal(text, "WRITER_REPLY"); return actions.shift(); },
			editor: async () => "FOLLOWUP_SENTINEL",
		}, onError: (error) => { throw new Error(error.error); } });
	}
	async function close() {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
		session = undefined;
	}
	function check(body, history = true) {
		const serialized = JSON.stringify(body);
		assert.equal(serialized.split(sentinel).length - 1, 1, "current instructions must occur exactly once at the HTTP boundary");
		assert.equal(body.tools?.length ?? 0, 0, "writer must not advertise historical tools");
		assert.doesNotMatch(serialized, /OLD_INSTRUCTIONS|OLD_SCHEMA_SENTINEL|OFF_BRANCH_SENTINEL|tool_calls|tool_call_id/);
		assert.ok(body.messages.every((m) => ["system", "user", "assistant"].includes(m.role)));
		if (history) {
			for (const text of ["CONVERSATION_SENTINEL", "HISTORY_REPLY", "called historical_tool", "ARG_SENTINEL", "historical_tool error", "RESULT_SENTINEL"]) assert.ok(serialized.includes(text), text);
		}
	}
	async function exercise(sm, label, history = true) {
		const before = structuredClone(sm.getEntries());
		const leaf = sm.getLeafId();
		for (const [command, followup, dismiss] of [["draft", "Tweak", "Deny"], ["side-question", "Ask again", "Dismiss"]]) {
			const start = requests.length;
			actions.push(followup, dismiss);
			await session.prompt(`/${command} SOURCE_SENTINEL`);
			assert.equal(requests.length - start, 2, `${label} /${command} must complete and follow up`);
			for (const body of requests.slice(start)) check(body, history);
			assert.match(JSON.stringify(requests[start + 1]), /WRITER_REPLY.*FOLLOWUP_SENTINEL/);
			assert.equal(actions.length, 0);
			assert.deepEqual(sm.getEntries(), before, "off-transcript commands must not alter the journal");
			assert.equal(sm.getLeafId(), leaf);
		}
		console.log(`PASS ${label}: draft/tweak/deny and side-question/ask-again/dismiss`);
	}
	await open(manager);
	await exercise(manager, "active branch");
	// Persist only our synthetic active branch, then use the native JSONL reader.
	const file = join(temp, "saved.jsonl");
	writeFileSync(file, [manager.getHeader(), ...manager.getBranch()].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
	await close();
	const resumed = sdk.SessionManager.open(file, temp);
	await open(resumed);
	writeFileSync(join(agentDir, "write-prompt.json"), JSON.stringify({ model: "writer-boundary/override" }));
	await exercise(resumed, "file-backed resume + override");
	assert.equal(requests.at(-1).model, "override");
	if (process.env.PI_COMPAT_HOST === "fork") assert.equal(typeof session.newContext, "function", "Fork qualification requires native new-context rollover");
	if (typeof session.newContext === "function") {
		session.newContext({ handoff: "HANDOFF_SENTINEL" });
		await exercise(resumed, "native new context", false);
		assert.match(JSON.stringify(requests.at(-1)), /HANDOFF_SENTINEL/);
		assert.doesNotMatch(JSON.stringify(requests.at(-1)), /CONVERSATION_SENTINEL/);
	} else console.log("SKIP newContext: host does not expose it");
	await close();
	const fresh = sdk.SessionManager.inMemory(cwd);
	await open(fresh);
	await exercise(fresh, "fresh session", false);
	assert.doesNotMatch(JSON.stringify(requests.at(-1)), /CONVERSATION_SENTINEL/);
	assert.equal(notices.some((notice) => notice.level === "error"), false, JSON.stringify(notices));
	assert.ok(lifecycle.includes("startup"));
	console.log(JSON.stringify({ host, version: JSON.parse(readFileSync(join(host, "package.json"))).version, aiVersion: JSON.parse(readFileSync(join(aiRoot, "package.json"))).version, sdkPath, aiPath, extension: loader.getExtensions().extensions[0].path, requests: requests.length, lifecycle }));
} finally {
	if (session) { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
	globalThis.fetch = originalFetch;
	rmSync(temp, { recursive: true, force: true });
}
