#!/usr/bin/env node
// Optional host root: exercise native SDK lifecycle and HTTP serialization, without network or model charges.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
	AgentSession,
	createAgentSession as CreateAgentSessionFn,
	DefaultResourceLoader,
	ExtensionUIDialogOptions,
	ExtensionUIContext,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { gate, jsonList, requireRecord } from "./test-harness.ts";

/** The host-selected Pi SDK surface this boundary regression drives. */
type HostSdk = {
	DefaultResourceLoader: typeof DefaultResourceLoader;
	ModelRuntime: typeof ModelRuntime;
	ModelRegistry: typeof ModelRegistry;
	SessionManager: typeof SessionManager;
	SettingsManager: typeof SettingsManager;
	createAgentSession: typeof CreateAgentSessionFn;
};
const isHostSdk = (module: unknown): module is HostSdk =>
	typeof module === "object" &&
	module !== null &&
	"DefaultResourceLoader" in module &&
	"ModelRuntime" in module &&
	"ModelRegistry" in module &&
	"SessionManager" in module &&
	"SettingsManager" in module &&
	"createAgentSession" in module;

/** The host-selected pi-ai surface the offline credential store needs. */
type HostAi = { InMemoryCredentialStore: typeof InMemoryCredentialStore };
const isHostAi = (module: unknown): module is HostAi =>
	typeof module === "object" &&
	module !== null &&
	"InMemoryCredentialStore" in module &&
	typeof module.InMemoryCredentialStore === "function";

