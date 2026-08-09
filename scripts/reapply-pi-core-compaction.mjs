#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const patchPath = join(projectRoot, "patches/pi-0.84.1-compaction.patch");
const patchSha256 = "e22b2060d2e92e35499386eaf32cde9fe66de6d871b247ae5394c0a945bac486";
const legacyPatchPath = join(projectRoot, "patches/archive/pi-0.84.1-compaction-v0.4.2.patch");
const legacyPatchSha256 = "5f68de3bb9689ad983168a683bd2cc43426e19325071b75d6fd36425ac191b24";
const legacyAgentSessionPatched = "cd1f9b9a0b6ad10239394568be5961c5a7d8fc117830e1a09650eb5ade176c6a";
const commonFiles = {
  "dist/core/agent-session.js": {
    stock: "91e72d5497f665e731cbd79da6a6e826d8cae7d2ce156a7dee39f8ca205e32c8",
    patched: "ee4ffc5bcdfc8b348280f0b370f17f839deb7f11fdeefb9e72b020bbeb1758e2",
  },
  "dist/core/compaction/compaction.js": {
    stock: "fcb12f1eb4d38578978e1a8e3e382a3fccfd5e0ccf87bc86979a9a8d9c145c7b",
    patched: "476b9cd8329f3b6ea94a7aeca663b1bd3992319b04f088ffd6025ce7959cec2e",
  },
};
const interactiveModeHashes = {
  "0.84.0": {
    stock: "1efe4f58c10593e0d283b3e6d5bf4fd342d8e5d681f1fbc9dfbb7cc03fe4b266",
    patched: "702beb350dcb588bd52e0f061e9d9d72ef62ed85a061ed7b9fc650e9daa607e3",
  },
  "0.84.1": {
    stock: "da01f077caca6e7c440ea05e7226a64dffdfd96e8e53a1ffaca4bd7d6e186261",
    patched: "28c7d6d73fbf0fd69beb750cb622251732113bb55d1903644bb4fe93bbd6516f",
  },
};
let piVersion;
let files;

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
  let hasExplicitRoot = false;
  while (args.length > 0) {
    const flag = args.shift();
    if (flag !== "--pi-root" || args.length === 0 || hasExplicitRoot) {
      fail("Usage: reapply-pi-core-compaction.mjs <apply|restore|status> [--pi-root <path>]");
    }
    explicitRoot = args.shift();
    hasExplicitRoot = true;
    if (explicitRoot.trim() === "") fail("--pi-root must not be empty");
  }
  return { action, explicitRoot };
}

function resolvePiRoot(explicitRoot) {
  if (explicitRoot !== undefined) return realpathSync(resolve(explicitRoot));
  const activePath = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => !resolve(entry).endsWith(`${sep}node_modules${sep}.bin`))
    .join(delimiter);
  const executable = execFileSync("which", ["pi"], {
    encoding: "utf8",
    env: { ...process.env, PATH: activePath },
  }).trim();
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
  const interactiveMode = interactiveModeHashes[packageJson.version];
  if (packageJson.name !== PI_PACKAGE || !interactiveMode) {
    fail(`Refusing ${packageJson.name ?? "unknown package"}@${packageJson.version ?? "unknown version"} at ${root}; expected ${PI_PACKAGE}@${Object.keys(interactiveModeHashes).join(" or ")}`);
  }
  piVersion = packageJson.version;
  files = {
    ...commonFiles,
    "dist/modes/interactive/interactive-mode.js": interactiveMode,
  };
  const cli = realpathSync(join(root, "dist/cli.js"));
  if (!cli.startsWith(`${root}/`)) fail(`Refusing Pi CLI outside package root: ${cli}`);
}

function verifyPatch(path, expected) {
  if (sha256(path) !== expected) fail(`Patch checksum mismatch: ${path}`);
}

function state(root) {
  const hashes = Object.fromEntries(
    Object.keys(files).map((relativePath) => [relativePath, sha256(join(root, relativePath))]),
  );
  if (Object.entries(files).every(([path, expected]) => hashes[path] === expected.stock)) {
    return { name: "stock" };
  }
  if (Object.entries(files).every(([path, expected]) => hashes[path] === expected.patched)) {
    return { name: "patched" };
  }
  if (
    hashes["dist/core/agent-session.js"] === legacyAgentSessionPatched &&
    Object.entries(files).every(
      ([path, expected]) => path === "dist/core/agent-session.js" || hashes[path] === expected.patched,
    )
  ) {
    return { name: "legacy-patched" };
  }
  const detail = Object.entries(hashes).map(([path, hash]) => `${path}: ${hash}`).join("\n");
  fail(`Pi core diverges from both reviewed stock and patched states; refusing mutation:\n${detail}`);
}

