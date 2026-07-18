# My pi setup, and why I run agents this way

_Updated July 18, 2026 for pi 0.80.10._

A few people have asked about my terminal agent setup. This is what I'm running and why. If you want to get set up like this, ping me. I'm happy to pair on it, and it doesn't matter if you've never used pi before.

I use pi, a small terminal coding agent, plus a stack of packages that give it specialized agents, browser and company-service tools, saved workflows, and a strict review gate. Most of my day-to-day engineering work flows through it now.

## What pi is, if you haven't used it

Pi is in the same general category as Claude Code or Codex CLI. Out of the box it reads files, edits files, and runs shell commands. I add everything else through packages, local extensions, and config files.

With Node.js 22.19 or newer, you can be running it in a few minutes:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.10
pi
```

Once pi opens, run `/login` and pick a provider.

## The parts that matter

**1. A written working agreement.** Every session reads my global `AGENTS.md`, plus any repo-specific instructions. It's rules of engagement, not coding trivia: make local reversible changes without asking, ask before anything external or destructive, check real evidence instead of guessing, verify the end state before claiming done, and stop before merge unless I said merge. This file does more for consistent output than any model setting.

**2. Fresh subagents.** Instead of one agent carrying a giant conversation until it gets dumb, I hand clean briefs to child agents. A scout maps the relevant code. A debugger proves a root cause before remediation. A worker implements a bounded task. A fresh reviewer tries to prove the result wrong. A writer handles polished human-facing copy. Think of it like giving a teammate a tight one-pager instead of forwarding a 400-message Slack thread.

Most of these roles currently use the same GPT-5.6 Sol model. The value is the clean context and clear job, not pretending each agent has a personality.

**3. A real review gate.** For code changes in `workos/*`, a fresh GPT reviewer runs my thermo-nuclear maintainability review before commit, push, or merge. Any later code change invalidates the sign-off. When a change is broad or risky, `/hard-review` adds separate GPT and Claude passes. I don't trust a model to be the only grader of its own homework.

**4. Reusable prompts and skills.** Common workflows are saved as slash commands such as `/hard-review`, `/debug-mode`, `/manual-qa`, and `/orchestrate`, so I'm not retyping the perfect prompt from memory. Skills are longer playbooks loaded only when the task matches, things like root-cause debugging, TDD, browser dogfooding, or “verify before you claim done.”

My favorite is Ponytail. Agents love to over-build. Ponytail tells them to reuse what exists, prefer the standard library or native platform, and do less.

**5. Connected to the work.** MCP gives pi typed tools for other services. My setup has integrations for Linear, Slack, Notion, Plain for support, Horizon, Cloudflare, Granola, and optional observability tools. It also drives a real browser for live docs, dashboards, and QA screenshots.

The result is that pi can correlate the repo with the systems around it instead of making me paste context from five tabs. The connections load only when needed, and each teammate should authenticate their own access.

**6. Sessions that survive.** Pi sessions are saved locally. I can resume yesterday's work, branch from an earlier point to try a different approach, or let pi summarize older context in a long thread. Closing a terminal doesn't throw away the day.

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
Set up pi on this machine for a scout, worker, and reviewer workflow. Read the active installed pi docs before changing anything.

Install these public packages: git:github.com/fitchmultz/pi-subagents, git:github.com/fitchmultz/pi-intercom, npm:pi-agent-browser-native, npm:pi-mcp-adapter, npm:@ff-labs/pi-fff, and git:github.com/DietrichGebert/ponytail. Use the two fitchmultz Git forks, not the older npm releases. Review each source, resolve and install an exact version or commit, and record it. For the browser wrapper, follow its installed README and install the compatible upstream agent-browser version and browser runtime before running its doctor. Do not install anything else without asking.

Create my working agreement in ~/.pi/agent/AGENTS.md; focused orchestrate, triage-first, hard-review, and manual-qa prompts under ~/.pi/agent/prompts; fresh scout and reviewer profiles plus a bounded worker under ~/.pi/agent/agents; approved model overrides in ~/.pi/agent/models.json; and a child trust policy set to inherit in ~/.pi/agent/extensions/subagent/config.json. Inherit forwards explicit parent --approve or --no-approve CLI flags, not an interactive trust decision. Use no-approve for untrusted repositories and only models I can authenticate to.

For useful parts of this setup that aren't publicly installable, build my own smallest equivalent under ~/.pi/agent with current public pi APIs instead of trying to copy the original package. Offer a structured question tool, deterministic calculator, and nested project-instruction loader separately, and create only the ones I approve. Treat paid modes, custom provider endpoints, and company integrations as separate opt-in decisions.

Preserve unrelated configuration. Do not read or copy credentials, OAuth stores, browser profiles, sessions, or service payloads. Stop when login, a secret, a paid feature, or a product decision is required. Tell me when to run /reload, then run the relevant doctor and discovery checks plus one harmless smoke for every installed or created capability. Report every change and remaining manual step.
```

The longer guide has separate prompts for auditing a machine, configuring subagent trust, creating prompt templates and skills, adding public integrations, and validating the finished setup.

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
