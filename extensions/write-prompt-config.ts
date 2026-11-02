import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Api, clampThinkingLevel, type Message, type Model } from "@earendil-works/pi-ai";
import {
	buildSessionContext,
	convertToLlm,
	type ExtensionAPI,
	type ExtensionCommandContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";

export const WRITE_PROMPT_FILE = "write-prompt.json";

export type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
const THINKING_LEVELS: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

type WriterConfig = {
	provider?: string | undefined;
	model?: string | undefined;
	thinkingLevel?: ThinkingLevel | undefined;
};

/** First defined value, for provider/model fallback chains. */
const firstDefined = (values: readonly (string | undefined)[]): string | undefined =>
	values.find((value) => value !== undefined);

export function parseModelRef(ref: string): { provider: string; id: string } | undefined {
	const trimmed = ref.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) {
		return undefined;
	}
	return { provider: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
}

/** Reads one field's value, undefined when absent. */
const readField = (fields: object, key: "provider" | "model" | "thinkingLevel"): unknown => {
	if (key === "provider" && "provider" in fields) {
		return fields.provider;
	}
	if (key === "model" && "model" in fields) {
		return fields.model;
	}
	if (key === "thinkingLevel" && "thinkingLevel" in fields) {
		return fields.thinkingLevel;
	}
	return undefined;
};

/** Reads one optional non-empty string field, or undefined when absent. */
const stringField = (fields: object, key: "provider" | "model"): string | undefined => {
	const text = readField(fields, key);
	if (text === undefined) {
		return undefined;
	}
	if (typeof text !== "string" || text.trim() === "") {
		throw new Error(`${key} must be a non-empty string`);
	}
	return text.trim();
};

/** Reads the optional thinkingLevel field, or undefined when absent. */
const thinkingField = (fields: object): ThinkingLevel | undefined => {
	if (!("thinkingLevel" in fields)) {
		return undefined;
	}
	const level = THINKING_LEVELS.find((candidate) => candidate === fields.thinkingLevel);
	if (level === undefined) {
		throw new Error(`thinkingLevel must be one of: ${THINKING_LEVELS.join(", ")}`);
	}
	return level;
};

/** Rejects unknown fields so typos surface instead of silently overriding nothing. */
const allowOnlyFields = (value: object, allowed: readonly string[]): void => {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) {
			throw new Error(`Unknown field: ${key}`);
		}
	}
};

function configuredWriter(raw: string): WriterConfig {
	const value: unknown = JSON.parse(raw);
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Expected an object with optional provider, model, and thinkingLevel fields");
	}
	allowOnlyFields(value, ["provider", "model", "thinkingLevel"]);
	return {
		provider: stringField(value, "provider"),
		model: stringField(value, "model"),
		thinkingLevel: thinkingField(value),
	};
}

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
	typeof error === "object" && error !== null && "code" in error && typeof error.code === "string";

function readWriterConfig(): WriterConfig {
	try {
		return configuredWriter(readFileSync(join(getAgentDir(), WRITE_PROMPT_FILE), "utf8"));
	} catch (error) {
		if (isErrnoException(error) && error.code === "ENOENT") {
			return {};
		}
		throw error;
	}
}

/** The resolved writer model and thinking level for one command run. */
export type ResolvedWriter = {
	model: Model<Api>;
	thinkingLevel: ThinkingLevel;
};

/** Recognizes the session's registry model; the command context types it as Model<any>. */
const isRegistryModel = (value: unknown): value is Model<Api> =>
	typeof value === "object" && value !== null && "provider" in value && "id" in value;

/** The provider/id a config override names, legacy "provider/id" model refs included. */
function overrideTarget(
	config: WriterConfig,
	ctx: ExtensionCommandContext,
): { provider: string; id: string } {
	const ref = config.provider === undefined ? parseModelRef(config.model ?? "") : undefined;
	const provider = firstDefined([config.provider, ref?.provider, ctx.model?.provider]);
	const id = firstDefined([ref?.id, config.model, ctx.model?.id]);
	if (provider === undefined || id === undefined) {
		throw new Error("Set both provider and model when no session model is selected");
	}
	return { provider, id };
}

/** Picks the configured override model or the session model. */
function selectModel(config: WriterConfig, ctx: ExtensionCommandContext): ResolvedWriter["model"] {
	if (config.provider === undefined && config.model === undefined) {
		if (!isRegistryModel(ctx.model)) {
			throw new Error("No model selected");
		}
		return ctx.model;
	}
	const { provider, id } = overrideTarget(config, ctx);
	const model = ctx.modelRegistry.find(provider, id);
	if (model === undefined) {
		throw new Error(`Unknown model: ${provider}/${id}`);
	}
	if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
		throw new Error(`No auth for ${model.provider}/${model.id}; configure it with /login`);
	}
	return model;
}

/** Resolves the configured or session writer model, notifying the user on problems. */
export function resolveWriter(
	ctx: ExtensionCommandContext,
	sessionThinking: ThinkingLevel,
): ResolvedWriter | undefined {
	try {
		const config = readWriterConfig();
		const model = selectModel(config, ctx);
		const requested = config.thinkingLevel ?? sessionThinking;
		const thinkingLevel = clampThinkingLevel(model, requested);
		if (thinkingLevel !== requested) {
			ctx.ui.notify(
				`${model.provider}/${model.id} does not support ${requested} thinking; using ${thinkingLevel}`,
				"warning",
			);
		}
		const override = config.provider !== undefined || config.model !== undefined;
		if (override || config.thinkingLevel !== undefined) {
			ctx.ui.notify(`Using ${model.provider}/${model.id} (${thinkingLevel} thinking)`, "info");
		}
		return { model, thinkingLevel };
	} catch (error) {
		ctx.ui.notify(
			`${WRITE_PROMPT_FILE}: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return undefined;
	}
}

/** The saved draft entry for one rewrite command, newest first. */
export function savedDraft(
	ctx: ExtensionCommandContext,
	customType: string,
): { source: string; draft: string } | undefined {
	for (const entry of ctx.sessionManager.getBranch().toReversed()) {
		if (entry.type !== "custom" || entry.customType !== customType) {
			continue;
		}
		const data: unknown = entry.data;
		if (
			typeof data === "object" &&
			data !== null &&
			"source" in data &&
			"draft" in data &&
			typeof data.source === "string" &&
			typeof data.draft === "string"
		) {
			return { source: data.source, draft: data.draft };
		}
	}
	return undefined;
}

export function sessionPrefix(ctx: ExtensionCommandContext): Message[] {
	return convertToLlm(
		buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages,
	);
}

// One provider session per Pi session keeps prompt-cache affinity and accounting
// across writer commands. A custom session ID can name unrelated sessions in other
// projects or in-memory runs, so hash it with the persisted header's cwd and
// creation time: resume and cwd overrides keep the result, new and forked sessions
// change it. Hashing keeps writer traffic out of the main agent's provider session,
// and the fixed-length UUID survives native 64-character cache-key clamping.
export function writerSessionId(ctx: ExtensionCommandContext): string {
	const header = ctx.sessionManager.getHeader();
	const session = JSON.stringify([
		"fitch-kit.writer",
		ctx.sessionManager.getSessionId(),
		header?.cwd,
		header?.timestamp,
	]);
	const bytes = createHash("sha256").update(session).digest();
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex", 0, 16);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
