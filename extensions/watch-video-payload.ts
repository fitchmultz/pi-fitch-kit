import { checkVideoBudget, type VideoFile } from "./watch-video-file.ts";
import type { VideoRoute } from "./watch-video-routes.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function appendToUserTurn(
	payload: unknown,
	shape: { turns: string; roleKey: string; userRole: string; parts: string },
	part: unknown,
): Record<string, unknown> {
	const turns = isRecord(payload) ? payload[shape.turns] : undefined;
	if (!isRecord(payload) || !Array.isArray(turns)) {
		throw new Error(
			"The selected Pi route did not serialize a video request in the expected format.",
		);
	}
	const index = turns.findLastIndex(
		(turn: unknown) => isRecord(turn) && turn[shape.roleKey] === shape.userRole,
	);
	const user: unknown = turns[index];
	const parts = isRecord(user) ? user[shape.parts] : undefined;
	if (!isRecord(user) || !Array.isArray(parts)) {
		throw new Error("The selected Pi route did not serialize a user content list for the video.");
	}
	const content: unknown[] = parts;
	return {
		...payload,
		[shape.turns]: turns.with(index, { ...user, [shape.parts]: [...content, part] }),
	};
}

function videoMime({ format, mimeType }: VideoFile, wire: VideoRoute["wire"]): string {
	if (format === "mov" && wire !== "converse") {
		return "video/mov";
	}
	if (wire === "generate-content" || wire === "interactions" || wire === "minimax") {
		if (format === "avi") {
			return "video/avi";
		}
		if (format === "wmv") {
			return "video/wmv";
		}
	}
	return mimeType;
}

/** Pi's provider hooks see SDK inputs, before translation to the HTTP request. */
export function injectVideo(
	payload: unknown,
	route: VideoRoute,
	video: VideoFile,
): Record<string, unknown> {
	const empty = appendVideo(payload, route, video, { data: "", bytes: "" });
	checkVideoBudget(
		video.bytes.length,
		Buffer.byteLength(JSON.stringify(empty)),
		route.maxRequestBytes,
	);
	const data = route.wire === "converse" ? "" : video.bytes.toString("base64");
	return appendVideo(payload, route, video, { data, bytes: video.bytes });
}

function appendVideo(
	payload: unknown,
	route: VideoRoute,
	video: VideoFile,
	{ data, bytes }: { data: string; bytes: Uint8Array | "" },
): Record<string, unknown> {
	const msg = { turns: "messages", roleKey: "role", userRole: "user", parts: "content" };
	const mime = videoMime(video, route.wire);
	switch (route.wire) {
		case "interactions": {
			const shape = { turns: "input", roleKey: "type", userRole: "user_input", parts: "content" };
			const part = {
				type: "video",
				mime_type: mime,
				data,
				...(route.agentic ? { processing: "agentic" } : {}),
			};
			return { ...appendToUserTurn(payload, shape, part), store: false };
		}
		case "generate-content": {
			const shape = { ...msg, turns: "contents", parts: "parts" };
			return appendToUserTurn(payload, shape, { inlineData: { mimeType: mime, data } });
		}
		case "converse": {
			const format = video.format === "3gp" ? "three_gp" : video.format;
			return appendToUserTurn(payload, msg, { video: { format, source: { bytes } } });
		}
		case "completions":
			return appendToUserTurn(payload, msg, {
				type: "video_url",
				video_url: { url: `data:${mime};base64,${data}` },
			});
		case "responses":
			return appendToUserTurn(
				payload,
				{ ...msg, turns: "input" },
				{ type: "input_video", video_url: `data:${mime};base64,${data}` },
			);
		case "minimax":
			return appendToUserTurn(payload, msg, {
				type: "video",
				source: { type: "base64", media_type: mime, data },
			});
	}
}
