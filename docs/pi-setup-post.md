# My pi setup, and why I run agents this way

_Updated July 24, 2026 for pi 0.82.0._

A few people have asked about my terminal agent setup. This is what I'm running and why. If you want to get set up like this, ping me. I'm happy to pair on it, and it doesn't matter if you've never used pi before.

I use pi, a small terminal coding agent, plus a stack of packages that give it specialized agents, browser and company-service tools, saved workflows, and selective independent review. Most of my day-to-day engineering work flows through it now.

## What pi is, if you haven't used it

Pi is in the same general category as Claude Code or Codex CLI. Out of the box it reads files, edits files, and runs shell commands. I add everything else through packages, local extensions, and config files.

With Node.js 22.19 or newer, you can be running it in a few minutes:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.82.0
pi
```

Once pi opens, run `/login` and pick a provider.

## The parts that matter

**1. A written working agreement.** Every session reads my global `AGENTS.md`, plus any repo-specific instructions. It's rules of engagement, not coding trivia: make local reversible changes without asking, ask before anything external or destructive, check real evidence instead of guessing, verify the end state before claiming done, and stop before merge unless I said merge. This file does more for consistent output than any model setting.

**2. Fresh subagents.** Instead of one agent carrying a giant conversation until it gets dumb, I hand clean briefs to child agents. A scout maps the relevant code. A debugger proves a root cause before remediation. A worker implements a bounded task. A fresh reviewer tries to prove the result wrong. A writer handles polished human-facing copy. Think of it like giving a teammate a tight one-pager instead of forwarding a 400-message Slack thread.

The quality-first research and GPT review roles use GPT-5.6 Sol. The speed-sensitive scout, context-builder, fixer, and worker use `xai/grok-4.5` at high effort, falling back through `cursor/grok-4.5` before Sol. Claude Opus 5 handles diagnosis, planning, and cross-model review, and Fable 5 handles writing. The value still comes from clean context and a clear job, not pretending each agent has a personality.

Grok earned a real role here because it is both fast and strong: CursorBench reports 66.7% at $1.51/task, and the separate Artificial Analysis snapshot reports 88 tok/s and 16.3 seconds end to end. Cursor disclosed benchmark contamination for Grok, so I discount that exact 66.7% rank rather than ignore the independently corroborated speed and cost advantage.

The 26 July 2026 CursorBench refresh added Claude Opus 5, which now ties that same 66.7% at high effort for $3.91 without any contamination caveat. That does not displace Grok from the speed roles, where it costs a third as much for the same score, but it does make Opus 5 the Anthropic route worth reaching for on review and quality work.

**3. Selective independent review.** Review is not a blanket commit or push gate. I use a fresh GPT reviewer when I ask for it, when risk is high, or when an independent check clearly helps. `/hard-review` adds separate GPT and Claude passes for the strict cases. Ordinary changes can ship after relevant validation without review ceremony; merge still waits for explicit approval.

**4. Reusable prompts and skills.** Common workflows are saved as package-backed slash commands such as `/hard-review`, `/debug-mode`, `/manual-qa`, and `/orchestrate`, so I'm not retyping the perfect prompt from memory. `~/.agents/skills` is the source of truth for a curated active library covering root-cause triage, TDD, completion verification, code and repo audits, dogfooding, platform work, external integrations, Pi extension work, SSH operations, handoffs, and clarification. Package skills add subagent, Intercom, Macuse, and Ponytail workflows; Macuse is currently from a private repository. Pi loads the full playbook only when the task matches; document, demo, and occasional workflow skills stay excluded from the default catalog.

My favorite is Ponytail. Agents love to over-build. Ponytail tells them to reuse what exists, prefer the standard library or native platform, and do less. I run its Ultra mode by default.

**5. One file-mutation tool.** `pi-apply-edits` replaces Pi's built-in `edit` and `write` tools by default. It handles exact edits, whole-file rewrites, and plan-first multi-file batches through one `apply_edits` tool. The built-ins remain an explicit opt-in for compatibility.

**6. Connected to the work.** MCP gives pi typed tools for Linear, Slack, GitHub, Notion, Plain, Horizon, Cloudflare, Granola, Sentry, and Datadog. Agent Browser handles live docs, dashboards, and web QA. Macuse handles native macOS apps when browser DOM or CLI tools cannot.

The result is that pi can correlate the repo with the systems around it instead of making me paste context from five tabs. The connections load only when needed, and each teammate should authenticate their own access.

**7. Sessions that survive.** Pi sessions are saved locally. I can resume yesterday's work, branch from an earlier point to try a different approach, or let pi summarize older context in a long thread. Closing a terminal doesn't throw away the day. The main Sol model runs at max thinking with low answer verbosity and Codex priority mode enabled; compaction uses Grok high, then Luna high, instead of spending the main model's maximum effort on summaries.

## Why I use agents

I use them for leverage on the boring parts and safety rails on the parts that matter.

I checked an eight-day slice of my own session history: 139 top-level sessions, 58% using subagents, 63% using connected-service tools, and 45% using browser automation or web search. Those numbers match how I use the setup day to day. These aren't demo features.

A real larger change usually looks like this:

1. A scout maps the code and risks.
2. A worker implements the scoped change.
3. The parent session checks the actual files and runs the real validation.
4. A fresh reviewer tears the completion claim apart.
5. Valid findings get fixed and reviewed again.

Small work skips the ceremony. If it's a one-file fix, I usually just ask for it. The machinery is for changes where being wrong is expensive or where independent work can happen in parallel.

The parent session stays responsible throughout. Child-agent summaries are evidence, not proof.

## Have pi help set it up

Once core pi is installed, you can paste this into a session:

```text
Set up pi on this machine for my current specialist-agent workflow. Read the active installed pi docs before changing anything.

