import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp, truncate, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	createCodemodeExtension,
	DefaultResourceLoader,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { injectVideo } from "../extensions/watch-video-payload.ts";
import { resolveVideoRoute } from "../extensions/watch-video-routes.ts";
import { jsonList, requireRecord } from "./test-harness.ts";

const cwd = await mkdtemp(join(tmpdir(), "pi-watch-video-"));
process.once("exit", () => rmSync(cwd, { recursive: true, force: true }));
const extension = fileURLToPath(new URL("../extensions/watch-video.ts", import.meta.url));
const filename = "clip.MP4";
// An ISO BMFF file-type box is sufficient to exercise the file-signature check and byte-preserving transport.
const clip = Buffer.from("000000186674797069736f6d0000020069736f6d6d703431", "hex");
const data = clip.toString("base64");
const answer = "Video analysis text.";
await writeFile(join(cwd, filename), clip);

const runtime = await ModelRuntime.create({
	credentials: new InMemoryCredentialStore(),
	modelsPath: null,
	allowModelNetwork: false,
	refreshOnCreate: false,
});
const registry = new ModelRegistry(runtime);

function registerModel({
	provider,
	api,
	baseUrl,
	id,
}: Pick<Model<Api>, "provider" | "api" | "baseUrl" | "id">): Model<Api> {
	registry.registerProvider(provider, {
		api,
		baseUrl,
		apiKey: "offline-test-key",
		models: [
			{
				id,
				name: id,
				reasoning: false,
				input: ["text", "image"],
				contextWindow: 128_000,
				maxTokens: 4096,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
		],
	});
	const model = registry.find(provider, id);
	assert.ok(model, `missing configured ${provider}/${id}`);
	return model;
}

const router = "https://openrouter.ai/api/v1";
const completions = registerModel({
	provider: "video-chat-test",
	api: "openai-completions",
	baseUrl: router,
	id: "google/gemini-4-neon",
});
const stillImage = registerModel({
	provider: "video-hidden-test",
	api: "openai-completions",
	baseUrl: router,
	id: "openai/gpt-4o",
});
const responses = registerModel({
	provider: "video-responses-test",
	api: "openai-responses",
	baseUrl: router,
	id: "google/gemini-4-neon",
});
const google = registerModel({
	provider: "video-google-test",
	api: "google-generative-ai",
	baseUrl: "https://generativelanguage.googleapis.com/v1beta",
	id: "gemini-4-carbon",
});
const vertex = registerModel({
	provider: "video-vertex-test",
	api: "google-vertex",
	baseUrl: "https://aiplatform.googleapis.com",
	id: "gemini-2.5-flash",
});
const installedNeon = registry.find("google", "gemini-4-neon");
const neon =
	installedNeon?.api === "google-interactions"
		? registerModel({
				provider: "video-interactions-test",
				api: "google-interactions",
				baseUrl: google.baseUrl,
				id: "gemini-4-neon",
			})
		: undefined;
const minimax = registerModel({
	provider: "video-minimax-test",
	api: "anthropic-messages",
	baseUrl: "https://api.minimax.io/anthropic",
	id: "MiniMax-M3",
});

async function createSession(
	model: Model<Api>,
): Promise<{ session: AgentSession; journal: SessionManager }> {
	const settingsManager = SettingsManager.inMemory();
	const journal = SessionManager.inMemory(cwd);
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: cwd,
		settingsManager,
		noExtensions: true,
		noPromptTemplates: true,
		noSkills: true,
		noContextFiles: true,
		additionalExtensionPaths: [extension],
		extensionFactories: [createCodemodeExtension({ models: false })],
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({
		cwd,
		agentDir: cwd,
		model,
		modelRuntime: runtime,
		resourceLoader: loader,
		settingsManager,
		sessionManager: journal,
	});
	await session.bindExtensions({ mode: "rpc", onError: (error) => assert.fail(error.error) });
	return { session, journal };
}

function toolOf(session: AgentSession) {
	const tool = session.extensionRunner.getToolDefinition("watch_video");
	assert.ok(tool);
	return tool;
}

function executeVideo(session: AgentSession, path = filename, question?: string) {
	const signal = AbortSignal.timeout(5000);
	const context = session.extensionRunner.createToolContext("verify", signal);
	return toolOf(session).execute("verify", { path, question }, signal, undefined, context);
}

type Wire = { url: URL; body: Record<string, unknown> };

function captureFetch(reply: (request: Wire) => Response): typeof fetch {
	return async (input, init) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		assert.equal(request.method, "POST");
		const bytes = await request.arrayBuffer();
		const body =
			request.headers.get("content-encoding") === "zstd"
				? zstdDecompressSync(bytes)
				: Buffer.from(bytes);
		return reply({ url, body: requireRecord(JSON.parse(body.toString()), "native JSON request") });
	};
}

