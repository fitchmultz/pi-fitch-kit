import { type ExtensionAPI, formatDimensionNote } from "@earendil-works/pi-coding-agent";
import {
	anthropicMimeType,
	type CachedImage,
	ImageGuardCache,
	type ImageModel,
	isBlockArray,
	isClaude,
	MAX_CONTEXT_IMAGE_BASE64_CHARS,
	MAX_IMAGE_BASE64_CHARS,
	type Resized,
	type ResizePool,
	resizePool,
	shareImageCache,
} from "./anthropic-image-core.ts";

export { sharedImageCache } from "./anthropic-image-core.ts";
export { fitClaudeRequest } from "./anthropic-image-fit.ts";

type ImagePart = { type: "image"; mimeType: string; data: string };
type ResizeJob = { image: ImagePart; mimeType: string; pending: Promise<Resized> };

const isImagePart = (part: unknown): part is ImagePart =>
	part !== null && typeof part === "object" && "type" in part && part.type === "image";

/** Tracks the request-wide encoded-image budget during newest-first admission. */
class ContextImageBudget {
	private chars = 0;

	admits(data: string): boolean {
		if (
			data.length > MAX_IMAGE_BASE64_CHARS ||
			this.chars + data.length > MAX_CONTEXT_IMAGE_BASE64_CHARS
		) {
			return false;
		}
		this.chars += data.length;
		return true;
	}
}

/** One part of a planned message: kept as-is, or a resize job to await. */
type PlannedPart = { kind: "kept"; part: unknown } | { kind: "job"; job: ResizeJob };

/** One message's rebuilt content plan. */
type MessagePlan = {
	message: { role?: string; content?: unknown };
	parts: PlannedPart[];
	changed: boolean;
};

/** Admission state shared across one request's captures. */
type Admission = {
	budget: ContextImageBudget;
	cache: ImageGuardCache;
	pool: ResizePool;
	// Snapshot of entry results so a miss evicted mid-request still reuses its resize.
	reusable: Map<string, CachedImage>;
};

const omission = (text: string): { type: "text"; text: string } => ({ type: "text", text });

/** Admits one image part or explains its omission. */
const admitImagePart = (
	part: ImagePart,
	admission: Admission,
): { planned: PlannedPart; omitted: boolean } => {
	const mimeType = anthropicMimeType(part.mimeType);
	if (mimeType === undefined) {
		return {
			planned: {
				kind: "kept",
				part: omission("[Image omitted: Anthropic does not support this image type.]"),
			},
			omitted: true,
		};
	}
	if (!admission.budget.admits(part.data)) {
		return {
			planned: {
				kind: "kept",
				part: omission(
					"[Image omitted: encoded source exceeds the Anthropic resize safety limit.]",
				),
			},
			omitted: true,
		};
	}
	const cached = admission.cache.entries.get(part.data) ?? admission.reusable.get(part.data);
	let pending: Promise<Resized>;
	if (cached?.mimeType === mimeType) {
		pending = cached.pending;
		admission.cache.set(part.data, cached);
	} else {
		pending = admission.pool.run(part.data, mimeType);
		admission.cache.set(part.data, { mimeType, pending, bytes: 2 * part.data.length + 512 });
	}
	return { planned: { kind: "job", job: { image: part, mimeType, pending } }, omitted: false };
};

/** Plans one message's rebuilt content, newest part first. */
const planMessage = (
	message: { role?: string; content?: unknown },
	admission: Admission,
): MessagePlan | undefined => {
	if (
		message.role === "assistant" ||
		!isBlockArray(message.content) ||
		!message.content.some(isImagePart)
	) {
		return undefined;
	}
	const plan: MessagePlan = { message, parts: [], changed: false };
	for (const part of message.content.toReversed()) {
		if (!isImagePart(part)) {
			plan.parts.push({ kind: "kept", part });
			continue;
		}
		const admitted = admitImagePart(part, admission);
		plan.parts.push(admitted.planned);
		plan.changed ||= admitted.omitted;
	}
	return plan;
};

