#!/usr/bin/env node
// Optional argument: another installed/built pi-coding-agent package root.
// Use the host's native extension loader and completion/HTTP serializer, not a mocked complete().
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";

import type {
	AgentSession,
	createAgentSession as CreateAgentSessionFn,
	DefaultResourceLoader,
	ModelRegistry,
	ModelRuntime,
	ProviderModelConfig,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	contentText as ContentTextFn,
	fauxAssistantMessage as FauxAssistantMessageFn,
	InMemoryCredentialStore as InMemoryCredentialStoreCtor,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "@earendil-works/pi-ai";
import { gate, isRecord, jsonList, requireRecord } from "./test-harness.ts";

/** The host-selected Pi SDK surface this writer boundary drives. */
type HostSdk = {
	createAgentSession: typeof CreateAgentSessionFn;
	DefaultResourceLoader: typeof DefaultResourceLoader;
	ModelRegistry: typeof ModelRegistry;
	ModelRuntime: typeof ModelRuntime;
	SessionManager: typeof SessionManager;
	SettingsManager: typeof SettingsManager;
};
const isHostSdk = (module: unknown): module is HostSdk =>
	typeof module === "object" &&
	module !== null &&
	"createAgentSession" in module &&
	"DefaultResourceLoader" in module &&
	"ModelRegistry" in module &&
	"ModelRuntime" in module &&
	"SessionManager" in module &&
	"SettingsManager" in module;

/** The host-selected pi-ai surface the offline writer needs. */
type HostAi = {
	contentText: typeof ContentTextFn;
	fauxAssistantMessage: typeof FauxAssistantMessageFn;
	InMemoryCredentialStore: typeof InMemoryCredentialStoreCtor;
};
const isHostAi = (module: unknown): module is HostAi =>
	typeof module === "object" &&
	module !== null &&
	"contentText" in module &&
	"fauxAssistantMessage" in module &&
	"InMemoryCredentialStore" in module;

/** The chat variant of a registered provider model (the union member with reasoning). */
type ChatModelConfig = Extract<ProviderModelConfig, { reasoning: boolean }>;

/** A held request: opened when it starts, released by the test. */
type HeldRequest = { started: ReturnType<typeof gate>; release: ReturnType<typeof gate> };

const root = fileURLToPath(new URL("..", import.meta.url));
const host =
	process.argv[2] !== undefined
		? resolve(process.argv[2])
		: dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const apis = ["openai-completions", "openai-responses", "openai-codex-responses"];
const api = process.argv[3];
if (api === undefined) {
	for (const route of apis) {
		execFileSync(process.execPath, [fileURLToPath(import.meta.url), host, route], {
			stdio: "inherit",
		});
	}
	process.exit(0);
}
assert.ok(apis.includes(api));
const responses = api !== "openai-completions";
const hostRequire = createRequire(join(host, "package.json"));
const sdkPath = join(host, "dist/index.js");
if (process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR !== undefined) {
	assert.equal(realpathSync(host), realpathSync(process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR));
}
if (process.env.PI_HOST_INDEX !== undefined) {
	assert.equal(realpathSync(sdkPath), realpathSync(process.env.PI_HOST_INDEX));
}
if (process.env.PI_COMPAT_EXPECTED_VERSION !== undefined) {
	assert.equal(
		requireRecord(JSON.parse(readFileSync(join(host, "package.json"), "utf8")), "host package.json")
			.version,
		process.env.PI_COMPAT_EXPECTED_VERSION,
	);
}
const aiRootBases = hostRequire.resolve.paths("@earendil-works/pi-ai");
if (aiRootBases === null) {
	throw new Error("could not resolve pi-ai from the host package");
}
const aiRoot = aiRootBases
	.map((base) => join(base, "@earendil-works/pi-ai"))
	.find((base) => existsSync(join(base, "package.json")));
if (aiRoot === undefined) {
	throw new Error("could not locate the host pi-ai package");
}
const aiPath = realpathSync(join(aiRoot, "dist/index.js"));
const temp = mkdtempSync(join(tmpdir(), "pi-writer-boundary-"));
const agentDir = join(temp, "agent");
const cwd = join(temp, "project");
const otherProject = join(temp, "other-project");
mkdirSync(agentDir);
mkdirSync(cwd);
mkdirSync(otherProject);
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_PACKAGE_DIR = host;
process.env.PI_OFFLINE = "1";
const sdkModule: unknown = await import(pathToFileURL(sdkPath).href);
if (!isHostSdk(sdkModule)) {
	throw new Error("host Pi SDK did not expose the expected session surface");
}
const sdk = sdkModule;
const aiModule: unknown = await import(pathToFileURL(aiPath).href);
if (!isHostAi(aiModule)) {
	throw new Error("host pi-ai did not expose the writer surface");
}
const ai = aiModule;
const requests: Array<Record<string, unknown>> = [];
const identities: unknown[] = [];
const requestOrigins: string[] = [];
const replies: string[] = [];
let holdNextRequest: HeldRequest | undefined;
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
// Keep the writer's raw request options unchanged. Native auto transport falls
// back to our fake HTTP endpoint when WebSockets are unavailable.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- QX-003: offline fixture disables the WebSocket transport
globalThis.WebSocket = undefined as unknown as typeof WebSocket;
const png =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=";
const encrypted = {
	type: "reasoning",
	id: "rs_history",
	summary: [],
	encrypted_content: "SYNTHETIC_ENCRYPTED_REASONING",
};
// No request can leave the process. Only the fake endpoint is accepted.
globalThis.fetch = async (
	url: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
): Promise<Response> => {
	let path: string;
	if (api === "openai-codex-responses") {
		path = "codex/responses";
	} else if (responses) {
		path = "responses";
	} else {
		path = "chat/completions";
	}
	if (typeof url !== "string") {
		throw new Error("fixture expected a string request URL");
	}
	assert.ok(
		["writer.invalid", "alternate-writer.invalid"].some(
			(endpoint) => url === `https://${endpoint}/v1/${path}`,
		),
	);
	requestOrigins.push(new URL(url).hostname);
	if (init === undefined) {
		throw new Error("fixture capture lost its request init");
	}
	const headers = new Headers(init.headers);
	let bodyText: string;
	if (headers.get("content-encoding") === "zstd") {
		if (!(init.body instanceof Uint8Array) && !(init.body instanceof ArrayBuffer)) {
			throw new Error("zstd capture expected compressed bytes");
		}
		bodyText = zstdDecompressSync(init.body).toString();
	} else {
		if (typeof init.body !== "string") {
			throw new Error("fixture capture expected a string body");
		}
		bodyText = init.body;
	}
	requests.push(requireRecord(JSON.parse(bodyText), "captured request"));
	// The provider-visible session: OpenAI's cache key, or the Completions affinity header.
	const captured = requests.at(-1);
	if (captured === undefined) {
		throw new Error("captured request missing");
	}
	identities.push(responses ? captured.prompt_cache_key : headers.get("x-session-affinity"));
	if (holdNextRequest !== undefined) {
		const hold = holdNextRequest;
		holdNextRequest = undefined;
		hold.started.open();
		await hold.release.promise;
	}
	const reply = replies.shift() ?? "WRITER_REPLY";
	if (responses) {
		const item = {
			id: "msg_writer",
			type: "message",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: reply, annotations: [] }],
		};
		const events = [
			{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
			{ type: "response.output_item.done", output_index: 0, item },
			{
				type: "response.completed",
				response: {
					id: "resp_writer",
					status: "completed",
					output: [item],
					usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
				},
			},
		];
		return new Response(
			events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
			{ headers: { "content-type": "text/event-stream" } },
		);
	}
	const chunk = {
		id: "writer-response",
		object: "chat.completion.chunk",
		created: 1,
		model: "writer",
		choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: "stop" }],
	};
	return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
		headers: { "content-type": "text/event-stream" },
	});
};
let session: AgentSession | undefined;
let loader: DefaultResourceLoader | undefined;
const notices: Array<{ text: string; level: string | undefined }> = [];
const actions: Array<string | (() => string | Promise<string>)> = [];
const lifecycle: string[] = [];
const sendErrors: unknown[] = [];
const inputs: unknown[] = [];
let editorText = "";
let expectedDraft = "WRITER_REPLY";
const sentinel = "CURRENT_WRITER_INSTRUCTIONS";
const historicalTool = {
	name: "historical_tool",
	description: "OLD_SCHEMA_SENTINEL",
	parameters: { type: "object", properties: {} },
};
let toolExecutions = 0;
try {
	const runtime = await sdk.ModelRuntime.create({
		credentials: new ai.InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const registry = new sdk.ModelRegistry(runtime);
	const writerModels: ChatModelConfig[] = ["writer", "override"].map((id) => ({
		id,
		name: id,
		reasoning: true,
		thinkingLevelMap: { off: "none", high: "high" },
		input: ["text", "image"],
		contextWindow: 100000,
		maxTokens: 1000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	}));
	if (!responses) {
		for (const entry of writerModels) {
			entry.compat = { sendSessionAffinityHeaders: true };
		}
	}
	const providerConfig: Parameters<ModelRegistry["registerProvider"]>[1] = {
		api,
		baseUrl: "https://writer.invalid/v1",
		apiKey: `synthetic.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline" } })).toString("base64")}.synthetic`,
		models: writerModels,
	};
	registry.registerProvider("writer-boundary", providerConfig);
	registry.registerProvider("alternate-writer", {
		...providerConfig,
		baseUrl: "https://alternate-writer.invalid/v1",
	});
	const model = registry.find("writer-boundary", "writer");
	assert.ok(model !== undefined, "writer-boundary model missing");
	// Positive control: this native serializer really exposes supplied schemas.
	const control = await registry.complete(model, {
		systemPrompt: sentinel,
		tools: [historicalTool],
		messages: [{ role: "user", content: "control", timestamp: 0 }],
	});
	assert.equal(control.stopReason, "stop");
	const controlRequest = requests.at(-1);
	if (controlRequest === undefined) {
		throw new Error("control request missing");
	}
	const controlTool = requireRecord(
		jsonList(controlRequest.tools, "control tools").at(0),
		"control tool",
	);
	assert.equal(
		responses
			? controlTool.name
			: requireRecord(controlTool.function, "control tool function").name,
		"historical_tool",
	);
	assert.match(JSON.stringify(requests.at(-1)), /CURRENT_WRITER_INSTRUCTIONS/);
	// Compare the writer to the native simple API, independently of its config.
	const offControl = await runtime.completeSimple(model, {
		messages: [{ role: "user", content: "off control", timestamp: 0 }],
	});
	assert.equal(offControl.stopReason, "stop");
	const effortOf = (request: Record<string, unknown>): string | undefined => {
		if (responses) {
			const reasoning = request.reasoning;
			return isRecord(reasoning) && typeof reasoning.effort === "string"
				? reasoning.effort
				: undefined;
		}
		return typeof request.reasoning_effort === "string" ? request.reasoning_effort : undefined;
	};
	const nativeOffEffort = effortOf(requireRecord(requests.at(-1), "off control request"));
	const manager = sdk.SessionManager.inMemory(cwd);
	manager.appendMessage({
		role: "system",
		content: "",
		sections: { preamble: "OLD_INSTRUCTIONS" },
		toolsAdded: [historicalTool],
		timestamp: 1,
	});
	manager.appendMessage({
		role: "system",
		content: "",
		sections: { preamble: sentinel },
		toolsRemoved: [{ name: "historical_tool" }],
		timestamp: 2,
	});
	manager.appendMessage({ role: "user", content: "CONVERSATION_SENTINEL", timestamp: 3 });
	const assistant = {
		...ai.fauxAssistantMessage("HISTORY_REPLY"),
		api: model.api,
		provider: model.provider,
		model: model.id,
	};
	const historyContent: Array<TextContent | ThinkingContent | ToolCall> = [];
	if (responses) {
		historyContent.push({
			type: "thinking",
			thinking: "",
			thinkingSignature: JSON.stringify(encrypted),
		});
	}
	historyContent.push({ type: "text", text: "HISTORY_REPLY" });
	historyContent.push({
		type: "toolCall",
		id: "call-1",
		name: "historical_tool",
		arguments: { query: "ARG_SENTINEL" },
	});
	manager.appendMessage({
		...assistant,
		content: historyContent,
		stopReason: "toolUse",
	});
	manager.appendMessage({
		role: "toolResult",
		toolName: "historical_tool",
		toolCallId: "call-1",
		content: [
			{ type: "text", text: "RESULT_SENTINEL" },
			{ type: "image", data: png, mimeType: "image/png" },
			{ type: "text", text: "AFTER_IMAGE" },
		],
		isError: true,
		timestamp: 4,
	});
	manager.appendMessage({
		role: "system",
		content: "",
		toolsAdded: [historicalTool],
		timestamp: 5,
	});
	const branchLeaf = manager.getLeafId();
	if (branchLeaf === null) {
		throw new Error("history branch leaf missing");
	}
	manager.appendMessage({ role: "user", content: "OFF_BRANCH_SENTINEL", timestamp: 6 });
	manager.branch(branchLeaf);
	const settingsManager = sdk.SettingsManager.inMemory({
		compaction: { enabled: false, keepRecentTokens: 1 },
		retry: { enabled: false },
	});
	loader = new sdk.DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		additionalExtensionPaths: [join(root, "extensions/write-prompt.ts")],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () => sentinel,
		extensionFactories: [
			(pi) => {
				pi.registerTool({
					...historicalTool,
					label: "Historical tool",
					execute: async () => {
						toolExecutions++;
						throw new Error("Writer must not execute tools");
					},
				});
				pi.on("session_start", (event) => {
					lifecycle.push(event.reason);
				});
				pi.on("session_shutdown", (event) => {
					lifecycle.push(`shutdown:${event.reason}`);
				});
				pi.on("input", (event) => {
					inputs.push(event);
				});
				pi.on("session_before_compact", (event) => ({
					compaction: {
						summary: "HANDOFF_SENTINEL",
						firstKeptEntryId: (() => {
							const lastEntry = event.branchEntries.at(-1);
							if (lastEntry === undefined) {
								throw new Error("compaction boundary has no entries");
							}
							return lastEntry.id;
						})(),
						tokensBefore: event.preparation.tokensBefore,
					},
				}));
			},
		],
	});
	const open = async (sm: SessionManager): Promise<AgentSession> => {
		if (loader === undefined) {
			throw new Error("loader not constructed");
		}
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const created = (
			await sdk.createAgentSession({
				cwd,
				agentDir,
				model,
				modelRuntime: runtime,
				resourceLoader: loader,
				settingsManager,
				sessionManager: sm,
				tools: [],
			})
		).session;
		session = created;
		created.setThinkingLevel("high");
		const ui = created.extensionRunner.createContext().ui;
		await created.bindExtensions({
			mode: "rpc",
			uiContext: {
				...ui,
				notify: (text, level) => {
					notices.push({ text, level });
				},
				select: async (text, options) => {
					assert.equal(
						text,
						expectedDraft,
						"only a complete, within-limit prompt may reach the action dialog",
					);
					const action = actions.shift();
					assert.deepEqual(
						options,
						action === "Ask again" || action === "Dismiss"
							? ["Copy answer", "Ask again", "Dismiss"]
							: ["Accept", "Copy prompt", "Tweak", "Restore original", "Deny"],
					);
					return typeof action === "function" ? action() : action;
				},
				editor: async () => "FOLLOWUP_SENTINEL",
				setEditorText: (text) => {
					editorText = text;
				},
				getEditorText: () => editorText,
			},
			onError: (error) => {
				if (error.event === "send_user_message") {
					sendErrors.push(error);
				} else {
					throw new Error(error.error);
				}
			},
		});
		return created;
	};
	const close = async (): Promise<void> => {
		const current = session;
		if (current === undefined) {
			throw new Error("no open session");
		}
		await current.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		current.dispose();
		session = undefined;
	};
	const check = (body: Record<string, unknown>, history: boolean = true): void => {
		const serialized = JSON.stringify(body);
		assert.equal(
			serialized.split(sentinel).length - 1,
			1,
			"current instructions must occur exactly once at the HTTP boundary",
		);
		assert.equal(
			Array.isArray(body.tools) ? body.tools.length : 0,
			0,
			"writer must not advertise historical tools",
		);
		assert.doesNotMatch(serialized, /OLD_INSTRUCTIONS|OLD_SCHEMA_SENTINEL|OFF_BRANCH_SENTINEL/);
		const messages = jsonList(responses ? body.input : body.messages, "request messages");
		assert.doesNotMatch(
			JSON.stringify(messages),
			/tool_calls|tool_call_id|function_call|additional_tools/,
		);
		assert.ok(
			messages.every((m) => {
				const record = requireRecord(m, "request message");
				return (
					(typeof record.role === "string" &&
						["system", "developer", "user", "assistant"].includes(record.role)) ||
					record.type === "reasoning"
				);
			}),
		);
		if (responses) {
			assert.equal(
				body.max_output_tokens,
				api === "openai-codex-responses" ? undefined : 1000,
				"native simple streaming owns the output limit",
			);
			assert.equal(
				isRecord(body.reasoning) ? body.reasoning.effort : undefined,
				"high",
				"writer inherits the session thinking level",
			);
			assert.equal(body.temperature, undefined);
			const reasoning = jsonList(body.input, "request input").filter(
				(item) => requireRecord(item, "request input item").type === "reasoning",
			);
			assert.deepEqual(
				reasoning,
				history && body.model === "writer" ? [encrypted] : [],
				"encrypted reasoning replays only for the same model",
			);
			if (api === "openai-codex-responses") {
				assert.equal(body.prompt_cache_options, undefined);
			}
		} else {
			assert.equal(body.reasoning_effort, "high", "Completions also inherits session thinking");
		}
		if (history) {
			for (const text of [
				"CONVERSATION_SENTINEL",
				"HISTORY_REPLY",
				"called historical_tool",
				"ARG_SENTINEL",
				"historical_tool error",
				"RESULT_SENTINEL",
			]) {
				assert.ok(serialized.includes(text), text);
			}
			assert.ok(
				serialized.includes(`data:image/png;base64,${png}`),
				"tool-result image must reach the native HTTP serializer",
			);
			const result = messages.find((m) => {
				const record = requireRecord(m, "request message");
				return (
					Array.isArray(record.content) &&
					record.content.some(
						(part) => requireRecord(part, "content part").text === "RESULT_SENTINEL",
					)
				);
			});
			if (result === undefined) {
				throw new Error("flattened tool result remains a user message");
			}
			const resultRecord = requireRecord(result, "tool result message");
			assert.equal(resultRecord.role, "user");
			assert.deepEqual(
				resultRecord.content,
				responses
					? [
							{ type: "input_text", text: "[historical_tool error]" },
							{ type: "input_text", text: "RESULT_SENTINEL" },
							{ type: "input_image", detail: "auto", image_url: `data:image/png;base64,${png}` },
							{ type: "input_text", text: "AFTER_IMAGE" },
						]
					: [
							{ type: "text", text: "[historical_tool error]" },
							{ type: "text", text: "RESULT_SENTINEL" },
							{ type: "image_url", image_url: { url: `data:image/png;base64,${png}` } },
							{ type: "text", text: "AFTER_IMAGE" },
						],
				"tool-result image bytes and text order survive native HTTP serialization",
			);
		}
	};
	const exercise = async (
		sm: SessionManager,
		label: string,
		history: boolean = true,
	): Promise<unknown> => {
		const active = session;
		if (active === undefined) {
			throw new Error("no open session");
		}
		const before = structuredClone(sm.getEntries());
		const leaf = sm.getLeafId();
		const file = sm.getSessionFile();
		const journal = file !== undefined && existsSync(file) ? readFileSync(file) : undefined;
		const first = requests.length;
		const commandTable: Array<[string, string, string]> = [
			["draft", "Tweak", "Deny"],
			["ambitious", "Tweak", "Deny"],
			["unreasonable", "Tweak", "Deny"],
			["side-question", "Ask again", "Dismiss"],
		];
		for (const [command, followup, dismiss] of commandTable) {
			const start = requests.length;
			actions.push(followup, dismiss);
			await active.prompt(`/${command} SOURCE_SENTINEL`);
			assert.equal(requests.length - start, 2, `${label} /${command} must complete and follow up`);
			if (command !== "side-question") {
				const instruction =
					command === "unreasonable"
						? "an unreasonably demanding, outcome-driven agent prompt"
						: `a ${command === "ambitious" ? "more ambitious" : "better"} coding-agent prompt`;
				assert.ok(
					JSON.stringify(requests[start]).includes(`Rewrite the boxed text into ${instruction}`),
					`${label} /${command} instruction`,
				);
				if (command === "unreasonable") {
					const revisionRequest = requireRecord(
						requests.at(start + 1),
						"unreasonable revision request",
					);
					const revision = jsonList(
						responses ? revisionRequest.input : revisionRequest.messages,
						"unreasonable revision messages",
					).at(-1);
					assert.match(
						JSON.stringify(revision),
						/unreasonably demanding.*Revise the current draft.*Original request:.*SOURCE_SENTINEL.*Revision notes:.*FOLLOWUP_SENTINEL/s,
						"Tweak retains unreasonable instructions in the new request, not just prior history",
					);
				}
			}
			for (const body of requests.slice(start)) {
				check(body, history);
			}
			assert.match(JSON.stringify(requests[start + 1]), /WRITER_REPLY.*FOLLOWUP_SENTINEL/);
			assert.equal(actions.length, 0);
			assert.deepEqual(
				sm.getEntries(),
				before,
				"off-transcript commands must not alter the journal",
			);
			assert.equal(sm.getLeafId(), leaf);
			if (journal !== undefined && file !== undefined) {
				assert.deepEqual(
					readFileSync(file),
					journal,
					"off-transcript commands must not write to the main journal",
				);
			}
			assert.equal(toolExecutions, 0);
		}
		const sessions = new Set(identities.slice(first));
		assert.equal(
			sessions.size,
			1,
			`${label}: every writer command and follow-up shares one provider session`,
		);
		const [identity] = sessions;
		assert.ok(identity !== undefined, `${label}: writer requests carry a provider session`);
		console.log(
			`PASS ${api} ${label}: draft/ambitious/unreasonable tweak/deny and side-question/ask-again/dismiss`,
		);
		return identity;
	};
	await open(manager);
	const activeId = await exercise(manager, "active branch");
	// Persist only our synthetic active branch, then use the native JSONL reader.
	const file = join(temp, "saved.jsonl");
	writeFileSync(
		file,
		[manager.getHeader(), ...manager.getBranch()].map((entry) => JSON.stringify(entry)).join("\n") +
			"\n",
	);
	await close();
	const resumed = sdk.SessionManager.open(file, temp);
	await open(resumed);
	writeFileSync(
		join(agentDir, "write-prompt.json"),
		JSON.stringify({ model: "writer-boundary/override" }),
	);
	const resumedId = await exercise(resumed, "file-backed resume + override");
	assert.equal(resumedId, activeId, "resuming a session keeps its writer provider session");
	assert.equal(requireRecord(requests.at(-1), "override request").model, "override");
	// Replace history through public compaction, without a model-generated summary.
	const resumedActive = session;
	if (resumedActive === undefined) {
		throw new Error("no open session");
	}
	await resumedActive.compact();
	assert.equal(await exercise(resumed, "compacted context", false), resumedId);
	assert.match(JSON.stringify(requests.at(-1)), /HANDOFF_SENTINEL/);
	assert.doesNotMatch(
		JSON.stringify(requests.at(-1)),
		/CONVERSATION_SENTINEL|HISTORY_REPLY|RESULT_SENTINEL|ARG_SENTINEL/,
	);
	await close();
	// Native resume can replace a missing project directory with another cwd.
	const cwdOverride = await open(sdk.SessionManager.open(file, temp, otherProject));
	actions.push("Dismiss");
	await cwdOverride.prompt("/side-question CWD_OVERRIDE_SOURCE");
	assert.equal(
		identities.at(-1),
		resumedId,
		"a cwd override at resume keeps the writer provider session",
	);
	await close();
	const forked = sdk.SessionManager.forkFrom(file, cwd, join(temp, "forks"));
	await open(forked);
	const forkedId = await exercise(forked, "forked compacted session", false);
	assert.notEqual(
		forkedId,
		resumedId,
		"a fork with identical history gets its own writer provider session",
	);
	await close();
	const fresh = sdk.SessionManager.inMemory(cwd);
	const freshActive = await open(fresh);
	const freshId = await exercise(fresh, "fresh session", false);
	assert.ok(
		![activeId, forkedId].includes(freshId),
		"a new session gets its own writer provider session",
	);
	assert.doesNotMatch(JSON.stringify(requests.at(-1)), /CONVERSATION_SENTINEL/);
	// Visible characters, not provider tokens or UTF-16 units. Never slice off
	// a constraint at the end of a long completion; retry once, then fail closed.
	const beforeLimits = structuredClone(fresh.getEntries());
	const overflow = "x".repeat(1800) + " Do not deploy.";
	expectedDraft = "🧪".repeat(1800);
	replies.push(expectedDraft);
	actions.push("Deny");
	await freshActive.prompt("/ambitious BOUNDARY_SOURCE");
	expectedDraft = "WRITER_REPLY";
	for (const tweak of [false, true]) {
		const start = requests.length;
		if (tweak) {
			actions.push("Tweak");
		}
		replies.push(...(tweak ? ["WRITER_REPLY"] : []), overflow, "WRITER_REPLY");
		actions.push("Deny");
		await freshActive.prompt("/ambitious RETRY_SOURCE");
		assert.equal(
			requests.length - start,
			tweak ? 3 : 2,
			"one bounded shortening retry also applies to Tweak",
		);
		const retryRequest = requireRecord(requests.at(-1), "retry request");
		const retry = jsonList(
			responses ? retryRequest.input : retryRequest.messages,
			"retry messages",
		).at(-1);
		assert.equal(requireRecord(retry, "retry message").role, "user");
		assert.match(
			JSON.stringify(retry),
			/RETRY_SOURCE.*1800 Unicode characters.*Shorten/s,
			"retry must ask for shortening, not simply replay the same task",
		);
		if (tweak) {
			assert.match(
				JSON.stringify(retry),
				/<<<\\nOriginal request:.*Revision notes:\\nFOLLOWUP_SENTINEL\\n>>>/s,
				"shortening must retain the revision notes inside the current task",
			);
		}
	}
	for (const tweak of [false, true]) {
		const start = requests.length;
		if (tweak) {
			actions.push("Tweak", "Deny");
		}
		replies.push(...(tweak ? ["WRITER_REPLY"] : []), overflow, overflow);
		// Initial failure must not offer an invalid draft. Failed Tweak keeps
		// the last valid draft instead of replacing it with a truncated one.
		await freshActive.prompt("/ambitious REJECT_SOURCE");
		assert.equal(requests.length - start, tweak ? 3 : 2);
		const errorNotice = notices.findLast((notice) => notice.level === "error");
		if (errorNotice === undefined) {
			throw new Error("expected overflow rejection notice missing");
		}
		assert.match(errorNotice.text, /1800.*(?:characters|limit)/);
		assert.equal(actions.length, 0);
	}
	assert.deepEqual(fresh.getEntries(), beforeLimits);
	assert.equal(replies.length, 0);
	// These expected guard errors must not mask unrelated fixture errors.
	assert.equal(notices.filter((notice) => notice.level === "error").length, 2);
	notices.length = 0;
	console.log(
		`PASS ${api}: ambitious 1800-character boundary, bounded retry, overflow rejection and Tweak recovery`,
	);
	const configCases: Array<
		[Record<string, unknown> | undefined, string, string, string | undefined]
	> = [
		[undefined, "writer.invalid", "writer", "high"],
		[
			{ provider: "alternate-writer", model: "override", thinkingLevel: "low" },
			"alternate-writer.invalid",
			"override",
			"low",
		],
		[{ provider: "alternate-writer" }, "alternate-writer.invalid", "writer", "high"],
		[{ model: "override" }, "writer.invalid", "override", "high"],
		[{ thinkingLevel: "medium" }, "writer.invalid", "writer", "medium"],
		[{ thinkingLevel: "off" }, "writer.invalid", "writer", nativeOffEffort],
	];
	for (const [config, origin, id, effort] of configCases) {
		const configPath = join(agentDir, "write-prompt.json");
		if (config === undefined) {
			rmSync(configPath, { force: true });
		} else {
			writeFileSync(configPath, JSON.stringify(config));
		}
		actions.push("Deny");
		await freshActive.prompt("/draft CONFIGURATION_SENTINEL");
		assert.equal(requestOrigins.at(-1), origin);
		const configRequest = requireRecord(requests.at(-1), "config request");
		assert.equal(configRequest.model, id);
		assert.equal(effortOf(configRequest), effort);
		const configSessionModel = freshActive.model;
		if (configSessionModel === undefined) {
			throw new Error("fresh session lost its model");
		}
		assert.equal(configSessionModel.provider, "writer-boundary");
		assert.equal(configSessionModel.id, "writer");
		assert.equal(freshActive.thinkingLevel, "high");
	}
	rmSync(join(agentDir, "write-prompt.json"));
	console.log(
		`PASS ${api}: native thinking inheritance, full and partial overrides, off, unchanged session`,
	);
	// Real extension dispatch, native steering queues and async error handling.
	const until = async (predicate: () => boolean): Promise<void> => {
		const deadline = Date.now() + 5000;
		while (!predicate()) {
			assert.ok(
				Date.now() < deadline,
				`native delivery did not reach the expected state: ${JSON.stringify({ sendErrors, notices, inputs })}`,
			);
			await delay(10);
		}
	};
	const delivered = () =>
		fresh.getBranch().filter((entry) => {
			if (entry.type !== "message" || entry.message.role !== "user") {
				return false;
			}
			return ai.contentText(entry.message.content) === "WRITER_REPLY";
		}).length;
	actions.push("Accept");
	await freshActive.prompt("/draft IDLE_ORIGINAL");
	await until(() => delivered() === 1);
	await freshActive.waitForIdle();
	const idleInput = requireRecord(inputs.at(-1), "idle input event");
	assert.equal(idleInput.source, "extension");
	assert.equal(idleInput.streamingBehavior, undefined);
	assert.equal(editorText, "", "successful acceptance must not replace editor input");

	// A different flavor must not reopen the accepted /draft entry.
	for (const command of ["ambitious", "unreasonable"]) {
		const before = requests.length;
		await freshActive.prompt(`/${command}`);
		assert.equal(requests.length, before);
		const usageNotice = notices.at(-1);
		if (usageNotice === undefined) {
			throw new Error(`missing usage notice for /${command}`);
		}
		assert.equal(usageNotice.text, `Usage: /${command} <text>`);
	}

	let activeRun: Promise<unknown> | undefined;
	const hold: HeldRequest = { started: gate(), release: gate() };
	actions.push(async () => {
		holdNextRequest = hold;
		activeRun = freshActive.prompt("BUSY_SENTINEL");
		await hold.started.promise;
		assert.equal(freshActive.extensionRunner.createContext().isIdle(), false);
		return "Accept";
	});
	try {
		await freshActive.prompt("/unreasonable BUSY_ORIGINAL");
		await until(() => freshActive.getSteeringMessages().includes("WRITER_REPLY"));
		const steerInput = requireRecord(inputs.at(-1), "steer input event");
		assert.equal(steerInput.source, "extension");
		assert.equal(steerInput.streamingBehavior, "steer");
		assert.equal(delivered(), 1, "busy acceptance queues instead of starting a concurrent turn");
	} finally {
		hold.release.open();
		if (activeRun !== undefined) {
			await activeRun;
		}
	}
	await freshActive.waitForIdle();
	assert.equal(delivered(), 2, "queued draft is delivered once");

	// Remove the main model only after writing finishes: sendUserMessage's
	// rejected promise is handled by Pi, never returned to the extension.
	const original = "FAILED_ORIGINAL\nsecond line";
	editorText = "unrelated editor input";
	actions.push(() => {
		// Deliberately corrupt the agent state to force the async failure path.
		(freshActive.agent.state as { model?: unknown }).model = undefined;
		return "Accept";
	});
	await freshActive.prompt(`/unreasonable ${original}`);
	await until(() => sendErrors.length === 1);
	const sendErrorText = requireRecord(sendErrors[0], "send error").error;
	if (typeof sendErrorText !== "string") {
		throw new Error("send error message missing");
	}
	assert.match(sendErrorText, /[Nn]o model/);
	assert.equal(delivered(), 2);
	assert.equal(editorText, "unrelated editor input", "failure preserves existing editor input");
	const backup = fresh
		.getBranch()
		.findLast((entry) => entry.type === "custom" && entry.customType === "fitch-kit.unreasonable");
	if (backup === undefined || backup.type !== "custom") {
		throw new Error("unreasonable backup entry missing");
	}
	assert.deepEqual(backup.data, { source: original, draft: "WRITER_REPLY" });
	assert.doesNotMatch(
		JSON.stringify(fresh.buildSessionContext().messages),
		/FAILED_ORIGINAL/,
		"backup stays out of model context",
	);

	// Save/reopen through Pi's native journal to prove recovery is not a mock
	// or a command closure that vanishes after restart.
	const recoveryFile = join(temp, "recovery.jsonl");
	writeFileSync(
		recoveryFile,
		[fresh.getHeader(), ...fresh.getBranch()].map((entry) => JSON.stringify(entry)).join("\n") +
			"\n",
	);
	await close();
	const recovered = sdk.SessionManager.open(recoveryFile, temp);
	const recoveredActive = await open(recovered);
	const beforeRecovery = requests.length;
	actions.push("Restore original");
	await recoveredActive.prompt("/unreasonable");
	assert.equal(editorText, `/unreasonable ${original}`);
	assert.equal(requests.length, beforeRecovery, "recovery does not spend another writer call");
	actions.push("Accept");
	await recoveredActive.prompt("/unreasonable");
	await until(
		() =>
			recovered.getBranch().filter((entry) => {
				if (entry.type !== "message" || entry.message.role !== "user") {
					return false;
				}
				return ai.contentText(entry.message.content) === "WRITER_REPLY";
			}).length === 3,
	);
	await recoveredActive.waitForIdle();
	assert.equal(
		requests.length,
		beforeRecovery + 1,
		"retry sends the retained draft without rewriting it",
	);
	assert.equal(sendErrors.length, 1, "retry succeeds");
	// /ambitious delivers through the same native path, saves under its own
	// entry type, and recovers through its own command without a rewrite.
	actions.push("Accept");
	await recoveredActive.prompt("/ambitious AMBITIOUS_ORIGINAL");
	await until(
		() =>
			recovered.getBranch().filter((entry) => {
				if (entry.type !== "message" || entry.message.role !== "user") {
					return false;
				}
				return ai.contentText(entry.message.content) === "WRITER_REPLY";
			}).length === 4,
	);
	await recoveredActive.waitForIdle();
	const ambitiousBackup = recovered
		.getBranch()
		.findLast((entry) => entry.type === "custom" && entry.customType === "fitch-kit.ambitious");
	if (ambitiousBackup === undefined || ambitiousBackup.type !== "custom") {
		throw new Error("ambitious backup entry missing");
	}
	assert.deepEqual(ambitiousBackup.data, { source: "AMBITIOUS_ORIGINAL", draft: "WRITER_REPLY" });
	const ambitiousRecoveryFile = join(temp, "ambitious-recovery.jsonl");
	writeFileSync(
		ambitiousRecoveryFile,
		[recovered.getHeader(), ...recovered.getBranch()]
			.map((entry) => JSON.stringify(entry))
			.join("\n") + "\n",
	);
	await close();
	const ambitiousRecovered = sdk.SessionManager.open(ambitiousRecoveryFile, temp);
	const ambitiousActive = await open(ambitiousRecovered);
	const beforeAmbitiousRecovery = requests.length;
	// All namespaces coexist, including a later acceptance by another flavor.
	// Native journal reopening must restore each command's exact original.
	const recoveryCases: Array<[string, string]> = [
		["draft", "IDLE_ORIGINAL"],
		["unreasonable", original],
		["ambitious", "AMBITIOUS_ORIGINAL"],
	];
	for (const [command, source] of recoveryCases) {
		actions.push("Restore original");
		await ambitiousActive.prompt(`/${command}`);
		assert.equal(editorText, `/${command} ${source}`);
		assert.equal(
			requests.length,
			beforeAmbitiousRecovery,
			"per-command recovery does not spend another writer call",
		);
	}
	assert.doesNotMatch(
		JSON.stringify(ambitiousRecovered.buildSessionContext().messages),
		/fitch-kit\.(?:draft|ambitious|unreasonable)|FAILED_ORIGINAL|AMBITIOUS_ORIGINAL/,
		"saved sources never enter model context",
	);
	console.log(
		`PASS ${api}: draft/ambitious/unreasonable saved-entry isolation and resumed recovery`,
	);
	console.log(
		`PASS ${api}: native idle send, busy steering, async failure preservation and resumed retry`,
	);
	// One custom ID can name unrelated sessions: one per project (--session-id),
	// and a new one for each in-memory run (--no-session --session-id).
	const sameId: Array<{ writer: unknown; main: unknown }> = [];
	for (const project of [cwd, otherProject, cwd]) {
		await close();
		const sameIdActive = await open(sdk.SessionManager.inMemory(project, { id: "release-review" }));
		actions.push("Dismiss");
		await sameIdActive.prompt("/side-question SAME_ID_SOURCE");
		const writer = identities.at(-1);
		await sameIdActive.prompt("MAIN_SENTINEL");
		sameId.push({ writer, main: identities.at(-1) });
	}
	assert.equal(
		new Set(sameId.map(({ writer }) => writer)).size,
		sameId.length,
		"sessions sharing a custom ID keep separate writer provider sessions",
	);
	for (const { writer, main } of sameId) {
		assert.ok(main !== undefined, "the main agent sends its provider session");
		assert.notEqual(writer, main, "the writer never joins the main agent's provider session");
	}
	console.log(
		`PASS ${api}: one writer provider session per session across resume, cwd override and compaction, separate from forks, new or same-ID sessions, and the main agent`,
	);
	assert.equal(
		notices.some((notice) => notice.level === "error"),
		false,
		JSON.stringify(notices),
	);
	assert.ok(lifecycle.includes("startup"));
	console.log(
		JSON.stringify({
			host,
			api,
			version: requireRecord(
				JSON.parse(readFileSync(join(host, "package.json"), "utf8")),
				"host package.json",
			).version,
			aiVersion: requireRecord(
				JSON.parse(readFileSync(join(aiRoot, "package.json"), "utf8")),
				"pi-ai package.json",
			).version,
			sdkPath,
			aiPath,
			extension: ((): string => {
				const extension = loader.getExtensions().extensions.at(0);
				if (extension === undefined) {
					throw new Error("writer extension missing");
				}
				return extension.path;
			})(),
			requests: requests.length,
			lifecycle,
		}),
	);
} finally {
	if (session !== undefined) {
		const current = session;
		await current.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		current.dispose();
	}
	globalThis.fetch = originalFetch;
	globalThis.WebSocket = originalWebSocket;
	rmSync(temp, { recursive: true, force: true });
}
