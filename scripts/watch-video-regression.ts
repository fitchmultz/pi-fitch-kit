import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVideoRoute } from "../extensions/watch-video-routes.ts";

const google = "https://generativelanguage.googleapis.com/v1beta";
const vertex = "https://{location}-aiplatform.googleapis.com";
const gateway = "https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/google-ai-studio/v1beta";
const bedrock = "https://bedrock-runtime.us-east-1.amazonaws.com";
const openRouter = "https://openrouter.ai/api/v1";
const alibaba = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const moonshot = "https://api.moonshot.ai/v1";
const zai = "https://api.z.ai/api/paas/v4";
const fireworks = "https://api.fireworks.ai/inference/v1";
const minimax = "https://api.minimax.io/anthropic";

const routes = [
	["google-generative-ai", google, "gemini-2.5-flash", "generate-content"],
	["google-generative-ai", google, "gemini-2.5-flash-lite", "generate-content"],
	["google-vertex", vertex, "gemini-2.5-pro", "generate-content"],
	["google-generative-ai", google, "gemini-3-flash-preview", "generate-content"],
	["google-generative-ai", google, "gemini-3.1-flash-lite-preview", "generate-content"],
	["google-vertex", vertex, "publishers/google/models/gemini-3.1-pro-preview", "generate-content"],
	["google-vertex", vertex, "gemini-4-argon", "generate-content"],
	["google-generative-ai", gateway, "google/gemini-4-carbon", "generate-content"],
	["google-generative-ai", google, "gemini-4-hydrogen", "generate-content"],
	["google-interactions", gateway, "google/gemini-4-neon", "interactions"],
	["google-interactions", google, "gemini-pro-latest", "interactions"],
	["google-generative-ai", google, "gemini-robotics-er-2-preview", "generate-content"],
	["bedrock-converse-stream", bedrock, "us.amazon.nova-lite-v1:0", "converse"],
	["bedrock-converse-stream", bedrock, "amazon.nova-pro-v1:0", "converse"],
	["bedrock-converse-stream", bedrock, "amazon.nova-premier-v1:0", "converse"],
	["bedrock-converse-stream", bedrock, "global.amazon.nova-2-lite-v1:0", "converse"],
	["openai-completions", openRouter, "google/gemini-4-neon", "completions"],
	["openai-responses", openRouter, "google/gemini-2.5-pro", "responses"],
	["openai-responses", openRouter, "amazon/nova-2-lite-v1", "responses"],
	["openai-completions", openRouter, "stepfun/step-5-preview", "completions"],
	["openai-completions", openRouter, "google/gemma-4-31b-it", "completions"],
	["openai-completions", openRouter, "xiaomi/mimo-v2.6-flash", "completions"],
	["openai-completions", openRouter, "z-ai/glm-5v-turbo", "completions"],
	["openai-responses", openRouter, "qwen/qwen3.5-397b-a17b", "responses"],
	["openai-completions", alibaba, "qwen2.5-vl-72b-instruct", "completions"],
	["openai-completions", alibaba, "qwen3-omni-flash", "completions"],
	["openai-completions", alibaba, "qwen3.5-omni-plus-2026-03-15", "completions"],
	[
		"openai-completions",
		"https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
		"qwen3.8-omni-flash",
		"completions",
	],
	["openai-completions", moonshot, "kimi-k3", "completions"],
	["openai-completions", moonshot, "kimi-k3.1-pro", "completions"],
	["openai-completions", zai, "glm-5.3-flashx", "completions"],
	["openai-completions", zai, "glm-4.5v", "completions"],
	["openai-completions", fireworks, "accounts/fireworks/models/glm-5p3-flash", "completions"],
	["anthropic-messages", minimax, "MiniMax-M3", "minimax"],
	["anthropic-messages", minimax, "MiniMax-M3.1-Flash", "minimax"],
] as const;

const hidden = [
	["google-generative-ai", google, "gemini-2.5-computer-use-preview-10-2025"],
	["google-generative-ai", google, "gemini-3-pro-image"],
	["google-generative-ai", google, "gemini-3.1-flash-lite-image"],
	["google-generative-ai", google, "gemini-2.5-flash-preview-tts"],
	["google-interactions", google, "gemini-embedding-2-preview"],
	["google-interactions", google, "gemini-decision-1"],
	["google-interactions", "https://localhost/v1beta", "gemini-4-neon"],
	[
		"google-interactions",
		"https://gateway.ai.cloudflare.com/v1/account/gateway/openai",
		"gemini-4-neon",
	],
	["bedrock-converse-stream", bedrock, "amazon.nova-micro-v1:0"],
	["openai-completions", openRouter, "google/gemini-4-neon:batch"],
	["openai-responses", openRouter, "openrouter/auto"],
	["openai-completions", openRouter, "openrouter/auto-code"],
	["openai-completions", openRouter, "amazon/nova-pro-v1"],
	["openai-completions", openRouter, "qwen/qwen2.5-vl-72b-instruct"],
	["openai-completions", openRouter, "z-ai/glm-4.5v"],
	["openai-completions", openRouter, "openai/gpt-4o"],
	["openai-completions", "https://api.openai.com/v1", "gpt-4o"],
	["openai-responses", "https://api.openai.com/v1", "gpt-5"],
	["openai-responses", "https://api.openai.com/v1", "gpt-6"],
	["openai-codex-responses", "https://chatgpt.com/backend-api", "gpt-5.3-codex"],
	["anthropic-messages", "https://api.anthropic.com", "claude-opus-4-8"],
	["openai-completions", "https://api.x.ai/v1", "grok-4"],
	["openai-completions", "https://api.mistral.ai/v1", "pixtral-large-latest"],
	["openai-completions", "http://127.0.0.1:11434/v1", "google/gemini-4-neon"],
	["openai-completions", "https://openrouter.ai.localhost/api/v1", "google/gemini-4-neon"],
	["openai-completions", alibaba, "qwen3-omni-flash-realtime"],
	["openai-completions", moonshot, "kimi-k2.5"],
	["openai-completions", zai, "glm-5.3"],
	["openai-responses", "https://api.z.ai/api/v1", "glm-5.3-flash"],
	["anthropic-messages", minimax, "MiniMax-M2.7"],
] as const;

