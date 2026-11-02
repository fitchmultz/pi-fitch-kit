#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { jsonField, jsonList, jsonNumber, jsonString, requireRecord } from "./test-harness.ts";

/** The validator inputs a regression case mutates. */
type ValidatorInput = {
	manifest: Record<string, unknown>;
	settings: Record<string, unknown>;
	setupPrompt: string;
	agreement: string;
	hardReview: string;
};

/** Mutates the validator inputs for one regression case. */
type ValidatorChange = (input: ValidatorInput) => void;

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
const contentPaths = {
	setupPrompt: "prompts/fitch-setup.md",
	agreement: jsonString(
		jsonField(baseManifest, "kitResources", "manifest kitResources").workingAgreementTemplate,
		"kitResources.workingAgreementTemplate",
	),
	hardReview: "prompts/review/hard-review.md",
} as const;
const content: Record<keyof typeof contentPaths, string> = {
	setupPrompt: readFileSync(join(root, contentPaths.setupPrompt), "utf8"),
	agreement: readFileSync(join(root, contentPaths.agreement), "utf8"),
	hardReview: readFileSync(join(root, contentPaths.hardReview), "utf8"),
};

const contentKeys: Array<keyof typeof contentPaths> = ["setupPrompt", "agreement", "hardReview"];

const validate = (
	change: ValidatorChange = () => {
		return;
	},
): SpawnSyncReturns<string> => {
	const input: ValidatorInput = {
		manifest: structuredClone(baseManifest),
		settings: structuredClone(baseSettings),
		...content,
	};
	change(input);
	writeFileSync(join(fixture, "setup-manifest.json"), JSON.stringify(input.manifest));
	writeFileSync(join(fixture, "examples/settings.json"), JSON.stringify(input.settings));
	for (const key of contentKeys) {
		writeFileSync(join(fixture, contentPaths[key]), input[key]);
	}
	return spawnSync(process.execPath, [join(fixture, "scripts/validate.ts")], { encoding: "utf8" });
};

const rejects = (change: ValidatorChange, message: string): void => {
	const result = validate(change);
	assert.equal(result.status, 1, `validator must reject this input: ${result.stdout}`);
	assert.ok(result.stderr.includes(`Error: ${message}`), result.stderr);
	assert.ok(!result.stderr.includes("TypeError"), result.stderr);
};

suite.push(
	test("current policy passes and the manifest can select another context budget", () => {
		assert.equal(validate().status, 0);
		const result = validate((input) => {
			const manifest = input.manifest;
			jsonField(manifest, "modelContextWindows", "manifest modelContextWindows")[
				`${jsonString(baseSettings.defaultProvider, "settings defaultProvider")}/${jsonString(baseSettings.defaultModel, "settings defaultModel")}`
			] = 600000;
		});
		assert.equal(result.status, 0, result.stderr);
	}),
);

for (const route of Object.keys(
	jsonField(baseManifest, "modelContextWindows", "manifest modelContextWindows"),
)) {
	suite.push(
		test(`${route} rejects invalid or undersized context windows`, () => {
			for (const value of [
				0,
				-1,
				320000.5,
				Number.MAX_SAFE_INTEGER + 1,
				"320000",
				null,
				jsonNumber(
					jsonField(baseSettings, "compaction", "settings compaction").reserveTokens,
					"compaction.reserveTokens",
				) +
					jsonNumber(
						jsonField(baseSettings, "compaction", "settings compaction").keepRecentTokens,
						"compaction.keepRecentTokens",
					),
			]) {
				rejects((input) => {
					const manifest = input.manifest;
					jsonField(manifest, "modelContextWindows", "manifest modelContextWindows")[route] = value;
				}, `modelContextWindows value for ${route} must be a safe integer exceeding the compaction reserve plus recent tokens`);
			}
		}),
	);
}

suite.push(
	test("unmanaged routes remain invalid even at the correct window", () => {
		rejects((input) => {
			const manifest = input.manifest;
			jsonField(manifest, "modelContextWindows", "manifest modelContextWindows")[
				"unmanaged/model"
			] = 320000;
		}, "modelContextWindows route unmanaged/model must be a manifest-managed model route");
	}),
);

for (const compaction of [undefined, null, {}, { keepRecentTokens: 40000 }]) {
	suite.push(
		test(`missing reserve (${JSON.stringify(compaction)}) has a useful diagnostic`, () => {
			rejects((input) => {
				const settings = input.settings;
				settings.compaction = compaction;
			}, "compaction.reserveTokens must be a positive safe integer");
		}),
	);
}