/** Awaits one resize job and returns its replacement content parts. */
const resolveJob = async (
	job: ResizeJob,
	cache: ImageGuardCache,
): Promise<{ parts: unknown[]; changed: boolean }> => {
	const { image, mimeType, pending } = job;
	const resized = await pending;
	if (!resized) {
		if (cache.entries.get(image.data)?.pending === pending) {
			cache.delete(image.data);
		}
		return {
			parts: [
				omission("[Image omitted: could not be resized below Anthropic's inline image limits.]"),
			],
			changed: true,
		};
	}
	if (cache.entries.get(image.data)?.pending === pending) {
		// Native results own base64 strings even when unchanged. Budget both
		// strings conservatively as UTF-16, plus an entry/promise allowance.
		cache.set(image.data, {
			mimeType,
			pending,
			bytes: 2 * (image.data.length + resized.data.length) + 512,
		});
	}
	if (!resized.wasResized) {
		if (image.mimeType === resized.mimeType) {
			return { parts: [image], changed: false };
		}
		return { parts: [{ ...image, mimeType: resized.mimeType }], changed: true };
	}
	const note = formatDimensionNote(resized);
	const parts: unknown[] = [{ type: "image", data: resized.data, mimeType: resized.mimeType }];
	if (note !== undefined) {
		parts.push(omission(note));
	}
	return { parts, changed: true };
};

/** Awaits one message's resize jobs and builds its replacement content. */
const resolvePlan = async (
	plan: MessagePlan,
	cache: ImageGuardCache,
): Promise<{ content: unknown[]; changed: boolean } | undefined> => {
	let changed = plan.changed;
	const content: unknown[] = [];
	for (const planned of plan.parts) {
		if (planned.kind === "kept") {
			content.push(planned.part);
			continue;
		}
		const resolved = await resolveJob(planned.job, cache);
		content.push(...resolved.parts);
		changed ||= resolved.changed;
	}
	if (!changed) {
		return undefined;
	}
	return { content: content.reverse(), changed: true };
};

export async function prepareClaudeImages(
	model: ImageModel,
	messages: Array<{ role?: string; content?: unknown }>,
	cache: ImageGuardCache = new ImageGuardCache(),
): Promise<boolean> {
	// Anthropic's image limits follow the model, not one provider name:
	// Claude behind cloudflare-ai-gateway or github-copilot hits the same
	// constraints as the direct route. The wire API alone is too broad a
	// gate, though: vercel-ai-gateway, kimi-coding, minimax, and others
	// speak anthropic-messages for non-Claude models whose limits differ,
	// so require a Claude model on that API (vercel namespaces ids as
	// "anthropic/claude-...", hence includes, not startsWith).
	if (!isClaude(model)) {
		return false;
	}
	const admission: Admission = {
		budget: new ContextImageBudget(),
		cache,
		pool: resizePool(),
		reusable: new Map(cache.entries),
	};
	// Admission favors the newest captures; only the request copy is transformed.
	// Every miss starts before any result is awaited, so cold requests overlap workers.
	const plans: MessagePlan[] = [];
	for (const message of messages.toReversed()) {
		const plan = planMessage(message, admission);
		if (plan !== undefined) {
			plans.push(plan);
		}
	}
	let changed = false;
	for (const plan of plans) {
		const resolved = await resolvePlan(plan, cache);
		if (resolved?.changed === true) {
			plan.message.content = resolved.content;
			changed = true;
		}
	}
	return changed;
}

export default function anthropicImageGuard(pi: ExtensionAPI): void {
	// A fresh instance per load keeps reloaded code from inheriting an older cache shape.
	const cache = new ImageGuardCache();
	shareImageCache(cache);
	const clearCache = () => cache.clear();
	pi.on("session_start", clearCache);
	pi.on("session_compact", clearCache);

	pi.on("context", async (event, ctx) => {
		if (await prepareClaudeImages(ctx.model, event.messages, cache)) {
			return { messages: event.messages };
		}
		return;
	});
}
