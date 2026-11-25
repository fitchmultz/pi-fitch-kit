import type { Api, Model } from "@earendil-works/pi-ai";
import { openRouterVideoModels } from "./watch-video-openrouter.ts";

export type VideoFormat = "mp4" | "mov" | "webm" | "mpeg" | "avi" | "mkv" | "wmv" | "3gp" | "flv";

export type VideoRoute = {
	wire: "interactions" | "generate-content" | "converse" | "completions" | "responses" | "minimax";
	maxRequestBytes: number;
	formats: readonly VideoFormat[];
	agentic?: true;
};

type VideoModel = Pick<Model<Api>, "baseUrl" | "id" | "inputLimits"> & { api: string };

const geminiModels = new Set([
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite",
	"gemini-2.5-pro",
	"gemini-3-flash",
	"gemini-3-flash-preview",
	"gemini-3-pro",
	"gemini-3-pro-preview",
	"gemini-3.1-flash",
	"gemini-3.1-flash-lite",
	"gemini-3.1-flash-lite-preview",
	"gemini-3.1-pro",
	"gemini-3.1-pro-preview",
	"gemini-3.1-pro-preview-customtools",
	"gemini-3.5-flash",
	"gemini-3.5-flash-lite",
	"gemini-3.6-flash",
	"gemini-3.7-flash",
	"gemini-3.8-flash",
	"gemini-4-argon",
	"gemini-4-carbon",
	"gemini-4-hydrogen",
	"gemini-4-neon",
	"gemini-pro-latest",
]);

const geminiFormats: readonly VideoFormat[] = [
	"mp4",
	"mov",
	"webm",
	"mpeg",
	"avi",
	"wmv",
	"3gp",
	"flv",
];
const converseFormats: readonly VideoFormat[] = [
	"mp4",
	"mov",
	"webm",
	"mpeg",
	"mkv",
	"wmv",
	"3gp",
	"flv",
];
const openRouterFormats: readonly VideoFormat[] = ["mp4", "mov", "webm", "mpeg"];
const minimaxFormats: readonly VideoFormat[] = ["mp4", "mov", "avi", "mkv"];
const alibabaFormats: readonly VideoFormat[] = ["mp4", "mov", "avi", "mkv", "flv", "wmv"];
const MB = 1_000_000;

/** The endpoint and wire API must agree; a provider label can describe any local proxy. */
export function resolveVideoRoute(model: VideoModel | undefined): VideoRoute | undefined {
	if (model === undefined) {
		return undefined;
	}
	const url = URL.parse(model.baseUrl);
	if (url?.protocol !== "https:") {
		return undefined;
	}
	const route = nativeRoute(model, url);
	if (route === undefined) {
		return undefined;
	}
	const modelLimit = model.inputLimits?.maxRequestBytes ?? route.maxRequestBytes;
	return { ...route, maxRequestBytes: Math.min(modelLimit, route.maxRequestBytes) };
}

function nativeRoute(model: VideoModel, url: URL): VideoRoute | undefined {
	const { api, id } = model;
	switch (api) {
		case "google-interactions":
		case "google-generative-ai":
		case "google-vertex":
			return googleRoute(api, id, url);
		case "bedrock-converse-stream":
			return bedrockRoute(id, url);
		case "openai-completions":
		case "openai-responses":
			return (
				openRouterRoute(model, url) ??
				(api === "openai-completions" ? directCompletionsRoute(id, url) : undefined)
			);
		case "anthropic-messages":
			return minimaxRoute(id, url);
		default:
			return undefined;
	}
}

function googleEndpoint(
	{ hostname, pathname }: URL,
	vertex: boolean,
): "gateway" | "direct" | undefined {
	if (hostname === "gateway.ai.cloudflare.com") {
		const providerPath = vertex
			? /^\/v1\/[^/]+\/[^/]+\/google-vertex-ai(?:\/|$)/u
			: /^\/v1\/[^/]+\/[^/]+\/google-ai-studio(?:\/|$)/u;
		return providerPath.test(pathname) ? "gateway" : undefined;
	}
	const direct = vertex
		? /^(?:(?:[a-z\d-]+|\{location\})-)?aiplatform\.googleapis\.com$/u.test(hostname)
		: hostname === "generativelanguage.googleapis.com";
	return direct ? "direct" : undefined;
}