suite.push(
	test("default model must remain the preferred required route and enabled", () => {
		rejects((input) => {
			const settings = input.settings;
			settings.defaultModel = "unmanaged";
		}, "settings default model must be the preferred route of a required entry");
		rejects((input) => {
			const settings = input.settings;
			settings.defaultProvider = "openai";
		}, "settings default model must be the preferred route of a required entry");
		rejects((input) => {
			const settings = input.settings;
			settings.enabledModels = [];
		}, "settings default model must be enabled");
	}),
);

suite.push(
	test("required models are ordered alternative lists", () => {
		rejects((input) => {
			const manifest = input.manifest;
			jsonList(manifest.requiredModels, "manifest requiredModels").push("openai/gpt-6-astra");
		}, "each requiredModels entry must be a non-empty ordered list of provider/model routes");
		rejects((input) => {
			const manifest = input.manifest;
			jsonList(manifest.requiredModels, "manifest requiredModels").push([]);
		}, "each requiredModels entry must be a non-empty ordered list of provider/model routes");
	}),
);

suite.push(
	test("core npm channels reject foreign, mismatched, and pinned identities", () => {
		const corePackageCases: Array<[string, string, string]> = [
			["subagents", "pi-subagents", "subagents must use the consolidated owned scoped npm source"],
			[
				"ask-question",
				"pi-ask-question",
				"ask-question must use the owned scoped npm source for the structured question tool",
			],
			[
				"verbosity",
				"pi-verbosity-control",
				"verbosity must use the owned scoped npm native-status controller",
			],
			["calculator", "pi-calculator", "calculator must use the owned scoped npm source"],
		];
		for (const [id, name, message] of corePackageCases) {
			for (const source of [
				`npm:${name}`,
				`npm:@other/${name}`,
				"npm:@fitchmultz/unrelated",
				`npm:@fitchmultz/${name}@1.0.0`,
			]) {
				let expected = message;
				if (source.endsWith("@1.0.0")) {
					expected = `corePackages ${id} must use an unpinned npm or Git source: ${source}`;
				} else if (source === "npm:pi-verbosity-control") {
					expected = "corePackages verbosity cannot also be retired";
				}
				rejects((input) => {
					const manifest = input.manifest;
					const pkg = jsonList(manifest.corePackages, "manifest corePackages").find(
						(entry) => requireRecord(entry, "core package").id === id,
					);
					if (pkg === undefined) {
						throw new Error(`missing core package: ${id}`);
					}
					requireRecord(pkg, "core package").source = source;
				}, expected);
			}
		}
	}),
);

suite.push(
	test("missing recent-token setting has its own diagnostic", () => {
		rejects((input) => {
			const settings = input.settings;
			delete jsonField(settings, "compaction", "settings compaction").keepRecentTokens;
		}, "compaction.keepRecentTokens must be a positive safe integer");
	}),
);

suite.push(
	test("setup content contracts reject sibling tree references and profile-gate identifiers", () => {
		rejects((input) => {
			const caseInput = input;
			caseInput.setupPrompt += "\n- Preview the installed `pi-subagents/agents/` directory.\n";
		}, "setup content must not reference a sibling profile tree");
		for (const gate of [
			"Require the `reviewer` profile for review.",
			"Complete a fresh reviewer-gpt review.",
		]) {
			rejects((input) => {
				const caseInput = input;
				caseInput.agreement = caseInput.agreement.replace(
					"<!-- fitch-pi-kit:process:end -->",
					`- ${gate}\n<!-- fitch-pi-kit:process:end -->`,
				);
			}, "managed process content must avoid code spans and reviewer-prefixed identifiers");
		}
	}),
);

suite.push(
	test("setup content does not pass an unknown running-runtime minimum", () => {
		for (const anchor of [
			"minimum versions against the running runtime",
			"minimum check as unverified rather than as passing",
		]) {
			rejects((input) => {
				const caseInput = input;
				caseInput.setupPrompt = caseInput.setupPrompt.replace(anchor, "");
			}, "setup must assess the running-runtime minimum without treating unknown as a pass");
		}
	}),
);

suite.push(
	test("setup content requires host-currency provenance and an unverified fallback", () => {
		for (const anchor of [
			"running session's channel and build provenance",
			"selected CLI may differ from the running session",
			"compare it with the current maintained build or revision",
			"matching version numbers do not establish identity or currency",
			"host currency as unverified",
			"current comparison target cannot be established",
		]) {
			rejects((input) => {
				const caseInput = input;
				caseInput.setupPrompt = caseInput.setupPrompt.replace(anchor, "");
			}, "setup must require channel/build provenance before confirming host currency");
		}
	}),
);

suite.push(
	test("hard-review content contracts reject either missing required model family", () => {
		for (const family of ["GPT-family", "Claude-family"]) {
			rejects((input) => {
				const caseInput = input;
				caseInput.hardReview = caseInput.hardReview.replaceAll(family, "other-family");
			}, "hard-review content must retain both GPT-family and Claude-family requirements");
		}
	}),
);
