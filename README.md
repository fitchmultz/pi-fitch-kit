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
      resolve-findings.md
      triage-first.md
    review/
      fresh-review.md
      hard-review.md
    qa/
      manual-qa.md
  agents/
    context-builder.md
    debugger.md
    fixer.md
    oracle.md
    planner.md
    researcher.md
    reviewer-claude.md
    reviewer-gpt.md
    reviewer.md
    scout.md
    ui-designer.md
    worker.md
    writer.md
  docs/
    Model_Reference_Sheet_Artificial_Analysis_2026-07-26.docx
    Model_Reference_Sheet_Artificial_Analysis_2026-07-26.pdf
    pi-setup-post.md
    pi-setup.md
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

- `scout` — `xai/grok-4.5`, thinking high, fallbacks `cursor/grok-4.5` then `openai-codex/gpt-5.6-sol`; `defaultContext: fresh`; `output: context.md`; `maxSubagentDepth: 0`
- `context-builder` — `xai/grok-4.5`, thinking high, fallbacks `cursor/grok-4.5` then `openai-codex/gpt-5.6-sol`; `defaultContext: fresh`; `allowSubagents: false`
- `debugger` — `anthropic/claude-opus-5`, thinking high, fallbacks `anthropic/claude-fable-5` then `openai-codex/gpt-5.6-sol`; `defaultContext: fresh`; read-only root-cause diagnosis; `output: diagnosis.md`; `maxSubagentDepth: 0`
- `fixer` — `xai/grok-4.5`, thinking high, fallbacks `cursor/grok-4.5`, `openai-codex/gpt-5.6-sol`, then `anthropic/claude-opus-5`; `defaultContext: fresh`; bounded remediation from an explicit fix list; `maxSubagentDepth: 0`
- `researcher` — `openai-codex/gpt-5.6-sol`, thinking xhigh, fallback `anthropic/claude-opus-5`; `defaultContext: fresh`; `output: research.md`; `defaultProgress: false`; `maxSubagentDepth: 0`
- `planner` — `anthropic/claude-opus-5`, thinking high, fallbacks `anthropic/claude-fable-5` then `openai-codex/gpt-5.6-sol`; `defaultContext: fresh`; `allowSubagents: false`; `output: plan.md`
- `worker` — `xai/grok-4.5`, thinking high, fallbacks `cursor/grok-4.5`, `openai-codex/gpt-5.6-sol`, then `anthropic/claude-opus-5`; `defaultContext: fresh`; `allowSubagents: false`; `maxSubagentDepth: 0`
- `reviewer` — `openai-codex/gpt-5.6-sol`, thinking high, fallbacks `cursor/gpt-5.6-sol@272k` then `openai-codex/gpt-5.6-terra`; `defaultContext: fresh`; `output: false`; `allowSubagents: false`
- `reviewer-gpt` — `openai-codex/gpt-5.6-sol`, thinking xhigh, fallbacks `cursor/gpt-5.6-sol@272k` then `openai-codex/gpt-5.6-terra`; `defaultContext: fresh`; `output: false`; `allowSubagents: false`
- `reviewer-claude` — `anthropic/claude-opus-5`, thinking xhigh, fallbacks `anthropic/claude-fable-5` then `xai/grok-4.5`; `defaultContext: fresh`; `output: false`; `allowSubagents: false`
- `oracle` — `openai-codex/gpt-5.6-sol`, thinking xhigh, fallback `cursor/gpt-5.6-sol@272k` only, because forked Pi transcript context rules out an Anthropic route; `defaultContext: fork`; `maxSubagentDepth: 0`
- `ui-designer` — `openai-codex/gpt-5.6-sol`, thinking high, fallback `anthropic/claude-opus-5`; `defaultContext: fresh`; `output: false`; `maxSubagentDepth: 0`
- `writer` — `anthropic/claude-fable-5`, thinking high, fallback `anthropic/claude-opus-5`; `defaultContext: fresh`; `output: draft.md`; `defaultProgress: false`; `maxSubagentDepth: 0`

Most names intentionally match builtin `pi-subagents` names so the user-level versions override the builtin ones cleanly; `debugger`, `reviewer-claude`, `reviewer-gpt`, `ui-designer`, and `writer` are added specialists. Agent **model**, **thinking**, **inherit***, **defaultContext**, etc. live **only** in `agents/*.md` frontmatter—no duplicate `subagents.agentOverrides` in `settings.json`, so this repo stays the single source of truth after sync.

Frontmatter owns runtime policy. Each model-facing body stays focused on the role's work, evidence standard, boundaries, and output rather than explaining model or launch configuration.

Model policy:

