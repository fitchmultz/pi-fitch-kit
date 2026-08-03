# AGENTS.md

## Project shape

- This repo is the public, opinionated composition package for Fitch's active Pi extensions, skills, settings, and user-level subagent overrides.
- Canonical sources:
  - `prompts/fitch-setup.md` and `prompts/audit/github-open-issues-prs.md` for the two registered package slash commands; other prompt files are retained source material.
  - `agents/*.md` for reusable user subagent overrides.
  - `extensions/sync-agents.ts` for startup/reload symlink sync into `~/.pi/agent/agents/`.
  - `extensions/anthropic-image-guard.ts` for provider-specific image limit handling when global auto-resize is off.
  - `examples/settings.json` for the safe, non-secret behavioral settings subset.
  - `setup-manifest.json` for each tagged release's exact package pins, native asset digests, required model routes, and kit resources; `/fitch-setup` treats that snapshot as the source of truth.
  - `templates/working-agreement.md` for the managed working-agreement blocks.
  - `package.json#pi` for the resources Pi loads from this package.
- Keep `README.md`, `setup-manifest.json`, and `docs/pi-setup.md` in sync when commands, prompt names, agent roles, models, package pins, install flow, or source-of-truth rules change. `npm run check` enforces the manifest side of this.

## Commands

- Install deps: `npm install`
- Validate repo: `npm run check`
- Package load smoke: `npm run smoke`
- Manual agent sync fallback: `bash scripts/sync-agents.sh`
- Install/update package in Pi from this checkout: `pi install "$PWD"`
- After changing prompts or agents in a running Pi session, use `/reload` or start a fresh session before runtime verification.

## Editing rules

- Use npm and Node `>=22.19.0`; do not introduce another package manager.
- Do not edit synced copies under `~/.pi/agent/agents/`; edit `agents/*.md` here and let the extension or fallback script relink them.
- Do not add duplicate subagent overrides in Pi settings. Agent model/thinking/context/tool policy lives in `agents/*.md` frontmatter.
- Keep model-facing agent bodies focused on actionable role instructions, evidence standards, boundaries, and outputs. Agent model, effort, and context policy belongs in frontmatter; parent-launch guidance belongs in orchestration docs.
- Use configured agent defaults first. Override model or thinking only when a concrete routing, provider-capability, model-diversity, or cost requirement justifies it.
- The Anthropic route is machine-specific: this work machine uses Pi's `anthropic` provider, and the personal machine uses the `claude-code` provider. Keep `anthropic/*` ids in agent frontmatter so both machines resolve the same overrides.
- Do not use the `claude-code` provider as primary or fallback routing for forked invocations; use fresh context with a compact handoff because Claude Code cannot import a Pi fork transcript. `oracle` is the only fork-context override, so keep its chain non-Anthropic.
- Keep `tools:` omitted in agent overrides unless a task explicitly needs a static allowlist; Pi should provide the normal builtin/extension tool surface.
- Keep every agent as a leaf agent; do not opt into nested subagents unless the README policy changes.

## Prompt templates

- Prompt filenames are slash-command names. Keep `package.json#pi.prompts` and `setup-manifest.json#kitResources.prompts` limited to prompts that belong in the active public setup.
- Prompt frontmatter should stay native and portable: use fields such as `description:` and `argument-hint:`.
- Do not add `model:`, `thinking:`, or extension-only skill injection to prompt frontmatter.
- Prefer Pi template defaults like `${1:-default}` for optional args; document quoted multi-word args when relevant.

## Extension and Pi package work

- Before changing Pi runtime/package behavior, read the installed Pi docs/types for the touched surface, especially `docs/packages.md`, `docs/prompt-templates.md`, and `docs/extensions.md` under the installed Pi root.
- Keep `extensions/sync-agents.ts` startup work small and deterministic: create symlinks, skip non-symlink conflicts, warn through UI only when needed.
- Keep `extensions/anthropic-image-guard.ts` provider-scoped and based on Pi's native `resizeImage`; do not reintroduce global resizing logic.
- Keep Agent Browser native asset names and SHA-256 digests in the manifest. Installation must use `--ignore-scripts`; the verifier must fail closed on a missing or mismatched npm-bundled binary.
- Runtime dependencies belong in `dependencies`; Pi core packages stay peer dependencies with `"*"` unless installed Pi docs say otherwise.

## Validation

- Run `npm run check` after edits to `package.json`, `setup-manifest.json`, `extensions/`, `scripts/`, `agents/`, or `prompts/`; add `npm run smoke` when package resources changed.
- For runtime-facing changes, also verify Pi loads the package through `pi install ...` plus `/reload` or a fresh Pi session when practical.
- Keep this file short and project-specific; point to `README.md` or Pi docs instead of copying large directory maps or generic coding rules.
