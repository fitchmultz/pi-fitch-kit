# How I use Pi

_Reviewed 10 November 2026 against official Pi 1.5.2 and the current [Fitch Pi](https://github.com/fitchmultz/pi) build._

A few people have asked about my terminal agent setup. This guide describes it. [`pi-fitch-kit`](https://github.com/fitchmultz/pi-fitch-kit) is the public, installable version.

I run [Fitch Pi](https://github.com/fitchmultz/pi), my maintained fork of [Pi](https://github.com/earendil-works/pi), a small terminal coding agent. Everything in this guide applies to official Pi too: the kit and every package here run on both through public extension APIs. The fork adds two conveniences that this setup can use, compact view and `/restart`, and the [reference](reference.md#host-features) marks them.

The useful part is not the package count. It is the division of responsibility:

```text
Pi
  ├─ one main session that owns the task
  ├─ extensions that give it reliable tools
  ├─ child sessions for bounded, independent work
  ├─ skills that load a procedure when a task needs it
  └─ MCP connections to the systems around the code
```

One main session owns the task. It gathers context, makes decisions, usually edits the code, verifies the result, and explains what happened. Child sessions help with reconnaissance, parallel work, and independent review. This is not an autonomous swarm. The main session is the lead engineer.

## What is installed

The [README](../README.md#what-setup-installs) lists every package in the setup, and the [setup manifest](../setup-manifest.json) is the source of truth. The groups are:

- **Delegation and coordination:** [`pi-subagents`](https://github.com/fitchmultz/pi-subagents).
- **Connected work:** [`pi-mcp-adapter`](https://github.com/fitchmultz/pi-mcp-adapter) and [`pi-agent-browser-native`](https://github.com/fitchmultz/pi-agent-browser-native).
- **Repository work:** Pi's built-in `grep`, `find`, and `ls`, and [`pi-apply-edits`](https://github.com/fitchmultz/pi-apply-edits) for changes.
- **Long tasks:** [`pi-posthorse`](https://github.com/fitchmultz/pi-posthorse) for context rollover, notes, and history.
- **Small tools:** structured questions, working-directory changes, a calculator, `/ctx`, draft stash, and raw message copy.
- **Skills:** [`pi-agent-skills`](https://github.com/fitchmultz/pi-agent-skills) and [`pi-pstack`](https://github.com/fitchmultz/pi-pstack).
- **The kit's own extensions:** a compact footer, session naming, fast-mode controls, the Claude image guard, and the `/draft` family of prompt-writing commands. The [reference](reference.md#bundled-extensions) describes each one.

Every package is an independent repository. None depends on the kit, and the kit does not patch Pi.

Setup also offers [`macuse`](https://github.com/fitchmultz/macuse), an optional and experimental package for native macOS apps, which I run on my Macs. My own configuration loads a few things that are not in the public setup: private skill packages and personal provider definitions. I filter out a few resources that I do not use, including the kit's setup prompt.

## One task from start to finish

Consider a behavior change that crosses an API and a browser-visible product. The issue is brief, the relevant decisions live in connected services, and the current behavior must be checked before it changes.

### 1. The main session takes ownership

I start Pi in the repository and give it the issue, or ask it to fetch the issue through a connected service.

The session reads my global working agreement and the repository's instructions. Those rules set the boundaries: inspect before guessing, preserve unrelated work, act under standing authority without repeated permission prompts, and verify the real end state before claiming completion.

### 2. It gathers connected context

Through MCP, the session reads planning context, conversations, meeting notes, and observability data. It retrieves what the task needs, not whole services.

### 3. It maps the code before editing

The session traces callers, tests, data boundaries, and repository conventions before it chooses where to change code.

For a broad or unfamiliar area, it delegates. `delegate` starts a child session with a complete written assignment: the requirements, scope, authority, and expected result. A child starts with fresh context by default, so it does not inherit the parent's assumptions. Delegation is asynchronous. The parent continues other work and is notified when a child finishes. Children cannot delegate further.

### 4. The parent owns design and integration

The parent makes ordinary reversible decisions and usually implements the change itself. A child implements only when a piece is independent enough for its own worktree. The parent then inspects the real files and diff. A child's success report is a lead, not proof.

### 5. It verifies the behavior

The narrowest meaningful repository check runs first. Arithmetic goes through the calculator. If the behavior is visible in a browser, Agent Browser exercises the real flow, because unit tests do not prove what the user sees.

### 6. Fresh reviewers challenge the claim

A reviewer starts without the implementation conversation and reconstructs the claim from the requirements, the current files, the diff, and the validation output. I add a second model family when the risk warrants it, by giving that child a different model.

Reviewer judgment does not replace validation, and a green test suite does not replace a required review. Substantive changes refresh the affected review. A mechanical base sync does not.

### 7. The main session closes the loop

The parent fixes valid findings or rebuts incorrect ones with evidence, then ships through the PR workflow it is authorized to use. After the merge it refreshes the local checkout, verifies the shipped result, and removes only its own task worktrees.

Small work skips the ceremony. The structure is for changes where being wrong is expensive or where independent work saves time.

## Long tasks and context

I set each model route's context window to 400,000 tokens and reserve 64,000 of it. Posthorse starts a fresh context window when a task reaches that line. It keeps a recent tail of about 30,000 tokens and does not ask a model to write a summary. A reminder prompts the session to save task state in notes before the rollover, and the session can search the earlier conversation afterward. The context window is not a deadline for the task.

For some routes, 400,000 is above the native window. On OpenAI routes that crosses a long-context price tier. These are my budgets, not a claim that one size suits everyone. Setup offers each window as a separate choice.

## Tools load when needed

A large setup does not need a large prompt. Extensions register optional tools as deferred, and Pi's `tool_search` loads one when a task needs it. `pi-mcp-adapter` does the same for MCP servers, so hundreds of service tools stay out of the prompt until used. Pi's `codemode` runs a script that calls several tools, which suits loops and filtering large output.

Skills work the same way. Pi shows the model a one-line description of each skill and loads the full procedure only when the task matches.

## Models

My default is `gpt-6-astra` through a ChatGPT subscription at `xhigh` thinking. Claude runs through Anthropic directly or through Cloudflare AI Gateway. The [settings example](../examples/settings.json) lists the routes I enable.

None of these routes is required. The kit's extensions work with any model, and setup offers only the routes your session can use.

A child session inherits the parent's model unless the assignment names another one. That is how a review gets a second model family.

Fast modes cost more and are off unless you turn them on. The [fast-mode reference](reference.md#fast-modes) has the commands, eligibility rules, and prices.

## Image quality

I turn off Pi's global image resize so models can inspect original detail:

```json
{
	"images": {
		"autoResize": false
	}
}
```

Anthropic has stricter image limits, so the kit's [image guard](reference.md#image-guard) resizes only the images sent to Claude. This is the pattern in the rest of the setup too: keep the capability globally, then adapt at the one boundary that needs it.

## Connected services

My MCP connections cover Linear, two Slack workspaces, Cloudflare, Datadog, Granola, and an internal gateway that fronts other services. GitHub goes through the `gh` command-line tool instead of MCP.

Each person authenticates their own connections. The kit contains no service configuration, and setup does not add servers for you.

My personal runtime runs with full approvals. MCP transports tool calls; it is not an authorization boundary. The working agreement tells the model when an external write needs explicit direction, but that is policy, not per-tool enforcement. A multi-user product needs authorization in the surrounding identity and execution layer.

## Trust and security

Pi extensions run with the permissions of the user who started Pi. Project trust controls whether project-local configuration loads. It is not a sandbox.

A shared setup must not distribute:

- authentication files, OAuth state, keys, or tokens;
- private service endpoints;
- browser profiles;
- saved Pi sessions;
- copied service responses.

The settings example leaves out the trust setting on purpose. Choose `defaultProjectTrust` for your environment instead of copying mine.

## Beyond one setup

This stack is a working composition layer for a model-agnostic team harness:

- several model providers, with the model chosen per session and per child;
- independent extension packages instead of core patches;
- bounded child sessions, worktrees, and independent review;
- per-user authenticated access to planning, conversation, and observability systems;
- policy, skills, and package sources kept in Git;
- browser, terminal, and connected-system work in one runtime.

A product would add central provisioning, single sign-on, policy distribution, scoped credential brokerage, audit and cost visibility, managed execution, and multi-user controls. Those belong above the reusable pieces, not inside every extension.

## Install and verify

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
# Complete provider login, then:
pi install git:github.com/fitchmultz/pi-fitch-kit
# Start a new Pi process, then:
/fitch-setup
```

`/fitch-setup` reads the manifest, checks model routes in the running session, shows one preview, and installs only what you select. `/fitch-setup verify` reports differences from the manifest without changing anything. The [reference](reference.md#setup) describes each step.
