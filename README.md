# pi-fitch-kit

Personal Pi package repo for reusable prompt templates plus source-managed user subagents.

## What this repo does

- Keeps reusable prompt templates in one package repo.
- Loads prompts recursively through `package.json#pi.prompts`.
- Keeps reusable user-agent overrides in `agents/` as the source of truth.
- Installs a small package extension that symlinks those agents into `~/.pi/agent/agents/` on Pi startup/reload.
- Lets prompts inherit the active Pi model by omitting `model:` from prompt frontmatter.
- Pins subagent models and thinking per role in `agents/` (see Agents).

## Layout

```text
pi-fitch-kit/
  package.json
  prompts/
    audit/
      precommit-review.md
      repo-audit.md
      extension-audit.md
      github-open-issues-prs.md
    execute/
      create-goal.md
      run-to-completion.md
      resolve-findings.md
      triage-first.md
    review/
      fresh-review.md
    qa/
      manual-qa.md
  agents/
    context-builder.md
    delegate.md
    oracle.md
    planner.md
    researcher.md
    reviewer.md
    scout.md
    worker.md
  extensions/
    sync-agents.ts
  scripts/
    sync-agents.sh
  README.md
```

## Prompts

These prompts are available through the package manifest:

- `/precommit-review`
- `/repo-audit`
- `/extension-audit`
- `/github-open-issues-prs`
- `/create-goal`
- `/run-to-completion`
- `/resolve-findings`
- `/triage-first`
- `/fresh-review`
- `/manual-qa`

Notes:

- Prompt discovery in plain `prompts/` folders is non-recursive, so this repo uses `pi.prompts: ["./prompts"]` and relies on package directory loading to pick up the nested prompt files.
- Prompt filenames are the slash-command names.
- Prompt `description:` values improve autocomplete.
- Prompt frontmatter intentionally omits `model:`, `thinking:`, and other extension-only fields so prompts stay compatible with native Pi prompt templates.
- Prompts may ask the agent to use a named workflow/skill in the body, but they do not depend on prompt-template skill injection.

## Agents

`agents/` stores the reusable source copies of the user-level subagent overrides. Model and thinking vary by role:

- `scout` — `cursor/composer-2.5`, thinking off; `defaultContext: fresh`; `inheritSkills: false`; `maxSubagentDepth: 0`
- `researcher` — `openai-codex/gpt-5.5`, thinking high; `defaultContext: fresh`; `defaultProgress: false`; `maxSubagentDepth: 0`
- `planner` — `openai-codex/gpt-5.5`, thinking xhigh; `defaultContext: fresh`; `maxSubagentDepth: 0`
- `worker` — `openai-codex/gpt-5.5`, thinking high; `defaultContext: fresh` (parent passes `context: "fork"` only for fix-after-review)
- `reviewer` — `openai-codex/gpt-5.5`, thinking high; `defaultContext: fresh`; `defaultProgress: false`; `maxSubagentDepth: 0`
- `context-builder` — `openai-codex/gpt-5.5`, thinking medium; `defaultContext: fresh`; `maxSubagentDepth: 0`
- `oracle` — `openai-codex/gpt-5.5`, thinking xhigh; `defaultContext: fork`; `maxSubagentDepth: 0`
- `delegate` — `openai-codex/gpt-5.5`, thinking high; `defaultContext: fresh`; `maxSubagentDepth: 0`

These names intentionally match the builtin `pi-subagents` names so the user-level versions override the builtin ones cleanly. Agent **model**, **thinking**, **inherit***, **defaultContext**, etc. live **only** in `agents/*.md` frontmatter—no duplicate `subagents.agentOverrides` in `settings.json`, so this repo stays the single source of truth after sync.

Model policy:

- Scouts and other read-only agents use cheaper models where output is verifiable.
- Implementation, review, planning, and oracle roles stay on **`openai-codex/gpt-5.5`** unless A/B data supports a cheaper route.
- **`tools:` is intentionally omitted** on every override so children receive Pi’s normal builtin/extension tool surface (see pi-subagents README for MCP direct-tool nuances).

## Subagent context policy

When spawning subagents from parent prompts or code:

- Pass `context: "fresh"` unless the task explicitly requires parent transcript history.
- Use `context: "fork"` only for oracle consistency checks or fix-after-review in the same active thread.
- Hand off with artifacts (`context.md`, `plan.md`, `review.md`, `progress.md`) instead of inherited transcript.
- Do not mix scout/reviewer/researcher calls into the same parallel batch as worker/oracle unless each step’s context policy is intentional.

Requires pi-subagents with per-agent context resolution (not whole-invocation fork promotion when any agent defaults to fork).

## Install

Install the package globally from this local path:

```bash
pi install /Users/mitchfultz/Projects/AI/pi-fitch-kit
```

Because this is a local-path package install, Pi points at this repo directly instead of copying it. Edits here become the live source of truth.

The package manifest loads:

- prompt templates from `prompts/`
- `extensions/sync-agents.ts`, which symlinks `agents/*.md` into `~/.pi/agent/agents/`

That means the package install is the normal source of truth for both prompts and user agent overrides. `scripts/sync-agents.sh` remains only as a manual fallback if Pi is not running or extension loading is disabled.

If you change prompts or agent definitions while Pi is already running, use `/reload` or start a fresh session so the current session picks up the updated resources.

## Repo-local overrides

When a specific project needs custom behavior, override globally installed resources with the same filenames in:

- `.pi/prompts/`
- `.pi/agents/`

That preserves stable command names while allowing per-repo specialization.

## Subagent output discipline

Pi-subagents currently supports `outputMode: "file-only"` on the parent `subagent(...)` call, parallel task item, or chain step. It is not enforced by agent frontmatter, so `output: review.md` by itself still returns saved output inline unless the caller also sets `outputMode: "file-only"`.

Use file-only mode for report-writing agents unless the expected output is small:

```ts
subagent({
  agent: "reviewer",
  task: "Review the current diff for correctness issues.",
  output: "review.md",
  outputMode: "file-only",
  progress: false,
  context: "fresh",
});
```

For quick review fanout where no artifact is needed, use `output: false` and `progress: false` so the parent receives only concise findings. Parent launch defaults are documented in global `~/.pi/agent/AGENTS.md` (async, fresh reviewers, scope in `task`).

Advisory agents set `maxSubagentDepth: 0` so children cannot spawn nested subagent trees. `tools:` remains omitted on every override so children keep Pi’s normal builtin/extension tool surface.

Agents should write bulky logs, diffs, browser snapshots, JSON, and raw command output to `/tmp` or a repo-local gitignored scratch path, then summarize only decision-relevant lines.

## Browser research note

`agents/context-builder.md` is written to use `agent_browser` for live web research and page reading when local repo context is insufficient.

## Current migration notes

This repo is the new source of truth for the renamed prompt set:

- `QA-QC.md` -> `manual-qa.md`
- `double-check.md` -> `fresh-review.md`
- `mini-gated-escalation.md` -> `triage-first.md`
- `remediate-findings.md` -> `resolve-findings.md`
- `task-execution.md` -> `run-to-completion.md`

The legacy prompt files were moved out of `~/.pi/agent/prompts/` and backed up under `~/.pi/agent/prompt-backups/` during cutover so only the new package-backed slash commands remain active.