function backupStock(root) {
  const backupRoot = join(root, ".pi-fitch-kit-backup", `pi-${piVersion}-compaction`);
  const manifestPath = join(backupRoot, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.packageRoot !== root || manifest.version !== piVersion) {
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
    `${JSON.stringify({ packageRoot: root, package: PI_PACKAGE, version: piVersion, patchSha256, files }, null, 2)}\n`,
    "utf8",
  );
}

function runPatch(root, reverse, dryRun, source = patchPath) {
  const args = ["--batch", "--forward", "--no-backup-if-mismatch", "--reject-file=-", "-p1", "-d", root];
  if (reverse) args.unshift("--reverse");
  if (dryRun) args.unshift("--dry-run");
  const result = spawnSync("patch", args, { encoding: "utf8", input: readFileSync(source) });
  if (result.status !== 0) {
    fail(`Patch ${dryRun ? "preflight" : "mutation"} failed:\n${result.stdout}${result.stderr}`);
  }
}

function checkSyntax(root) {
  for (const relativePath of Object.keys(files)) {
    execFileSync(process.execPath, ["--check", join(root, relativePath)], { stdio: "pipe" });
  }
}

function planSteps(action, beforeName) {
  if (action === "restore") {
    return [{ reverse: true, source: beforeName === "legacy-patched" ? legacyPatchPath : patchPath }];
  }
  if (beforeName === "legacy-patched") {
    // One-step migration: reverse the superseded reviewed patch, verify the
    // exact stock intermediate, ensure the stock backup exists, then apply the
    // current patch. Failures roll back to the legacy-patched pre-state.
    return [
      { reverse: true, source: legacyPatchPath, verify: "stock", backup: true },
      { reverse: false, source: patchPath },
    ];
  }
  return [{ reverse: false, source: patchPath }];
}

function mutateAndVerify(root, action, beforeName, steps) {
  const snapshots = Object.fromEntries(
    Object.keys(files).map((relativePath) => [relativePath, readFileSync(join(root, relativePath))]),
  );
  try {
    for (const step of steps) {
      runPatch(root, step.reverse, false, step.source);
      if (step.verify && state(root).name !== step.verify) {
        fail(`Expected ${step.verify} state mid-${action}, found a divergent intermediate`);
      }
      if (step.backup) backupStock(root);
    }
    const expected = action === "apply" ? "patched" : "stock";
    const after = state(root);
    if (after.name !== expected) fail(`Expected ${expected} state after ${action}, found ${after.name}`);
    checkSyntax(root);
    return after;
  } catch (error) {
    try {
      for (const [relativePath, contents] of Object.entries(snapshots)) {
        writeFileSync(join(root, relativePath), contents);
      }
      const restored = state(root);
      if (restored.name !== beforeName) fail(`Rollback restored ${restored.name}, expected ${beforeName}`);
      checkSyntax(root);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `Pi core ${action} failed and rollback could not be verified`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Pi core ${action} failed; restored and verified the ${beforeName} pre-operation state.\n${message}`, { cause: error });
  }
}

const { action, explicitRoot } = parseArgs();
const root = resolvePiRoot(explicitRoot);
verifyInstallation(root);
verifyPatch(patchPath, patchSha256);
const before = state(root);
if (before.name === "legacy-patched" && action !== "status") {
  verifyPatch(legacyPatchPath, legacyPatchSha256);
}

if (action === "status") {
  console.log(JSON.stringify({ ok: true, action, packageRoot: root, version: piVersion, state: before.name }, null, 2));
  process.exit(0);
}
if (action === "apply" && before.name === "patched") {
  console.log(JSON.stringify({ ok: true, action, packageRoot: root, version: piVersion, state: "already-patched", changed: false }, null, 2));
  process.exit(0);
}
if (action === "restore" && before.name === "stock") {
  console.log(JSON.stringify({ ok: true, action, packageRoot: root, version: piVersion, state: "already-stock", changed: false }, null, 2));
  process.exit(0);
}

const steps = planSteps(action, before.name);
runPatch(root, steps[0].reverse, true, steps[0].source);
if (action === "apply" && before.name === "stock") backupStock(root);
const after = mutateAndVerify(root, action, before.name, steps);
console.log(
  JSON.stringify(
    {
      ok: true,
      action,
      packageRoot: root,
      version: piVersion,
      state: after.name,
      changed: true,
      ...(before.name === "legacy-patched" ? { migratedFrom: "legacy-patched" } : {}),
    },
    null,
    2,
  ),
);
