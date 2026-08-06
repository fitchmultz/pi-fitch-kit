#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const PI_VERSION = "0.84.0";
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const patchPath = join(projectRoot, "patches/pi-0.84.0-compaction.patch");
const patchSha256 = "5f68de3bb9689ad983168a683bd2cc43426e19325071b75d6fd36425ac191b24";
const files = {
  "dist/core/agent-session.js": {
    stock: "91e72d5497f665e731cbd79da6a6e826d8cae7d2ce156a7dee39f8ca205e32c8",
    patched: "cd1f9b9a0b6ad10239394568be5961c5a7d8fc117830e1a09650eb5ade176c6a",
  },
  "dist/core/compaction/compaction.js": {
    stock: "fcb12f1eb4d38578978e1a8e3e382a3fccfd5e0ccf87bc86979a9a8d9c145c7b",
    patched: "476b9cd8329f3b6ea94a7aeca663b1bd3992319b04f088ffd6025ce7959cec2e",
  },
  "dist/modes/interactive/interactive-mode.js": {
    stock: "1efe4f58c10593e0d283b3e6d5bf4fd342d8e5d681f1fbc9dfbb7cc03fe4b266",
    patched: "702beb350dcb588bd52e0f061e9d9d72ef62ed85a061ed7b9fc650e9daa607e3",
  },
};

function fail(message) {
  throw new Error(message);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const action = args.shift() ?? "status";
  if (!["apply", "restore", "status"].includes(action)) {
    fail("Usage: reapply-pi-core-compaction.mjs <apply|restore|status> [--pi-root <path>]");
  }
  let explicitRoot;
  while (args.length > 0) {
    const flag = args.shift();
    if (flag !== "--pi-root" || args.length === 0 || explicitRoot) {
      fail("Usage: reapply-pi-core-compaction.mjs <apply|restore|status> [--pi-root <path>]");
    }
    explicitRoot = args.shift();
  }
  return { action, explicitRoot };
}

function resolvePiRoot(explicitRoot) {
  if (explicitRoot) return realpathSync(resolve(explicitRoot));
  const executable = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
  const realExecutable = realpathSync(executable);
  const root = dirname(dirname(realExecutable));
  if (realExecutable !== realpathSync(join(root, "dist/cli.js"))) {
    fail(`Refusing unexpected Pi executable: ${realExecutable}`);
  }
  return root;
}

function verifyInstallation(root) {
  const packageJsonPath = join(root, "package.json");
  if (!existsSync(packageJsonPath)) fail(`Not a Pi package root: ${root}`);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (packageJson.name !== PI_PACKAGE || packageJson.version !== PI_VERSION) {
    fail(`Refusing ${packageJson.name ?? "unknown package"}@${packageJson.version ?? "unknown version"} at ${root}; expected ${PI_PACKAGE}@${PI_VERSION}`);
  }
  const cli = realpathSync(join(root, "dist/cli.js"));
  if (!cli.startsWith(`${root}/`)) fail(`Refusing Pi CLI outside package root: ${cli}`);
}

function verifyPatch() {
  if (sha256(patchPath) !== patchSha256) fail(`Patch checksum mismatch: ${patchPath}`);
}

function state(root) {
  const hashes = Object.fromEntries(
    Object.keys(files).map((relativePath) => [relativePath, sha256(join(root, relativePath))]),
  );
  if (Object.entries(files).every(([path, expected]) => hashes[path] === expected.stock)) {
    return { name: "stock", hashes };
  }
  if (Object.entries(files).every(([path, expected]) => hashes[path] === expected.patched)) {
    return { name: "patched", hashes };
  }
  const detail = Object.entries(hashes).map(([path, hash]) => `${path}: ${hash}`).join("\n");
  fail(`Pi core diverges from both reviewed stock and patched states; refusing mutation:\n${detail}`);
}

function backupStock(root) {
  const backupRoot = join(root, ".pi-fitch-kit-backup", `pi-${PI_VERSION}-compaction`);
  const manifestPath = join(backupRoot, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.packageRoot !== root || manifest.version !== PI_VERSION) {
      fail(`Backup belongs to an unexpected installation: ${manifestPath}`);
    }
    for (const [relativePath, expected] of Object.entries(files)) {
      if (sha256(join(backupRoot, relativePath)) !== expected.stock) {
        fail(`Backup preimage mismatch: ${join(backupRoot, relativePath)}`);
      }
    }
    return;
  }
  mkdirSync(backupRoot, { recursive: true });
  for (const [relativePath, expected] of Object.entries(files)) {
    const source = join(root, relativePath);
    if (sha256(source) !== expected.stock) fail(`Stock preimage changed before backup: ${source}`);
    const destination = join(backupRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ packageRoot: root, package: PI_PACKAGE, version: PI_VERSION, patchSha256, files }, null, 2)}\n`,
    "utf8",
  );
}

function runPatch(root, reverse, dryRun) {
  const args = ["--batch", "--forward", "--no-backup-if-mismatch", "-p1", "-d", root];
  if (reverse) args.unshift("--reverse");
  if (dryRun) args.unshift("--dry-run");
  const result = spawnSync("patch", args, { encoding: "utf8", input: readFileSync(patchPath) });
  if (result.status !== 0) {
    fail(`Patch ${dryRun ? "preflight" : "mutation"} failed:\n${result.stdout}${result.stderr}`);
  }
}

function checkSyntax(root) {
  for (const relativePath of Object.keys(files)) {
    execFileSync(process.execPath, ["--check", join(root, relativePath)], { stdio: "pipe" });
  }
}

const { action, explicitRoot } = parseArgs();
const root = resolvePiRoot(explicitRoot);
verifyInstallation(root);
verifyPatch();
const before = state(root);

if (action === "status") {
  console.log(JSON.stringify({ ok: true, action, packageRoot: root, version: PI_VERSION, state: before.name }, null, 2));
  process.exit(0);
}
if (action === "apply" && before.name === "patched") {
  console.log(JSON.stringify({ ok: true, action, packageRoot: root, version: PI_VERSION, state: "already-patched", changed: false }, null, 2));
  process.exit(0);
}
if (action === "restore" && before.name === "stock") {
  console.log(JSON.stringify({ ok: true, action, packageRoot: root, version: PI_VERSION, state: "already-stock", changed: false }, null, 2));
  process.exit(0);
}

if (action === "apply") backupStock(root);
runPatch(root, action === "restore", true);
runPatch(root, action === "restore", false);
const expected = action === "apply" ? "patched" : "stock";
const after = state(root);
if (after.name !== expected) fail(`Expected ${expected} state after ${action}, found ${after.name}`);
checkSyntax(root);
console.log(JSON.stringify({ ok: true, action, packageRoot: root, version: PI_VERSION, state: after.name, changed: true }, null, 2));
