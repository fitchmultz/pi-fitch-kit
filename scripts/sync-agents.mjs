#!/usr/bin/env node
import { lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "agents");

function stat(path) {
	try {
		return lstatSync(path);
	} catch (error) {
		if (error?.code === "ENOENT") return undefined;
		throw error;
	}
}

export function syncAgents(agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent")) {
	const targetDir = join(agentDir, "agents");
	mkdirSync(targetDir, { recursive: true });

	const created = [];
	const unchanged = [];
	const skipped = [];
	const sourceNames = readdirSync(sourceDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".chain.md")))
		.map((entry) => entry.name)
		.sort();

	for (const name of sourceNames) {
		const source = join(sourceDir, name);
		const target = join(targetDir, basename(name));
		let handled = false;
		for (let attempt = 0; attempt < 3; attempt++) {
			const current = stat(target);
			if (!current) {
				try {
					symlinkSync(source, target);
					created.push(target);
					handled = true;
					break;
				} catch (error) {
					if (error?.code === "EEXIST") continue;
					throw error;
				}
			}
			if (!current.isSymbolicLink()) {
				skipped.push({ path: target, reason: "non-symlink" });
				handled = true;
				break;
			}
			try {
				const link = resolve(dirname(target), readlinkSync(target));
				if (link === source) unchanged.push(target);
				else skipped.push({ path: target, reason: "foreign-symlink", target: link });
				handled = true;
				break;
			} catch (error) {
				if (error?.code === "ENOENT") continue;
				throw error;
			}
		}
		if (!handled) skipped.push({ path: target, reason: "concurrent-change" });
	}

	return { created, unchanged, skipped };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	console.log(JSON.stringify(syncAgents(), null, 2));
}