const root = fileURLToPath(new URL("..", import.meta.url));
const host =
	process.argv[2] !== undefined
		? resolve(process.argv[2])
		: dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const hostRequire = createRequire(join(host, "package.json"));
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
const temp = mkdtempSync(join(tmpdir(), "pi-name-boundary-"));
const cwd = join(temp, "project");
mkdirSync(cwd);
process.env.PI_CODING_AGENT_DIR = temp;
process.env.PI_PACKAGE_DIR = host;
process.env.PI_OFFLINE = "1";
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
// The fixture disables WebSocket so no transport can leave offline mode.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberate offline-fixture disable
globalThis.WebSocket = undefined as unknown as typeof WebSocket;
const requests: Array<Record<string, unknown>> = [];
let requestedName: string | undefined;
let boundaryInput: Record<string, unknown> | undefined;
let renameAfterBoundary: string | undefined;
let batchCalls: Array<[string, Record<string, unknown>]> | undefined;
let retainNoneNextTurn = false;
let overflowNextRequest = false;
globalThis.fetch = async (
	url: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
): Promise<Response> => {
	if (typeof url !== "string") {
		throw new Error("fixture expected a string request URL");
	}
	assert.equal(url, "https://naming.invalid/v1/responses", "no network may leave the fixture");
	if (init === undefined || typeof init.body !== "string") {
		throw new Error("fixture capture lost its request body");
	}
	requests.push(requireRecord(JSON.parse(init.body), "captured request"));
	if (overflowNextRequest) {
		overflowNextRequest = false;
		return new Response(
			JSON.stringify({
				error: {
					message: "maximum context length exceeded",
					code: "context_length_exceeded",
					type: "invalid_request_error",
				},
			}),
			{ status: 400, headers: { "content-type": "application/json" } },
		);
	}
	const items: Array<Record<string, unknown>> = batchCalls?.map(([name, args], index) => ({
		type: "function_call",
		id: `fc_${requests.length}_${index}`,
		call_id: `call_${requests.length}_${index}`,
		name,
		arguments: JSON.stringify(args),
		status: "completed",
	})) ?? [
		requestedName !== undefined || boundaryInput !== undefined
			? {
					type: "function_call",
					id: `fc_${requests.length}`,
					call_id: `call_${requests.length}`,
					name: boundaryInput !== undefined ? "boundary_case" : "name_session",
					arguments: JSON.stringify(boundaryInput ?? { name: requestedName }),
					status: "completed",
				}
			: {
					id: `msg_${requests.length}`,
					type: "message",
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: "DONE", annotations: [] }],
				},
	];
	batchCalls = undefined;
	requestedName = boundaryInput !== undefined ? renameAfterBoundary : undefined;
	renameAfterBoundary = undefined;
	boundaryInput = undefined;
	const events = [
		...items.flatMap((item, index) => [
			{
				type: "response.output_item.added",
				output_index: index,
				item: { ...item, ...(item.type === "message" ? { content: [] } : { arguments: "" }) },
			},
			{ type: "response.output_item.done", output_index: index, item },
		]),
		{
			type: "response.completed",
			response: {
				id: `resp_${requests.length}`,
				status: "completed",
				output: items,
				usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
			},
		},
	];
	return new Response(
		events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
};
let session: AgentSession | undefined;
try {
	const sdkModule: unknown = await import(pathToFileURL(join(host, "dist/index.js")).href);
	if (!isHostSdk(sdkModule)) {
		throw new Error("host Pi SDK did not expose the expected session surface");
	}
	const aiModule: unknown = await import(pathToFileURL(join(aiRoot, "dist/index.js")).href);
	if (!isHostAi(aiModule)) {
		throw new Error("host pi-ai did not expose the credential store");
	}
	const sdk = sdkModule;
	const ai = aiModule;
	const runtime = await sdk.ModelRuntime.create({
		credentials: new ai.InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const registry = new sdk.ModelRegistry(runtime);
	registry.registerProvider("naming-boundary", {
		api: "openai-responses",
		baseUrl: "https://naming.invalid/v1",
		apiKey: "offline",
		models: [
			{
				id: "naming",
				name: "naming",
				reasoning: false,
				input: ["text"],
				contextWindow: 100000,
				maxTokens: 1000,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				compat: { supportsMidConvoSystemMessages: true },
			},
		],
	});
	const settingsManager = sdk.SettingsManager.inMemory({
		compaction: { enabled: false, keepRecentTokens: 1 },
		retry: { enabled: false },
	});
	const namingPath = process.env.PI_NAMING_EXTENSION ?? join(root, "extensions/session-name.ts");
	const makeLoader = (paths: string[]) =>
		new sdk.DefaultResourceLoader({
			cwd,
			agentDir: temp,
			settingsManager,
			additionalExtensionPaths: paths,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			extensionFactories: [
				(pi) => {
					pi.on("turn_end", (event) => {
						if (!retainNoneNextTurn) {
							return;
						}
						retainNoneNextTurn = false;
						return {
							entries: [
								...event.entries,
								{ type: "compaction", summary: "", firstKeptEntryId: null },
							],
						};
					});
					// Replace only the summarizer, not compaction dispatch, persistence or projection.
					pi.on("session_before_compact", (event) => ({
						compaction: {
							summary: "OFFLINE_SUMMARY",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: 10,
						},
					}));
				},
			],
		});
	const open = async (
		manager: SessionManager,
		paths: string[] = [namingPath],
		uiContext?: Pick<ExtensionUIContext, "confirm">,
	): Promise<AgentSession> => {
		const loader = makeLoader(paths);
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.ok(
			loader.getExtensions().extensions.some((e) => e.path.endsWith("session-name.ts")),
			JSON.stringify(loader.getExtensions().extensions.map((e) => e.path)),
		);
		assert.deepEqual(
			loader
				.getExtensions()
				.extensions.filter((e) => paths.includes(e.path))
				.map((e) => e.path),
			paths,
			"resource paths must exercise the requested extension order",
		);
		const namingModel = registry.find("naming-boundary", "naming");
		if (namingModel === undefined) {
			throw new Error("naming-boundary model missing");
		}
		const created = (
			await sdk.createAgentSession({
				cwd,
				agentDir: temp,
				model: namingModel,
				modelRuntime: runtime,
				resourceLoader: loader,
				settingsManager,
				sessionManager: manager,
				// "builtin" matches the original truthy flag: no default tools, no allowlist.
				noTools: "builtin",
			})
		).session;
		session = created;
		await created.bindExtensions({
			...(uiContext !== undefined
				? {
						uiContext: {
							...created.extensionRunner.createContext().ui,
							confirm: uiContext.confirm,
						},
					}
				: {}),
			onError: (error) => {
				throw new Error(error.error);
			},
		});
		return created;
	};
	const close = (): void => {
		if (session !== undefined) {
			session.dispose();
		}
		session = undefined;
	};
	const metadata = () => {
		if (session === undefined) {
			throw new Error("no open session");
		}
		return session.sessionManager
			.buildSessionProjection()
			.messages.filter((m) => m.role === "custom" && m.customType === "pi-session-name");
	};
	const latestName = (
		body: Record<string, unknown> | undefined = requests.at(-1),
	): string | null => {
		if (body === undefined) {
			throw new Error("no captured request to inspect");
		}
		const matches = [...JSON.stringify(body.input).matchAll(/currentName\\":(null|\\"(.*?)\\")/g)];
		assert.ok(
			matches.length > 0,
			`request must report the current name: ${JSON.stringify(body.input)}`,
		);
		const last = matches.at(-1);
		if (last === undefined || last[1] === undefined) {
			throw new Error("current name capture was malformed");
		}
		return last[1] === "null" ? null : (last[2] ?? null);
	};
	const extendsPrefix = (
		previous: Record<string, unknown> | undefined,
		next: Record<string, unknown> | undefined = requests.at(-1),
	): void => {
		if (previous === undefined || next === undefined) {
			throw new Error("no captured request to inspect");
		}
		assert.equal(next.instructions, previous.instructions);
		assert.deepEqual(
			jsonList(next.input, "request input").slice(
				0,
				jsonList(previous.input, "request input").length,
			),
			jsonList(previous.input, "request input"),
			"introducing or changing naming metadata must preserve every prior serialized input item",
		);
	};
	const prompt = async (text: string): Promise<void> => {
		if (session === undefined) {
			throw new Error("no open session");
		}
		await session.prompt(text);
		await session.waitForIdle();
	};
	const active = await open(sdk.SessionManager.inMemory(cwd));
	// A long conversation need not be reproduced: every old serialized item must survive.
	active.setActiveToolsByName([]);
	await prompt("before naming enabled");
	const beforeEnable = requests.at(-1);
	active.setActiveToolsByName(["name_session"]);
	assert.ok(
		active.getActiveToolNames().includes("name_session"),
		JSON.stringify(active.getAllTools()),
	);
	await prompt("naming enabled");
	extendsPrefix(beforeEnable);
	assert.equal(latestName(), null);
	assert.equal(metadata().length, 1);
	const unnamed = requests.at(-1);
	requestedName = "cache-stable-session";
	await prompt("name this session");
	assert.equal(active.sessionManager.getSessionName(), "cache-stable-session");
	extendsPrefix(unnamed);
	assert.equal(
		latestName(),
		"cache-stable-session",
		"tool-loop follow-up sees the actual new name",
	);
	assert.equal(metadata().length, 2);
	const named = requests.at(-1);
	await prompt("ordinary followup");
	extendsPrefix(named);
	assert.equal(metadata().length, 2, "unchanged names do not grow metadata");
	const branchTarget = active.sessionManager.getLeafId();
	if (branchTarget === null) {
		throw new Error("session branch target missing");
	}
	active.setSessionName("manual-name"); // Same native operation as /name.
	await prompt("after manual rename");
	extendsPrefix(named);
	assert.equal(latestName(), "manual-name");
	assert.equal(metadata().length, 3);
	await active.reload();
	await prompt("after reload");
	assert.equal(metadata().length, 3, "reload reconstructs from native history");
	await active.navigateTree(branchTarget, { summarize: false });
	await prompt("after tree navigation");
	assert.equal(latestName(), "manual-name", "global display name wins over old branch metadata");
	assert.equal(metadata().length, 3);
	const lastMetadata = active.sessionManager
		.getBranch()
		.findLast((e) => e.type === "custom_message" && e.customType === "pi-session-name");
	if (lastMetadata === undefined) {
		throw new Error("naming metadata entry missing");
	}
	active.sessionManager.appendContextEdit(lastMetadata.id, null);
	active.refreshContext();
	await prompt("after context omission");
	assert.equal(latestName(), "manual-name");
	await active.compact();
	await prompt("after native compaction");
	assert.equal(latestName(), "manual-name");
	assert.equal(metadata().length, 1, "compacted-away metadata is restored exactly once");
	await prompt("create a compactable next turn");
	active.setAutoCompactionEnabled(true);
	overflowNextRequest = true;
	const beforeOverflow = requests.length;
	await prompt("overflow and retry");
	active.setAutoCompactionEnabled(false);
	assert.equal(requests.length, beforeOverflow + 2, "native overflow recovery retries once");
	assert.equal(
		latestName(),
		"manual-name",
		"first overflow retry sees restored metadata without before_agent_start",
	);
	assert.equal(metadata().length, 1);
	const file = join(temp, "saved.jsonl");
	writeFileSync(
		file,
		[active.sessionManager.getHeader(), ...active.sessionManager.getEntries()]
			.map((e) => JSON.stringify(e))
			.join("\n") + "\n",
	);
	close();
	await open(sdk.SessionManager.open(file, temp));
	await prompt("after reopen");
	assert.equal(latestName(), "manual-name");
	assert.equal(metadata().length, 1);
	close();
	const active3 = await open(sdk.SessionManager.forkFrom(file, cwd, temp));
	await prompt("after native file fork");
	assert.equal(latestName(), active3.sessionManager.getSessionName() ?? null);
	retainNoneNextTurn = true;
	await prompt("RETAIN_NONE_DISCARDED_TURN");
	const retained = active3.sessionManager.getBranch().at(-1);
	if (retained === undefined || retained.type !== "compaction") {
		throw new Error("retain-none compaction entry missing");
	}
	assert.equal(
		retained.firstKeptEntryId,
		retained.id,
		"native retain-none compaction keeps no preceding entries",
	);
	assert.equal(retained.summary, "");
	assert.equal(metadata().length, 0, "the boundary really discards old name metadata");
	const beforeRetainNoneRequest = requests.length;
	await prompt("after summary-free retain-none compaction");
	assert.equal(
		requests.length,
		beforeRetainNoneRequest + 1,
		"first request needs no extra naming round",
	);
	assert.equal(latestName(), active3.sessionManager.getSessionName() ?? null);
	assert.equal(metadata().length, 1, "first request restores truthful name metadata exactly once");
	assert.doesNotMatch(
		JSON.stringify(requests.at(-1)),
		/RETAIN_NONE_DISCARDED_TURN|OFFLINE_SUMMARY|before naming enabled/,
	);
	const fresh = requests.at(-1);
	await prompt("retain-none followup");
	extendsPrefix(fresh);
	assert.equal(metadata().length, 1, "unchanged name keeps the restored prefix stable");
	console.log(
		"PASS native summary-free retain-none compaction: first request metadata and stable followup prefix",
	);
	close();
	await open(sdk.SessionManager.inMemory(cwd));
	await prompt("fresh unnamed");
	assert.equal(latestName(), null);
	assert.equal(metadata().length, 1);
	assert.ok(requests.length < 30, "metadata must not trigger extra model loops");
	console.log(
		"PASS serialized prefix: late enable, naming tool loop, unchanged and /name; native reload/tree/edit/compact/overflow-retry/reopen/fork/fresh",
	);
	close();
	const producer = join(temp, "boundary-producer.ts");
	writeFileSync(
		producer,
		`export default function (pi) {
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
	}`,
	);
	/** The committed compaction entry, failing loudly with the case label when absent. */
	const requireCompaction = (
		entries: ReturnType<SessionManager["getBranch"]>,
		label: string,
	): { firstKeptEntryId: string | null; id: string; summary: string } => {
		const entry = entries.find((candidate) => candidate.type === "compaction");
		if (entry === undefined) {
			throw new Error(`${label}: compaction entry missing`);
		}
		return entry;
	};

	for (const order of ["producer-first", "kit-first"] as const) {
		if (process.env.PI_NAMING_ORDER !== undefined && process.env.PI_NAMING_ORDER !== order) {
			continue;
		}
		const paths = order === "producer-first" ? [producer, namingPath] : [namingPath, producer];
		const boundaryModes: Array<[string, boolean, string]> = [
			["drafts", false, ""],
			["empty", true, ""],
			["handoff", true, "POSTHORSE_HANDOFF"],
			["in-run-rename", true, "POSTHORSE_HANDOFF"],
		];
		for (const [mode, rollover, summary] of boundaryModes) {
			if (process.env.PI_NAMING_CASE !== undefined && process.env.PI_NAMING_CASE !== mode) {
				continue;
			}
			const active5 = await open(sdk.SessionManager.create(cwd, temp), paths);
			active5.setActiveToolsByName(["name_session", "boundary_case"]);
			active5.setSessionName(`${order}-${mode}-initial`);
			await prompt("OLD_BOUNDARY_HISTORY");
			await active5.sendCustomMessage({
				customType: "boundary-edit-target",
				content: "EDIT_TARGET",
				display: false,
			});
			const start = requests.length;
			const name = `${order}-${mode}-updated`;
			const finalName = mode === "in-run-rename" ? `${name}-tool-renamed` : name;
			boundaryInput = { name, rollover, summary };
			renameAfterBoundary = mode === "in-run-rename" ? finalName : undefined;
			await prompt("execute boundary fixture");
			assert.equal(
				requests.length,
				start + (mode === "in-run-rename" ? 3 : 2),
				`${order}/${mode}: only requested tool calls and their followup`,
			);
			const branch = active5.sessionManager.getBranch();
			const compactions = branch.filter((e) => e.type === "compaction");
			assert.equal(
				compactions.length,
				rollover ? 1 : 0,
				`${order}/${mode}: actual compaction must commit`,
			);
			assert.equal(
				branch.filter((e) => e.type === "custom" && e.customType === "boundary-receipt").length,
				1,
				`${order}/${mode}: preserve producer receipt`,
			);
			assert.equal(
				branch.filter((e) => e.type === "context_edit").length,
				1,
				`${order}/${mode}: preserve producer context edit`,
			);
			assert.equal(
				branch.filter((e) => e.type === "custom_message" && e.customType === "boundary-survivor")
					.length,
				1,
				`${order}/${mode}: preserve producer message`,
			);
			if (rollover) {
				const compaction = requireCompaction(branch, `${order}/${mode}`);
				assert.equal(compaction.firstKeptEntryId, compaction.id);
				assert.equal(compaction.summary, summary);
			}
			const continued = requests.at(start + 1);
			if (continued === undefined) {
				throw new Error(`${order}/${mode}: followup request missing`);
			}
			assert.equal(
				latestName(continued),
				name,
				`${order}/${mode}: first in-run request reports the current name`,
			);
			assert.match(JSON.stringify(continued.input), /BOUNDARY_SURVIVOR/);
			assert.doesNotMatch(JSON.stringify(continued.input), /EDIT_TARGET/);
			if (rollover) {
				assert.doesNotMatch(
					JSON.stringify(continued.input),
					/OLD_BOUNDARY_HISTORY|BOUNDARY_TOOL_RESULT|execute boundary fixture/,
				);
				assert.equal([...JSON.stringify(continued.input).matchAll(/currentName\\":/g)].length, 1);
				assert.equal(
					metadata().length,
					mode === "in-run-rename" ? 2 : 1,
					"only recovery and any explicit rename are persisted",
				);
			}
			assert.equal(latestName(), finalName);
			if (mode === "in-run-rename") {
				extendsPrefix(continued);
			}
			const beforeFollowup = requests.at(-1);
			await prompt("after in-run boundary");
			extendsPrefix(beforeFollowup);
			assert.equal(latestName(), finalName);
			const modeTarget = active5.sessionManager.getLeafId();
			if (modeTarget === null) {
				throw new Error("session branch target missing");
			}
			const beforeRename = requests.at(-1);
			active5.setSessionName(`${finalName}-renamed`);
			await prompt("after boundary rename");
			extendsPrefix(beforeRename);
			assert.equal(latestName(), `${finalName}-renamed`);
			const renamed = requests.at(-1);
			await active5.reload();
			await prompt("after boundary reload");
			extendsPrefix(renamed);
			await active5.navigateTree(modeTarget, { summarize: false });
			await prompt("after boundary branch");
			extendsPrefix(continued);
			assert.equal(latestName(), `${finalName}-renamed`);
			const saved = active5.sessionManager.getSessionFile();
			assert.ok(saved !== undefined && existsSync(saved), "native file persistence");
			const persisted = readFileSync(saved, "utf8")
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.map((line) => requireRecord(JSON.parse(line), "persisted entry"));
			assert.equal(persisted.filter((e) => e.type === "compaction").length, rollover ? 1 : 0);
			const beforeReopen = requests.at(-1);
			close();
			const active6 = await open(sdk.SessionManager.open(saved, temp), paths);
			active6.setActiveToolsByName(["name_session", "boundary_case"]);
			await prompt("after boundary reopen");
			extendsPrefix(beforeReopen);
			assert.equal(latestName(), `${finalName}-renamed`);
			const beforeLoadout = requests.at(-1);
			assert.ok(
				!active6.getActiveToolNames().includes("late_tool"),
				"fixture must deactivate the late tool before testing its activation",
			);
			active6.setActiveToolsByName(["name_session", "boundary_case", "late_tool"]);
			await prompt("after post-boundary tool activation");
			extendsPrefix(beforeLoadout);
			const loadoutRequest = requests.at(-1);
			const loadoutInput = jsonList(
				loadoutRequest === undefined ? [] : loadoutRequest.input,
				"request input",
			);
			const loadoutHead = loadoutInput.at(0);
			const beforeLoadoutInput = jsonList(
				beforeLoadout === undefined ? [] : beforeLoadout.input,
				"request input",
			);
			const beforeLoadoutHead = beforeLoadoutInput.at(0);
			assert.equal(
				requireRecord(loadoutHead, "input head").role,
				"system",
				"preserve the native system head at index zero",
			);
			assert.deepEqual(
				loadoutHead,
				beforeLoadoutHead,
				"tool updates must not rebuild the submitted system head",
			);
			assert.ok(
				loadoutInput
					.slice(beforeLoadoutInput.length)
					.some(
						(item) =>
							requireRecord(item, "input item").role === "system" &&
							JSON.stringify(item).includes("LATE_TOOL_PROMPT_UPDATE"),
					),
				"native tool update is appended mid-conversation",
			);
			const afterLoadout = requests.at(-1);
			await prompt("steady after tool activation");
			extendsPrefix(afterLoadout);
			console.log(
				`PASS ${order}/${mode}: producer drafts, first in-run wire, stable followup/rename/reload/branch/reopen and native persistence`,
			);
			console.log(
				`PASS ${order}/${mode}: mid-conversation tool update preserves full system/input prefix`,
			);
			close();
		}
	}
	const probe = join(temp, "sibling-probe.ts");
	writeFileSync(
		probe,
		`export default function (pi) {
		pi.registerTool({ name: "sibling_probe", label: "Sibling probe", description: "Offline sibling fixture",
			parameters: { type: "object", properties: {} },
			execute: async () => ({ content: [{ type: "text", text: "SIBLING_DONE" }], details: undefined })
		});
	}`,
	);
	for (const answer of ["accept", "deny", "cancel"] as const) {
		if (
			process.env.PI_NAMING_CASE !== undefined &&
			process.env.PI_NAMING_CASE !== `batch-${answer}`
		) {
			continue;
		}
		const dialogs: Array<{ message: string; siblingDone: boolean; name: string | undefined }> = [];
		const siblingEnded = gate();
		const ui: Pick<ExtensionUIContext, "confirm"> = {
			async confirm(_title: string, message: string, opts?: ExtensionUIDialogOptions) {
				const signal = opts?.signal;
				if (signal === undefined) {
					throw new Error("confirm dialog lost its abort signal");
				}
				const current = session;
				if (current === undefined) {
					throw new Error("no open session");
				}
				const timeout = new AbortController();
				const siblingDone = await Promise.race([
					siblingEnded.promise.then(() => true),
					delay(1000, false, { signal: timeout.signal }),
				]);
				timeout.abort();
				dialogs.push({ message, siblingDone, name: current.sessionManager.getSessionName() });
				if (answer !== "cancel") {
					return answer === "accept";
				}
				// Native dialogs close unanswered when their signal aborts.
				const closed = new Promise<boolean>((settle) => {
					signal.addEventListener("abort", () => settle(false), { once: true });
				});
				// oxlint-disable-next-line typescript/no-floating-promises -- awaiting abort would deadlock the dialog it is meant to close
				current.abort();
				return closed;
			},
		};
		const active7 = await open(sdk.SessionManager.inMemory(cwd), [namingPath, probe], ui);
		active7.subscribe((event) => {
			if (event.type === "tool_execution_end" && event.toolName === "sibling_probe") {
				siblingEnded.open();
			}
		});
		active7.setActiveToolsByName(["name_session", "sibling_probe"]);
		active7.setSessionName("release-coordinator");
		batchCalls = [
			["name_session", { name: "release-planning" }],
			["sibling_probe", {}],
			["name_session", { name: "planning-coordinator" }],
		];
		await prompt("rename while a sibling runs");
		assert.deepEqual(
			dialogs,
			[
				{
					message: 'Use the new name "release-planning"?',
					siblingDone: true,
					name: "release-coordinator",
				},
			],
			`${answer}: the sibling finishes during the one protected confirmation, and the queued rename waits`,
		);
		const results = active7.messages
			.filter((m) => m.role === "toolResult")
			.map((m) => [m.toolName, m.isError, m.details]);
		const laterCases: Record<"accept" | "deny" | "cancel", [boolean, Record<string, unknown>]> = {
			accept: [false, { name: "planning-coordinator", previousName: "release-planning" }],
			deny: [false, { name: "planning-coordinator", previousName: "release-coordinator" }],
			cancel: [true, {}],
		};
		const later = laterCases[answer];
		assert.deepEqual(
			results,
			[
				[
					"name_session",
					answer !== "accept",
					answer === "accept"
						? { name: "release-planning", previousName: "release-coordinator" }
						: {},
				],
				["sibling_probe", false, undefined],
				["name_session", ...later],
			],
			`${answer}: the later call reads the name its predecessor left, and a cancelled batch renames nothing`,
		);
		assert.equal(
			active7.sessionManager.getSessionName(),
			answer === "cancel" ? "release-coordinator" : "planning-coordinator",
		);
		console.log(`PASS batch-${answer}: parallel sibling, serialized naming in call order`);
		close();
	}
	console.log(
		JSON.stringify({
			host,
			version: requireRecord(
				JSON.parse(readFileSync(join(host, "package.json"), "utf-8")),
				"host package.json",
			).version,
			aiRoot,
			requests: requests.length,
			network: "fixture only",
		}),
	);
} finally {
	if (session !== undefined) {
		session.dispose();
	}
	globalThis.fetch = originalFetch;
	globalThis.WebSocket = originalWebSocket;
	rmSync(temp, { recursive: true, force: true });
}