await test("only documented native video model and endpoint pairs qualify", () => {
	for (const [api, baseUrl, id, wire] of routes) {
		assert.equal(resolveVideoRoute({ api, baseUrl, id })?.wire, wire, `${api} ${baseUrl} ${id}`);
	}
	for (const [api, baseUrl, id] of hidden) {
		const model = { api, baseUrl, id, input: ["text", "image"] };
		assert.equal(resolveVideoRoute(model), undefined, `${api} ${baseUrl} ${id}`);
	}
});

await test("Pi's video input signal qualifies new models only on implemented routes", () => {
	const id = "future-video-model";
	const input = ["text", "image", "video"];
	const supported = [
		["google-interactions", google, "interactions"],
		["google-generative-ai", google, "generate-content"],
		["google-vertex", vertex, "generate-content"],
		["bedrock-converse-stream", bedrock, "converse"],
		["openai-completions", openRouter, "completions"],
		["openai-completions", alibaba, "completions"],
		["openai-completions", moonshot, "completions"],
		["openai-completions", zai, "completions"],
		["openai-completions", fireworks, "completions"],
		["openai-responses", openRouter, "responses"],
		["anthropic-messages", minimax, "minimax"],
	] as const;
	for (const [api, baseUrl, wire] of supported) {
		assert.equal(resolveVideoRoute({ api, baseUrl, id, input })?.wire, wire, `${api} ${baseUrl}`);
	}
	const unsupported = [
		["anthropic-messages", "https://api.anthropic.com", "claude-opus-4-8"],
		["anthropic-messages", "https://ai-gateway.vercel.sh", id],
		["openai-completions", "https://api.openai.com/v1", id],
		["openai-responses", "https://api.openai.com/v1", id],
		["openai-responses", fireworks, id],
	] as const;
	for (const [api, baseUrl, modelId] of unsupported) {
		assert.equal(
			resolveVideoRoute({ api, baseUrl, id: modelId, input }),
			undefined,
			`${api} ${baseUrl}`,
		);
	}
});

await test("Vertex uses its inline part budget and keeps the Cloudflare gateway ceiling", () => {
	const model = { api: "google-vertex", baseUrl: vertex, id: "gemini-3.1-pro-preview" };
	assert.equal(resolveVideoRoute(model)?.maxRequestBytes, 256_000_000);
	const vertexGateway = "https://gateway.ai.cloudflare.com/v1/account/gateway/google-vertex-ai";
	assert.equal(
		resolveVideoRoute({ ...model, baseUrl: vertexGateway })?.maxRequestBytes,
		32 * 1024 * 1024,
	);
});

await test("Fireworks applies a request ceiling only when configured", () => {
	const model = {
		api: "openai-completions",
		baseUrl: fireworks,
		id: "accounts/fireworks/models/glm-5p3-flash",
	};
	assert.equal(resolveVideoRoute(model)?.maxRequestBytes, Infinity);
	assert.equal(
		resolveVideoRoute({ ...model, inputLimits: { maxRequestBytes: 25_000_000 } })?.maxRequestBytes,
		25_000_000,
	);
});

await test("Neon agentic mode and configurable request byte ceilings", () => {
	const model = { api: "google-interactions", baseUrl: gateway, id: "google/gemini-4-neon" };
	assert.equal(resolveVideoRoute(model)?.agentic, true);
	assert.equal(resolveVideoRoute({ ...model, id: "gemini-4-carbon" })?.agentic, undefined);
	assert.equal(resolveVideoRoute(model)?.maxRequestBytes, 32 * 1024 * 1024);
	assert.equal(
		resolveVideoRoute({ ...model, inputLimits: { maxRequestBytes: 600 } })?.maxRequestBytes,
		600,
	);
});

await test("OpenRouter uses its configured request ceiling instead of the 10 MB fallback", () => {
	const model = { api: "openai-responses", baseUrl: openRouter, id: "google/gemini-4-neon" };
	assert.equal(resolveVideoRoute(model)?.maxRequestBytes, 10_000_000);
	for (const maxRequestBytes of [600, 25_000_000]) {
		assert.equal(
			resolveVideoRoute({ ...model, inputLimits: { maxRequestBytes } })?.maxRequestBytes,
			maxRequestBytes,
		);
	}
});