function sse(events: unknown[]): Response {
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
		headers: { "content-type": "text/event-stream" },
	});
}

function completion(delta: Record<string, unknown>, finishReason = "stop"): Response {
	return sse([
		{
			id: "chat-1",
			object: "chat.completion.chunk",
			created: 1,
			model: completions.id,
			choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: finishReason }],
		},
	]);
}

function callTool(name: string, input: Record<string, unknown>): Response {
	return completion(
		{
			tool_calls: [
				{
					index: 0,
					id: `call_${name}`,
					type: "function",
					function: { name, arguments: JSON.stringify(input) },
				},
			],
		},
		"tool_calls",
	);
}

function userParts(body: Record<string, unknown>, turns: string, field: string): unknown[] {
	const turn = requireRecord(jsonList(body[turns], turns).at(-1), "user turn");
	assert.equal(
		turn.role ?? turn.type,
		turns === "input" && turn.type === "user_input" ? "user_input" : "user",
	);
	return jsonList(turn[field], "user content");
}

function expectExposure(session: AgentSession, expected: "hidden" | "direct"): void {
	const context = session.extensionRunner.createToolContext(
		"verify-exposure",
		AbortSignal.timeout(5000),
	);
	assert.equal(
		session.getAllTools().find(({ name }) => name === "watch_video")?.exposure,
		expected,
	);
	assert.equal(session.getActiveToolNames().includes("watch_video"), expected === "direct");
	assert.equal(
		context.tools.some(({ name }) => name === "watch_video"),
		expected === "direct",
	);
}

await test("native Pi hides the tool across model changes and before a run, including from real Codemode", async (t) => {
	const { session, journal } = await createSession(stillImage);
	t.after(() => session.dispose());
	session.setActiveToolsByName(["read", "codemode", "watch_video"]);
	expectExposure(session, "hidden");
	assert.deepEqual(session.getActiveToolNames(), ["read", "codemode"]);
	await session.setModel(completions);
	expectExposure(session, "direct");
	assert.deepEqual(session.getActiveToolNames(), ["read", "codemode", "watch_video"]);
	await session.setModel(stillImage);
	expectExposure(session, "hidden");
	assert.deepEqual(session.getActiveToolNames(), ["read", "codemode"]);
	await session.setModel(completions);

	// SDK model changes can bypass model_select. The next run must still withdraw the declaration.
	session.agent.state.model = stillImage;
	await assert.rejects(executeVideo(session), /does not support native video/u);
	const requests: Wire[] = [];
	t.mock.method(
		globalThis,
		"fetch",
		captureFetch((request) => {
			requests.push(request);
			if (requests.length === 1) {
				return callTool("codemode", {
					code: 'text(ALL_TOOLS.includes("watch_video")); try { await tools.watch_video({path:"clip.MP4"}); } catch (error) { text(String(error)); }',
				});
			}
			return completion({ content: "Done" });
		}),
	);
	await session.prompt("Try to use the unavailable tool via Codemode.");
	expectExposure(session, "hidden");
	assert.equal(requests.length, 2);
	const declared = JSON.stringify(requests[0]?.body.tools);
	assert.match(declared, /"name":"codemode"/u);
	assert.doesNotMatch(declared, /watch_video/u);
	const result = journal
		.getEntries()
		.find((entry) => entry.type === "message" && entry.message.role === "toolResult");
	const transcript = JSON.stringify(result);
	assert.match(transcript, /false/u);
	assert.match(transcript, /tools\.watch_video does not exist/u);
	assert.deepEqual(session.getActiveToolNames(), ["read", "codemode"]);
	session.agent.state.model = completions;
	await session.prompt("Use the video-capable model.");
	expectExposure(session, "direct");
	assert.match(JSON.stringify(requests[2]?.body.tools), /"name":"watch_video"/u);
});

