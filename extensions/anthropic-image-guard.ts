import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatDimensionNote, resizeImage } from "@earendil-works/pi-coding-agent";

export default function anthropicImageGuard(pi: ExtensionAPI): void {
	const cache = new Map<string, ReturnType<typeof resizeImage>>();
	pi.on("session_start", () => cache.clear());

	pi.on("context", async (event, ctx) => {
		if (ctx.model?.provider !== "anthropic") return;

		let changed = false;
		for (const message of event.messages) {
			if (message.role === "assistant" || typeof message.content === "string") continue;

			let messageChanged = false;
			const content: typeof message.content = [];
			for (const part of message.content) {
				if (part.type !== "image") {
					content.push(part);
					continue;
				}

				let pending = cache.get(part.data);
				if (!pending) {
					pending = resizeImage(Buffer.from(part.data, "base64"), part.mimeType).catch(() => null);
					cache.set(part.data, pending);
				}
				const resized = await pending;
				if (!resized) {
					content.push({
						type: "text",
						text: "[Image omitted: could not be resized below Anthropic's inline image limits.]",
					});
					messageChanged = true;
					continue;
				}
				if (!resized.wasResized) {
					content.push(part);
					continue;
				}

				const note = formatDimensionNote(resized);
				if (note) content.push({ type: "text", text: note });
				content.push({ type: "image", data: resized.data, mimeType: resized.mimeType });
				messageChanged = true;
			}

			if (messageChanged) {
				message.content = content;
				changed = true;
			}
		}

		if (changed) return { messages: event.messages };
	});
}
