import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const PATCH_EXECUTABLE = "/usr/bin/patch";
const stockRoot = join(
	packageRoot,
	"node_modules/@earendil-works/pi-coding-agent",
);
const applicator = join(
	packageRoot,
	"scripts/reapply-pi-core-compaction.mjs",
);
const fixtures = [];
process.on("exit", () => {
	for (const fixture of fixtures) {
		rmSync(fixture, { recursive: true, force: true });
	}
});

function stockFixture() {
	const root = mkdtempSync(join(tmpdir(), "pi-kit-applicator-"));
	fixtures.push(root);
	for (const relativePath of [
		"package.json",
		"dist/cli.js",
		"dist/core/agent-session.js",
		"dist/core/compaction/compaction.js",
		"dist/modes/interactive/interactive-mode.js",
		"node_modules/@earendil-works/pi-ai/dist/utils/retry.js",
	]) {
		const destination = join(root, relativePath);
		mkdirSync(dirname(destination), { recursive: true });
		copyFileSync(join(stockRoot, relativePath), destination);
	}
	return root;
}

{
	const root = stockFixture();
	const fakeBin = mkdtempSync(join(tmpdir(), "pi-kit-fake-patch-"));
	fixtures.push(fakeBin);
	const marker = join(fakeBin, "executed");
	const fakePatch = join(fakeBin, "patch");
	writeFileSync(
		fakePatch,
		`#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 0\n`,
	);
	chmodSync(fakePatch, 0o755);
	const result = spawnSync(
		process.execPath,
		[applicator, "apply", "--pi-root", root],
		{
			encoding: "utf8",
			env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
		},
	);
	assert.equal(
		existsSync(marker),
		false,
		"the applicator must not execute an untrusted patch from PATH",
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
}

{
	const root = stockFixture();
	const lockPath = join(root, ".pi-fitch-kit.lock");
	writeFileSync(lockPath, `${process.pid}\n`);
	const result = spawnSync(
		process.execPath,
		[applicator, "apply", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.notEqual(result.status, 0, "an active operation lock must block apply");
	assert.match(
		result.stderr,
		/operation already in progress/i,
		"the lock failure must identify the active operation",
	);
}

{
	const root = stockFixture();
	const external = mkdtempSync(join(tmpdir(), "pi-kit-external-core-"));
	fixtures.push(external);
	mkdirSync(join(external, "compaction"));
	copyFileSync(
		join(root, "dist/core/agent-session.js"),
		join(external, "agent-session.js"),
	);
	copyFileSync(
		join(root, "dist/core/compaction/compaction.js"),
		join(external, "compaction/compaction.js"),
	);
	rmSync(join(root, "dist/core"), { recursive: true });
	symlinkSync(external, join(root, "dist/core"));
	const result = spawnSync(
		process.execPath,
		[applicator, "apply", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.notEqual(result.status, 0, "a symlinked mutable path must be refused");
	assert.match(result.stderr, /symlink/i);
}

{
	const root = stockFixture();
	for (const action of ["apply", "restore"]) {
		const result = spawnSync(
			process.execPath,
			[applicator, action, "--pi-root", root],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	writeFileSync(
		join(
			root,
			".pi-fitch-kit-backup/pi-0.84.1-compaction/dist/core/agent-session.js",
		),
		"corrupt\n",
	);
	const result = spawnSync(
		process.execPath,
		[applicator, "status", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.notEqual(result.status, 0, "status must reject a corrupt stock backup");
	assert.match(result.stderr, /Backup preimage mismatch/);
}

{
	const root = stockFixture();
	let result = spawnSync(
		process.execPath,
		[applicator, "apply", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const patchedAgentSession = readFileSync(
		join(root, "dist/core/agent-session.js"),
	);
	result = spawnSync(
		process.execPath,
		[applicator, "restore", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	writeFileSync(join(root, "dist/core/agent-session.js"), patchedAgentSession);
	writeFileSync(
		join(root, ".pi-fitch-kit-backup/pi-0.84.1-compaction/journal.json"),
		`${JSON.stringify({
			packageRoot: root,
			version: "0.84.1",
			action: "apply",
			before: "stock",
		})}\n`,
	);
	const mixedAgentSession = readFileSync(join(root, "dist/core/agent-session.js"));
	const journalPath = join(
		root,
		".pi-fitch-kit-backup/pi-0.84.1-compaction/journal.json",
	);
	result = spawnSync(
		process.execPath,
		[applicator, "status", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const status = JSON.parse(result.stdout);
	assert.equal(status.state, "recovery-needed");
	assert.equal(status.currentState, "mixed");
	assert.equal(existsSync(journalPath), true, "status must not clear a recovery journal");
	assert.deepEqual(
		readFileSync(join(root, "dist/core/agent-session.js")),
		mixedAgentSession,
		"status must not repair interrupted core bytes",
	);
	result = spawnSync(
		process.execPath,
		[applicator, "restore", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.equal(JSON.parse(result.stdout).state, "already-stock");
	assert.equal(existsSync(journalPath), false);
}

{
	const root = stockFixture();
	const copiedKit = mkdtempSync(join(tmpdir(), "pi-kit-copied-applicator-"));
	fixtures.push(copiedKit);
	mkdirSync(join(copiedKit, "scripts"));
	mkdirSync(join(copiedKit, "patches"));
	copyFileSync(applicator, join(copiedKit, "scripts/reapply-pi-core-compaction.mjs"));
	writeFileSync(
		join(copiedKit, "patches/pi-0.84.1-compaction.patch"),
		"corrupt artifact\n",
	);
	const result = spawnSync(
		process.execPath,
		[
			join(copiedKit, "scripts/reapply-pi-core-compaction.mjs"),
			"status",
			"--pi-root",
			root,
		],
		{ encoding: "utf8" },
	);
	assert.equal(
		result.status,
		0,
		`stock status must not require the unused current patch:\n${result.stderr}`,
	);
	assert.equal(JSON.parse(result.stdout).state, "stock");
}

{
	const fakeBin = mkdtempSync(join(tmpdir(), "pi-kit-wrapper-bin-"));
	fixtures.push(fakeBin);
	const wrapper = join(fakeBin, "pi");
	writeFileSync(wrapper, "#!/bin/sh\nexit 0\n");
	chmodSync(wrapper, 0o755);
	const result = spawnSync(process.execPath, [applicator, "status"], {
		encoding: "utf8",
		env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin` },
	});
	assert.notEqual(result.status, 0);
	assert.match(
		result.stderr,
		/--pi-root/,
		"wrapper launchers must direct callers to the explicit package-root flag",
	);
}

{
	const root = stockFixture();
	const lockPath = join(root, ".pi-fitch-kit.lock");
	writeFileSync(lockPath, "999999\n");
	// shlock waits for the lock mtime to stabilize before deleting a dead owner's file.
	await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_100));
	const result = spawnSync(
		process.execPath,
		[applicator, "apply", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.equal(existsSync(lockPath), false, "a stale lock must be reclaimed");
}

{
	const root = stockFixture();
	const external = mkdtempSync(join(tmpdir(), "pi-kit-external-backup-"));
	fixtures.push(external);
	symlinkSync(external, join(root, ".pi-fitch-kit-backup"));
	const result = spawnSync(
		process.execPath,
		[applicator, "apply", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.notEqual(result.status, 0, "a symlinked backup path must be refused");
	assert.match(result.stderr, /symlink/i);
	assert.deepEqual(
		readFileSync(join(root, "dist/core/agent-session.js")),
		readFileSync(join(stockRoot, "dist/core/agent-session.js")),
		"backup-path refusal must leave Pi stock",
	);
}

{
	const root = stockFixture();
	for (const action of ["apply", "restore"]) {
		const result = spawnSync(
			process.execPath,
			[applicator, action, "--pi-root", root],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	const aliasContainer = mkdtempSync(join(tmpdir(), "pi-kit-root-alias-"));
	fixtures.push(aliasContainer);
	const aliasRoot = join(aliasContainer, basename(root));
	symlinkSync(root, aliasRoot);
	const manifestPath = join(
		root,
		".pi-fitch-kit-backup/pi-0.84.1-compaction/manifest.json",
	);
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.packageRoot = aliasRoot;
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	const result = spawnSync(
		process.execPath,
		[applicator, "apply", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(
		result.status,
		0,
		`a canonical alias in the backup manifest must remain valid:\n${result.stderr}`,
	);
}

{
	const root = stockFixture();
	const result = spawnSync(
		PATCH_EXECUTABLE,
		["--batch", "--forward", "--no-backup-if-mismatch", "-p1", "-d", root],
		{
			encoding: "utf8",
			input: readFileSync(
				join(packageRoot, "patches/pi-0.84.1-compaction.patch"),
			),
		},
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const status = spawnSync(
		process.execPath,
		[applicator, "status", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.notEqual(status.status, 0, "patched state without a stock backup must fail closed");
	assert.match(status.stderr, /stock backup missing/i);
}

{
	const root = stockFixture();
	let result = spawnSync(
		process.execPath,
		[applicator, "apply", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	writeFileSync(
		join(root, ".pi-fitch-kit-backup/pi-0.84.1-compaction/journal.json"),
		`${JSON.stringify({
			packageRoot: root,
			version: "0.84.1",
			action: "apply",
			before: "stock",
		})}\n`,
	);
	const journalPath = join(
		root,
		".pi-fitch-kit-backup/pi-0.84.1-compaction/journal.json",
	);
	result = spawnSync(
		process.execPath,
		[applicator, "status", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const status = JSON.parse(result.stdout);
	assert.equal(status.state, "recovery-needed");
	assert.equal(status.currentState, "patched");
	assert.equal(existsSync(journalPath), true, "status must leave completed journals untouched");
	result = spawnSync(
		process.execPath,
		[applicator, "apply", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.equal(JSON.parse(result.stdout).state, "already-patched");
	assert.equal(existsSync(journalPath), false);
}

{
	const root = stockFixture();
	const stale = join(
		root,
		".pi-fitch-kit-backup/pi-0.84.1-compaction.tmp-interrupted",
	);
	mkdirSync(stale, { recursive: true });
	writeFileSync(join(stale, "partial"), "stale\n");
	const result = spawnSync(
		process.execPath,
		[applicator, "apply", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.equal(existsSync(stale), false, "a stale backup staging directory must be reaped");
}

// Released kit applicators tracked only these three core files; their backups
// and manifests never contained the later-tracked pi-ai retry classifier.
// Each migration leg rebuilds that exact on-disk layout so the current
// applicator is proven against real released-era backups, not backups it
// created itself. The stale patchSha256 variant mirrors a live install whose
// pre-0.5.0 backup metadata was carried forward (issue #16).
const LEGACY_ERA_FILES = [
	"dist/core/agent-session.js",
	"dist/core/compaction/compaction.js",
	"dist/modes/interactive/interactive-mode.js",
];
const sha256 = (path) =>
	createHash("sha256").update(readFileSync(path)).digest("hex");

function buildLegacyEraBackup(root, legacyPatchPath, { stalePatchSha } = {}) {
	const backupRoot = join(root, ".pi-fitch-kit-backup/pi-0.84.1-compaction");
	const manifestFiles = {};
	for (const relativePath of LEGACY_ERA_FILES) {
		const destination = join(backupRoot, relativePath);
		mkdirSync(dirname(destination), { recursive: true });
		copyFileSync(join(root, relativePath), destination);
		manifestFiles[relativePath] = { stock: sha256(destination), patched: "recorded-by-released-kit" };
	}
	writeFileSync(
		join(backupRoot, "manifest.json"),
		`${JSON.stringify(
			{
				packageRoot: root,
				package: "@earendil-works/pi-coding-agent",
				version: "0.84.1",
				patchSha256: stalePatchSha ?? sha256(legacyPatchPath),
				files: manifestFiles,
			},
			null,
			2,
		)}\n`,
	);
	return backupRoot;
}

for (const { version, stalePatchSha } of [
	{ version: "0.4.2" },
	{ version: "0.4.3" },
	{ version: "0.5.0" },
	{ version: "0.5.0", stalePatchSha: `f4d8f383${"0".repeat(56)}` },
]) {
	const root = stockFixture();
	const legacyPatch = join(
		packageRoot,
		`patches/archive/pi-0.84.1-compaction-v${version}.patch`,
	);
	const backupDir = buildLegacyEraBackup(root, legacyPatch, { stalePatchSha });
	const legacyApply = spawnSync(
		PATCH_EXECUTABLE,
		["--batch", "--forward", "--no-backup-if-mismatch", "-p1", "-d", root],
		{ encoding: "utf8", input: readFileSync(legacyPatch) },
	);
	assert.equal(legacyApply.status, 0, legacyApply.stderr || legacyApply.stdout);
	const legacyStatus = spawnSync(
		process.execPath,
		[applicator, "status", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(legacyStatus.status, 0, legacyStatus.stderr || legacyStatus.stdout);
	assert.equal(JSON.parse(legacyStatus.stdout).legacyPatchVersion, version);
	const migration = spawnSync(
		process.execPath,
		[applicator, "apply", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(
		migration.status,
		0,
		`the released v${version} patch must migrate:\n${migration.stderr}`,
	);
	assert.equal(JSON.parse(migration.stdout).migratedFrom, "legacy-patched");
	const upgradedManifest = JSON.parse(
		readFileSync(join(backupDir, "manifest.json"), "utf8"),
	);
	const retryPath = "node_modules/@earendil-works/pi-ai/dist/utils/retry.js";
	assert.ok(
		upgradedManifest.files[retryPath],
		"migration must extend the released-era backup to newly tracked files",
	);
	assert.equal(
		sha256(join(backupDir, retryPath)),
		sha256(join(stockRoot, retryPath)),
		"the upgraded backup must hold the stock retry classifier preimage",
	);
	assert.equal(
		upgradedManifest.patchSha256,
		sha256(join(packageRoot, "patches/pi-0.84.1-compaction.patch")),
		"migration must refresh recorded backup patch metadata to the executed artifact",
	);
	const restore = spawnSync(
		process.execPath,
		[applicator, "restore", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(restore.status, 0, restore.stderr || restore.stdout);
	assert.equal(JSON.parse(restore.stdout).state, "stock");
	const legacyReapply = spawnSync(
		PATCH_EXECUTABLE,
		["--batch", "--forward", "--no-backup-if-mismatch", "-p1", "-d", root],
		{ encoding: "utf8", input: readFileSync(legacyPatch) },
	);
	assert.equal(legacyReapply.status, 0, legacyReapply.stderr || legacyReapply.stdout);
	const legacyRestore = spawnSync(
		process.execPath,
		[applicator, "restore", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(legacyRestore.status, 0, legacyRestore.stderr || legacyRestore.stdout);
	assert.equal(JSON.parse(legacyRestore.stdout).state, "stock");
}

// A manifest listing only a subset of a released layout could make recovery
// restore fewer files than an interrupted patch step touched. Every action
// must reject it before considering any mutation.
{
	const root = stockFixture();
	const legacyPatch = join(
		packageRoot,
		"patches/archive/pi-0.84.1-compaction-v0.5.0.patch",
	);
	const backupDir = buildLegacyEraBackup(root, legacyPatch, {});
	const manifestPath = join(backupDir, "manifest.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.files = {
		"dist/core/agent-session.js": manifest.files["dist/core/agent-session.js"],
	};
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	for (const action of ["status", "apply", "restore"]) {
		const result = spawnSync(
			process.execPath,
			[applicator, action, "--pi-root", root],
			{ encoding: "utf8" },
		);
		assert.notEqual(result.status, 0, `${action} must reject a truncated backup manifest`);
		assert.match(result.stderr, /does not match a released kit backup layout/);
	}
}

// A fully patched install whose backup still has the legacy layout cannot
// recover an interrupted restore of the current patch; restore must refuse
// to journal the mutation. The state is unreachable through kit flows.
{
	const root = stockFixture();
	const applied = spawnSync(
		process.execPath,
		[applicator, "apply", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(applied.status, 0, applied.stderr || applied.stdout);
	const backupDir = join(root, ".pi-fitch-kit-backup/pi-0.84.1-compaction");
	const manifestPath = join(backupDir, "manifest.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const retryPath = "node_modules/@earendil-works/pi-ai/dist/utils/retry.js";
	delete manifest.files[retryPath];
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	rmSync(join(backupDir, retryPath));
	const refused = spawnSync(
		process.execPath,
		[applicator, "restore", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.notEqual(refused.status, 0, "restore must refuse a patched install with a legacy-layout backup");
	assert.match(refused.stderr, /cannot recover an interrupted restore/);
	const status = spawnSync(
		process.execPath,
		[applicator, "status", "--pi-root", root],
		{ encoding: "utf8" },
	);
	assert.equal(status.status, 0, status.stderr || status.stdout);
	assert.equal(JSON.parse(status.stdout).state, "patched", "the refused restore must not have mutated the install");
}

console.log("pi core applicator security and recovery checks passed");
