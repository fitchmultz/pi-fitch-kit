# How I actually use pi at WorkOS

_Last updated August 1, 2026. This reflects my live pi 0.83.0 setup. The usage numbers near the end are still the July 8 through July 15 sample and have not been recounted._

I wrote this for a WorkOS engineer who is new to pi.

The useful part of my setup is not the number of packages I have installed. It is the way the work is divided. One main pi session stays responsible for the task. It gathers context, makes decisions, usually edits the code, verifies the result, and explains what happened. Fresh specialist sessions help with reconnaissance, research, bounded parallel work, and independent review.

That distinction matters. This is not an autonomous swarm, and my normal workflow is not scout → worker → reviewer. The main session is the lead engineer.

This guide describes the live workflow and the package that reproduces it. The [pi-fitch-kit](https://github.com/fitchmultz/pi-fitch-kit) repository ships the agent profiles, prompts, pinned dependency manifest, and a `/fitch-setup` entry point; the honest caveats about its freshness are near the end.

The best way to explain the setup is to follow a realistic task, then pull apart the pieces that made it work.

## What pi is

Pi is a coding agent that runs in the terminal, in the same category as Claude Code or Codex CLI. It can read and edit files, run commands, keep long-lived sessions, and load extensions and packages.

Pi's core stays small. You choose the instructions, models, tools, and integrations around it:

- `AGENTS.md` files describe how work should be done.
- Packages and extensions add capabilities such as repository search, browser work, service integrations, or subagents.
- Agent profiles give a fresh pi session a bounded role and model policy.
- Sessions preserve the conversation and tool history so work can continue, compact, branch, or resume.

You do not need to understand all of that before starting. The setup path in the kit has pi explain the choices and make only the approved changes itself, because pi reading its own current documentation beats me writing a wiki page that goes stale.

## A representative task

Consider a sanitized composite of work I do regularly: a Linear issue asks for a behavior change that crosses an API and the Dashboard. The ticket is brief, relevant decisions are scattered through Slack, and the current behavior needs to be checked in the product before changing it.

### 1. The main session takes ownership

I start pi in the repository and give the main session the issue or ask it to fetch the issue from Linear.

Before proposing a change, it reads my global working agreement and the repository's own instructions. Those rules establish the boundaries: inspect before guessing, preserve unrelated work, ask before consequential external actions, and verify the real end state before claiming completion.

The main session remains accountable for the whole task. Delegating part of the work does not delegate that responsibility.

### 2. It gathers connected context

The issue rarely contains the complete story. Through MCP tools, pi can read the Linear issue, find relevant Slack or GitHub context, and inspect approved context in Horizon, our internal engineering MCP service. The current catalog also covers Plain, Granola, Notion, Cloudflare, Sentry, and Datadog when the task needs them.

MCP is the adapter between pi and another service. Instead of scraping a site or asking me to paste everything into the terminal, pi gets typed operations for the service. Every teammate authenticates their own access. The setup never copies credentials or another person's service data.

The main session decides what context is actually relevant. It does not dump every message or service response into the conversation.

### 3. It maps the code before editing

FFF gives pi fast file and content search. That speed compounds: an agent searches constantly, so slow search quietly taxes every step of every task. The main session traces the real flow, callers, tests, and repository conventions before it edits anything.

If the surface is unfamiliar or broad, it may launch work in parallel:

- a `scout` maps the relevant code without editing it;
- a `researcher` checks current external documentation or API behavior;
- a `context-builder` produces a compact handoff when the work crosses several systems.

These agents start with fresh context. They receive a focused task instead of the entire parent transcript, then return evidence the main session can inspect.

### 4. The main session decides and implements

Most of the time, the main session makes the change itself. That keeps the design, implementation, and validation loop in one accountable place.

A `debugger` reproduces a failure and proves its root cause without editing, so diagnosis cannot quietly turn into an unreviewed fix. A `worker` is useful when an implementation item is genuinely independent, needs an isolated worktree, or can proceed in parallel without creating coordination overhead. A `fixer` is narrower still: it gets an explicit list of confirmed findings and applies only those fixes.

The parent reads the resulting files and diffs. A child reporting success is evidence to check, not proof that the task is done.

### 5. It verifies the behavior

The first validation is normally the repository's narrowest meaningful automated check. If the behavior is visible in a browser, Agent Browser then exercises the real flow rather than treating unit tests as proof of the user experience.

The deterministic calculator handles arithmetic instead of leaving it to model intuition. The structured question tool is available when a real decision would change scope or safety. Neither should interrupt work that pi can resolve from the repository or current evidence.

### 6. Fresh reviewers challenge the result

Independent review runs after implementation and validation when the workflow requires a review gate. I launch a fresh `reviewer-gpt` Pi subagent in async mode to check structure, maintainability, and correctness. `reviewer-claude` challenges hidden assumptions, edge cases, and product risk from a different model family, and it joins the gate when a change warrants cross-model coverage; the `hard-review` command always runs both. Blocking findings are fixed before the reviewer reruns, cheap non-blocking ones are fixed in place, and the rest become follow-ups.

The fresh context is deliberate. A reviewer that inherits the implementation conversation also inherits the story the implementer built about why the change is correct. A fresh reviewer has to reconstruct the reasoning from the requirements, diff, tests, and current files.

`/hard-review` runs both reviewers for the strict gate. Every PR runs `reviewer-gpt` before it is ready to ship, and pulls in `reviewer-claude` when the change warrants a second model; local non-PR work only needs a formal review when the workflow or risk requires one. I still stop before merge unless I explicitly authorized it.

### 7. The main session closes the loop

When review is used, valid findings are fixed and reviewed again. The main session reruns the checks that prove the behavior, summarizes what changed, names remaining risk, and stops before a merge or other consequential action unless I explicitly authorized it.

That is the recurring shape of the setup: connected evidence, focused parallel help, main-session ownership, and independent verification.

## What my setup contains

### The working agreement

The most important file is `~/.pi/agent/AGENTS.md`. Repositories add their own `AGENTS.md` for local commands and conventions.

My global agreement says, in plain language:

- make requested local and reversible changes without repeatedly asking permission;
- ask before external writes, destructive actions, production changes, credentials, or security and privacy changes;
- inspect repositories, documentation, logs, CI, and live state instead of guessing;
- preserve unrelated work and prefer an isolated worktree for shared-repository changes;
- use Linear for task tracking;
- verify the real outcome before claiming completion;
- use independent review when I ask for it or when risk makes it worthwhile, not as a blanket commit or push gate;
- stop before merge unless I explicitly requested it.

These process rules are part of explaining my workflow, but the installer should not silently impose all of them on another engineer. It should show the rules and ask which ones they want.

### The tools on the normal path

| Capability | What it contributes |
|---|---|
| FFF | Fast repository file and content search |
| MCP | Typed access to Linear, Slack, Horizon, Notion, Cloudflare, and other approved services |
| Agent Browser | Current documentation, browser-visible verification, dashboards, and screenshots |
| Macuse | Native macOS app inspection and control when browser DOM or CLI tools are insufficient (private repository) |
| Apply Edits | Default file mutation tool, replacing Pi's built-in `edit` and `write` tools |
| `pi-subagents` | Fresh specialist sessions, parallel work, isolated worktrees, and review artifacts |
| `pi-intercom` | Coordination between separate local pi sessions |
| Calculator | Deterministic arithmetic and small statistical checks |
| Ask Question | Structured input when a user-owned decision is genuinely required |
| Ponytail | Always-on pressure toward existing helpers, standard-library features, deletion, and the smallest root-cause fix |
| Cursor SDK | Supplies the `cursor/grok-4.5` first fallback for Grok-backed agents |
| Todo List | Nested task list that survives context compaction on multi-step work |
| Session Name | Names each session so past work stays searchable |
| Change Dir | Moves the session working directory once instead of prefixing every command with `cd` |
| PR Hawk | Watches my open pull requests and reports what needs attention (private repository, currently disabled) |

`pi-apply-edits` exposes `apply_edits` as the one active mutation tool and removes Pi's built-in `edit` and `write` tools before the first model turn. One mutation tool means one set of edit semantics to trust: exact edits, whole-file rewrites, and plan-first multi-file batches that either all apply or none do. The built-ins remain available through an explicit session opt-in and should stay enabled on platforms where existing-file replacement is unsupported.

I do not invoke Ponytail when a task looks complicated. I installed it once, set its default to Ultra, and leave it enabled for every response. It is baseline behavior, not a workflow I have to remember to run.

The `fitchmultz` Git forks of `pi-subagents` and `pi-intercom` are intentional. They contain newer behavior than the npm releases I evaluated.

### The skill library

`~/.agents/skills` is the source of truth for my user-authored skills. The current automatically matched set is:

- `ask-clarifying-questions`, `deslop`, `diagram-creation`, `dogfood`, `external-repo-integration`, and `handoff`;
- `pi-extension-development`, `propose-then-ship-pi`, `root-cause-triage`, `ssh-unix-ops`, `tdd`, `thermo-nuclear-code-quality-review`, and `verification-before-completion`.

Package skills add `pi-subagents`, `pi-intercom`, `macuse`, `ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, and `ponytail-help`. Pi keeps only skill names and descriptions in the base prompt, then loads a full `SKILL.md` when the task matches.

`agent-skill-engineering`, `collaborative-coding`, `comprehensive-codebase-audit`, `crabbox-platform-testing`, `cueloop`, `gogcli`, `pdf`, `peekaboo`, `platform-validation`, `propose-then-ship` (superseded by its pi port), `readme-great-demo`, `slides`, `weekly-review`, and `workflow-from-chats` remain installed but are excluded from normal Pi discovery. `bro` is explicit-only through `disable-model-invocation`. This keeps the default catalog focused without deleting occasional workflows.

### The specialist bench

I keep a larger bench than a new user needs, but I do not use every profile equally.

| Role | Profiles | When I use them |
|---|---|---|
| Reconnaissance | `scout`, `researcher`, `context-builder` | Map unfamiliar code, verify an external contract, or produce a clean cross-system handoff |
| Diagnosis | `debugger` | Reproduce a failure, prove the root cause, and define the smallest regression check before remediation |
| Independent review | `reviewer`, `reviewer-gpt`, `reviewer-claude` | Challenge correctness, validation, maintainability, and completion claims |
| Security review | `reviewer-security` | Check changed code, dependencies, and exposed surfaces for security and data-safety problems |
| Bounded implementation | `worker`, `fixer` | Implement an independent item or apply a confirmed finding list |
| Direction and planning | `planner`, `oracle` | Split genuinely broad work or compare the current direction with earlier decisions |
| Product review | `ui-designer` | Review rendered behavior, accessibility, responsive layout, and polish |
| Writing | `writer` | Draft documentation, guides, announcements, and polished human-facing copy |

There are fourteen profiles. Thirteen start fresh. `oracle` is the exception because its job is to compare the current direction with the parent conversation and catch contradictions.

All profiles are leaf agents and cannot launch more children. That keeps a focused job from quietly turning into an unbounded hierarchy.

### The models

My current default main model is `anthropic/claude-opus-5` with thinking set to `max`. I switch the main session to `openai-codex/gpt-5.6-sol` for work where I want the Codex route, and both GPT-5.6 Sol routes run at `low` answer verbosity. Codex priority mode is enabled. The model picker is limited to `anthropic/claude-opus-5`, `anthropic/claude-fable-5`, `openai-codex/gpt-5.6-sol`, and `xai/grok-4.5`. When the session compacts, a local extension tries `xai/grok-4.5` at `high`, then `openai-codex/gpt-5.6-luna` at `high`, before falling back to the active model.

The specialist mappings are explicit:

| Profile | Primary model | Fallback | Thinking |
|---|---|---|---|
| `scout` | `xai/grok-4.5` | `cursor/grok-4.5`, `openai-codex/gpt-5.6-sol`, then `openai/gpt-5.6-sol` | `high` |
| `context-builder` | `xai/grok-4.5` | `cursor/grok-4.5`, `openai-codex/gpt-5.6-sol`, then `openai/gpt-5.6-sol` | `high` |
| `debugger` | `openai-codex/gpt-5.6-sol` | `anthropic/claude-fable-5`, then `openai/gpt-5.6-sol` | `high` |
| `researcher` | `openai-codex/gpt-5.6-sol` | `openai/gpt-5.6-sol`, then `anthropic/claude-opus-5` | `xhigh` |
| `planner` | `openai-codex/gpt-5.6-sol` | `anthropic/claude-fable-5`, then `openai/gpt-5.6-sol` | `xhigh` |
| `worker` | `xai/grok-4.5` | `cursor/grok-4.5`, `openai-codex/gpt-5.6-sol`, `openai/gpt-5.6-sol`, then `anthropic/claude-opus-5` | `high` |
| `fixer` | `xai/grok-4.5` | `cursor/grok-4.5`, `openai-codex/gpt-5.6-sol`, `openai/gpt-5.6-sol`, then `anthropic/claude-opus-5` | `high` |
| `reviewer` | `openai-codex/gpt-5.6-sol` | `openai/gpt-5.6-sol`, `cursor/gpt-5.6-sol@272k`, then `openai-codex/gpt-5.6-terra` | `high` |
| `reviewer-gpt` | `openai-codex/gpt-5.6-sol` | `openai/gpt-5.6-sol`, `cursor/gpt-5.6-sol@272k`, then `openai-codex/gpt-5.6-terra` | `xhigh` |
| `reviewer-claude` | `anthropic/claude-fable-5` | `anthropic/claude-opus-5`, then `xai/grok-4.5` | `xhigh` |
| `reviewer-security` | `anthropic/claude-fable-5` | `xai/grok-4.5`, then `openai-codex/gpt-5.6-terra` | `xhigh` |
| `oracle` | `openai-codex/gpt-5.6-sol` | `openai/gpt-5.6-sol`, then `cursor/gpt-5.6-sol@272k` | `xhigh` |
| `ui-designer` | `anthropic/claude-fable-5` | `anthropic/claude-opus-5`, `openai-codex/gpt-5.6-sol`, then `openai/gpt-5.6-sol` | `xhigh` |
| `writer` | `anthropic/claude-fable-5` | `anthropic/claude-opus-5` | `high` |

This is not model variety for its own sake. GPT-5.6 Sol carries diagnosis, planning, research, GPT review, and oracle work, and it is the quality fallback for every Grok-backed role. Every Sol-primary role keeps `openai/gpt-5.6-sol` in its fallback chain so a Codex-route failure can reach the same model through the OpenAI API. The Cursor route provides the first fallback to the same Grok 4.5 model before switching model families. Grok 4.5 at high effort handles scouting, context building, bounded implementation, and confirmed fixes because it is dramatically faster while remaining strong enough under a smart parent agent. Opus 5 is the main session model, where a wrong conclusion is expensive and worth its higher per-task cost. Fable 5 leads writing, cross-model review, security review, and UI review. Xhigh is reserved for consequential research, planning, the strict review gates, UI review, and oracle decisions.

The profile body is what `pi-subagents` passes as the role system prompt, so it contains task instructions, evidence standards, boundaries, and output expectations. Model, effort, and context stay in frontmatter; launch guidance stays in orchestration documentation instead of being narrated back to the model.

The benchmark rationale and Artificial Analysis plus CursorBench 3.2 source metrics are available as [PDF](./Model_Reference_Sheet_Artificial_Analysis_2026-07-26.pdf) and [DOCX](./Model_Reference_Sheet_Artificial_Analysis_2026-07-26.docx), refreshed from the live leaderboard on 26 July 2026. Cursor reports Grok 4.5 high at 66.7% and $1.51/task, while the independent Artificial Analysis snapshot records 88 tok/s, 16.3 seconds E2E, 54 intelligence, 45.7 agentic, and 72.4 coding. Cursor disclosed that Grok benefited from an older Cursor codebase snapshot in training, so I discount its exact CursorBench rank rather than discard the independently corroborated speed/value signal.

The 26 July refresh grew CursorBench 3.2 from 42 to 50 entries by adding Claude Opus 5 at five effort levels and Gemini 3.6 Flash at three. No previously recorded value changed. Opus 5 wins on both score and cost against Fable 5 at low, high, and extra high effort, which covers every effort level these overrides use, so `anthropic/claude-opus-5` is the main session model. Opus 5 high also reaches 66.7% at $3.91, matching Grok 4.5 high's score without the contamination caveat and beating GPT-5.6 Sol extra high by 2.2 points at effectively the same cost. Fable 5 leads `writer` because it tops the separate Artificial Analysis writing benchmark at roughly 2,810 Elo, which CursorBench does not measure. It also leads `reviewer-claude`, `reviewer-security`, and `ui-designer`. Opus 5 sits directly behind it on all of those except `reviewer-security`. Claude Opus 4.8 and Sonnet 5 are now fully superseded and appear in no override. Neither Opus 5 nor Gemini 3.6 Flash has Artificial Analysis coverage, so their speed, latency, and general-capability profiles remain unverified.

Pi exposes `xai/grok-4.5` through its built-in xAI provider. Authenticate with `/login xai` using a Grok/X subscription or xAI API key. The separately installed `pi-cursor-sdk` package and a Cursor SDK API key supply `cursor/grok-4.5`. All four Grok-backed profiles fall back first to Cursor's Grok route and then GPT-5.6 Sol; `fixer` and `worker` finally fall back to Opus 5. The same Cursor SDK key also supplies `cursor/gpt-5.6-sol@272k`, which sits behind the OpenAI API route on both GPT review gates and on `oracle`, whose fork context rules out an Anthropic route.

A faithful installer should use these exact current mappings, show them before writing configuration, and stop with a precise missing-model list if a required route is unavailable. It should not silently substitute a model that happens to look similar.

For the full setup, a teammate needs ChatGPT Plus or Pro with Codex authentication, Claude Pro or Max authentication, and xAI authentication. Two optional keys deepen the fallbacks: an OpenAI API key keeps Sol reachable if the Codex route fails, and a Cursor SDK API key adds the `cursor/*` routes. Pi's Claude subscription route uses Anthropic extra usage, which may be billed per token rather than drawn from the normal plan limit.

### Sessions and small friction reducers

Pi sessions are durable trees, not disposable chat windows. I can resume a session, compact old context, branch from an earlier point, or fork a separate session without losing the original path.

A few extensions make that daily use better:

- goal tracking keeps a long-running objective and its completion contract attached to the session;
- stash parks an editor draft while I send another message, then restores it;
- low OpenAI verbosity keeps routine answers concise;
- Codex priority mode lowers latency for the main model;
- Grok-then-Luna compaction avoids spending the main model's maximum effort on summaries;
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

Scouting, context assembly, bounded implementation, and confirmed repair lists benefit from low elapsed time under a smart parent agent. Grok high gives those roles fast, strong execution; Sol and Claude remain the quality gates.

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

Workflow prompt templates did not show the same pattern. They still ship with the kit because they live in the same package, but the setup story is one entry point; the rarely used commands just sit in autocomplete until wanted.

## What I would recommend to a WorkOS teammate

The installer should offer two paths:

1. **Install my complete core workflow.** This is the recommended path for someone who wants the setup described above.
2. **Choose the parts.** Pi explains each component, shows what it will change, and installs only the selected pieces.

The complete core includes:

- the working-agreement template;
- the full specialist bench and prompt library, which arrive with the kit itself;
- the exact OpenAI, Anthropic, xAI, and Cursor role mappings with explicit Cursor and Sol fallbacks;
- FFF, Agent Browser, MCP, subagents, Intercom, Apply Edits, structured questions, todo list, session naming, working-directory switching, goal, stash, verbosity, duration, session editing, message copying, Ponytail, and the Cursor SDK route;
- offers to build the calculator, Codex priority, and custom compaction equivalents you approve;
- harmless validation for every installed capability.

My skills live in `~/.agents/skills` and are not part of the kit; the setup preserves whatever skill library you already have instead of imposing mine.

The following remain explicit choices:

- Linear, Slack, GitHub, Horizon, Plain, Granola, Notion, Cloudflare, Sentry, and Datadog integration setup;
- process rules such as Linear tracking, worktrees, and when independent review is warranted;
- any project-specific instructions.

## The package that ships this

The public [`pi-fitch-kit`](https://github.com/fitchmultz/pi-fitch-kit) repository is that package. It carries the fourteen specialist profiles with their exact model, effort, context, and delegation policies, the prompt library, a small extension that symlinks the profiles into place on startup, and the setup path: a `/fitch-setup` entry point plus a `setup-manifest.json` that pins every dependency to an exact npm version or Git commit.

The manifest exists because "copy my setup" should not mean an agent improvising from prose. Prose drifts; a manifest can be checked. The kit's own validation fails if a profile uses a model route the manifest does not list, if a pinned resource goes missing, or if the setup prompt's profile count drifts. Prose can still lag; the frontmatter and the manifest are the authority.

The rules `/fitch-setup` works under:

- install only sources and versions from the manifest, exactly as pinned;
- preserve unrelated user configuration;
- show one complete preview before writing anything;
- stop for authentication, service login, paid features, or user-owned process decisions;
- never read or copy credential stores, browser profiles, raw sessions, or service payloads;
- reload pi and run one harmless smoke test for every selected capability;
- report every changed file, installed source, validation result, and remaining manual step.

Every engineer authenticates their own providers, which is why the setup prompt treats logins as steps it asks you to do rather than things it does.

The pinned dependency set covers subagents, Intercom, Apply Edits, structured questions, todo list, session naming, working-directory switching, Ponytail, FFF, Agent Browser plus its upstream browser dependency, the MCP adapter, goal tracking, stash, verbosity, tool duration, session editing, message copying, and the Cursor SDK route. The exact pins live in the manifest, not here, so this guide cannot rot into a second package list.

Macuse and PR Hawk are part of my current setup, but their repositories are private. The kit leaves them unavailable rather than copying code from my installation or silently substituting another tool.

My small local extensions, the deterministic calculator, the Codex priority toggle, and the custom compaction route, are not in the kit yet. The setup prompt offers to build the smallest current-API equivalent of each one you approve instead of copying mine.

## How the bootstrap works

1. Install the supported Node.js and pi versions.
2. Start pi.
3. Authenticate ChatGPT/Codex, Claude, and xAI through `/login`. An OpenAI API key and a Cursor SDK API key are optional and only feed fallback routes.
4. `pi install git:github.com/fitchmultz/pi-fitch-kit`, then `/reload`. Installing the kit is consent for its bundled pieces: the prompt library loads with the package and the agent bench links on reload.
5. Run `/fitch-setup` for everything beyond that.
6. Choose the complete core or individual components, integrations, process rules, and trust posture.
7. Review the single preview of every install command, file change, and model mapping.
8. Apply, reload, and let it run the smoke checks.

Pi is the installer. The setup prompt reads the active installed pi documentation before changing anything, inspects existing configuration without reading credentials, and leaves every decision that belongs to you as a question rather than a default. `/fitch-setup verify` re-checks an existing install against the manifest without changing anything.

One honest caveat: I have not yet watched this run end to end on a completely clean machine. The pieces are real and validated against my live setup, but treat the first fresh install as something we do together rather than a solo afternoon. That is also just the faster way to do it.

## Trust and security boundaries

Pi extensions run with the permissions of the user who started pi. Project trust controls whether project-local settings and extensions load; it is not a sandbox.

My personal setup currently sets `defaultProjectTrust: always` because I normally work in repositories I already trust. A shared setup should keep Pi's safer project-trust prompt unless the user explicitly chooses otherwise.

I have no subagent config override, so the current `pi-subagents` fork uses its default `projectTrust.childRuns: approve`; an explicitly started parent `--no-approve` run still keeps children at `--no-approve`. A shared installer should show `approve`, `inherit`, and `no-approve` as explicit choices instead of silently copying mine. Untrusted repositories should use `no-approve`.

The package and guide must never distribute:

- authentication files or OAuth state;
- service credentials or private endpoints;
- browser profiles;
- raw pi sessions;
- generated model catalogs or caches;
- copied service responses.

Every engineer authenticates their own providers and services. Consequential external writes, production actions, account changes, and merges still require explicit authorization.

## What comes next

The remaining work is proving the bootstrap on a clean machine, deciding which of my local extensions graduate into the kit, and keeping the manifest pins fresh as the packages move.

The shorter post stays a derivative of this guide rather than becoming a second source of truth, for the same reason the manifest exists: one canonical copy of anything that can drift.
