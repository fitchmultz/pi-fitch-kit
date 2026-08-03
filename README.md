# pi-fitch-kit

A versioned snapshot of my Pi setup: specialist agent profiles, reusable slash commands, a startup extension that keeps them in sync, and a pinned setup path for anyone who wants to copy the workflow.

Tagged releases are known-good snapshots; my live installation and `main` may move ahead between releases.

Two documents explain the setup itself:

- [docs/pi-setup.md](docs/pi-setup.md) — the full guide: workflow, agents, models, skills, evidence, and security boundaries.
- [docs/pi-setup-post.md](docs/pi-setup-post.md) — the short version, with the quickest way to get running.

If you work with me and want this setup, the intended path is:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.83.0
pi
# /login for your providers, then:
pi install git:github.com/fitchmultz/pi-fitch-kit@v0.2.1
# /reload, then:
/fitch-setup
```

Installing the kit is itself the first choice: the prompt library loads with the package, and the agent bench links on reload. `/fitch-setup` then drives everything beyond that from [setup-manifest.json](setup-manifest.json), the machine-readable source of truth for exact package pins, required model routes, and kit resources. It previews before writing, asks which parts you want, and never touches credentials. `/fitch-setup verify` reports drift without changing anything. It exists because "copy my setup" should not mean an agent improvising from prose: the manifest is checkable, the prose is not.

## What this repo does

- Keeps reusable prompt templates in one package repo, loaded recursively through `package.json#pi.prompts`.
- Keeps the user-level subagent profiles in `agents/` as the single source of truth.
- Bundles `extensions/sync-agents.ts`, which symlinks those profiles into `~/.pi/agent/agents/` on Pi startup/reload, so editing this repo edits the live bench. The sync manages only its own links: it never replaces a regular file or a symlink pointing anywhere else, so you can opt out of any bundled profile by putting your own file at that name.
- Pins per-role model, fallback, and thinking policy in `agents/*.md` frontmatter; no duplicate overrides in `settings.json`.
- Ships the setup entry point (`prompts/fitch-setup.md`), the pin manifest (`setup-manifest.json`), and a working-agreement template (`templates/working-agreement.md`).

## Layout

```text
pi-fitch-kit/
  package.json
  setup-manifest.json
  LICENSE
  prompts/
    fitch-setup.md
    audit/        precommit-review, repo-audit, extension-audit,
                  extract-process-improvements, github-open-issues-prs
    execute/      debug-mode, fix-issues, mine-workflows, optimize-skill, orchestrate,
                  resolve-findings, triage-first
    review/       fresh-review, hard-review
    qa/           manual-qa
  agents/
    scout, context-builder, debugger, researcher, planner, worker, fixer,
    reviewer, reviewer-gpt, reviewer-claude, reviewer-security, oracle,
    ui-designer, writer
  templates/
    working-agreement.md
  docs/
    pi-setup.md
    pi-setup-post.md
    Model_Reference_Sheet_Artificial_Analysis_2026-07-26.{pdf,docx}
  extensions/
    sync-agents.ts
  scripts/
    validate.mjs
    package-smoke.mjs
    sync-agents.sh
```

## Prompts

Prompt filenames are the slash-command names: `/fitch-setup`, `/precommit-review`, `/repo-audit`, `/extension-audit`, `/extract-process-improvements`, `/github-open-issues-prs`, `/debug-mode`, `/fix-issues`, `/mine-workflows`, `/optimize-skill`, `/orchestrate`, `/resolve-findings`, `/triage-first`, `/fresh-review`, `/hard-review`, and `/manual-qa`.

Notes:

- Prompt discovery in plain `prompts/` folders is non-recursive, so this repo uses `pi.prompts: ["./prompts"]` and relies on package directory loading to pick up the nested prompt files.
- Prompt `description:` and `argument-hint:` values improve autocomplete.
- Optional-scope prompts use native prompt-template defaults like `${1:-...}` so blank invocations produce useful scoped instructions instead of empty placeholders. Multi-word focus must be quoted (for example `/repo-audit "auth module"`).
- Prompt frontmatter intentionally omits `model:`, `thinking:`, and other extension-only fields so prompts stay compatible with native Pi prompt templates and inherit the active session model.

## Agents

`agents/` stores the fourteen specialist profiles. The exact per-role model, fallback, and thinking mapping lives in each file's frontmatter and is tabulated in [docs/pi-setup.md](docs/pi-setup.md); `npm run check` fails if a profile uses a model route the manifest does not list, so the routes cannot silently drift; order and effort still live in the frontmatter alone. Most names intentionally match builtin `pi-subagents` names so the user-level versions override the builtin ones cleanly; `debugger`, `reviewer-claude`, `reviewer-gpt`, `reviewer-security`, `ui-designer`, and `writer` are added specialists.

Frontmatter owns runtime policy. Each model-facing body stays focused on the role's work, evidence standard, boundaries, and output rather than explaining model or launch configuration, because narrating configuration back to the model wastes prompt budget without changing behavior.

Model policy, and why:

