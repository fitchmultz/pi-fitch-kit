# AGENTS.md

## Project shape

- This repo is the public, opinionated composition package for Fitch's active Pi extensions, skills, settings, and setup flow.
- Canonical sources:
  - `prompts/fitch-setup.md` and `prompts/audit/github-open-issues-prs.md` for the two registered slash commands; other prompt files are retained source material.
  - `extensions/anthropic-image-guard.ts` for provider-specific image handling when global auto-resize is off.
  - `extensions/clean-footer.ts` for a compact footer without cumulative token, cache, or cost counters.
  - `extensions/fast-mode.ts` for the shared `/anthropic-fast` and `/codex-fast` toggles.
  - `extensions/session-name.ts` for stable, searchable session naming and protected role identifiers.
  - `examples/settings.json` for the safe, non-secret behavioral settings subset.
  - `setup-manifest.json` for unpinned package sources, required model routes, and kit resources.
  - `templates/working-agreement.md` for the optional managed working-agreement blocks.
  - `package.json#pi` for the resources Pi loads from this package.
- The `pi-subagents` package owns the fourteen specialist profiles and model routing. Do not copy them back into this kit or restore agent-sync code.
- Keep `README.md`, `setup-manifest.json`, and `docs/pi-setup.md` aligned when prompts, packages, models, install flow, or source-of-truth rules change.

## Commands

- Install deps: `npm install`
- Validate repo: `npm run check`
- Package load smoke: `npm run smoke`
- Install/update package in Pi from this checkout: `pi install "$PWD"`
- After changing package resources in a running Pi session, use `/reload` or start a fresh session before runtime verification.

## Editing rules

- Use npm and Node `>=24.0.0`; do not introduce another package manager.
- Keep this package an opinionated composition layer. Independent extensions and skill packages must not depend on it.
- Keep only active public resources registered in `package.json#pi` and `setup-manifest.json`.
- Do not add duplicate subagent or skill copies. Point to the public owning package without pinning extension installs to a ref or version.

## Prompt templates

- Prompt filenames are slash-command names. Keep `package.json#pi.prompts` and `setup-manifest.json#kitResources.prompts` limited to prompts that belong in the active public setup.
- Prompt frontmatter should stay native and portable: use fields such as `description:` and `argument-hint:`.
- Do not add `model:`, `thinking:`, or extension-only skill injection to prompt frontmatter.
- Prefer Pi template defaults like `${1:-default}` for optional args; document quoted multi-word args when relevant.

## Extension and package work

- Before changing Pi runtime/package behavior, read the installed Pi docs/types for the touched surface, especially `docs/packages.md`, `docs/prompt-templates.md`, and `docs/extensions.md` under the installed Pi root.
- Keep `extensions/anthropic-image-guard.ts` provider-scoped and based on Pi's native `resizeImage`; preserve its pre-decode source limits and do not reintroduce global resizing logic.
- Keep `extensions/clean-footer.ts` free of cumulative token, cache, and cost counters; preserve context usage, model details, extension statuses, and wrapping without truncation.
- Keep `extensions/fast-mode.ts` hook-only on `before_provider_request` and `before_provider_headers`; never register provider overrides, keep the existing state filenames, and keep eligibility scoped to Anthropic-messages Opus routes and the OpenAI providers.
- Keep `extensions/session-name.ts` metadata inert and its coordinator/numbered-subagent removal confirmation intact.
- Keep the Agent Browser prerequisite aligned with the released wrapper's tested compatibility baseline.
- Runtime dependencies belong in `dependencies`; Pi core packages stay peer dependencies with `"*"` unless installed Pi docs say otherwise.

## Validation

- Run `npm run check` after edits to `package.json`, `setup-manifest.json`, `extensions/`, `scripts/`, or registered prompts; add `npm run smoke` when package resources changed.
- Run `npm run regression:fast-mode` after changing fast-mode toggles, eligibility, payload or header injection, or state handling.
- Run `npm run regression:session-name` after changing naming guidance, metadata injection, protected identities, or its migration gate.
- For runtime-facing changes, also verify Pi loads the package through `pi install ...` plus `/reload` or a fresh Pi session when practical.
- Keep this file short and project-specific; point to `README.md` or Pi docs instead of copying generic coding rules.
