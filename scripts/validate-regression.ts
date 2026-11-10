#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { jsonField, jsonList, jsonNumber, jsonString, requireRecord } from "./test-harness.ts";

/** The validator inputs a regression case varies. */
type ValidatorInput = {
	manifest: Record<string, unknown>;
	settings: Record<string, unknown>;
	agreement: string;
};

/** Derives one regression case's inputs from the checked-in ones. */
type ValidatorChange = (base: ValidatorInput) => ValidatorInput;

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), "pi-kit-validator-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
cpSync(root, fixture, {
	recursive: true,
	filter: (path: string) => ![".git", "node_modules", ".dogfood"].includes(basename(path)),
});
/** Registered node:test cases; collected so the runner owns execution order. */
const suite: Array<Promise<unknown>> = [];

const baseManifest: Record<string, unknown> = requireRecord(
	JSON.parse(readFileSync(join(root, "setup-manifest.json"), "utf8")),
	"setup-manifest.json",
);
const baseSettings: Record<string, unknown> = requireRecord(
	JSON.parse(readFileSync(join(root, "examples/settings.json"), "utf8")),
	"examples/settings.json",
);
const agreementPath = jsonString(
	jsonField(baseManifest, "kitResources", "manifest kitResources").workingAgreementTemplate,
	"kitResources.workingAgreementTemplate",
);
const base: ValidatorInput = {
	manifest: baseManifest,
	settings: baseSettings,
	agreement: readFileSync(join(root, agreementPath), "utf8"),
};
const baseCompaction = jsonField(baseSettings, "compaction", "settings compaction");
const defaultRoute = `${jsonString(baseSettings.defaultProvider, "settings defaultProvider")}/${jsonString(baseSettings.defaultModel, "settings defaultModel")}`;

const validate = (change: ValidatorChange = (input) => input): SpawnSyncReturns<string> => {
	const input = change(base);
	writeFileSync(join(fixture, "setup-manifest.json"), JSON.stringify(input.manifest));
	writeFileSync(join(fixture, "examples/settings.json"), JSON.stringify(input.settings));
	writeFileSync(join(fixture, agreementPath), input.agreement);
	return spawnSync(process.execPath, [join(fixture, "scripts/validate.ts")], { encoding: "utf8" });
};

const rejects = (change: ValidatorChange, message: string): void => {
	const result = validate(change);
	assert.equal(result.status, 1, `validator must reject this input: ${result.stdout}`);
	assert.ok(result.stderr.includes(`Error: ${message}`), result.stderr);
	assert.ok(!result.stderr.includes("TypeError"), result.stderr);
};

const withWindow = (input: ValidatorInput, route: string, value: unknown): ValidatorInput => ({
	...input,
	manifest: {
		...input.manifest,
		modelContextWindows: {
			...jsonField(input.manifest, "modelContextWindows", "manifest modelContextWindows"),
			[route]: value,
		},
	},
});

const withSettings = (input: ValidatorInput, patch: Record<string, unknown>): ValidatorInput => ({
	...input,
	settings: { ...input.settings, ...patch },
});

const corePackage = (manifest: Record<string, unknown>, id: string): Record<string, unknown> =>
	requireRecord(
		jsonList(manifest.corePackages, "manifest corePackages")
			.map((entry) => requireRecord(entry, "core package"))
			.find((entry) => entry.id === id),
		`core package ${id}`,
	);

const withCoreSource = (input: ValidatorInput, id: string, source: string): ValidatorInput => {
	const manifest = structuredClone(input.manifest);
	corePackage(manifest, id).source = source;
	return { ...input, manifest };
};

suite.push(
	test("the checked-in policy passes and accepts another context budget", () => {
		assert.equal(validate().status, 0);
		const result = validate((input) => withWindow(input, defaultRoute, 600000));
		assert.equal(result.status, 0, result.stderr);
	}),
);

suite.push(
	test("context windows must be safe integers above the compaction reserve and recent tail", () => {
		const reserveAndRecent =
			jsonNumber(baseCompaction.reserveTokens, "compaction.reserveTokens") +
			jsonNumber(baseCompaction.keepRecentTokens, "compaction.keepRecentTokens");
		for (const value of [
			0,
			-1,
			320000.5,
			Number.MAX_SAFE_INTEGER + 1,
			"320000",
			null,
			reserveAndRecent,
		]) {
			rejects(
				(input) => withWindow(input, defaultRoute, value),
				`modelContextWindows value for ${defaultRoute} must be a safe integer exceeding the compaction reserve plus recent tokens`,
			);
		}
	}),
);

suite.push(
	test("the settings example may enable only manifest routes, including its default", () => {
		rejects(
			(input) =>
				withSettings(input, {
					enabledModels: [
						...jsonList(input.settings.enabledModels, "settings enabledModels"),
						"unmanaged/model",
					],
				}),
			"settings enabled model unmanaged/model must be a manifest model route",
		);
		rejects(
			(input) => withSettings(input, { defaultModel: "unmanaged" }),
			"settings default model must be enabled",
		);
		rejects(
			(input) => withSettings(input, { enabledModels: [] }),
			"settings default model must be enabled",
		);
	}),
);

for (const compaction of [undefined, null, {}, { keepRecentTokens: 30000 }]) {
	suite.push(
		test(`missing reserve (${JSON.stringify(compaction)}) has a useful diagnostic`, () => {
			rejects(
				(input) => withSettings(input, { compaction }),
				"compaction.reserveTokens must be a positive safe integer",
			);
		}),
	);
}

suite.push(
	test("missing recent-token setting has its own diagnostic", () => {
		rejects(
			(input) =>
				withSettings(input, { compaction: { reserveTokens: baseCompaction.reserveTokens } }),
			"compaction.keepRecentTokens must be a positive safe integer",
		);
	}),
);

suite.push(
	test("package sources must be unpinned, unique, and not retired", () => {
		for (const source of [
			"npm:@fitchmultz/pi-subagents@1.0.0",
			"git:github.com/fitchmultz/pi-subagents@v1",
			"https://github.com/fitchmultz/pi-subagents",
		]) {
			rejects(
				(input) => withCoreSource(input, "subagents", source),
				`corePackages subagents must use an unpinned npm or Git source: ${source}`,
			);
		}
		rejects(
			(input) => withCoreSource(input, "subagents", "git:github.com/fitchmultz/pi-intercom"),
			"corePackages subagents cannot also be retired",
		);
		const mcpSource = jsonString(corePackage(base.manifest, "mcp").source, "mcp source");
		rejects(
			(input) => withCoreSource(input, "subagents", mcpSource),
			`package source ${mcpSource} must be listed once`,
		);
	}),
);

suite.push(
	test("each manifest working-agreement section needs one complete managed block", () => {
		rejects(
			(input) => ({
				...input,
				agreement: input.agreement.replace("<!-- fitch-pi-kit:process:end -->", ""),
			}),
			"working-agreement template must contain one complete process block",
		);
		rejects(
			(input) => ({
				...input,
				agreement: `${input.agreement}\n<!-- fitch-pi-kit:baseline:start -->\n`,
			}),
			"working-agreement template must contain one complete baseline block",
		);
	}),
);
