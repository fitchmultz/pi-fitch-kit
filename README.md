# pi-fitch-kit

Personal Pi package repo for reusable prompt templates plus source-managed user subagents.

## What this repo does

- Keeps reusable prompt templates in one package repo.
- Loads prompts recursively through `package.json#pi.prompts`.
- Keeps reusable user-agent overrides in `agents/` as the source of truth.
- Symlinks those agents into `~/.pi/agent/agents/` while iterating locally.
- Lets prompts inherit the active Pi model by omitting `model:` from prompt frontmatter.
- Sets explicit subagent model defaults so high-turn helper roles do not accidentally inherit expensive parent models.

## Layout

```text
pi-fitch-kit/
  package.json
  prompts/
    audit/
      precommit-review.md
      repo-audit.md
      extension-audit.md
    execute/
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
    planner.md
    reviewer.md
    scout.md
    worker.md
  scripts/
    sync-agents.sh
  README.md
```

## Prompts

These prompts are available through the package manifest:

- `/precommit-review`
- `/repo-audit`
- `/extension-audit`
- `/run-to-completion`
- `/resolve-findings`
- `/triage-first`
- `/fresh-review`
- `/manual-qa`

Notes:

- Prompt discovery in plain `prompts/` folders is non-recursive, so this repo uses `pi.prompts: ["./prompts"]` and relies on package directory loading to pick up the nested prompt files.
- Prompt filenames are the slash-command names.
- Prompt `description:` values improve autocomplete.
- Prompt frontmatter intentionally omits `model:` so prompts inherit the current Pi model.
- `thinking:` is set on audit/review/orchestration prompts because the global default is low.

## Agents

`agents/` stores the reusable source copies of the user-level subagent overrides:

- `scout` - `openai-codex/gpt-5.3-codex`, medium thinking
- `delegate` - `openai-codex/gpt-5.3-codex`, medium thinking
- `context-builder` - `openai-codex/gpt-5.4`, medium thinking
- `planner` - `openai-codex/gpt-5.4`, high thinking
- `worker` - `openai-codex/gpt-5.4`, medium thinking
- `reviewer` - `openai-codex/gpt-5.4`, high thinking

These names intentionally match the builtin `pi-subagents` names so the user-level versions override the builtin ones cleanly.

Model policy:

- Use `openai-codex/gpt-5.3-codex` for retrieval-heavy, bounded, non-authoritative helper work when quality floor matters more than the cheapest possible helper.
- Use `openai-codex/gpt-5.4` for authoritative planning, implementation, synthesis, and review defaults.
- Use `openai-codex/gpt-5.5` only as an explicit per-run escalation for complex architecture, hard debugging, security/data-loss review, or final high-stakes adversarial review.
- Do not make `xhigh` a default; escalate thinking per run only when the task justifies it.

## Install and sync

Install the package globally from this local path:

```bash
pi install /Users/mitchfultz/Projects/AI/pi-fitch-kit
```

Sync the user agents into `~/.pi/agent/agents/`:

```bash
bash scripts/sync-agents.sh
```

Because this is a local-path package install, Pi points at this repo directly instead of copying it. Edits here become the live source of truth.

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

For quick review fanout where no artifact is needed, use `output: false` and `progress: false` so the parent receives only concise findings.

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