Install these public packages: npm:pi-cursor-sdk, npm:pi-agent-browser-native, npm:pi-codex-goal, git:github.com/fitchmultz/pi-subagents, git:github.com/fitchmultz/pi-intercom, git:github.com/DietrichGebert/ponytail, npm:pi-edit-session-in-place, npm:@fitchmultz/pi-stash, npm:pi-copy-message, npm:pi-tool-duration, npm:pi-verbosity-control, npm:pi-mcp-adapter, git:github.com/fitchmultz/pi-ask-question, npm:@ff-labs/pi-fff, and git:github.com/fitchmultz/pi-apply-edits. Use the listed Git sources exactly; the fitchmultz subagent and Intercom forks intentionally replace older npm releases. Review each source, resolve and install an exact version or commit, and record it. For the browser wrapper, follow its installed README and install the compatible upstream agent-browser version and browser runtime before running its doctor. Do not install anything else without asking.

Create my working agreement in ~/.pi/agent/AGENTS.md; focused orchestrate, triage-first, hard-review, and manual-qa prompts; the full scout, context-builder, debugger, researcher, planner, worker, fixer, reviewer, reviewer-gpt, reviewer-claude, oracle, ui-designer, and writer bench under ~/.pi/agent/agents; and approved model overrides in ~/.pi/agent/models.json. Keep ~/.agents/skills as the canonical user-skill root, preserve its active and excluded selections when it exists, and do not duplicate skills under ~/.pi/agent/skills.

Use openai-codex/gpt-5.6-sol at max thinking and low verbosity for the main session, with Codex priority mode on. Compact with xai/grok-4.5 at high, then openai-codex/gpt-5.6-luna at high. Route scout, context-builder, fixer, and worker through Pi's built-in xai/grok-4.5 at high effort. All four fall back first to cursor/grok-4.5, then openai-codex/gpt-5.6-sol with immediate openai/gpt-5.6-sol; fixer and worker finally fall back to anthropic/claude-opus-5. Route debugger and planner through anthropic/claude-opus-5 at high effort, falling back to anthropic/claude-fable-5, then openai-codex/gpt-5.6-sol with immediate openai/gpt-5.6-sol. Every openai-codex/gpt-5.6-sol primary or fallback is followed immediately by openai/gpt-5.6-sol. Authenticate xAI with /login xai using my Grok/X subscription or xAI API key, and save a Cursor SDK API key through /login for the pi-cursor-sdk route.

Use pi-apply-edits as the default mutation tool and verify that apply_edits is active while built-in edit and write are hidden. If existing-file replacement is unsupported on this platform, keep the built-ins enabled and report that limitation. Show me the project-trust choices before changing them: my current personal setup uses defaultProjectTrust always and the pi-subagents default childRuns approve, but untrusted repositories should use no-approve. Use only models and services I can authenticate to.

For useful parts of this setup that aren't publicly installable, build my own smallest equivalent under ~/.pi/agent with current public pi APIs instead of trying to copy the original package. Offer the deterministic calculator, nested project-instruction loader, Codex priority toggle, and custom compaction route separately, and create only the ones I approve. Macuse is currently private: leave it unavailable unless I provide an approved source, and do not copy it from another installation. Treat paid modes, custom provider endpoints, and company integrations as separate opt-in decisions.

Preserve unrelated configuration. Do not read or copy credentials, OAuth stores, browser profiles, sessions, or service payloads. Stop when login, a secret, a paid feature, or a product decision is required. Tell me when to run /reload, then run the relevant doctor and discovery checks plus one harmless smoke for every installed or created capability. Report every change and remaining manual step.
```

The longer guide has the full model and agent mapping, package list, active skill catalog, trust choices, security boundaries, and validation expectations.

## If you want this

Don't copy my config directory. It mixes shareable settings with credentials, sessions, caches, and personal state. Install the public packages you need, then have pi create your prompts, agent profiles, and model overrides in the standard user paths. If a team wants to share those files, move the reviewed parts into a Git-backed pi package.

I'd start in this order:

1. Install pi, log in, and use it plain for a few days.
2. Write a short `AGENTS.md` with your rules of engagement.
3. Add a scout, a worker, and one fresh reviewer around a real change.
4. Add a second model reviewer when the risk justifies it.
5. Connect Linear, Slack, docs, observability, or browser tools as you need them.
6. Turn workflows you keep repeating into prompt templates.
7. Delete anything that becomes ceremony.

The longer reference, including the agent roles, setup prompts, public package options, session behavior, security notes, and current model choices, is in [pi-setup.md](./pi-setup.md).

Seriously, if any of this looks useful, grab me and we'll get you set up.
