#!/usr/bin/env node
// Structural checks: the manifest, package metadata, lockfile, settings example, and
// working-agreement template must agree with each other. Prose is reviewed, not asserted.
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	isRecord,
	jsonField,
	jsonList,
	jsonNumber,
	jsonString,
	jsonStrings,
	requireRecord,
} from "./test-harness.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** A parsed JSON document, kept unknown until a check establishes its shape. */
const jsonDocument = (path: string): Record<string, unknown> =>
	requireRecord(JSON.parse(readFileSync(join(root, path), "utf-8")), path);
const manifest = jsonDocument("setup-manifest.json");
const packageJson = jsonDocument("package.json");
const packageLock = jsonDocument("package-lock.json");
const settingsExample = jsonDocument(join("examples", "settings.json"));

const assert: (condition: boolean, message: string) => asserts condition = (condition, message) => {
	if (!condition) {
		throw new Error(message);
	}
};

assert(manifest.schemaVersion === 9, "setup manifest schema must be version 9");

// Runtime floors and package metadata.
const runtime = jsonField(manifest, "runtime", "manifest runtime");
assert(
	/^>=\d+\.\d+\.\d+$/.test(jsonString(runtime.pi, "runtime.pi")),
	"runtime.pi must be a >=x.y.z floor",
);
assert(
	jsonField(packageJson, "engines", "package engines").node === runtime.node,
	"package and manifest Node floors must match",
);
assert(
	typeof packageJson.version === "string" && /^\d+\.\d+\.\d+$/.test(packageJson.version),
	"package version must be a release version",
);
const lockPackages = jsonField(packageLock, "packages", "lockfile packages");
assert(
	packageLock.version === packageJson.version &&
		requireRecord(lockPackages[""], "lockfile root package").version === packageJson.version,
	"lockfile version must match package.json",
);
const resolvedOrigins = Object.values(lockPackages)
	.flatMap((entry) => {
		const resolved = requireRecord(entry, "lockfile entry").resolved;
		return typeof resolved === "string" ? [resolved] : [];
	})
	.map((resolved) => new URL(resolved).origin);
assert(resolvedOrigins.length > 0, "the lockfile must contain resolved package origins");
assert(
	resolvedOrigins.every((origin) => origin === "https://registry.npmjs.org"),
	`the public lockfile must use only the npm registry; found ${[...new Set(resolvedOrigins)].join(", ")}`,
);

// Pi packages: one exact development cohort, unversioned optional peers.
const devDependencies = jsonField(packageJson, "devDependencies", "package devDependencies");
const peerDependencies = jsonField(packageJson, "peerDependencies", "package peerDependencies");
const peerDependenciesMeta = jsonField(
	packageJson,
	"peerDependenciesMeta",
	"package peerDependenciesMeta",
);
for (const dependency of [
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
]) {
	const devVersion = devDependencies[dependency];
	assert(
		typeof devVersion === "string" && /^\d+\.\d+\.\d+$/.test(devVersion),
		`${dependency} must pin an exact Pi development baseline`,
	);
	assert(
		devVersion === devDependencies["@earendil-works/pi-coding-agent"],
		`${dependency} must use the coherent Pi development cohort`,
	);
	assert(peerDependencies[dependency] === "*", `${dependency} must remain an unversioned Pi peer`);
	const peerMeta = peerDependenciesMeta[dependency];
	assert(
		isRecord(peerMeta) && peerMeta.optional === true,
		`${dependency} must remain an optional Pi peer`,
	);
}
assert(
	runtime.pi === `>=${String(devDependencies["@earendil-works/pi-coding-agent"])}`,
	"manifest runtime.pi floor must match the locked @earendil-works/pi-coding-agent floor",
);

// Bundled resources: the manifest mirrors package.json#pi, and every file exists.
const piField = jsonField(packageJson, "pi", "package pi field");
const kitResources = jsonField(manifest, "kitResources", "manifest kitResources");
const resourceFiles: string[] = [
	jsonString(kitResources.workingAgreementTemplate, "kitResources.workingAgreementTemplate"),
	jsonString(kitResources.settingsExample, "kitResources.settingsExample"),
];
for (const kind of ["extensions", "prompts", "themes"]) {
	const paths = jsonStrings(kitResources[kind], `kitResources.${kind}`);
	assert(
		JSON.stringify(piField[kind]) === JSON.stringify(paths.map((path) => `./${path}`)),
		`package.json pi.${kind} must match manifest kitResources.${kind}`,
	);
	resourceFiles.push(...paths);
}
for (const resource of resourceFiles) {
	assert(
		lstatSync(join(root, resource), { throwIfNoEntry: false })?.isFile() === true,
		`manifest resource missing: ${resource}`,
	);
}

