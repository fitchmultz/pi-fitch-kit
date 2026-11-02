#!/usr/bin/env node
// Canonical acceptance runner: execute every gate and aggregate the results
// so one failing gate cannot hide the outcome of the others.
import { spawnSync } from "node:child_process";

const testFiles = [
	"scripts/image-guard-smoke.ts",
	"scripts/image-budget-regression.ts",
	"scripts/clean-footer-regression.ts",
	"scripts/fast-mode-regression.ts",
	"scripts/session-name-regression.ts",
	"scripts/session-name-boundary.ts",
	"scripts/write-prompt-regression.ts",
	"scripts/write-prompt-boundary.ts",
	"scripts/paged-reader-regression.ts",
	"scripts/setup-lifecycle-smoke.ts",
	"scripts/validate.ts",
	"scripts/validate-regression.ts",
] as const;

/** One acceptance gate and the command that runs it. */
type Gate = { name: string; command: readonly string[] };

const gates: readonly Gate[] = [
	{ name: "typecheck", command: ["tsc", "--noEmit"] },
	{ name: "format", command: ["oxfmt", "--check", "."] },
	{ name: "tests", command: ["node", "--test", ...testFiles] },
];

const failures: string[] = [];
for (const gate of gates) {
	console.log(`\n=== ${gate.name} ===`);
	const [command, ...args] = gate.command;
	if (command === undefined) {
		continue;
	}
	const result = spawnSync(command, args, {
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	if (result.status !== 0) {
		failures.push(gate.name);
	}
}

console.log("\n=== summary ===");
for (const gate of gates) {
	const status = failures.includes(gate.name) ? "FAIL" : "pass";
	console.log(`${gate.name}: ${status}`);
}
if (failures.length > 0) {
	console.error(`failed gates: ${failures.join(", ")}`);
	process.exit(1);
}
