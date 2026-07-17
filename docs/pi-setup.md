# How I actually use pi at WorkOS

_Last updated July 16, 2026. This reflects my live pi 0.80.10 setup and an eight-day sample of how I used it._

I wrote this for a WorkOS engineer who is new to pi.

The useful part of my setup is not the number of packages I have installed. It is the way the work is divided. One main pi session stays responsible for the task. It gathers context, makes decisions, usually edits the code, verifies the result, and explains what happened. Fresh specialist sessions help with reconnaissance, research, bounded parallel work, and independent review.

That distinction matters. This is not an autonomous swarm, and my normal workflow is not scout → worker → reviewer. The main session is the lead engineer.

This guide describes both the live workflow and the package needed to reproduce it. A local public-core implementation now exists, but the repository is not public and no public release commit exists yet.

The best way to explain the setup is to follow a realistic task, then pull apart the pieces that made it work.

## What pi is

Pi is a coding agent that runs in the terminal, in the same category as Claude Code or Codex CLI. It can read and edit files, run commands, keep long-lived sessions, and load extensions and packages.

Pi's core stays small. You choose the instructions, models, tools, and integrations around it:

- `AGENTS.md` files describe how work should be done.
- Packages and extensions add capabilities such as repository search, browser work, service integrations, or subagents.
- Agent profiles give a fresh pi session a bounded role and model policy.
- Sessions preserve the conversation and tool history so work can continue, compact, branch, or resume.

You do not need to understand all of that before starting. The setup I want to publish will let pi explain the choices and make the approved changes itself.

## A representative task

Consider a sanitized composite of work I do regularly: a Linear issue asks for a behavior change that crosses an API and the Dashboard. The ticket is brief, relevant decisions are scattered through Slack, and the current behavior needs to be checked in the product before changing it.

### 1. The main session takes ownership

I start pi in the repository and give the main session the issue or ask it to fetch the issue from Linear.

Before proposing a change, it reads my global working agreement and the repository's own instructions. Those rules establish the boundaries: inspect before guessing, preserve unrelated work, ask before consequential external actions, and verify the real end state before claiming completion.

The main session remains accountable for the whole task. Delegating part of the work does not delegate that responsibility.

### 2. It gathers connected context

The issue rarely contains the complete story. Through MCP tools, pi can read the Linear issue, find a relevant Slack thread, and inspect approved context in Horizon, our internal engineering MCP service. If the change involves documentation or infrastructure, it can also check Notion or Cloudflare.

MCP is the adapter between pi and another service. Instead of scraping a site or asking me to paste everything into the terminal, pi gets typed operations for the service. Every teammate authenticates their own access. The setup never copies credentials or another person's service data.

The main session decides what context is actually relevant. It does not dump every message or service response into the conversation.

### 3. It maps the code before editing

FFF gives pi fast file and content search. The main session traces the real flow, callers, tests, and repository conventions before it edits anything.

If the surface is unfamiliar or broad, it may launch work in parallel:

- a `scout` maps the relevant code without editing it;
- a `researcher` checks current external documentation or API behavior;
- a `context-builder` produces a compact handoff when the work crosses several systems.

These agents start with fresh context. They receive a focused task instead of the entire parent transcript, then return evidence the main session can inspect.

### 4. The main session decides and implements

Most of the time, the main session makes the change itself. That keeps the design, implementation, and validation loop in one accountable place.

A `worker` is useful when an implementation item is genuinely independent, needs an isolated worktree, or can proceed in parallel without creating coordination overhead. A `fixer` is narrower still: it gets an explicit list of confirmed findings and applies only those fixes.

The parent reads the resulting files and diffs. A child reporting success is evidence to check, not proof that the task is done.

### 5. It verifies the behavior

The first validation is normally the repository's narrowest meaningful automated check. If the behavior is visible in a browser, Agent Browser then exercises the real flow rather than treating unit tests as proof of the user experience.

The deterministic calculator handles arithmetic instead of leaving it to model intuition. The structured question tool is available when a real decision would change scope or safety. Neither should interrupt work that pi can resolve from the repository or current evidence.

### 6. Fresh reviewers challenge the result

The author should not be the only reviewer.

For meaningful code changes, I use fresh review sessions after implementation and validation. `reviewer-gpt` checks the diff at `high` effort. `reviewer-claude` provides a second model family when the risk or breadth justifies it. A generic `reviewer` is available for narrower review work.

The fresh context is deliberate. A reviewer that inherits the implementation conversation also inherits the story the implementer built about why the change is correct. A fresh reviewer has to reconstruct the reasoning from the requirements, diff, tests, and current files.

For changes in `workos/*`, my personal process has a stricter gate: before commit, push, or merge, a fresh `reviewer-gpt` runs my maintainability review and must return with no required changes. Any later code change invalidates that sign-off.

