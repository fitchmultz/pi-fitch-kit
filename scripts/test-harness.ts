import type {
	Extension,
	ExtensionToolContext,
	ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

/** A registered event handler as the loose callable a regression drives. */
export type DrivenHandler = (...args: unknown[]) => Promise<unknown>;

/** A registered slash command as the loose callable a regression drives. */
export type DrivenCommand = {
	handler: (args: string, ctx: unknown) => Promise<void>;
};

/** A registered tool as the loose callable a regression drives; call sites
 * pass the same (toolCallId, args, signal, onUpdate, ctx) shape Pi uses. */
export type DrivenTool = {
	execute: (...args: unknown[]) => Promise<unknown>;
};

/** A resolved-later gate for sequencing assertions. */
export const gate = (): { promise: Promise<void>; open: () => void } => {
	let open: () => void = () => {
		throw new Error("gate opened before construction");
	};
	const promise = new Promise<void>((resolve) => {
		open = () => {
			resolve();
		};
	});
	return { promise, open };
};

/** The value as a string-keyed record, failing loudly with the label when not. */
export const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
	if (!isRecord(value)) {
		throw new Error(`expected ${label} to be an object`);
	}
	return value;
};

/** A JSON array, failing loudly with its label when the value is not one. */
export const jsonList = (value: unknown, label: string): unknown[] => {
	if (!Array.isArray(value)) {
		throw new Error(`expected ${label} to be an array`);
	}
	return value;
};

/** A JSON string, failing loudly with its label when the value is not one. */
export const jsonString = (value: unknown, label: string): string => {
	if (typeof value !== "string") {
		throw new Error(`expected ${label} to be a string`);
	}
	return value;
};

/** A JSON number, failing loudly with its label when the value is not one. */
export const jsonNumber = (value: unknown, label: string): number => {
	if (typeof value !== "number") {
		throw new Error(`expected ${label} to be a number`);
	}
	return value;
};

/** A JSON array of strings, failing loudly with its label on any non-string item. */
export const jsonStrings = (value: unknown, label: string): string[] =>
	jsonList(value, label).map((item, index) => jsonString(item, `${label}[${index}]`));

/** A JSON object field, failing loudly when the field is not an object. */
export const jsonField = (
	record: Record<string, unknown>,
	key: string,
	label: string,
): Record<string, unknown> => requireRecord(record[key], label);

/** True when the value is a plain string-keyed record. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The sole loaded extension, failing loudly when the load did not produce one. */
export const soleExtension = (loaded: { extensions: Extension[] }): Extension => {
	const extension = loaded.extensions[0];
	if (extension === undefined) {
		throw new Error("expected exactly one loaded extension");
	}
	return extension;
};

/** The handlers of a loaded extension, keyed by event name. */
export const drivenHandlers = (extension: Extension): Record<string, DrivenHandler[]> =>
	Object.fromEntries(extension.handlers);

/* oxlint-disable typescript/no-unsafe-type-assertion -- QX-002: Pi's command and tool contexts
 * are structurally complete or nominal (ModelRegistry's private runtime), so unit-style
 * regressions drive them with deliberate partial fixtures. The narrowing casts live only in
 * this module; scripts pass raw partial objects instead of casting at call sites. */

/** The commands of a loaded extension, keyed by command name. */
export const drivenCommands = (extension: Extension): Record<string, DrivenCommand> =>
	Object.fromEntries(extension.commands) as unknown as Record<string, DrivenCommand>;

/** A partial Pi tool-execute context fixture carrying only the confirm UI a
 * tool reads; executed paths must not touch the remaining members. */
export const toolContext = (ui?: Pick<ExtensionUIContext, "confirm">): ExtensionToolContext =>
	(ui === undefined ? {} : { hasUI: true, ui }) as unknown as ExtensionToolContext;

/** A richer partial tool-execute context fixture a regression builds itself. */
export const toolContextFrom = (fixture: Record<string, unknown>): ExtensionToolContext =>
	fixture as unknown as ExtensionToolContext;

/** The tool definition registered under one name, as a loose callable. */
export const toolFor = (extension: Extension, name: string): DrivenTool => {
	const tool = [...extension.tools.values()].find(
		({ definition }) => definition.name === name,
	)?.definition;
	if (tool === undefined) {
		throw new Error(`missing tool registration: ${name}`);
	}
	return { execute: tool.execute.bind(tool) } as unknown as DrivenTool;
};

/* oxlint-enable typescript/no-unsafe-type-assertion */

/** The sole handler registered for one event, failing loudly when absent. */
export const handlerFor = (
	handlers: Record<string, DrivenHandler[]>,
	name: string,
): DrivenHandler => {
	const handler = handlers[name]?.[0];
	if (handler === undefined) {
		throw new Error(`missing handler registration: ${name}`);
	}
	return handler;
};

/** The command registered under one name, failing loudly when absent. */
export const commandFor = (
	commands: Record<string, DrivenCommand>,
	name: string,
): DrivenCommand => {
	const command = commands[name];
	if (command === undefined) {
		throw new Error(`missing command registration: ${name}`);
	}
	return command;
};
