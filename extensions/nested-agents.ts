import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	hasTrustRequiringProjectResources,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

export default function nestedAgents(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async (event, ctx) => {
		const cwd = event.systemPromptOptions?.cwd ?? ctx.cwd;
		if (!hasTrustRequiringProjectResources(cwd) || !ctx.isProjectTrusted()) return;
		const file = resolve(cwd, CONFIG_DIR_NAME, "agent", "AGENTS.md");
		const loaded = new Set((event.systemPromptOptions?.contextFiles ?? []).map(({ path }) => resolve(path)));
		loaded.add(resolve(getAgentDir(), "AGENTS.md"));
		if (loaded.has(file)) return;

		let extra: string;
		try {
			extra = readFileSync(file, "utf8").trim();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		if (!extra) return;

		// ponytail: re-read every turn so edits take effect without a reload.
		return { systemPrompt: `${event.systemPrompt}\n\n${extra}\n` };
	});
}