### 7. The main session closes the loop

Valid findings are fixed and reviewed again. The main session reruns the checks that prove the behavior, summarizes what changed, names remaining risk, and stops before a merge or other consequential action unless I explicitly authorized it.

That is the recurring shape of the setup: connected evidence, focused parallel help, main-session ownership, and independent verification.

## What my setup contains

### The working agreement

The most important file is `~/.pi/agent/AGENTS.md`. Repositories add their own `AGENTS.md` for local commands and conventions.

My global agreement says, in plain language:

- make requested local and reversible changes without repeatedly asking permission;
- ask before external writes, destructive actions, production changes, credentials, or security and privacy changes;
- inspect repositories, documentation, logs, CI, and live state instead of guessing;
- preserve unrelated work and prefer an isolated worktree for changes in `workos/*`;
- use Linear for task tracking;
- verify the real outcome before claiming completion;
- run the required independent review before commit, push, or merge;
- stop before merge unless I explicitly requested it.

A small nested-instruction extension also checks `<current project>/.pi/agent/AGENTS.md` on every turn. That lets a repository add pi-specific rules that take effect without restarting the session. Because that file does not itself trigger Pi's project-trust flow, the public extension loads it only when the project already contains another Pi-recognized trust-gated resource and the user has trusted the project.

These process rules are part of explaining my workflow, but the installer should not silently impose all of them on another engineer. It should show the rules and ask which ones they want.

### The tools on the normal path

| Capability | What it contributes |
|---|---|
| FFF | Fast repository file and content search |
| MCP | Typed access to Linear, Slack, Horizon, Notion, Cloudflare, and other approved services |
| Agent Browser | Current documentation, browser-visible verification, dashboards, and screenshots |
| `pi-subagents` | Fresh specialist sessions, parallel work, isolated worktrees, and review artifacts |
| `pi-intercom` | Coordination between separate local pi sessions |
| Calculator | Deterministic arithmetic and small statistical checks |
| Ask Question | Structured input when a user-owned decision is genuinely required |
| Ponytail | Always-on pressure toward existing helpers, standard-library features, deletion, and the smallest root-cause fix |

I do not invoke Ponytail when a task looks complicated. I installed it once, enabled its default Full mode, and leave it enabled for every response. It is baseline behavior, not a workflow I have to remember to run.

The `fitchmultz` Git forks of `pi-subagents` and `pi-intercom` are intentional. They contain newer behavior than the npm releases I evaluated.

### The specialist bench

I keep a larger bench than a new user needs, but I do not use every profile equally.

| Role | Profiles | When I use them |
|---|---|---|
| Reconnaissance | `scout`, `researcher`, `context-builder` | Map unfamiliar code, verify an external contract, or produce a clean cross-system handoff |
| Independent review | `reviewer`, `reviewer-gpt`, `reviewer-claude` | Challenge correctness, validation, maintainability, and completion claims |
| Bounded implementation | `worker`, `fixer` | Implement an independent item or apply a confirmed finding list |
| Direction and planning | `planner`, `oracle` | Split genuinely broad work or compare the current direction with earlier decisions |
| Product review | `ui-designer` | Review rendered behavior, accessibility, responsive layout, and polish |

Ten profiles start fresh. `oracle` is the exception because its job is to compare the current direction with the parent conversation and catch contradictions.

Most are leaf agents and cannot launch more children. Only `planner` and `context-builder` can delegate one level deeper. That keeps a focused job from quietly turning into an unbounded hierarchy.

### The models

My current main model is `openai-codex/gpt-5.6-sol` with thinking set to `max` and OpenAI answer verbosity set to `low`.

The specialist mappings are explicit:

| Profile | Primary model | Fallback | Thinking |
|---|---|---|---|
| `scout` | `openai-codex/gpt-5.6-sol` | none | `medium` |
| `context-builder` | `openai-codex/gpt-5.6-sol` | none | `medium` |
| `researcher` | `openai-codex/gpt-5.6-sol` | `anthropic/claude-fable-5` | `high` |
| `planner` | `openai-codex/gpt-5.6-sol` | `anthropic/claude-fable-5` | `high` |
| `worker` | `openai-codex/gpt-5.6-sol` | `anthropic/claude-fable-5` | `high` |
| `fixer` | `openai-codex/gpt-5.6-sol` | `anthropic/claude-fable-5` | `high` |
| `reviewer` | `openai-codex/gpt-5.6-sol` | `openai-codex/gpt-5.6-terra` | `high` |
| `reviewer-gpt` | `openai-codex/gpt-5.6-sol` | `openai-codex/gpt-5.6-terra` | `high` |
| `reviewer-claude` | `anthropic/claude-fable-5` | `anthropic/claude-opus-4-8` | `high` |
| `oracle` | `openai-codex/gpt-5.6-sol` | none | `high` |
| `ui-designer` | `openai-codex/gpt-5.6-sol` | `anthropic/claude-fable-5` | `high` |

