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
      debug-mode.md
      fix-issues.md
      mine-workflows.md
      optimize-skill.md
      orchestrate.md
      run-to-completion.md
      resolve-findings.md
      triage-first.md
    review/
      fresh-review.md
      hard-review.md
    qa/
      manual-qa.md
  agents/
    context-builder.md
    fixer.md
    oracle.md
    planner.md
    researcher.md
    reviewer.md
    scout.md
    ui-designer.md
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
- `/debug-mode`
- `/fix-issues`
- `/mine-workflows`
- `/optimize-skill`
- `/orchestrate`
- `/run-to-completion`
- `/resolve-findings`
- `/triage-first`
- `/fresh-review`
- `/hard-review`
- `/manual-qa`

Notes:

- Prompt discovery in plain `prompts/` folders is non-recursive, so this repo uses `pi.prompts: ["./prompts"]` and relies on package directory loading to pick up the nested prompt files.
- Prompt filenames are the slash-command names.
- Prompt `description:` values improve autocomplete.
- Prompt `argument-hint:` values show expected optional or required arguments in autocomplete.
- Optional-scope prompts use native prompt-template defaults like `${1:-...}` so blank invocations produce useful scoped instructions instead of empty placeholders. Multi-word focus must be quoted (for example `/repo-audit "auth module"`).
- Prompt frontmatter intentionally omits `model:`, `thinking:`, and other extension-only fields so prompts stay compatible with native Pi prompt templates.
- Prompts may ask the agent to use a named workflow/skill in the body, but they do not depend on prompt-template skill injection.

## Agents

`agents/` stores the reusable source copies of the user-level subagent overrides. Model and thinking vary by role:

- `scout` — `cursor/composer-2-5`, thinking medium, fallback `openai-codex/gpt-5.5`; `defaultContext: fresh`; `output: context.md`; `maxSubagentDepth: 0`
- `researcher` — `openai-codex/gpt-5.5`, thinking medium, fallback `claude-code/fable`; `defaultContext: fresh`; `output: research.md`; `defaultProgress: false`; `maxSubagentDepth: 0`
- `planner` — `claude-code/fable`, thinking medium, fallback `openai-codex/gpt-5.5`; `defaultContext: fresh`; `allowSubagents: true`; `maxSubagentDepth: 1`; `output: plan.md`
- `worker` — `openai-codex/gpt-5.5`, thinking medium, fallback `claude-code/fable`; `defaultContext: fresh`; `allowSubagents: false`; `maxSubagentDepth: 0` (parent may pass `context: "fork"` only for fix-after-review)
- `fixer` — `openai-codex/gpt-5.5`, thinking high, fallback `claude-code/fable`; `defaultContext: fresh`; bounded remediation from an explicit fix list; `maxSubagentDepth: 0`
- `reviewer` — `openai-codex/gpt-5.5`, thinking high, fallback `claude-code/fable`; `defaultContext: fresh`; `output: false`; `maxSubagentDepth: 0`
- `context-builder` — `cursor/composer-2-5`, thinking medium, fallback `openai-codex/gpt-5.5`; `defaultContext: fresh`; `allowSubagents: true`; `maxSubagentDepth: 1`
- `oracle` — `openai-codex/gpt-5.5`, thinking xhigh, no Claude Code fallback because it requires forked Pi transcript context; `defaultContext: fork`; `maxSubagentDepth: 0`
- `ui-designer` — `claude-code/fable`, thinking medium, fallback `claude-code/opus`; `defaultContext: fresh`; `output: false`; `maxSubagentDepth: 0`

Most names intentionally match builtin `pi-subagents` names so the user-level versions override the builtin ones cleanly; `ui-designer` is an added specialist. Agent **model**, **thinking**, **inherit***, **defaultContext**, etc. live **only** in `agents/*.md` frontmatter—no duplicate `subagents.agentOverrides` in `settings.json`, so this repo stays the single source of truth after sync.

Model policy:

- Agent routing favors expected quality while avoiding frontier spend where it does not matter.
- `cursor/composer-2-5` handles cheap breadth and context gathering; `thinking: medium` is kept in frontmatter for consistent status/override display even if the provider ignores it.
- `openai-codex/gpt-5.5` handles default implementation, research, review, and forked oracle work; `fixer`/`reviewer` stay high because explicit remediation and strict review should not half-fix known findings.
- `claude-code/fable` and `claude-code/opus` route through Claude Code CLI inside `pi-subagents` using the user's Claude Code subscription, not Pi's global model registry.
- Invoking agents may override worker/researcher to `openai-codex/gpt-5.5:high` when the child owns high-risk, hard-debug, broad multi-file, architecture/API/security, data-loss, lifecycle/state, release-blocking, or expensive-to-repeat work.
- Claude Code handles planning, UI judgment, and fallback model diversity for fresh-context children. Do not use Claude Code as primary or fallback routing for fork-default agents unless the task includes a compact handoff; Claude Code cannot import a Pi fork transcript.
- Because the parent session is usually `openai-codex/gpt-5.5` at xhigh, use planner/oracle for independent perspective or isolation—not routine extra thinking.
- **`tools:` is intentionally omitted** on every override so children receive Pi’s normal builtin/extension tool surface. Only explicitly nested-capable planning/context agents use `allowSubagents: true` instead of a static tool allowlist (requires current local `pi-subagents`).

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

Pi-subagents supports `outputMode: "file-only"` on the parent `subagent(...)` call, parallel task item, or chain step. It is not enforced by agent frontmatter, so an `output` path by itself still returns saved output inline unless the caller also sets `outputMode: "file-only"`. With current pi-subagents, relative output paths inherited from agent defaults are materialized under the run artifact directory with unique names, so defaults like `context.md`, `research.md`, and `plan.md` do not collide in parallel runs or leave project-root files. Explicit parent-provided output paths are still honored as written. The default `reviewer` override uses `output: false`; ask for an output path only when a durable review artifact is needed.

Use file-only mode with explicit temp/session-artifact paths for report-writing agents when the expected output is large:

```ts
const artifactDir = "/tmp/pi-hard-review.abc123";
subagent({
  agent: "reviewer",
  task: "Review the current diff for correctness issues. Do not edit files.",
  output: `${artifactDir}/reviewer.md`,
  outputMode: "file-only",
  progress: false,
  context: "fresh",
});
```

For quick review fanout, the `reviewer` default already uses `output: false` and `defaultProgress: false`, so the parent receives findings without project files unless it overrides output behavior. For strict saved reviews, use `/hard-review`, which creates a temp artifact directory and gives each reviewer a distinct `output` path. Parent launch defaults are documented in global `~/.pi/agent/AGENTS.md` (async, fresh reviewers, scope in `task`).

Only `planner` and `context-builder` set `allowSubagents: true` with `maxSubagentDepth: 1`; they synthesize broad work and may fan out one layer when explicitly useful. Worker and specialist/leaf agents (`worker`, `scout`, `researcher`, `reviewer`, `fixer`, `oracle`, `ui-designer`) keep `maxSubagentDepth: 0` so they stay focused and cannot fall into child-orchestrator loops. `tools:` remains omitted on every override so children keep Pi’s normal builtin/extension tool surface.

Agents should write bulky logs, diffs, browser snapshots, JSON, and raw command output to `/tmp` or a repo-local gitignored scratch path, then summarize only decision-relevant lines.

## Browser research note

`agents/context-builder.md` is written to use `agent_browser` for live web research and page reading when local repo context is insufficient.