- `xai/grok-4.5` at high effort is the primary for `scout`, `context-builder`, `fixer`, and `worker`. These roles run under a smart parent that checks their output, so elapsed time matters more than the last few points of quality, and Grok matches Opus 5 high's CursorBench score at roughly a third of the cost. All four fall back first to `cursor/grok-4.5` (same model, different provider); `scout` then uses Luna while the other three use Sol. `fixer` and `worker` keep `anthropic/claude-opus-5` as a final fallback because unattended implementation should degrade to a stronger model, not a cheaper one.
- `openai-codex/gpt-5.6-sol` is the primary for `debugger`, `researcher`, `planner`, `reviewer`, `reviewer-gpt`, `reviewer-security`, and `oracle`, and the quality fallback for most Grok-backed roles. Every Sol-primary role keeps `openai/gpt-5.6-sol` in its fallback chain so a Codex-route failure can reach the same model through the OpenAI API instead of losing it entirely; that route needs an OpenAI API key and is optional.
- `anthropic/claude-fable-5` is the primary for `writer`, `reviewer-claude`, and `ui-designer`, where the point is an independent second model family reading the same evidence. `anthropic/claude-opus-5` sits directly behind it on all three.
- Thinking is `high` for speed-sensitive and routine specialist work; `xhigh` is reserved for the roles where a wrong conclusion is expensive: consequential research, planning, the strict review gates, security review, UI review, and oracle decisions.
- `reviewer` and `reviewer-gpt` fall back through `openai/gpt-5.6-sol`, then `cursor/gpt-5.6-sol@272k`, then `openai-codex/gpt-5.6-terra`, keeping full Sol quality through two providers before dropping to Terra.
- `oracle` is the only fork-context agent: its job is to compare a proposed direction against the parent conversation, so it needs the transcript. Its chain stays non-Anthropic because the `claude-code` provider cannot import a Pi fork transcript.
- The Anthropic provider differs per machine: the work machine uses Pi's `anthropic` provider, the personal machine uses `claude-code`. Agent frontmatter keeps `anthropic/*` ids so both machines resolve the same overrides; only the `claude-code` route carries the fork-transcript restriction.
- `tools:` is intentionally omitted on every profile so agents receive Pi's normal builtin/extension tool surface, and every profile is a leaf agent (`allowSubagents: false` or `maxSubagentDepth: 0`) so a focused job cannot quietly become an unbounded hierarchy.
- Grok primaries use Pi's built-in xAI provider (`/login xai`). The `cursor/*` fallbacks require the separately installed `pi-cursor-sdk` package and a Cursor SDK API key; skipping that key only removes those fallbacks.

Benchmark rationale and the Artificial Analysis plus CursorBench 3.2 source metrics are in the [PDF](docs/Model_Reference_Sheet_Artificial_Analysis_2026-07-26.pdf) / [DOCX](docs/Model_Reference_Sheet_Artificial_Analysis_2026-07-26.docx), refreshed 26 July 2026. Grok's exact CursorBench rank is discounted because Cursor disclosed training-data contamination, but its independent speed and cost evidence still supports the fast/value roles.

## Subagent context policy

When spawning subagents from parent prompts or code:

- Pass `context: "fresh"` unless the task explicitly requires parent transcript history. Fresh context is the point: a child that inherits the parent transcript also inherits its blind spots.
- Use `context: "fork"` only for oracle consistency checks. For fix-after-review continuity, resume the same child or use fresh context with a compact handoff.
- Hand off with artifacts (`context.md`, `plan.md`, `review.md`, `progress.md`) instead of inherited transcript.
- Do not mix scout/reviewer/researcher calls into the same parallel batch as worker/oracle unless each step's context policy is intentional.

## Subagent output discipline

Pi-subagents supports `outputMode: "file-only"` on the parent `subagent(...)` call, parallel task item, or chain step. It is not enforced by agent frontmatter, so an `output` path by itself still returns saved output inline unless the caller also sets `outputMode: "file-only"`. Relative output paths inherited from agent defaults are materialized under the run artifact directory with unique names, so defaults like `context.md` and `plan.md` do not collide in parallel runs or leave project-root files. All reviewer profiles use `output: false`; ask for an output path only when a durable review artifact is needed. For strict saved reviews, use `/hard-review`, which creates a temp artifact directory and gives each reviewer a distinct `output` path.

Agents should write bulky logs, diffs, browser snapshots, JSON, and raw command output to `/tmp` or a repo-local gitignored scratch path, then summarize only decision-relevant lines.

## Install

For someone copying the setup, install from Git and let the setup prompt drive:

```bash
pi install git:github.com/fitchmultz/pi-fitch-kit@v0.2.1
# /reload, then /fitch-setup
```

For local development of the kit itself, install from the checkout path so edits become the live source of truth immediately:

```bash
pi install /path/to/pi-fitch-kit
```

Either way the package loads the prompts and the `sync-agents` extension. `scripts/sync-agents.sh` remains only as a manual fallback if Pi is not running or extension loading is disabled. If you change prompts or agent definitions while Pi is running, `/reload` or start a fresh session.

## Repo-local overrides

When a specific project needs custom behavior, override globally installed resources with the same filenames in `.pi/prompts/` and `.pi/agents/`. That preserves stable command names while allowing per-repo specialization.

## Validation

- `npm run check` — syntax-checks the extension, exercises the symlink sync (including the non-symlink conflict guard), and verifies the manifest against the agent profiles, kit resources, package pins, and setup prompt.
- `npm run smoke` — loads the repo as a real Pi package through the SDK in a throwaway agent dir and asserts prompts and the extension load cleanly. Requires `npm install` first.