This is not model variety for its own sake. GPT-5.6 Sol is the default because it works well for the main job. Claude is most valuable as an independent reviewer with a genuinely different model family.

I also keep Cursor-backed models in the in-session model picker. Cursor is useful but optional for the setup I want colleagues to adopt.

A faithful installer should use these exact current mappings, show them before writing configuration, and stop with a precise missing-model list if a required primary or fallback model is unavailable. It should not silently substitute a model that happens to look similar.

For the full setup, a teammate needs ChatGPT Plus or Pro with Codex authentication and Claude Pro or Max authentication. Pi's Claude subscription route uses Anthropic extra usage, which may be billed per token rather than drawn from the normal plan limit. Cursor authentication is optional.

### Sessions and small friction reducers

Pi sessions are durable trees, not disposable chat windows. I can resume a session, compact old context, branch from an earlier point, or fork a separate session without losing the original path.

A few extensions make that daily use better:

- goal tracking keeps a long-running objective and its completion contract attached to the session;
- stash parks an editor draft while I send another message, then restores it;
- low OpenAI verbosity keeps routine answers concise;
- tool-duration annotations tell the model when an operation was actually slow;
- session editing lets me rewind and correct an earlier turn;
- message copying retrieves raw session text without terminal formatting.

These are not the center of the workflow, but they remove recurring friction. Goal state appeared in 38 of the 139 sessions I sampled, and stash state appeared in 29.

## Why the specialized agents are worth it

### Fresh context reduces shared blind spots

The main session accumulates assumptions as it investigates and implements. A fresh scout or reviewer is less likely to inherit those assumptions and more likely to notice a missing caller, unsupported claim, or incomplete validation path.

### Independent review changes the job

Implementation asks, “How do I make this work?” Review asks, “What would make this completion claim false?” Separate sessions make that distinction real.

### Parallel research shortens elapsed time

Repository scouting, external documentation, and independent service checks often do not depend on one another. Running them concurrently can save time without creating merge conflicts.

### Bounded roles are easier to verify

A scout reads. A worker implements a named item. A fixer applies a confirmed list. A reviewer does not edit. Narrow authority makes output easier for the parent to inspect and keeps agents from expanding the task on their own.

### Different models catch different problems

A second model family is useful when it provides an independent reading of the same evidence. I use that selectively for review rather than paying for model fanout on every small change.

### Routing controls effort and cost

Scouting does not need the same reasoning budget as a difficult design review. Role-specific model and effort settings let me spend more only where it changes the result.

## What the usage evidence says

I checked 139 top-level sessions from July 8 through July 15. I counted aggregate tool and session metadata, not raw conversation or service content.

| Behavior | Sessions | Share |
|---|---:|---:|
| MCP integrations | 88 | 63% |
| Any subagent | 80 | 58% |
| File edits or writes | 79 | 57% |
| Fresh reviewer profiles | 72 | 52% |
| Browser automation or web search | 63 | 45% |
| FFF repository search | 61 | 44% |
| Goal state | 38 | 27% |
| Stash state | 29 | 21% |
| Worker or fixer profiles | 9 | 6% |

The service usage was concentrated where I would expect it: Linear appeared in 66 sessions, Slack in 62, Cloudflare in 36, Horizon in 28, and Notion in 7.

The important contrast is between main-session edits and delegated implementation. More than half the sessions edited or wrote files, while a worker or fixer appeared in only nine. Reviewers appeared in 72. The main session usually implements; specialists most often provide evidence and independent review.

The sample also shows why I consider browser work, repository search, connected services, goal state, and stash part of the real setup rather than demo features.

Workflow prompt templates did not show the same pattern, so I am not putting my existing prompt library in the recommended default. The public kit needs one setup entry point, not a catalog of commands I rarely invoke.

## What I would recommend to a WorkOS teammate

The installer should offer two paths:

1. **Install my complete core workflow.** This is the recommended path for someone who wants the setup described above.
2. **Choose the parts.** Pi explains each component, shows what it will change, and installs only the selected pieces.

The complete core includes:

- the working-agreement template and nested project instructions;
- the full specialist bench;
- the exact OpenAI and Anthropic role mappings;
- FFF, Agent Browser, MCP, subagents, Intercom, calculator, structured questions, and Ponytail;
- goal, stash, verbosity, duration, session-editing, and message-copying tools;
- harmless validation for every installed capability.

The following remain explicit choices:

