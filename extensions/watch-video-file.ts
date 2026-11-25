import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { buffer } from "node:stream/consumers";
import { fileTypeFromBuffer } from "file-type";
import type { VideoFormat, VideoRoute } from "./watch-video-routes.ts";

const videoMimes = {
	mp4: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	mpeg: "video/mpeg",
	avi: "video/x-msvideo",
	mkv: "video/x-matroska",
	wmv: "video/x-ms-wmv",
	"3gp": "video/3gpp",
	flv: "video/x-flv",
} satisfies Record<VideoFormat, string>;

export type VideoFile = {
	bytes: Buffer;
	format: VideoFormat;
	mimeType: string;
};

type ReadVideoRequest = {
	path: string;
	cwd: string;
	route: VideoRoute;
	question: string;
	signal: AbortSignal | undefined;
};

const isVideoFormat = (value: string): value is VideoFormat => Object.hasOwn(videoMimes, value);
function canonicalFormat(value: string): string {
	switch (value) {
		case "m4v":
			return "mp4";
		case "mpg":
			return "mpeg";
		default:
			return value;
	}
}

export function checkVideoBudget(size: number, overhead: number, limit: number): void {
	if (Math.ceil(size / 3) * 4 + overhead > limit) {
		const available = Math.max(0, Math.floor((limit - overhead) / 4) * 3);
		throw new Error(
			`This video is ${size.toLocaleString("en-US")} bytes; the selected route can fit at most ` +
				`${available.toLocaleString("en-US")} file bytes inline for this request. Trim or compress the video and try again.`,
		);
	}
}

function videoFormatForPath(path: string, formats: readonly VideoFormat[]): VideoFormat {
	const format = canonicalFormat(extname(path).slice(1).toLowerCase());
	if (!isVideoFormat(format)) {
		throw new Error(
			"Use a video file with an MP4/M4V, MOV, WebM, MPEG/MPG, AVI, MKV, WMV, 3GP, or FLV extension.",
		);
	}
	if (!formats.includes(format)) {
		throw new Error(`This route does not accept .${format} inline. Use ${formats.join(", ")}.`);
	}
	return format;
}

async function matchesFormat(bytes: Buffer, format: VideoFormat): Promise<boolean> {
	const detected = await fileTypeFromBuffer(bytes);
	const detectedFormat =
		detected?.mime === "video/x-ms-asf" ? "wmv" : canonicalFormat(detected?.ext ?? "");
	return detectedFormat === format;
}

/** Validate and read a single bounded file from one descriptor. */
export async function readVideo({
	path,
	cwd,
	route,
	question,
	signal,
}: ReadVideoRequest): Promise<VideoFile> {
	const resolvedPath = resolve(cwd, path.replace(/^~(?=\/|$)/u, homedir()));
	const format = videoFormatForPath(resolvedPath, route.formats);

	const file = await open(resolvedPath, constants.O_RDONLY | constants.O_NONBLOCK);
	try {
		const info = await file.stat();
		if (!info.isFile() || info.size === 0) {
			throw new Error("The path must point to a non-empty, readable video file.");
		}
		checkVideoBudget(info.size, Buffer.byteLength(JSON.stringify(question)), route.maxRequestBytes);
		signal?.throwIfAborted();
		const bytes = await buffer(
			file.createReadStream({
				start: 0,
				end: info.size - 1,
				autoClose: false,
				...(signal === undefined ? {} : { signal }),
			}),
		);
		if (bytes.length !== info.size || !(await matchesFormat(bytes, format))) {
			throw new Error(
				`The file contents do not match .${format}. Check the file or export the video again.`,
			);
		}
		return { bytes, format, mimeType: videoMimes[format] };
	} finally {
		await file.close();
	}
}
