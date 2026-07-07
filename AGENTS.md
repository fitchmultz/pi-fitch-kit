# AGENTS.md

## Project shape

- This repo is a local Pi package for Fitch-owned prompt templates and user-level subagent overrides.
- Canonical sources:
  - `prompts/**/*.md` for package slash commands.
  - `agents/*.md` for reusable user subagent overrides.
  - `extensions/sync-agents.ts` for startup/reload symlink sync into `~/.pi/agent/agents/`.
  - `package.json#pi` for the resources Pi loads from this package.
- Keep `README.md` in sync when commands, prompt names, agent roles, install flow, or source-of-truth rules change.

## Commands

- Install deps: `npm install`
- Validate repo: `npm run check`
- Manual agent sync fallback: `bash scripts/sync-agents.sh`
- Install/update package in Pi from this checkout: `pi install /Users/mitchfultz/Projects/AI/pi-fitch-kit`
- After changing prompts or agents in a running Pi session, use `/reload` or start a fresh session before runtime verification.

## Editing rules

- Use npm and Node `>=22.19.0`; do not introduce another package manager.
- Do not edit synced copies under `~/.pi/agent/agents/`; edit `agents/*.md` here and let the extension or fallback script relink them.
- Do not add duplicate subagent overrides in Pi settings. Agent model/thinking/context/tool policy lives in `agents/*.md` frontmatter.
- Use configured agent defaults first: worker/researcher/scout/context-builder are medium-effort, reviewer/fixer are high-effort, and oracle is xhigh forked-context by default. Override worker/researcher upward only when the child owns high-risk, hard-debug, broad multi-file, architecture/API/security, data-loss, lifecycle/state, release-blocking, or expensive-to-repeat work.
- `anthropic/*` models route through Claude Code CLI inside `pi-subagents`, not Pi's global model registry. Fresh-default agents may use Claude Code fallbacks. Do not use Claude Code as primary or fallback routing for fork-default agents unless the task includes a compact handoff; Claude Code cannot import a Pi fork transcript.
- Keep `tools:` omitted in agent overrides unless a task explicitly needs a static allowlist; Pi should provide the normal builtin/extension tool surface.
- Keep worker/reviewer/scout/researcher/fixer/oracle/ui-designer as leaf agents (`maxSubagentDepth: 0`). Only planner/context-builder should opt into nested subagents unless the README policy changes.

## Prompt templates

- Prompt filenames are slash-command names; update `README.md` lists when adding, renaming, or deleting one.
- Prompt frontmatter should stay native and portable: use fields such as `description:` and `argument-hint:`.
- Do not add `model:`, `thinking:`, or extension-only skill injection to prompt frontmatter.
- Prefer Pi template defaults like `${1:-default}` for optional args; document quoted multi-word args when relevant.

## Extension and Pi package work

- Before changing Pi runtime/package behavior, read the installed Pi docs/types for the touched surface, especially `docs/packages.md`, `docs/prompt-templates.md`, and `docs/extensions.md` under the installed Pi root.
- Keep `extensions/sync-agents.ts` startup work small and deterministic: create symlinks, skip non-symlink conflicts, warn through UI only when needed.
- Runtime dependencies belong in `dependencies`; Pi core packages stay peer dependencies with `"*"` unless installed Pi docs say otherwise.

## Validation

- Run `npm run check` after edits to `package.json`, `extensions/`, `scripts/`, `agents/`, or `prompts/`.
- For runtime-facing changes, also verify Pi loads the package through `pi install ...` plus `/reload` or a fresh Pi session when practical.
- Keep this file short and project-specific; point to `README.md` or Pi docs instead of copying large directory maps or generic coding rules.