- Cursor models and `pi-cursor-sdk`;
- Linear, Slack, Horizon, Notion, and Cloudflare integration setup;
- WorkOS process rules such as Linear tracking, worktrees, and mandatory pre-commit review;
- any project-specific instructions.

## The package I want to publish

The local public-core implementation repurposes and sanitizes `pi-fitch-kit` around this contract. It is still private, and its bootstrap examples intentionally use a public-commit placeholder, so this implementation status is not a claim that the GitHub install target exists yet.

The public package is designed to:

- carry the specialist profiles and their exact model, context, effort, and delegation policies;
- link missing profiles only after setup approval, using an add-only script that never replaces or deletes an existing target;
- bundle the small deterministic calculator and nested-instruction extensions;
- provide one setup entry point;
- install approved dependencies at exact npm versions or Git commits;
- preserve unrelated user configuration, including every existing agent file and symlink;
- show a plan before writing files;
- stop for authentication, service login, paid features, or user-owned process decisions;
- never read or copy credential stores, browser profiles, raw sessions, or service payloads;
- reload pi and run one harmless smoke test for every selected capability;
- report every changed file, installed source, validation result, and remaining manual step.

The structured-question tool already lives in its own repository. I plan to make that repository public rather than duplicate the extension in the kit.

The package's dependency set should cover:

- `git:github.com/fitchmultz/pi-subagents`;
- `git:github.com/fitchmultz/pi-intercom`;
- `npm:@ff-labs/pi-fff`;
- `npm:pi-agent-browser-native` plus its compatible upstream browser dependency;
- `npm:pi-mcp-adapter`;
- `git:github.com/DietrichGebert/ponytail`;
- `npm:pi-codex-goal`;
- `npm:@fitchmultz/pi-stash`;
- `npm:pi-verbosity-control`;
- `npm:pi-tool-duration`;
- `npm:pi-edit-session-in-place`;
- `npm:pi-copy-message`;
- the public `pi-ask-question` Git source;
- optional `npm:pi-cursor-sdk`.

The existing workflow prompt collection should move out of the default installation. A setup prompt is infrastructure; a library of rarely used workflow commands is not core.

## How the bootstrap works

Onboarding is:

1. Install Node.js 24 or newer and pi 0.80.10.
2. Start pi and authenticate ChatGPT/Codex and Claude through their documented user-owned login flows.
3. Paste the bootstrap prompt below after replacing the explicit placeholder with the real authorized public commit.
4. Run `/reload`, then `/fitch-setup`.
5. Choose complete core or individual components, optional Cursor, integrations, and working-agreement sections.
6. Review every proposed package, path, model mapping, and change.
7. Apply the approved setup, reload, and run harmless smoke checks.

The package is not public yet, so the placeholder makes this deliberately non-runnable rather than pretending a public commit exists:

```text
Read the active Pi package, prompt, extension, settings, security, and model documentation. Run exactly `pi install git:github.com/fitchmultz/pi-fitch-kit@__PUBLIC_COMMIT_REQUIRED_BEFORE_RELEASE__ --no-approve` to install the kit; do not substitute a branch, tag, package, version, or model. Do not read credentials, auth stores, browser profiles, raw sessions, or service payloads. Preview every command and changed path, preserve unrelated configuration, and stop on malformed/conflicting configuration. After installation, tell me to run /reload, then use /fitch-setup for the preview-first setup.
```

The bootstrap uses pi as the installer. `setup-manifest.json` is the pin authority and `/fitch-setup` is the setup procedure. There is no runtime bootstrap command or custom wizard.

## Trust and security boundaries

Pi extensions run with the permissions of the user who started pi. Project trust controls whether project-local settings and extensions load; it is not a sandbox.

My personal setup always trusts project-local configuration because I normally work in repositories I already trust. The shared setup should keep Pi's safer project-trust prompt instead.

For subagents, the installer should set `projectTrust.childRuns: inherit` in `~/.pi/agent/extensions/subagent/config.json`. That forwards an explicit parent `--approve` or `--no-approve` CLI flag to non-interactive child sessions; it does not reuse a trust choice made interactively in the parent. Untrusted repositories should use `no-approve`.

The package and guide must never distribute:

- authentication files or OAuth state;
- service credentials or private endpoints;
- browser profiles;
- raw pi sessions;
- generated model catalogs or caches;
- copied service responses.

Every engineer authenticates their own providers and services. Consequential external writes, production actions, account changes, and merges still require explicit authorization.

## What comes next

Before release, review and validate the local public-core implementation, make every referenced Fitch dependency public, commit the package, replace the explicit placeholder in a docs-only follow-up with that immutable package commit, and test the flow as a fresh WorkOS engineer install. None of those release actions are implied by the local implementation.

Only after that should I derive the shorter post or adapt the setup for a general public audience.
