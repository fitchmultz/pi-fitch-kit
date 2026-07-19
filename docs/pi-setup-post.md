# How I actually use pi at WorkOS

_Updated July 19, 2026 for pi 0.80.10._

I wrote this for WorkOS engineers who are curious about my pi setup but have not used pi before.

Pi is a terminal coding agent in the same category as Claude Code or Codex CLI. Its core is deliberately small. The useful part of my setup is the workflow around it: connected context, fast repository search, fresh specialist sessions, independent review, and one main session that remains accountable for the work.

## A representative task

Consider a sanitized example: a Linear issue asks for a behavior change that crosses an API and the Dashboard. The ticket is brief, relevant decisions are scattered through Slack, and the current product behavior needs to be checked before anything changes.

I start pi in the repository and give the issue to the main session. That session owns the task from start to finish.

It can fetch the Linear issue, find the relevant Slack thread, and inspect approved context in Horizon, our internal engineering MCP service. FFF maps the code, callers, tests, and repository conventions. If the behavior is browser-visible, Agent Browser checks the real flow before and after the change.

Specialists help when there is a reason:

- `scout` maps unfamiliar or broad code without editing;
- `researcher` checks a current external contract or documentation;
- `context-builder` prepares a compact handoff across several systems;
- `debugger` proves a root cause before remediation;
- `worker` implements a genuinely independent item;
- `fixer` applies a confirmed list of findings;
- `planner` decomposes genuinely broad work;
- `oracle` checks the current direction against established decisions;
- `ui-designer` reviews rendered behavior, accessibility, layout, and polish;
- `reviewer`, `reviewer-gpt`, and `reviewer-claude` challenge the completed diff from fresh context;
- `writer` handles polished human-facing documentation and announcements.

Most of the time, the main session still implements the change. It reads specialist output, decides what to do, edits the code, runs the meaningful checks, and verifies the actual behavior. A child saying that work passed is evidence to inspect, not proof.

For meaningful code changes, a fresh reviewer runs after implementation and validation. In `workos/*`, my personal rules require a clean `reviewer-gpt` maintainability review before commit, push, or merge. Any later code change invalidates that sign-off. The main session fixes valid findings, reruns the checks, and stops before merge unless I explicitly authorized it.

That is the recurring shape: gather connected evidence, use focused parallel help where it pays off, keep implementation accountable to one session, and review the completion claim independently.

## Why the specialist sessions help

Fresh context is the main benefit. The implementation session accumulates assumptions as it works. A fresh scout or reviewer has to reconstruct the answer from the requirements, current files, diff, and validation instead of inheriting the implementer's story.

The roles are bounded on purpose. A scout reads. A debugger diagnoses. A worker implements one named item. A fixer applies a confirmed list. A reviewer reports findings without editing. A writer produces copy without publishing it. Narrow authority makes the output easier for the main session to verify and keeps a small delegation from turning into an agent hierarchy.

Different jobs also deserve different routing. GPT-5.6 Sol remains the quality-first coding, diagnosis, and review model. The speed-sensitive `scout`, `context-builder`, and `fixer` use `cursor/grok-4.5` at high effort, with explicit Sol fallback when Cursor is unavailable. Claude is useful selectively as a second model family for review and writing, not as automatic fanout on every task.

Grok earns that role from two independent views. CursorBench 3.2 reports 66.7% at $1.51/task, while the Artificial Analysis snapshot records 88 tok/s and 16.3 seconds end to end. Cursor disclosed that Grok benefited from an older Cursor codebase snapshot in training, so I discount its exact CursorBench rank rather than ignore the independently corroborated speed, cost, and competitive quality. The complete benchmark sheet is available as [PDF](./Model_Reference_Sheet_Artificial_Analysis_2026-07-18.pdf) and [DOCX](./Model_Reference_Sheet_Artificial_Analysis_2026-07-18.docx).

## What is on the normal path

The working agreement matters more than any individual model setting. My global `AGENTS.md` tells pi to inspect real evidence instead of guessing, preserve unrelated work, make requested local and reversible changes without repeated permission, ask before consequential external actions, and verify the end state before claiming completion. Repository instructions add local commands and conventions.

The tools I use regularly are:

- FFF for fast repository search;
- MCP for typed access to Linear, Slack, Horizon, Notion, Cloudflare, and other approved services;
- Agent Browser for current documentation and browser-visible verification;
- `pi-subagents` for fresh specialists, parallel work, and isolated worktrees;
- `pi-intercom` for coordination between separate local pi sessions;
- a deterministic calculator for arithmetic;
- structured questions when a real user decision changes scope or safety;
- goal, stash, low-verbosity, duration, session-editing, and message-copying tools for long-running work.

Ponytail is always on in Full mode. It pushes the agent toward existing helpers, the standard library, native platform features, deletion, and the smallest root-cause fix. I do not remember to invoke it for complicated tasks; it is baseline behavior for every response.

The sessions themselves are durable. I can resume yesterday's work, compact older context, branch from an earlier point, or fork a separate session without losing the original path.

## This is how I actually use it

I checked 139 top-level sessions from July 8 through July 15, 2026. I counted aggregate tool and session metadata, not raw conversations or service content.

- MCP appeared in 63% of sessions.
- Subagents appeared in 58%.
- File edits or writes appeared in 57%.
- Fresh reviewers appeared in 52%.
- Browser work or web search appeared in 45%.
- FFF appeared in 44%.
- Worker or fixer profiles appeared in only 6%.

That last contrast is important. The main session usually implements. Specialists are used much more often for evidence and independent review than as autonomous workers.

## Install the public setup

The public package is [`fitchmultz/pi-fitch-kit`](https://github.com/fitchmultz/pi-fitch-kit). It targets Node.js 24 or newer and pi 0.80.10. A faithful setup requires access to the exact ChatGPT/Codex and Anthropic models in the package manifest; it stops instead of silently substituting another model. Cursor is optional. Selecting it installs `pi-cursor-sdk`. Declining Cursor installation does not disable a preinstalled Cursor provider or rewrite routing. The three Grok-backed profiles use Sol only when the Grok route cannot run.

After installing pi and authenticating ChatGPT/Codex and Claude through their documented login flows, paste this into a pi session:

```text
Read the active Pi package, prompt, extension, settings, security, and model documentation. Run exactly `pi install git:github.com/fitchmultz/pi-fitch-kit@4aaad82ba734fec94b008b5b2ee8d59f990735bb --no-approve` to install the kit; do not substitute a branch, tag, package, version, or model. Do not read credentials, auth stores, browser profiles, raw sessions, or service payloads. Preview every command and changed path, preserve unrelated configuration, and stop on malformed/conflicting configuration. After installation, tell me to run /reload, then use /fitch-setup for the preview-first setup.
```

Run `/reload`, then `/fitch-setup`.

The setup recommends the complete core but lets you choose components. It asks separately about Cursor, WorkOS integrations, baseline working-agreement rules, and optional WorkOS process rules such as Linear tracking, worktrees, and mandatory review. The preview names the Grok primaries and Sol fallbacks before changing anything. It preserves existing files and configuration and stops for authentication, paid features, malformed config, or missing exact models.

Every engineer authenticates their own providers and services. The package does not copy credentials, OAuth state, browser profiles, sessions, private endpoints, or service responses. Pi extensions run with the user's permissions, so project trust is an input-loading gate, not a sandbox. Use `--no-approve` in repositories you do not trust.

The complete walkthrough, exact agent mappings, package list, trust behavior, and verification contract are in [pi-setup.md](./pi-setup.md).