- `xai/grok-4.5` at high effort is the fast/value primary for `scout`, `context-builder`, `fixer`, and `worker`; all four fall back first to `cursor/grok-4.5`, then `openai-codex/gpt-5.6-sol`, while `fixer` and `worker` retain `anthropic/claude-opus-5` as their third fallback. Grok stays primary in these roles because it matches Opus 5 high's CursorBench score at roughly a third of the cost.
- `openai-codex/gpt-5.6-sol` remains primary for research, GPT review, UI, and oracle work, the quality fallback for every Grok-backed role, and the cross-provider fallback for `debugger` and `planner`.
- Effort is high for Grok-backed and routine specialist work; xhigh is reserved for consequential research, both reviewer gates, and oracle decisions.
- `anthropic/claude-opus-5` is the primary for `debugger`, `planner`, and `reviewer-claude`, and the Anthropic fallback for `fixer`, `researcher`, `ui-designer`, and `worker`. It beats Fable 5 on both CursorBench score and cost at every effort level these overrides use.
- `anthropic/claude-fable-5` is the `writer` primary because it leads the Artificial Analysis writing benchmark, and it stays the first fallback for `debugger`, `planner`, and `reviewer-claude`.
- The Anthropic provider differs per machine: this work machine uses Pi's `anthropic` provider, while the personal machine uses the `claude-code` provider. Only the `claude-code` route carries the fork-transcript restriction below.
- `reviewer` and `reviewer-gpt` fall back to `cursor/gpt-5.6-sol@272k` and then `openai-codex/gpt-5.6-terra`, so a provider-level Codex failure keeps full Sol quality before dropping to Terra. `oracle` uses the same Cursor route as its only fallback because it is fork-context and must stay non-Anthropic.
- Use configured model and thinking defaults unless a concrete routing, provider-capability, model-diversity, or cost requirement justifies an override.
- Do not use the `claude-code` provider as primary or fallback routing for forked invocations; use fresh context with a compact handoff because Claude Code cannot import a Pi fork transcript. This constrains `oracle`, the only fork-context override.
- Grok primaries use Pi's built-in xAI provider; authenticate with `/login xai` using a Grok/X subscription or xAI API key. The `cursor/grok-4.5` fallback requires the separately installed `pi-cursor-sdk` package and a Cursor SDK API key. Use planner/oracle for role and context isolation, not routine extra thinking.
- **`tools:` is intentionally omitted** on every override so agents receive Pi’s normal builtin/extension tool surface. Every override remains a leaf agent and cannot spawn nested subagents.

Benchmark rationale and the Artificial Analysis plus CursorBench 3.2 source metrics are available as [PDF](docs/Model_Reference_Sheet_Artificial_Analysis_2026-07-26.pdf) and [DOCX](docs/Model_Reference_Sheet_Artificial_Analysis_2026-07-26.docx), refreshed 26 July 2026. Grok's exact CursorBench rank is discounted because Cursor disclosed training-data contamination, but its independent speed, cost, and quality evidence still supports the fast/value roles above.

The 26 July refresh added Claude Opus 5 and Gemini 3.6 Flash to CursorBench 3.2. Opus 5 beats Fable 5 on both score and cost at low, high, and extra high effort, so `anthropic/claude-opus-5` is the preferred Anthropic route at the effort levels these overrides actually use. Fable 5 stays the `writer` primary because it leads the separate Artificial Analysis writing benchmark, which CursorBench does not measure. Neither Opus 5 nor Gemini 3.6 Flash has any Artificial Analysis coverage yet, so their evidence is CursorBench-only.

## Subagent context policy

When spawning subagents from parent prompts or code:

- Pass `context: "fresh"` unless the task explicitly requires parent transcript history.
- Use `context: "fork"` only for oracle consistency checks. For fix-after-review continuity, resume the same child or use fresh context with a compact handoff.
- Hand off with artifacts (`context.md`, `plan.md`, `review.md`, `progress.md`) instead of inherited transcript.
- Do not mix scout/reviewer-claude/reviewer-gpt/researcher calls into the same parallel batch as worker/oracle unless each step’s context policy is intentional.

Requires pi-subagents with per-agent context resolution (not whole-invocation fork promotion when any agent defaults to fork).

## Install

Install the package globally from this local path:

```bash
pi install /Users/mitchfultz/Projects/pi-stuff/pi-fitch-kit
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

Pi-subagents supports `outputMode: "file-only"` on the parent `subagent(...)` call, parallel task item, or chain step. It is not enforced by agent frontmatter, so an `output` path by itself still returns saved output inline unless the caller also sets `outputMode: "file-only"`. With current pi-subagents, relative output paths inherited from agent defaults are materialized under the run artifact directory with unique names, so defaults like `context.md`, `research.md`, and `plan.md` do not collide in parallel runs or leave project-root files. Explicit parent-provided output paths are still honored as written. All reviewer overrides use `output: false`; ask for an output path only when a durable review artifact is needed.

Use file-only mode with explicit temp/session-artifact paths for report-writing agents when the expected output is large:

```ts
const artifactDir = "/tmp/pi-hard-review.abc123";
subagent({
  agent: "reviewer-gpt",
  task: "Review the current diff for correctness issues. Do not edit files.",
  output: `${artifactDir}/reviewer-gpt.md`,
  outputMode: "file-only",
  progress: false,
  context: "fresh",
});
```

For quick review fanout, all reviewer defaults use `output: false` and no default progress file, so the parent receives findings without project files unless it overrides output behavior. For strict saved reviews, use `/hard-review`, which creates a temp artifact directory and gives each reviewer a distinct `output` path. Parent launch defaults are documented in global `~/.pi/agent/AGENTS.md` (async, fresh reviewers, scope in `task`).

Every override is configured as a leaf agent through `allowSubagents: false` or `maxSubagentDepth: 0`, so agents stay focused and cannot fall into child-orchestrator loops. `tools:` remains omitted on every override so agents keep Pi’s normal builtin/extension tool surface.

Agents should write bulky logs, diffs, browser snapshots, JSON, and raw command output to `/tmp` or a repo-local gitignored scratch path, then summarize only decision-relevant lines.

## Browser research note

`agents/context-builder.md` is written to use `agent_browser` for live web research and page reading when local repo context is insufficient.