await test("a native Chat Completions tool call sends one off-transcript video and journals only text", async (t) => {
	const { session, journal } = await createSession(completions);
	t.after(() => session.dispose());
	expectExposure(session, "direct");
	const requests: Wire[] = [];
	t.mock.method(
		globalThis,
		"fetch",
		captureFetch((request) => {
			requests.push(request);
			if (requests.length === 1) {
				return callTool("watch_video", { path: filename });
			}
			return completion({ content: requests.length === 2 ? answer : "Done" });
		}),
	);
	await session.prompt("Watch the example clip.");
	assert.equal(requests.length, 3);
	const nested = requests[1]?.body;
	assert.ok(nested);
	assert.equal(nested.model, completions.id);
	assert.equal(nested.tools, undefined);
	assert.equal(nested.prompt_cache_key, undefined);
	const parts = userParts(nested, "messages", "content");
	assert.equal(parts.length, 2);
	assert.match(JSON.stringify(parts[0]), /timestamps.*visual scenes.*audio or speech/u);
	assert.deepEqual(parts[1], {
		type: "video_url",
		video_url: { url: `data:video/mp4;base64,${data}` },
	});
	const entries = JSON.stringify(journal.getEntries());
	assert.ok(entries.includes(answer));
	assert.ok(!entries.includes(data));
	assert.ok(!JSON.stringify(requests[2]?.body).includes(data));
});

// ISO BMFF ftyp: major "M4V ", compatible isom/iso2/avc1/mp41, followed by moov.
const m4v = Buffer.from(
	"00000020667479704d3456200000020069736f6d69736f32617663316d703431000000086d6f6f76",
	"hex",
);
for (const suffix of ["mp4", "m4v"]) {
	await test(`M4V-branded .${suffix} sends its original bytes as MP4`, async (t) => {
		const { session } = await createSession(completions);
		t.after(() => session.dispose());
		const path = `apple-video.${suffix}`;
		await writeFile(join(cwd, path), m4v);
		const requests: Wire[] = [];
		t.mock.method(
			globalThis,
			"fetch",
			captureFetch((request) => {
				requests.push(request);
				return completion({ content: answer });
			}),
		);
		const result = await executeVideo(session, path);
		assert.deepEqual(result.content, [{ type: "text", text: answer }]);
		assert.equal(requests.length, 1);
		const [request] = requests;
		assert.ok(request);
		assert.deepEqual(userParts(request.body, "messages", "content")[1], {
			type: "video_url",
			video_url: { url: `data:video/mp4;base64,${m4v.toString("base64")}` },
		});
	});
}

await test("local file and base64 request budgets reject before the provider sends", async (t) => {
	const { session } = await createSession({
		...completions,
		inputLimits: { maxRequestBytes: 110 },
	});
	t.after(() => session.dispose());
	const fetch = t.mock.method(globalThis, "fetch", () => new Response(null, { status: 500 }));
	await writeFile(join(cwd, "not-video.mp4"), "not a video");
	await writeFile(join(cwd, "wrong.webm"), clip);
	await writeFile(join(cwd, "large.mp4"), clip);
	await truncate(join(cwd, "large.mp4"), 1024);
	await assert.rejects(executeVideo(session, "not-video.mp4", "?"), /contents do not match/u);
	await assert.rejects(executeVideo(session, "wrong.webm", "?"), /contents do not match/u);
	await assert.rejects(executeVideo(session, "missing.mp4", "?"), /ENOENT/u);
	await assert.rejects(executeVideo(session, "large.mp4", "?"), /fit at most.*Trim or compress/u);
	await assert.rejects(executeVideo(session, filename, "?"), /fit at most.*Trim or compress/u);
	assert.equal(fetch.mock.callCount(), 0);
});

