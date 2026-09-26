#!/usr/bin/env node
// Optional argument: another installed/built pi-coding-agent package root.
// Use the host's native extension loader and completion/HTTP serializer, not a mocked complete().
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const host = process.argv[2] ? resolve(process.argv[2]) : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const apis = ["openai-completions", "openai-responses", "openai-codex-responses"];
const api = process.argv[3];
if (!api) {
	for (const route of apis) execFileSync(process.execPath, [fileURLToPath(import.meta.url), host, route], { stdio: "inherit" });
	process.exit(0);
}
assert.ok(apis.includes(api));
const responses = api !== "openai-completions";
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
const requestOrigins = [];
let holdNextRequest;
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
// Keep the writer's raw request options unchanged. Native auto transport falls
// back to our fake HTTP endpoint when WebSockets are unavailable.
globalThis.WebSocket = undefined;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=";
const encrypted = { type: "reasoning", id: "rs_history", summary: [], encrypted_content: "SYNTHETIC_ENCRYPTED_REASONING" };
// No request can leave the process. Only the fake endpoint is accepted.
globalThis.fetch = async (url, init) => {
	const path = api === "openai-codex-responses" ? "codex/responses" : responses ? "responses" : "chat/completions";
	assert.ok(["writer.invalid", "alternate-writer.invalid"].some((host) => String(url) === `https://${host}/v1/${path}`));
	requestOrigins.push(new URL(url).hostname);
	const body = new Headers(init.headers).get("content-encoding") === "zstd" ? zstdDecompressSync(init.body).toString() : init.body;
	requests.push(JSON.parse(body));
	if (holdNextRequest) {
		const hold = holdNextRequest;
		holdNextRequest = undefined;
		hold.started.resolve();
		await hold.release.promise;
	}
	if (responses) {
		const item = { id: "msg_writer", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "WRITER_REPLY", annotations: [] }] };
		const events = [
			{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
			{ type: "response.output_item.done", output_index: 0, item },
			{ type: "response.completed", response: { id: "resp_writer", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } },
		];
		return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
	}
	const chunk = { id: "writer-response", object: "chat.completion.chunk", created: 1, model: "writer", choices: [{ index: 0, delta: { role: "assistant", content: "WRITER_REPLY" }, finish_reason: "stop" }] };
	return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
};
let session;
let loader;
const notices = [];
const actions = [];
const lifecycle = [];
const sendErrors = [];
const inputs = [];
let editorText = "";
const sentinel = "CURRENT_WRITER_INSTRUCTIONS";
const historicalTool = { name: "historical_tool", description: "OLD_SCHEMA_SENTINEL", parameters: { type: "object", properties: {} } };
let toolExecutions = 0;
try {
	const runtime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
	const registry = new sdk.ModelRegistry(runtime);
	const providerConfig = {
		api, baseUrl: "https://writer.invalid/v1",
		apiKey: `synthetic.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline" } })).toString("base64")}.synthetic`,
		models: ["writer", "override"].map((id) => ({ id, name: id, reasoning: true, thinkingLevelMap: { off: "none", high: "high" }, input: ["text", "image"], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
	};
	registry.registerProvider("writer-boundary", providerConfig);
	registry.registerProvider("alternate-writer", { ...providerConfig, baseUrl: "https://alternate-writer.invalid/v1" });
	const model = registry.find("writer-boundary", "writer");
	assert.ok(model);
	// Positive control: this native serializer really exposes supplied schemas.
	const control = await registry.complete(model, { systemPrompt: sentinel, tools: [historicalTool], messages: [{ role: "user", content: "control", timestamp: 0 }] });
	assert.equal(control.stopReason, "stop");
	assert.equal(responses ? requests.at(-1).tools[0].name : requests.at(-1).tools[0].function.name, "historical_tool");
	assert.match(JSON.stringify(requests.at(-1)), /CURRENT_WRITER_INSTRUCTIONS/);
	// Compare the writer to the native simple API, independently of its config.
	const offControl = await runtime.completeSimple(model, { messages: [{ role: "user", content: "off control", timestamp: 0 }] });
	assert.equal(offControl.stopReason, "stop");
	const nativeOffEffort = responses ? requests.at(-1).reasoning?.effort : requests.at(-1).reasoning_effort;
	const manager = sdk.SessionManager.inMemory(cwd);
	manager.appendMessage({ role: "system", content: "", sections: { preamble: "OLD_INSTRUCTIONS" }, toolsAdded: [historicalTool], timestamp: 1 });
	manager.appendMessage({ role: "system", content: "", sections: { preamble: sentinel }, toolsRemoved: [{ name: "historical_tool" }], timestamp: 2 });
	manager.appendMessage({ role: "user", content: "CONVERSATION_SENTINEL", timestamp: 3 });
	const assistant = { ...ai.fauxAssistantMessage("HISTORY_REPLY"), api: model.api, provider: model.provider, model: model.id };
	manager.appendMessage({ ...assistant, content: [...(responses ? [{ type: "thinking", thinking: "", thinkingSignature: JSON.stringify(encrypted) }] : []), { type: "text", text: "HISTORY_REPLY" }, { type: "toolCall", id: "call-1", name: "historical_tool", arguments: { query: "ARG_SENTINEL" } }], stopReason: "toolUse" });
	manager.appendMessage({ role: "toolResult", toolName: "historical_tool", toolCallId: "call-1", content: [{ type: "text", text: "RESULT_SENTINEL" }, { type: "image", data: png, mimeType: "image/png" }, { type: "text", text: "AFTER_IMAGE" }], isError: true, timestamp: 4 });
	manager.appendMessage({ role: "system", content: "", toolsAdded: [historicalTool], timestamp: 5 });
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
			pi.registerTool({ ...historicalTool, label: "Historical tool", execute: async () => { toolExecutions++; throw new Error("Writer must not execute tools"); } });
			pi.on("session_start", (event) => { lifecycle.push(event.reason); });
			pi.on("session_shutdown", (event) => { lifecycle.push(`shutdown:${event.reason}`); });
			pi.on("input", (event) => { inputs.push(event); });
		}],
	});
	async function open(sm) {
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		({ session } = await sdk.createAgentSession({ cwd, agentDir, model, modelRuntime: runtime, resourceLoader: loader, settingsManager, sessionManager: sm, tools: [] }));
		session.setThinkingLevel("high");
		const ui = session.extensionRunner.createContext().ui;
		await session.bindExtensions({ mode: "rpc", uiContext: {
			...ui,
			notify: (text, level) => { notices.push({ text, level }); },
			select: async (text) => {
				assert.equal(text, "WRITER_REPLY");
				const action = actions.shift();
				return typeof action === "function" ? action() : action;
			},
			editor: async () => "FOLLOWUP_SENTINEL",
			setEditorText: (text) => { editorText = text; },
			getEditorText: () => editorText,
		}, onError: (error) => {
			if (error.event === "send_user_message") sendErrors.push(error);
			else throw new Error(error.error);
		} });
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
		assert.doesNotMatch(serialized, /OLD_INSTRUCTIONS|OLD_SCHEMA_SENTINEL|OFF_BRANCH_SENTINEL/);
		const messages = responses ? body.input : body.messages;
		assert.doesNotMatch(JSON.stringify(messages), /tool_calls|tool_call_id|function_call|additional_tools/);
		assert.ok(messages.every((m) => ["system", "developer", "user", "assistant"].includes(m.role) || m.type === "reasoning"));
		if (responses) {
			assert.equal(body.max_output_tokens, api === "openai-codex-responses" ? undefined : 1000, "native simple streaming owns the output limit");
			assert.equal(body.reasoning?.effort, "high", "writer inherits the session thinking level");
			assert.equal(body.temperature, undefined);
			const reasoning = body.input.filter((item) => item.type === "reasoning");
			assert.deepEqual(reasoning, history && body.model === "writer" ? [encrypted] : [], "encrypted reasoning replays only for the same model");
			if (api === "openai-codex-responses") assert.equal(body.prompt_cache_options, undefined);
		} else assert.equal(body.reasoning_effort, "high", "Completions also inherits session thinking");
		if (history) {
			for (const text of ["CONVERSATION_SENTINEL", "HISTORY_REPLY", "called historical_tool", "ARG_SENTINEL", "historical_tool error", "RESULT_SENTINEL"]) assert.ok(serialized.includes(text), text);
			assert.ok(serialized.includes(`data:image/png;base64,${png}`), "tool-result image must reach the native HTTP serializer");
			const result = messages.find((m) => Array.isArray(m.content) && m.content.some((part) => part.text === "RESULT_SENTINEL"));
			assert.ok(result, "flattened tool result remains a user message");
			assert.equal(result.role, "user");
			assert.deepEqual(result.content, responses ? [
				{ type: "input_text", text: "[historical_tool error]" },
				{ type: "input_text", text: "RESULT_SENTINEL" },
				{ type: "input_image", detail: "auto", image_url: `data:image/png;base64,${png}` },
				{ type: "input_text", text: "AFTER_IMAGE" },
			] : [
				{ type: "text", text: "[historical_tool error]" },
				{ type: "text", text: "RESULT_SENTINEL" },
				{ type: "image_url", image_url: { url: `data:image/png;base64,${png}` } },
				{ type: "text", text: "AFTER_IMAGE" },
			], "tool-result image bytes and text order survive native HTTP serialization");
		}
	}
	async function exercise(sm, label, history = true) {
		const before = structuredClone(sm.getEntries());
		const leaf = sm.getLeafId();
		const file = sm.getSessionFile();
		const journal = file && existsSync(file) ? readFileSync(file) : undefined;
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
			if (journal) assert.deepEqual(readFileSync(file), journal, "off-transcript commands must not write to the main journal");
			assert.equal(toolExecutions, 0);
		}
		console.log(`PASS ${api} ${label}: draft/tweak/deny and side-question/ask-again/dismiss`);
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
	for (const [config, origin, id, effort] of [
		[undefined, "writer.invalid", "writer", "high"],
		[{ provider: "alternate-writer", model: "override", thinkingLevel: "low" }, "alternate-writer.invalid", "override", "low"],
		[{ provider: "alternate-writer" }, "alternate-writer.invalid", "writer", "high"],
		[{ model: "override" }, "writer.invalid", "override", "high"],
		[{ thinkingLevel: "medium" }, "writer.invalid", "writer", "medium"],
		[{ thinkingLevel: "off" }, "writer.invalid", "writer", nativeOffEffort],
	]) {
		const configPath = join(agentDir, "write-prompt.json");
		if (config === undefined) rmSync(configPath, { force: true });
		else writeFileSync(configPath, JSON.stringify(config));
		actions.push("Deny");
		await session.prompt("/draft CONFIGURATION_SENTINEL");
		assert.equal(requestOrigins.at(-1), origin);
		assert.equal(requests.at(-1).model, id);
		assert.equal(responses ? requests.at(-1).reasoning?.effort : requests.at(-1).reasoning_effort, effort);
		assert.equal(session.model.provider, "writer-boundary");
		assert.equal(session.model.id, "writer");
		assert.equal(session.thinkingLevel, "high");
	}
	rmSync(join(agentDir, "write-prompt.json"));
	console.log(`PASS ${api}: native thinking inheritance, full and partial overrides, off, unchanged session`);
	// Real extension dispatch, native steering queues and async error handling.
	async function until(predicate) {
		const deadline = Date.now() + 5000;
		while (!predicate()) {
			assert.ok(Date.now() < deadline, `native delivery did not reach the expected state: ${JSON.stringify({ sendErrors, notices, inputs })}`);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
	const delivered = () => fresh.getBranch().filter((entry) =>
		entry.type === "message" && entry.message.role === "user"
		&& ai.contentText(entry.message.content) === "WRITER_REPLY").length;
	actions.push("Accept");
	await session.prompt("/draft IDLE_ORIGINAL");
	await until(() => delivered() === 1);
	await session.waitForIdle();
	assert.equal(inputs.at(-1).source, "extension");
	assert.equal(inputs.at(-1).streamingBehavior, undefined);
	assert.equal(editorText, "", "successful acceptance must not replace editor input");

	let activeRun;
	const hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
	actions.push(async () => {
		holdNextRequest = hold;
		activeRun = session.prompt("BUSY_SENTINEL");
		await hold.started.promise;
		assert.equal(session.extensionRunner.createContext().isIdle(), false);
		return "Accept";
	});
	try {
		await session.prompt("/draft BUSY_ORIGINAL");
		await until(() => session.getSteeringMessages().includes("WRITER_REPLY"));
		assert.equal(inputs.at(-1).source, "extension");
		assert.equal(inputs.at(-1).streamingBehavior, "steer");
		assert.equal(delivered(), 1, "busy acceptance queues instead of starting a concurrent turn");
	} finally {
		hold.release.resolve();
		await activeRun;
	}
	await session.waitForIdle();
	assert.equal(delivered(), 2, "queued draft is delivered once");

	// Remove the main model only after writing finishes: sendUserMessage's
	// rejected promise is handled by Pi, never returned to the extension.
	const original = "FAILED_ORIGINAL\nsecond line";
	editorText = "unrelated editor input";
	actions.push(() => {
		session.agent.state.model = undefined;
		return "Accept";
	});
	await session.prompt(`/draft ${original}`);
	await until(() => sendErrors.length === 1);
	assert.match(sendErrors[0].error, /[Nn]o model/);
	assert.equal(delivered(), 2);
	assert.equal(editorText, "unrelated editor input", "failure preserves existing editor input");
	const backup = fresh.getBranch().findLast((entry) => entry.type === "custom" && entry.customType === "fitch-kit.draft");
	assert.deepEqual(backup.data, { source: original, draft: "WRITER_REPLY" });
	assert.doesNotMatch(JSON.stringify(fresh.buildSessionContext().messages), /FAILED_ORIGINAL/, "backup stays out of model context");

	// Save/reopen through Pi's native journal to prove recovery is not a mock
	// or a command closure that vanishes after restart.
	const recoveryFile = join(temp, "recovery.jsonl");
	writeFileSync(recoveryFile, [fresh.getHeader(), ...fresh.getBranch()].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
	await close();
	const recovered = sdk.SessionManager.open(recoveryFile, temp);
	await open(recovered);
	const beforeRecovery = requests.length;
	actions.push("Restore original");
	await session.prompt("/draft");
	assert.equal(editorText, `/draft ${original}`);
	assert.equal(requests.length, beforeRecovery, "recovery does not spend another writer call");
	actions.push("Accept");
	await session.prompt("/draft");
	await until(() => recovered.getBranch().filter((entry) => entry.type === "message"
		&& entry.message.role === "user" && ai.contentText(entry.message.content) === "WRITER_REPLY").length === 3);
	await session.waitForIdle();
	assert.equal(requests.length, beforeRecovery + 1, "retry sends the retained draft without rewriting it");
	assert.equal(sendErrors.length, 1, "retry succeeds");
	console.log(`PASS ${api}: native idle send, busy steering, async failure preservation and resumed retry`);
	assert.equal(notices.some((notice) => notice.level === "error"), false, JSON.stringify(notices));
	assert.ok(lifecycle.includes("startup"));
	console.log(JSON.stringify({ host, api, version: JSON.parse(readFileSync(join(host, "package.json"))).version, aiVersion: JSON.parse(readFileSync(join(aiRoot, "package.json"))).version, sdkPath, aiPath, extension: loader.getExtensions().extensions[0].path, requests: requests.length, lifecycle }));
} finally {
	if (session) { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
	globalThis.fetch = originalFetch;
	globalThis.WebSocket = originalWebSocket;
	rmSync(temp, { recursive: true, force: true });
}