function googleRoute(api: string, id: string, url: URL): VideoRoute | undefined {
	const model = id.replace(/^(?:(?:publishers\/)?google\/(?:models\/)?|models\/)/u, "");
	if (!geminiModels.has(model) && !/^gemini-robotics-er-2(?:\.\d+)?(?:-preview)?$/u.test(model)) {
		return undefined;
	}
	const vertex = api === "google-vertex";
	const endpoint = googleEndpoint(url, vertex);
	if (endpoint === undefined) {
		return undefined;
	}
	return {
		wire: api === "google-interactions" ? "interactions" : "generate-content",
		maxRequestBytes: Math.min(
			endpoint === "gateway" ? 32 * 1024 * 1024 : Infinity,
			(vertex ? 20 : 100) * MB,
		),
		formats: geminiFormats,
		...(api === "google-interactions" && model === "gemini-4-neon" ? { agentic: true } : {}),
	};
}

function bedrockRoute(id: string, { hostname }: URL): VideoRoute | undefined {
	const model = id.replace(
		/^arn:aws(?:-cn|-us-gov)?:bedrock:[\w-]+:(?:\d*):(?:foundation-model|inference-profile)\//u,
		"",
	);
	const nova =
		/^(?:(?:us|eu|apac|global|ca|jp|au|in)\.)?amazon\.nova-(?:2-lite|lite|pro|premier)-v1:0$/u;
	const endpoint = /^bedrock-runtime(?:-fips)?\.[a-z0-9-]+\.(?:amazonaws\.com(?:\.cn)?|api\.aws)$/u;
	return endpoint.test(hostname) && nova.test(model)
		? { wire: "converse", maxRequestBytes: 25 * MB, formats: converseFormats }
		: undefined;
}

function openRouterRoute(
	{ api, id, inputLimits }: VideoModel,
	{ hostname, pathname }: URL,
): VideoRoute | undefined {
	if (
		!/^(?:(?:us|eu)\.)?openrouter\.ai$/u.test(hostname) ||
		!/^\/api\/v1\/?$/u.test(pathname) ||
		!openRouterVideoModels.has(id)
	) {
		return undefined;
	}
	return {
		wire: api === "openai-responses" ? "responses" : "completions",
		maxRequestBytes: inputLimits?.maxRequestBytes ?? 10 * MB,
		formats: openRouterFormats,
	};
}

const directCompletions: ReadonlyArray<
	Omit<VideoRoute, "wire"> & { endpoint: RegExp; model: RegExp }
> = [
	{
		endpoint:
			/^(?:dashscope(?:-intl|-us)?|[a-z\d-]+\.[a-z\d-]+\.maas)\.aliyuncs\.com\/compatible-mode\/v1\/?$/u,
		model:
			/^qwen(?:-vl-(?:max|plus)|2\.5-vl-(?:3|7|32|72)b-instruct|3-vl-(?:plus|flash(?:-us)?|(?:8b|30b-a3b|32b|235b-a22b)-(?:instruct|thinking))|-omni-turbo|3(?:\.8)?-omni-flash|3\.5-omni-(?:flash|plus))(?:-latest|-20\d{2}-\d{2}-\d{2})?$/u,
		maxRequestBytes: 10 * MB,
		formats: alibabaFormats,
	},
	{
		endpoint: /^api\.moonshot\.(?:ai|cn)\/v1\/?$/u,
		model: /^(?:kimi-k3|kimi-k3\.1-pro(?:-highspeed)?)$/u,
		maxRequestBytes: 100 * 1024 * 1024,
		formats: ["mp4"],
	},
	{
		endpoint: /^(?:api\.z\.ai|open\.bigmodel\.cn)\/api\/(?:coding\/)?paas\/v4\/?$/u,
		model: /^glm-(?:4\.5v|5\.3-flashx?)$/u,
		maxRequestBytes: 200 * MB,
		formats: ["mp4", "mov", "mkv"],
	},
	{
		endpoint: /^api\.fireworks\.ai\/inference(?:\/v1)?\/?$/u,
		model: /^accounts\/fireworks\/models\/glm-5p3-flash$/u,
		maxRequestBytes: 10 * MB,
		formats: ["mp4"],
	},
];

function directCompletionsRoute(id: string, { hostname, pathname }: URL): VideoRoute | undefined {
	const route = directCompletions.find(
		({ endpoint, model }) => endpoint.test(hostname + pathname) && model.test(id),
	);
	return (
		route && { wire: "completions", maxRequestBytes: route.maxRequestBytes, formats: route.formats }
	);
}

function minimaxRoute(id: string, { hostname, pathname }: URL): VideoRoute | undefined {
	return (hostname === "api.minimax.io" || hostname === "api.minimaxi.com") &&
		/^\/anthropic\/?$/u.test(pathname) &&
		/^minimax-m3(?:\.1-flash)?$/iu.test(id)
		? { wire: "minimax", maxRequestBytes: 64 * MB, formats: minimaxFormats }
		: undefined;
}