const dataUrl = `data:video/mp4;base64,${data}`;
const inline = { inlineData: { mimeType: "video/mp4", data } };
const nativeVideo = { type: "video", mime_type: "video/mp4", data, processing: "agentic" };
const wireFixtures = [
	{
		model: google,
		turns: "contents",
		parts: "parts",
		part: inline,
		path: /:streamGenerateContent$/u,
	},
	{
		model: vertex,
		turns: "contents",
		parts: "parts",
		part: inline,
		path: /:streamGenerateContent$/u,
	},
	{
		model: responses,
		turns: "input",
		parts: "content",
		part: { type: "input_video", video_url: dataUrl },
		path: /\/responses$/u,
	},
	{
		model: minimax,
		turns: "messages",
		parts: "content",
		part: { type: "video", source: { type: "base64", media_type: "video/mp4", data } },
		path: /\/messages$/u,
	},
	{ model: neon, turns: "input", parts: "content", part: nativeVideo, path: /\/interactions$/u },
];

for (const fixture of wireFixtures) {
	const { model, turns, parts, part, path } = fixture;
	await test(
		`native wire serializer: ${model?.api ?? "google-interactions (Fitch Pi only)"}`,
		{ skip: model === undefined },
		async (t) => {
			assert.ok(model);
			const { session } = await createSession(model);
			t.after(() => session.dispose());
			const requests: Wire[] = [];
			t.mock.method(
				globalThis,
				"fetch",
				captureFetch((request) => {
					requests.push(request);
					// Deliberately echo the body in an upstream error; the tool must not leak it into its result.
					return Response.json(
						{ error: { code: 400, message: `Rejected: ${data}` } },
						{ status: 400 },
					);
				}),
			);
			await assert.rejects(
				executeVideo(session, filename, "What color is it?"),
				(error: Error) =>
					error.message.startsWith("Video analysis failed") && !error.message.includes(data),
			);
			assert.equal(requests.length, 1);
			const [request] = requests;
			assert.ok(request);
			const { body, url } = request;
			assert.match(url.pathname, path);
			assert.equal(body.tools, undefined);
			if (model.api === "google-interactions" || model.api === "openai-responses") {
				assert.equal(body.store, false);
			}
			const user = userParts(body, turns, parts);
			assert.equal(user.length, 2);
			assert.match(JSON.stringify(user[0]), /What color is it\?/u);
			assert.deepEqual(user[1], part);
		},
	);
}

await test("Bedrock Converse SDK serializes original bytes using its native video block", async (t) => {
	const model = registry.find("amazon-bedrock", "amazon.nova-lite-v1:0");
	assert.ok(model);
	const route = resolveVideoRoute(model);
	assert.ok(route);
	const requests: unknown[] = [];
	const server = createServer((request, response) => {
		buffer(request)
			.then((bytes) => {
				requests.push(JSON.parse(bytes.toString()));
				response.writeHead(400, {
					"content-type": "application/json",
					"x-amzn-errortype": "ValidationException",
				});
				response.end('{"message":"end of wire test"}');
			})
			.catch((error: unknown) => {
				response.destroy(
					error instanceof Error ? error : new Error("could not capture Bedrock request"),
				);
			});
	});
	t.after(() => server.close());
	await new Promise<void>((ready) => {
		server.listen(0, "127.0.0.1", ready);
	});
	const address = server.address();
	assert.ok(address !== null && typeof address !== "string");
	const local = registerModel({
		...model,
		provider: "video-bedrock-test",
		baseUrl: `http://127.0.0.1:${address.port}`,
	});
	const result = await registry
		.streamSimple(
			local,
			{
				messages: [{ role: "user", content: "What color is it?", timestamp: Date.now() }],
			},
			{
				env: { AWS_BEDROCK_FORCE_HTTP1: "1", AWS_BEDROCK_SKIP_AUTH: "1" },
				cacheRetention: "none",
				onPayload: (payload) =>
					injectVideo(payload, route, { bytes: clip, format: "mp4", mimeType: "video/mp4" }),
			},
		)
		.result();
	assert.equal(requests.length, 1, result.errorMessage);
	const body = requireRecord(requests[0], "Converse request");
	assert.deepEqual(userParts(body, "messages", "content"), [
		{ text: "What color is it?" },
		{ video: { format: "mp4", source: { bytes: data } } },
	]);
});
