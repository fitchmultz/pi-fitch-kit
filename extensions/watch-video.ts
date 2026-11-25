import { contentText, type Api, type Model } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ModelRegistry,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readVideo, type VideoFile } from "./watch-video-file.ts";
import { injectVideo } from "./watch-video-payload.ts";
import { resolveVideoRoute, type VideoRoute } from "./watch-video-routes.ts";

const name = "watch_video";
const questionDefault =
	"Describe the video concisely in chronological order with timestamps. Include visual scenes, on-screen text, and any audio or speech you can identify.";
const parameters = Type.Object({
	path: Type.String({
		description:
			"Path to a local video file, relative to the working directory or absolute (~ is supported).",
	}),
	question: Type.Optional(
		Type.String({
			description: "What to look for. Defaults to a timestamped summary of the video and audio.",
		}),
	),
});

// ExtensionContext provides Pi's registry model with an untyped API parameter.
const hasModelApi = (model: ExtensionContext["model"]): model is Model<Api> =>
	typeof model?.api === "string";

type VideoCompletion = {
	registry: ModelRegistry;
	model: Model<Api>;
	route: VideoRoute;
	video: VideoFile;
	question: string;
	signal: AbortSignal | undefined;
};

async function completeVideo({
	registry,
	model,
	route,
	video,
	question,
	signal,
}: VideoCompletion): Promise<string> {
	const injection: { attached?: true; error?: Error } = {};
	const response = await registry
		.streamSimple(
			model,
			{
				messages: [
					{ role: "user", content: [{ type: "text", text: question }], timestamp: Date.now() },
				],
			},
			{
				cacheRetention: "none",
				...(signal === undefined ? {} : { signal }),
				onPayload(payload) {
					try {
						const request = injectVideo(payload, route, video);
						injection.attached = true;
						return request;
					} catch (error) {
						if (error instanceof Error) {
							injection.error = error;
						}
						throw error;
					}
				},
			},
		)
		.result();
	if (injection.error !== undefined) {
		throw injection.error;
	}
	signal?.throwIfAborted();
	if (response.stopReason !== "stop" || injection.attached !== true) {
		// A provider's raw error can include the rejected request, including its media.
		throw new Error(
			`Video analysis failed on ${model.provider}/${model.id} (${response.stopReason}). Check this route's access and video limits.`,
		);
	}
	const answer = contentText(response.content).trim();
	if (answer === "") {
		throw new Error("The model returned no video analysis text.");
	}
	return answer;
}

const tool: ToolDefinition<typeof parameters> = {
	name,
	label: "Watch video",
	description:
		"Ask the active model to analyze a local video with native video input. Returns text only.",
	parameters,
	// oxlint-disable-next-line eslint/max-params -- QX-001: Pi's documented five-parameter tool execute callback.
	async execute(_toolCallId, { path, question }, signal, _onUpdate, ctx) {
		const { model } = ctx;
		const route = resolveVideoRoute(model);
		if (!hasModelApi(model) || route === undefined) {
			throw new Error(
				"The active model route does not support native video. Select a video-capable route first.",
			);
		}
		const requested = question?.trim() ?? "";
		const prompt = requested === "" ? questionDefault : requested;
		const video = await readVideo({ path, cwd: ctx.cwd, route, question: prompt, signal });
		const answer = await completeVideo({
			registry: ctx.modelRegistry,
			model,
			route,
			video,
			question: prompt,
			signal,
		});
		return {
			content: [{ type: "text", text: answer }],
			details: {
				bytes: video.bytes.length,
				mimeType: video.mimeType,
				model: `${model.provider}/${model.id}`,
			},
		};
	},
};

export default function watchVideo(pi: ExtensionAPI): void {
	let exposure: "hidden" | "direct" = "hidden";
	pi.registerTool({ ...tool, exposure });
	const reconcile = (model: ExtensionContext["model"]): void => {
		const next = resolveVideoRoute(model) === undefined ? "hidden" : "direct";
		if (next === exposure) {
			return;
		}
		const others = pi.getActiveTools().filter((active) => active !== name);
		exposure = next;
		pi.registerTool({ ...tool, exposure });
		const active = pi.getActiveTools();
		const intended = active.includes(name) && next === "direct" ? [...others, name] : others;
		if (active.length !== intended.length || active.some((item) => !intended.includes(item))) {
			pi.setActiveTools(intended);
		}
	};
	const reconcileContext = (_event: unknown, ctx: ExtensionContext): void => reconcile(ctx.model);
	pi.on("session_start", reconcileContext);
	pi.on("model_select", reconcileContext);
	pi.on("before_agent_start", reconcileContext);
}
