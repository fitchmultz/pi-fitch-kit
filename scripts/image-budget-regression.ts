#!/usr/bin/env node
// Offline regressions through the real resizer and Anthropic serializer. No network.
import assert from "node:assert/strict";
import { createHook } from "node:async_hooks";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { anthropicMessagesApi } from "@earendil-works/pi-ai/compat";
import type { Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import {
	handlerFor,
	drivenHandlers,
	requireRecord,
	jsonField,
	jsonList,
	jsonString,
} from "./test-harness.ts";

/** One framed image part for the tight-budget fixtures. */
type WireImage = { type: "image"; source: { type: string; media_type: string; data: string } };
/** One framed wire part for the tight-budget fixtures. */
type WirePart = WireImage | { type: "text"; text: string };

/** The wire stream the native Anthropic API and the fast-mode override share. */
type AnthropicStreamSimple = ReturnType<typeof anthropicMessagesApi>["streamSimple"];

/** The host photon image surface the guard's native resizes use. */
type HostPhotonImage = {
	get_bytes: () => Uint8Array;
	free: () => void;
};
type HostPhoton = {
	loadPhoton: () => Promise<{
		PhotonImage: new (pixels: Uint8Array, width: number, height: number) => HostPhotonImage;
	}>;
};
const isHostPhoton = (module: unknown): module is HostPhoton =>
	typeof module === "object" &&
	module !== null &&
	"loadPhoton" in module &&
	typeof module.loadPhoton === "function";

const agentDir = mkdtempSync(join(tmpdir(), "pi-image-budget-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
const { prepareClaudeImages, fitClaudeRequest, sharedImageCache } =
	await import("../extensions/anthropic-image-guard.ts");
const { default: fastMode } = await import("../extensions/fast-mode.ts");
const ai = await import("@earendil-works/pi-ai");
const photonModule: unknown = await import(
	new URL("./utils/photon.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href
);
if (!isHostPhoton(photonModule)) {
	throw new Error("host photon module did not expose the expected surface");
}
const { loadPhoton } = photonModule;
const photon = await loadPhoton();
let workers = 0;
createHook({
	init(_id: number, type: string) {
		if (type === "WORKER") {
			workers += 1;
		}
	},
}).enable();
const model: Model<"anthropic-messages"> = {
	api: "anthropic-messages",
	id: "claude-opus-5",
	name: "claude-opus-5",
	provider: "anthropic",
	baseUrl: "https://offline.invalid",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 320000,
	maxTokens: 4096,
};
function png(width: number, height: number): string {
	const pixels = new Uint8Array(width * height * 4);
	let seed = 123456789;
	for (let i = 0; i < pixels.length; i += 4) {
		for (let c = 0; c < 3; c++) {
			seed ^= seed << 13;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			pixels[i + c] = seed & 255;
		}
		pixels[i + 3] = 255;
	}
	const image = new photon.PhotonImage(pixels, width, height);
	try {
		return Buffer.from(image.get_bytes()).toString("base64");
	} finally {
		image.free();
	}
}
/** A synthetic user turn carrying one full-resolution screenshot. */
type ScreenshotTurn = {
	role: "user";
	timestamp: number;
	content: Array<
		{ type: "text"; text: string } | { type: "image"; mimeType: string; data: string }
	>;
};

const messages = (data: string, count: number): ScreenshotTurn[] =>
	Array.from({ length: count }, (_, index) => ({
		role: "user",
		timestamp: index + 1,
		content: [
			{ type: "text", text: `Screenshot ${index + 1}` },
			{ type: "image", mimeType: "image/png", data },
		],
	}));
const selected = process.argv[2];
if (selected === undefined || selected === "source") {
	const { DefaultResourceLoader, SettingsManager } =
		await import("@earendil-works/pi-coding-agent");
	const loader = new DefaultResourceLoader({
		cwd: agentDir,
		agentDir,
		settingsManager: SettingsManager.inMemory({}),
		additionalExtensionPaths: [
			fileURLToPath(new URL("../extensions/anthropic-image-guard.ts", import.meta.url)),
		],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const guard = loader.getExtensions().extensions.at(0);
	if (guard === undefined) {
		throw new Error("image-guard extension missing");
	}
	const contextHandler = handlerFor(drivenHandlers(guard), "context");
	const prepare = (turns: unknown) => contextHandler({ messages: turns }, { model });
	const data = png(2400, 1400);
	const originals = messages(data, 7);
	for (const count of [6, 7]) {
		const outgoing = structuredClone(originals.slice(0, count));
		await prepare(outgoing);
		assert.deepEqual(
			outgoing.map((message) => message.timestamp),
			originals.slice(0, count).map((message) => message.timestamp),
		);
		assert.deepEqual(
			outgoing
				.filter((message) => message.content.some((part) => part.type === "image"))
				.map((message) => message.timestamp),
			[count - 2, count - 1, count],
			"source safety budget must admit newest screenshots",
		);
		assert.ok(
			outgoing.every((message) => {
				const first = message.content.at(0);
				return (
					first !== undefined &&
					first.type === "text" &&
					first.text === `Screenshot ${message.timestamp}`
				);
			}),
		);
	}
	assert.ok(
		originals.every((message) => {
			const image = message.content.at(1);
			return image !== undefined && image.type === "image" && image.data === data;
		}),
		"saved sources stay full resolution",
	);
	// Several captures in one tool result must retain their original content ordering too.
	const tool = [{ role: "toolResult", content: originals.flatMap((message) => message.content) }];
	await prepare(tool);
	const toolTurn = tool.at(0);
	if (toolTurn === undefined) {
		throw new Error("tool fixture missing");
	}
	assert.deepEqual(
		toolTurn.content
			.filter((part) => part.type === "text" && part.text.startsWith("Screenshot"))
			.map((part) => {
				if (part.type !== "text") {
					throw new Error("expected a text part");
				}
				return part.text;
			}),
		originals.map((message) => {
			const first = message.content.at(0);
			if (first === undefined || first.type !== "text") {
				throw new Error("fixture message lost its text part");
			}
			return first.text;
		}),
	);
	assert.equal(toolTurn.content.filter((part) => part.type === "image").length, 3);
	console.log(
		"source budget: newest three admitted on repeated requests; chronology and original sources preserved",
	);
}
if (selected === undefined || selected === "wire") {
	const providers = new Map<string, { api: unknown; streamSimple: AnthropicStreamSimple }>();
	/* oxlint-disable typescript/no-unsafe-type-assertion -- QX-002: the fast-mode entry
	 * demands the complete ExtensionAPI. This regression drives it with partial recorders;
	 * the cast lives only at this boundary, matching the harness allowance. */
	fastMode({
		registerProvider: (
			name: string,
			config: { api: unknown; streamSimple: AnthropicStreamSimple },
		) => {
			providers.set(name, config);
		},
		registerFlag: (_name: string, _config: unknown) => {
			return;
		},
		registerCommand: (_name: string, _config: unknown) => {
			return;
		},
		on: (_event: string, _handler: unknown) => {
			return;
		},
	} as unknown as Parameters<typeof fastMode>[0]);
	/* oxlint-enable typescript/no-unsafe-type-assertion */
	const data = png(900, 900);
	const originals = messages(data, 9);
	const outgoing = structuredClone(originals);
	await prepareClaudeImages(model, outgoing);
	const context = ai.normalizeContext({
		messages: outgoing,
		systemPrompt: "Unicode overhead: 🐎 漢字 ".repeat(15000),
		tools: [
			{
				name: "inspect",
				description: "tool schema overhead ".repeat(10000),
				parameters: { type: "object", properties: {} },
			},
		],
	});
	const capture = async (
		stream: AnthropicStreamSimple,
		options: SimpleStreamOptions = {},
	): Promise<{ bytes: number; body: Record<string, unknown> }> => {
		let body: BodyInit | null | undefined;
		const response = await stream(model, structuredClone(context), {
			apiKey: "synthetic",
			maxRetries: 0,
			...options,
			fetch: async (
				_url: Parameters<typeof fetch>[0],
				init: Parameters<typeof fetch>[1],
			): Promise<Response> => {
				if (init === undefined) {
					throw new Error("offline capture received no request init");
				}
				body = init.body;
				throw new Error("offline capture complete");
			},
		}).result();
		assert.equal(response.stopReason, "error");
		if (typeof body !== "string") {
			throw new Error(response.errorMessage ?? "offline capture lost its body");
		}
		return {
			bytes: Buffer.byteLength(body),
			body: requireRecord(JSON.parse(body), "captured request body"),
		};
	};
	const native = anthropicMessagesApi();
	const nativeStreamSimple = native.streamSimple.bind(native);
	const baseline = await capture(nativeStreamSimple);
	assert.ok(baseline.bytes > 32_000_000, "fixture must reproduce native aggregate overflow");
	assert.ok(jsonList(baseline.body.system, "body system").length > 0);
	assert.equal(jsonList(baseline.body.tools, "body tools").length, 1);
	for (const fast of [false, true]) {
		writeFileSync(join(agentDir, "anthropic-fast.json"), JSON.stringify({ enabled: fast }));
		const anthropicFast = providers.get("anthropic");
		if (anthropicFast === undefined) {
			throw new Error("fast-mode did not register an anthropic provider");
		}
		const result = await capture(anthropicFast.streamSimple, {
			// A replacement hook and fast-mode speed are both included in final accounting.
			onPayload: (payload) => ({
				...requireRecord(payload, "onPayload payload"),
				metadata: { user_id: "x".repeat(50000) },
			}),
		});
		assert.ok(result.bytes <= 32_000_000, `final request is ${result.bytes} bytes`);
		assert.equal(
			jsonList(result.body.messages, "body messages")
				.flatMap((message) => requireRecord(message, "body message").content)
				.filter((part) => requireRecord(part, "body part").type === "image").length,
			9,
			"resize instead of dropping usable screenshots",
		);
		assert.equal(result.body.speed, fast ? "fast" : undefined);
		assert.deepEqual(result.body.system, baseline.body.system);
		assert.deepEqual(result.body.tools, baseline.body.tools);
		assert.equal(
			jsonString(jsonField(result.body, "metadata", "body metadata").user_id, "user_id").length,
			50000,
		);
	}
	// The writer's native callback also works without the fast-mode provider override.
	const writer = await capture(nativeStreamSimple, {
		onPayload: (payload) => fitClaudeRequest(model, payload),
	});
	assert.ok(writer.bytes <= 32_000_000);
	// Every over-limit turn resends the same captures; the shared cache must spare them native work.
	const repeated: SimpleStreamOptions = {
		onPayload: (payload) => fitClaudeRequest(model, payload, sharedImageCache()),
	};
	const first = await capture(nativeStreamSimple, repeated);
	const beforeRepeat = workers;
	const repeat = await capture(nativeStreamSimple, repeated);
	assert.equal(
		workers - beforeRepeat,
		0,
		"a repeated over-limit request must reuse its native results",
	);
	assert.deepEqual(repeat.body, first.body, "repeated requests resend identical image bytes");
	const toolPayload = {
		messages: [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "capture",
						content: originals
							.flatMap((message) => message.content)
							.map((part) =>
								part.type === "image"
									? {
											type: "image",
											source: { type: "base64", data: part.data, media_type: part.mimeType },
										}
									: part,
							),
					},
				],
			},
		],
	};
	await fitClaudeRequest(model, toolPayload);
	assert.ok(Buffer.byteLength(JSON.stringify(toolPayload)) <= 32_000_000);
	const toolMessage = toolPayload.messages.at(0);
	if (toolMessage === undefined) {
		throw new Error("tool payload lost its message");
	}
	const toolPart = toolMessage.content.at(0);
	if (toolPart === undefined) {
		throw new Error("tool payload lost its tool_result part");
	}
	assert.equal(
		jsonList(toolPart.content, "tool_result content").filter(
			(part) => requireRecord(part, "tool_result part").type === "image",
		).length,
		9,
	);
	const textOnly = { messages: [{ role: "user", content: "x".repeat(32_000_001) }] };
	assert.equal(
		await fitClaudeRequest(model, textOnly),
		textOnly,
		"native text overflow remains outside image guard scope",
	);
	const unfixableImage = {
		type: "image",
		source: { type: "base64", media_type: "image/png", data },
	};
	const unfixable = {
		messages: [...textOnly.messages, { role: "user", content: [unfixableImage] }],
	};
	await fitClaudeRequest(model, unfixable);
	const unfixableTurn = unfixable.messages.at(-1);
	if (unfixableTurn === undefined) {
		throw new Error("unfixable payload lost its image turn");
	}
	const unfixablePart = unfixableTurn.content.at(0);
	assert.equal(
		unfixablePart,
		unfixableImage,
		"do not discard images when text alone exceeds the cap",
	);
	assert.equal(unfixableImage.source.data, data);
	const nonClaude = structuredClone(baseline.body);
	assert.equal(await fitClaudeRequest({ ...model, id: "other-model" }, nonClaude), nonClaude);
	assert.deepEqual(
		nonClaude,
		baseline.body,
		"non-Claude requests retain even oversized image payloads",
	);
	assert.ok(
		originals.every((message) => {
			const image = message.content.at(1);
			return image !== undefined && image.type === "image" && image.data === data;
		}),
	);
	console.log(
		`wire budget: native ${baseline.bytes} bytes; guarded main fast on/off and writer under 32 MB, all nine images retained`,
	);

	// Tight framing/coordinate-note budgets used to drop the largest (newest)
	// image during fallback even when both images could fit after further resizing.
	for (const allowance of [775, 500]) {
		const image = (imageData: string): WireImage => ({
			type: "image",
			source: { type: "base64", media_type: "image/png", data: imageData },
		});
		const old = image(png(10, 10));
		const newest = image(png(20, 20));
		const text: WirePart = { type: "text", text: "" };
		const content: WirePart[] = [text, old, newest];
		const payload = { messages: [{ role: "user", content }] };
		const overhead =
			Buffer.byteLength(JSON.stringify({ ...payload, stream: true })) -
			old.source.data.length -
			newest.source.data.length;
		text.text = "x".repeat(32_000_000 - overhead - allowance);
		await fitClaudeRequest(model, payload);
		assert.ok(Buffer.byteLength(JSON.stringify({ ...payload, stream: true })) <= 32_000_000);
		assert.ok(content.includes(newest), "newest image survives when the budget cannot hold both");
		assert.equal(
			content.includes(old),
			allowance === 775,
			"further resizing preserves both when feasible; otherwise omit oldest",
		);
		assert.equal(content.at(0), text);
		const lastPart = content.at(-1);
		if (lastPart === undefined || lastPart.type !== "text") {
			throw new Error("coordinate note missing after tight-budget fit");
		}
		assert.match(
			lastPart.text,
			/original 20x20/,
			"repeated resizing retains the original coordinate mapping",
		);
	}
	console.log(
		"tight wire budget: further resizing before omission; oldest omitted first; coordinate mapping preserved",
	);
}
