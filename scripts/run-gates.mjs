#!/usr/bin/env node
// Canonical acceptance runner: execute every gate and aggregate the results
// so one failing gate cannot hide the outcome of the others.
import { spawnSync } from "node:child_process";

const testFiles = [
	"scripts/image-guard-smoke.mjs",
	"scripts/image-budget-regression.mjs",
	"scripts/clean-footer-regression.mjs",
	"scripts/fast-mode-regression.ts",
	"scripts/session-name-regression.ts",
	"scripts/session-name-boundary.mjs",
	"scripts/write-prompt-regression.ts",
	"scripts/write-prompt-boundary.mjs",
	"scripts/paged-reader-regression.ts",
	"scripts/setup-lifecycle-smoke.mjs",
	"scripts/validate.mjs",
	"scripts/validate-regression.mjs",
];

const gates = [
	{ name: "typecheck", command: ["tsc", "--noEmit"] },
	{ name: "format", command: ["oxfmt", "--check", "."] },
	{ name: "tests", command: ["node", "--test", ...testFiles] },
];

const failures = [];
for (const gate of gates) {
	console.log(`\n=== ${gate.name} ===`);
	const result = spawnSync(gate.command[0], gate.command.slice(1), {
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	if (result.status !== 0) failures.push(gate.name);
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
