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

test("current policy passes, including both managed Claude gateway windows", () => {
  const result = validate();
  assert.equal(result.status, 0, result.stderr);
  for (const route of ["cloudflare-ai-gateway/claude-fable-5", "cloudflare-ai-gateway/claude-opus-5"]) {
    assert.ok(manifest.optionalModels.includes(route));
    assert.equal(manifest.modelContextWindows[route], 320000);
  }
});

for (const route of Object.keys(manifest.modelContextWindows)) {
  test(`${route} rejects context-window drift`, () => {
    for (const value of [321000, 319999, "320000", null]) {
      rejects(({ manifest }) => { manifest.modelContextWindows[route] = value; },
        `modelContextWindows value for ${route} must be 320000`);
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
      "settings example must carry the 64k compaction reserve");
  });
}

test("missing recent-token setting has its own diagnostic", () => {
  rejects(({ settings }) => { delete settings.compaction.keepRecentTokens; },
    "settings example must keep 40k recent tokens");
});
