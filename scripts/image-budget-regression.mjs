#!/usr/bin/env node
// Offline regressions through the real resizer and Anthropic serializer. No network.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDir = mkdtempSync(join(tmpdir(), "pi-image-budget-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
const { prepareClaudeImages, fitClaudeRequest } = await import("../extensions/anthropic-image-guard.ts");
const { default: fastMode } = await import("../extensions/fast-mode.ts");
const { anthropicMessagesApi } = await import("@earendil-works/pi-ai/compat");
const ai = await import("@earendil-works/pi-ai");
const { loadPhoton } = await import(new URL("./utils/photon.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
const photon = await loadPhoton();
assert.ok(photon);
const model = {
	api: "anthropic-messages", id: "claude-opus-5", provider: "anthropic",
	baseUrl: "https://offline.invalid", reasoning: false, input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 320000, maxTokens: 4096,
};
function png(width, height) {
	const pixels = new Uint8Array(width * height * 4);
	let seed = 123456789;
	for (let i = 0; i < pixels.length; i += 4) {
		for (let c = 0; c < 3; c++) {
			seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
			pixels[i + c] = seed & 255;
		}
		pixels[i + 3] = 255;
	}
	const image = new photon.PhotonImage(pixels, width, height);
	try { return Buffer.from(image.get_bytes()).toString("base64"); }
	finally { image.free(); }
}
const messages = (data, count) => Array.from({ length: count }, (_, index) => ({
	role: "user", timestamp: index + 1,
	content: [{ type: "text", text: `Screenshot ${index + 1}` }, { type: "image", mimeType: "image/png", data }],
}));
const selected = process.argv[2];
if (!selected || selected === "source") {
	const data = png(2400, 1400);
	const originals = messages(data, 7);
	const cache = new Map();
	for (const count of [6, 7]) {
		const outgoing = structuredClone(originals.slice(0, count));
		await prepareClaudeImages(model, outgoing, cache);
		assert.deepEqual(outgoing.map((message) => message.timestamp), originals.slice(0, count).map((message) => message.timestamp));
		assert.deepEqual(outgoing.filter((message) => message.content.some((part) => part.type === "image")).map((message) => message.timestamp),
			[count - 2, count - 1, count], "source safety budget must admit newest screenshots");
		assert.ok(outgoing.every((message) => message.content[0].text === `Screenshot ${message.timestamp}`));
	}
	assert.ok(originals.every((message) => message.content[1].data === data), "saved sources stay full resolution");
	// Several captures in one tool result must retain their original content ordering too.
	const tool = [{ role: "toolResult", content: originals.flatMap((message) => message.content) }];
	await prepareClaudeImages(model, tool, cache);
	assert.deepEqual(tool[0].content.filter((part) => part.type === "text" && part.text.startsWith("Screenshot")).map((part) => part.text), originals.map((message) => message.content[0].text));
	assert.equal(tool[0].content.filter((part) => part.type === "image").length, 3);
	console.log("source budget: newest three admitted on repeated requests; chronology and original sources preserved");
}
if (!selected || selected === "wire") {
	const providers = new Map();
	fastMode({ registerProvider: (name, config) => providers.set(name, config), registerFlag() {}, registerCommand() {}, on() {} });
	const data = png(900, 900);
	const originals = messages(data, 9);
	const outgoing = structuredClone(originals);
	await prepareClaudeImages(model, outgoing);
	const legacyContext = {
		messages: outgoing,
		systemPrompt: "Unicode overhead: 🐎 漢字 ".repeat(15000),
		tools: [{ name: "inspect", description: "tool schema overhead ".repeat(10000), parameters: { type: "object", properties: {} } }],
	};
	// Current native APIs use transcript system messages; Pi 0.84.2 accepts Context.
	const context = ai.normalizeContext ? ai.normalizeContext(legacyContext) : legacyContext;
	async function capture(stream, options = {}) {
		let body;
		const response = await stream(model, structuredClone(context), {
			apiKey: "synthetic", maxRetries: 0, ...options,
			fetch: async (_url, init) => { body = init.body; throw new Error("offline capture complete"); },
		}).result();
		assert.equal(response.stopReason, "error");
		assert.equal(typeof body, "string", response.errorMessage);
		return { bytes: Buffer.byteLength(body), body: JSON.parse(body) };
	}
	const native = anthropicMessagesApi();
	const baseline = await capture(native.streamSimple);
	assert.ok(baseline.bytes > 32_000_000, "fixture must reproduce native aggregate overflow");
	assert.ok(baseline.body.system.length > 0);
	assert.equal(baseline.body.tools.length, 1);
	for (const fast of [false, true]) {
		writeFileSync(join(agentDir, "anthropic-fast.json"), JSON.stringify({ enabled: fast }));
		const result = await capture(providers.get("anthropic").streamSimple, {
			// A replacement hook and fast-mode speed are both included in final accounting.
			onPayload: (payload) => ({ ...payload, metadata: { user_id: "x".repeat(50000) } }),
		});
		assert.ok(result.bytes <= 32_000_000, `final request is ${result.bytes} bytes`);
		assert.equal(result.body.messages.flatMap((message) => message.content).filter((part) => part.type === "image").length, 9, "resize instead of dropping usable screenshots");
		assert.equal(result.body.speed, fast ? "fast" : undefined);
		assert.deepEqual(result.body.system, baseline.body.system);
		assert.deepEqual(result.body.tools, baseline.body.tools);
		assert.equal(result.body.metadata.user_id.length, 50000);
	}
	// The writer's native callback also works without the fast-mode provider override.
	const writer = await capture(native.streamSimple, { onPayload: (payload) => fitClaudeRequest(model, payload) });
	assert.ok(writer.bytes <= 32_000_000);
	const toolPayload = { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "capture", content: originals.flatMap((message) => message.content).map((part) => part.type === "image" ? { type: "image", source: { type: "base64", data: part.data, media_type: part.mimeType } } : part) }] }] };
	await fitClaudeRequest(model, toolPayload);
	assert.ok(Buffer.byteLength(JSON.stringify(toolPayload)) <= 32_000_000);
	assert.equal(toolPayload.messages[0].content[0].content.filter((part) => part.type === "image").length, 9);
	const textOnly = { messages: [{ role: "user", content: "x".repeat(32_000_001) }] };
	assert.equal(await fitClaudeRequest(model, textOnly), textOnly, "native text overflow remains outside image guard scope");
	const unfixableImage = { type: "image", source: { type: "base64", media_type: "image/png", data } };
	const unfixable = { messages: [...textOnly.messages, { role: "user", content: [unfixableImage] }] };
	await fitClaudeRequest(model, unfixable);
	assert.equal(unfixable.messages.at(-1).content[0], unfixableImage, "do not discard images when text alone exceeds the cap");
	assert.equal(unfixableImage.source.data, data);
	const nonClaude = structuredClone(baseline.body);
	assert.equal(await fitClaudeRequest({ ...model, id: "other-model" }, nonClaude), nonClaude);
	assert.deepEqual(nonClaude, baseline.body, "non-Claude requests retain even oversized image payloads");
	assert.ok(originals.every((message) => message.content[1].data === data));
	console.log(`wire budget: native ${baseline.bytes} bytes; guarded main fast on/off and writer under 32 MB, all nine images retained`);

	// Tight framing/coordinate-note budgets used to drop the largest (newest)
	// image during fallback even when both images could fit after further resizing.
	for (const allowance of [775, 500]) {
		const image = (data) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });
		const old = image(png(10, 10));
		const newest = image(png(20, 20));
		const text = { type: "text", text: "" };
		const content = [text, old, newest];
		const payload = { messages: [{ role: "user", content }] };
		const overhead = Buffer.byteLength(JSON.stringify({ ...payload, stream: true })) - old.source.data.length - newest.source.data.length;
		text.text = "x".repeat(32_000_000 - overhead - allowance);
		await fitClaudeRequest(model, payload);
		assert.ok(Buffer.byteLength(JSON.stringify({ ...payload, stream: true })) <= 32_000_000);
		assert.ok(content.includes(newest), "newest image survives when the budget cannot hold both");
		assert.equal(content.includes(old), allowance === 775, "further resizing preserves both when feasible; otherwise omit oldest");
		assert.equal(content[0], text);
		assert.match(content.at(-1).text, /original 20x20/, "repeated resizing retains the original coordinate mapping");
	}
	console.log("tight wire budget: further resizing before omission; oldest omitted first; coordinate mapping preserved");
}