// Package sources: unpinned, unique, and never also retired.
const unpinnedSource = /^(?:npm:(?:@[\w.-]+\/)?[\w.-]+|git:github\.com\/[\w.-]+\/[\w.-]+)$/;
const retiredPackageSources = jsonStrings(manifest.retiredPackageSources, "retiredPackageSources");
for (const source of retiredPackageSources) {
	assert(unpinnedSource.test(source), `retiredPackageSources must list bare sources: ${source}`);
}
const seenIds = new Set<string>();
const seenSources = new Set<string>();
for (const group of ["corePackages", "optionalPackages"]) {
	for (const [index, entry] of jsonList(manifest[group], group).entries()) {
		const pkg = requireRecord(entry, `${group}[${index}]`);
		const id = jsonString(pkg.id, `${group}[${index}].id`);
		const source = jsonString(pkg.source, `${group} ${id} source`);
		assert(
			unpinnedSource.test(source),
			`${group} ${id} must use an unpinned npm or Git source: ${source}`,
		);
		assert(!retiredPackageSources.includes(source), `${group} ${id} cannot also be retired`);
		assert(!seenIds.has(id), `package id ${id} must be unique`);
		assert(!seenSources.has(source), `package source ${source} must be listed once`);
		seenIds.add(id);
		seenSources.add(source);
		assert(
			jsonString(pkg.provides, `${group} ${id} provides`).length > 0,
			`${group} ${id} must say what it provides`,
		);
	}
}
assert(seenIds.size > 0, "the manifest must list packages");

// Model routes: each window leaves room for the example's compaction reserve and recent tail.
const compaction = isRecord(settingsExample.compaction) ? settingsExample.compaction : {};
for (const key of ["reserveTokens", "keepRecentTokens"]) {
	const value = compaction[key];
	assert(
		typeof value === "number" && Number.isSafeInteger(value) && value > 0,
		`compaction.${key} must be a positive safe integer`,
	);
}
const minimumWindow =
	jsonNumber(compaction["reserveTokens"], "compaction.reserveTokens") +
	jsonNumber(compaction["keepRecentTokens"], "compaction.keepRecentTokens");
const modelContextWindows = jsonField(
	manifest,
	"modelContextWindows",
	"manifest modelContextWindows",
);
assert(Object.keys(modelContextWindows).length > 0, "manifest must carry modelContextWindows");
for (const [route, value] of Object.entries(modelContextWindows)) {
	assert(
		/^[^/]+\/.+$/.test(route),
		`modelContextWindows key ${route} must be a provider/model route`,
	);
	assert(
		typeof value === "number" && Number.isSafeInteger(value) && value > minimumWindow,
		`modelContextWindows value for ${route} must be a safe integer exceeding the compaction reserve plus recent tokens`,
	);
}

// Settings example: its models are manifest routes and its default is one of them.
const enabledModels = jsonStrings(settingsExample.enabledModels, "settings enabledModels");
assert(
	new Set(enabledModels).size === enabledModels.length,
	"settings enabledModels must be unique",
);
for (const route of enabledModels) {
	assert(
		modelContextWindows[route] !== undefined,
		`settings enabled model ${route} must be a manifest model route`,
	);
}
const defaultRoute = `${jsonString(settingsExample.defaultProvider, "settings defaultProvider")}/${jsonString(
	settingsExample.defaultModel,
	"settings defaultModel",
)}`;
assert(enabledModels.includes(defaultRoute), "settings default model must be enabled");
assert(
	["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
		jsonString(settingsExample.defaultThinkingLevel, "settings defaultThinkingLevel"),
	),
	"settings thinking level must be valid",
);

// Working agreement: one complete managed block per manifest section.
const agreement = readFileSync(
	join(
		root,
		jsonString(kitResources.workingAgreementTemplate, "kitResources.workingAgreementTemplate"),
	),
	"utf-8",
);
for (const section of jsonStrings(manifest.workingAgreementSections, "workingAgreementSections")) {
	const start = `<!-- fitch-pi-kit:${section}:start -->`;
	const end = `<!-- fitch-pi-kit:${section}:end -->`;
	assert(
		agreement.split(start).length === 2 &&
			agreement.split(end).length === 2 &&
			agreement.indexOf(start) < agreement.indexOf(end),
		`working-agreement template must contain one complete ${section} block`,
	);
}

console.log(JSON.stringify({ ok: true, manifestChecked: true }, null, 2));
