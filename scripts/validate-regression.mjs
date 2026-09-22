#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), "pi-kit-validator-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
cpSync(root, fixture, {
  recursive: true,
  filter: (path) => ![".git", "node_modules", ".dogfood"].includes(basename(path)),
});
const manifest = JSON.parse(readFileSync(join(root, "setup-manifest.json"), "utf8"));
const settings = JSON.parse(readFileSync(join(root, "examples/settings.json"), "utf8"));

function validate(change = () => {}) {
  const input = { manifest: structuredClone(manifest), settings: structuredClone(settings) };
  change(input);
  writeFileSync(join(fixture, "setup-manifest.json"), JSON.stringify(input.manifest));
  writeFileSync(join(fixture, "examples/settings.json"), JSON.stringify(input.settings));
  return spawnSync(process.execPath, [join(fixture, "scripts/validate.mjs")], { encoding: "utf8" });
}

function rejects(change, message) {
  const result = validate(change);
  assert.equal(result.status, 1, `validator must reject this input: ${result.stdout}`);
  assert.ok(result.stderr.includes(`Error: ${message}`), result.stderr);
  assert.ok(!result.stderr.includes("TypeError"), result.stderr);
}

test("current policy passes and the manifest can select another context budget", () => {
  assert.equal(validate().status, 0);
  const result = validate(({ manifest }) => {
    manifest.modelContextWindows[`${settings.defaultProvider}/${settings.defaultModel}`] = 600000;
  });
  assert.equal(result.status, 0, result.stderr);
});

for (const route of Object.keys(manifest.modelContextWindows)) {
  test(`${route} rejects invalid or undersized context windows`, () => {
    for (const value of [0, -1, 320000.5, Number.MAX_SAFE_INTEGER + 1, "320000", null, settings.compaction.reserveTokens + settings.compaction.keepRecentTokens]) {
      rejects(({ manifest }) => { manifest.modelContextWindows[route] = value; },
        `modelContextWindows value for ${route} must be a safe integer exceeding the compaction reserve plus recent tokens`);
    }
  });
}

test("unmanaged routes remain invalid even at the correct window", () => {
  rejects(({ manifest }) => { manifest.modelContextWindows["unmanaged/model"] = 320000; },
    "modelContextWindows route unmanaged/model must be a manifest-managed model route");
});

for (const compaction of [undefined, null, {}, { keepRecentTokens: 40000 }]) {
  test(`missing reserve (${JSON.stringify(compaction)}) has a useful diagnostic`, () => {
    rejects(({ settings }) => { settings.compaction = compaction; },
      "compaction.reserveTokens must be a positive safe integer");
  });
}

test("default model must remain required and enabled", () => {
  rejects(({ settings }) => { settings.defaultModel = "unmanaged"; }, "settings default model must be a required route");
  rejects(({ settings }) => { settings.enabledModels = []; }, "settings default model must be enabled");
});

test("missing recent-token setting has its own diagnostic", () => {
  rejects(({ settings }) => { delete settings.compaction.keepRecentTokens; },
    "compaction.keepRecentTokens must be a positive safe integer");
});
