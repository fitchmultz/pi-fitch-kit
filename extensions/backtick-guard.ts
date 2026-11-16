import {
	type ExtensionAPI,
	isToolCallEventType,
	type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { createSourceIndex, parse, walk } from "sh-syntax";

// Longest substitution text quoted in a refusal; a span between two stray backticks can be long.
const MAX_QUOTED_CHARS = 80;

const ADVICE =
	"Nothing ran. For a real substitution write $(...). To pass text that contains backticks, put the text in a file (a quoted heredoc, <<'EOF', keeps backticks literal) and pass the file, for example with --body-file.";

/** The command of a call that hands one to the shell. */
const shellCommand = (event: ToolCallEvent): string | undefined => {
	if (isToolCallEventType("bash", event)) {
		return event.input.command;
	}
	// Fitch Pi's detached shell tool. Its status and cancel calls carry no command.
	if (
		isToolCallEventType<"background_command", { command?: unknown }>("background_command", event) &&
		typeof event.input.command === "string"
	) {
		return event.input.command;
	}
	return undefined;
};

/** The source text of each backtick command substitution that bash would run. */
const backtickSubstitutions = async (command: string): Promise<string[]> => {
	const file = await parse(command);
	const charIndex = createSourceIndex(command);
	const found: string[] = [];
	walk(file, (node) => {
		const runs = node.type === "CmdSubst" && node.backquotes;
		if (runs) {
			found.push(command.slice(charIndex(node.start), charIndex(node.end)));
		}
		// The text of an outer substitution already contains the ones nested in it.
		return !runs;
	});
	return found;
};

/** Why the shell must not run this command, or undefined when it may. */
const refusal = async (command: string): Promise<string | undefined> => {
	let substitutions: string[];
	try {
		substitutions = await backtickSubstitutions(command);
	} catch (error) {
		// Bash runs the lines before a syntax error, so an unread command is not a safe one.
		const message = error instanceof Error ? error.message : String(error);
		return `Blocked: unreadable command with a backtick. The bash parser stopped (${message}), so a backtick command substitution cannot be ruled out. ${ADVICE}`;
	}
	const [first, ...others] = substitutions;
	if (first === undefined) {
		return undefined;
	}
	const quoted =
		first.length > MAX_QUOTED_CHARS ? `${first.slice(0, MAX_QUOTED_CHARS).toWellFormed()}…` : first;
	const more = others.length > 0 ? ` (and ${others.length} more)` : "";
	return `Blocked: backtick command substitution. The shell would run ${quoted}${more} as a command and paste its output into this one. ${ADVICE}`;
};

/**
 * Refuses a shell tool call whose command contains a backtick command substitution.
 *
 * Text inside a double-quoted shell argument is still expanded, so a Markdown code span such as
 * `env` runs as a command and its output replaces the span. The mvdan/sh parser decides what bash
 * would run: backticks in single quotes, quoted heredocs, comments, and escapes pass.
 */
export default function backtickGuard(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event) => {
		const command = shellCommand(event);
		if (command === undefined || !command.includes("`")) {
			return;
		}
		const reason = await refusal(command);
		if (reason === undefined) {
			return;
		}
		return { block: true, reason };
	});
}
