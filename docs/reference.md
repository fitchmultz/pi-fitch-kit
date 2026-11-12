# Reference

Behavior and configuration for [pi-fitch-kit](../README.md). Start with the README for installation. Read [How I use Pi](pi-setup.md) for the workflow around these pieces.

The kit runs on official Pi and [Fitch Pi](https://github.com/fitchmultz/pi) through public extension APIs. It does not patch Pi.

## Bundled extensions

### Footer

[`clean-footer`](../extensions/clean-footer.ts) replaces Pi's footer with a compact one. It removes cumulative token, cache, and cost counters while retaining the latest prompt cache hit rate, working directory, session name, context usage, model, thinking level, and extension statuses. Statuses come from Pi's native status API, so the footer shows what any extension reports and reads no other package's configuration. It uses two lines when everything fits and wraps whole status items onto additional lines instead of truncating them. `/clean-footer` toggles the compact and built-in footers for comparison.

The footer bootstraps file-wide name/cache facts once and reconciles appended facts from the persisted journal after the leaf advances or the run settles, including abandoned branches and later `message_end` replacements. Each reconciliation acquires history once and processes only its new suffix; unchanged redraws do no history work. Native usage is a dirty snapshot keyed by session, leaf and model; resizing, themes and status-only redraws do not rescan history. An SDK owner making out-of-band journal edits must emit a lifecycle refresh; there is no public universal mutation signal. Git, provider/model/thinking and extension statuses remain live.

`/clean-footer` sets the footer for the running Pi instance; it is not a saved preference. Reload, new, resume, and fork start with the compact footer, and `/tree` leaves the current choice alone. On a cold start, the footer honors a `clean-footer-checkpoint` entry that an earlier kit version saved for the same session ID. An entry copied into a fork does not carry over.

### Session naming

[`session-name`](../extensions/session-name.ts) provides the `name_session` tool and inert session-name metadata that keep `/resume` searchable without renaming sessions for every subtask. It preserves coordinator and numbered subagent identities unless the user confirms their removal. When useful tools are already needed, naming joins the same tool-call batch rather than requiring a naming-only model round. Naming does not force that batch to run one call at a time: siblings stay parallel whenever Pi's native batch is otherwise parallel (Pi's default, unless another tool in the batch or the agent's `toolExecution` option is sequential). Only naming calls wait for one another, so each one checks the name its predecessor left and a cancelled batch applies no queued rename. A sibling tool may open its own dialog during a protected-name confirmation; Pi's native dialog stack shows the confirmation again when that dialog closes. Text-only tasks still receive names; unrelated work must not be invented to batch naming. This guidance works on official Pi and the Fitch runtime. If the archived standalone `pi-session-name` package is still loaded, the kit defers to its `name_session` tool; `/fitch-setup` offers to remove that package. Name metadata is stored as append-only conversation messages at native run/turn boundaries, not injected near the start of every request. Enabling naming and subsequent renames preserve the previous prompt prefix. A cached backward boundary walk stops at the first compaction (and reconciles committed retain-none drafts on the next request); supplied native request messages still own recovery placement. Native branch projection prevents duplicate metadata across reloads and restores the current name after compaction or tree navigation. Official Pi 1.5 and the maintained Fitch runtime use the public lifecycle and compaction path, including truthful metadata on the first in-run request after retain-none compaction. Naming preserves other extensions' boundary drafts and continuation decisions. When recovery is needed after those drafts commit, its saved metadata stays at its originally submitted position in later requests, including after rename or reload.

### Setup model check

[`setup-models`](../extensions/setup-models.ts) provides `fitch_setup_models` for `/fitch-setup` to check requested model routes in the running session's registry. It reads the current snapshot without opening credential files, making network calls, or starting another Pi process; a trusted project's models may be present, so the results describe this session rather than proving user-global availability.

### Fast modes

[`fast-mode`](../extensions/fast-mode.ts) owns shared per-user settings for three providers, plus an optional OpenAI override for one session. Installing or updating the kit never opts you into Ultrafast or changes the default model routes.

| Command                                            | Request policy                                                               | State                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| `/codex-fast [on\|off\|toggle\|status\|ultrafast]` | Shared OpenAI off, priority, or Ultrafast; only one at a time                | `openai-codex-fast.json`                    |
| `/fast`                                            | Toggle shared OpenAI priority                                                | `openai-codex-fast.json`                    |
| `/ultrafast [on\|off\|toggle\|status] [--session]` | Ultrafast toggle, shared by default; `--session` overrides only this session | The shared file, or native session metadata |
| `/ultrafast reset --session`                       | Clear this session's override and follow the shared mode                     | Native session metadata                     |
| `/anthropic-fast [on\|off\|toggle\|status]`        | Anthropic Opus fast mode                                                     | `anthropic-fast.json`                       |
| `/xai-fast [on\|off\|toggle\|status]`              | xAI priority                                                                 | `xai-fast.json`                             |

State files live in the Pi agent directory.

Shared settings affect sessions sharing that directory. For OpenAI, a session override takes precedence over the shared mode. OpenAI/xAI settings apply to normal agent requests through Pi's payload hook. Built-in compaction and bare registry/nested streams bypass that hook on the verified hosts and retain their native policy; Anthropic's provider override also covers eligible internal calls. Footers follow changes made in other sessions. Changing a setting does not retier requests already in flight.

#### OpenAI: priority and explicit Ultrafast

**Shared controls stay compatible with Fast.** `/codex-fast on` selects priority; `/codex-fast off` disables either shared kit mode. Blank `/fast`, or the existing `toggle` action, turns an enabled shared mode off and turns off into priority; none of those actions enables Ultrafast. Blank `/codex-fast` only reports status. Existing `enabled: true` state means priority, not Ultrafast. `/codex-fast ultrafast` remains a global alias with no `--session` form.

**Ultrafast is global by default.** `/ultrafast` with no arguments means `toggle`; `on` selects shared Ultrafast, `off` disables shared kit OpenAI tiers, and `toggle` changes shared Ultrafast to off or any other shared mode to Ultrafast. For example, `/ultrafast on` changes the shared setting like `/fast` does, while `/ultrafast on --session` affects only this session.

**Use `--session` for an override.** `/ultrafast on --session` stores `ultrafast`; `/ultrafast off --session` stores `off`, suppressing both kit priority and Ultrafast injection even when the shared setting is enabled. `/ultrafast toggle --session` changes effective Ultrafast to local off, or any other effective mode to local Ultrafast. Local off does **not** guarantee standard processing: native Auto or project defaults may still select a tier. Only `/ultrafast reset --session` clears the override and resumes the current shared setting; `reset` without `--session` is invalid.

An override takes precedence until cleared. It is saved in native session metadata and survives same-ID resume, reload, `/tree`, and compaction. Durability follows Pi 1.5's normal session saving, starting with the first user message; custom-only sessions are not yet restart-durable. Forks and new session IDs do not inherit it; they follow the current shared setting. Global `/fast` and `/codex-fast` commands never clear an override. `/ultrafast status`, including `/ultrafast status --session`, and the existing Fast status commands are read-only and show both shared and effective settings, including any mismatch. A shared change may therefore leave this session's effective setting unchanged.

The startup-only `--ultrafast` flag still selects the **shared** mode; `--fast` still selects shared priority. Both apply only at process startup, not again on reload, new, resume, or fork. Combining them, or requesting Ultrafast on an unsupported startup route, leaves state unchanged. Interactive Pi blocks requests until an explicit mode-changing command resolves the error; headless Pi reports the error on stderr and exits orderly with a nonzero status before making paid requests. Extension-sourced input is left unchanged, so recovery does not swallow queued extension messages. Startup and restored-Ultrafast notices disclose cost and entitlement requirements.

Explicit Ultrafast enablement validates exact Astra and the native route **before writing** shared state or a session override, without switching models, credentials, or endpoints. Off and session reset remain available on unsupported routes.

Ultrafast eligibility is deliberately narrow:

- exact `gpt-6-astra` on `openai` with `openai-responses` at the native global or US API endpoint;
- exact `gpt-6-astra` on `openai-codex` with `openai-codex-responses` at the native ChatGPT backend, **only with the required Codex plan entitlement**.

Cloudflare AI Gateway, GPT-5.6 preview models, other GPT models, o-series, Completions, and other proxies are not Ultrafast-eligible. Gateway priority support is unchanged; Ultrafast gateway support requires separate live proof before inclusion. If you move an Ultrafast-selected session to an unsupported route, the effective selection remains inactive, with no priority fallback. Shared Ultrafast shows `ultrafast requested` or `ultrafast unavailable`; a local Ultrafast override shows `session ultrafast requested` or `session ultrafast unavailable`. Local off shows `session OpenAI tiers off`. These labels describe kit request policy, not server confirmation. Route recognition cannot prove plan entitlement or residency eligibility.

The kit sends `service_tier: "ultrafast"` through Pi's stock `before_provider_request` payload hook on each eligible ordinary request. It adds no OpenAI provider override, custom transport, or routing header. The hook exposes the selected session model, not an internal call's actual destination: custom code forwarding that agent's payload callback to a different provider or endpoint is unsupported. OpenAI supports HTTP streaming and strongly recommends WebSockets for this mode. The kit adds no transport: official Pi 1.5.2 and Fitch Pi use HTTP streaming on the direct API route. Codex WebSockets are a different route, not a substitute for direct API support.

**Cost and access, checked 29 September 2026:** [OpenAI's Ultrafast guide](https://developers.openai.com/api/docs/guides/ultrafast-mode) and [pricing](https://developers.openai.com/api/docs/pricing?latest-pricing=ultrafast) make Astra Ultrafast available to all API users at **6× standard API prices (3× Fast)**. Per million tokens, requests with at most 272k input tokens cost $60 input, $6 cached input, $75 cache write, and $300 output; above 272k they cost $120/$12/$150/$450. The [Astra model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra) applies long-context pricing to the whole request. Initial Ultrafast limits are 500k tokens/minute for API tiers 1–3, 1M for tier 4, and 5M for tier 5. Processing supports global processing and US data residency only, not EU or other non-US regional inference. Astra's broad release is recorded in the [API changelog](https://developers.openai.com/api/docs/changelog); Sol remains a preview and is not enabled here.

[Codex Ultrafast access](https://learn.chatgpt.com/docs/agent-configuration/speed) requires the $500 Pro plan or eligible Enterprise/Edu access. Other self-serve plans do not qualify even with purchased credits. Enterprise access is off by default and controlled by workspace owners. Ultrafast consumes **8× included allowance**, or **6× purchased credits/PAYG**; neither multiplier promises an 8× task-speed improvement. Activation, startup, and restored-Ultrafast notifications disclose these costs and plan prerequisites.

**Native accounting is separate from this kit.** Official Pi 1.5.2 has no Ultrafast cost adjustment; it can send the tier while its dollar estimates remain standard-rate. [Fitch Pi](https://github.com/fitchmultz/pi) applies a **6× monetary estimate for exact `gpt-6-astra` on native OpenAI Responses and Codex Responses**, only when the terminal response confirms `service_tier: "ultrafast"`. Requesting the tier alone is insufficient: missing, unknown, or `default` returned tiers do not confirm Ultrafast and do not apply that multiplier. A matching Pi version does not imply accounting parity. Provider billing remains authoritative; a native estimate is not proof of the billed tier or amount. The kit does not manufacture billing estimates or turn Codex's 8× allowance multiplier into a dollar estimate.

Requested `service_tier` is observable through `onPayload` (`before_provider_request`); returned `response.service_tier` through `onProviderStreamEvent` (`provider_stream_event`). These existing raw hooks do not persist tier metadata or turn absent values into confirmation. No live Ultrafast generation, billing, or speed measurement is claimed here.

Priority continues to use `service_tier: "priority"` on `openai`, `openai-codex`, and the native OpenAI clone `chatgpt-rotate` supplied by `pi-chatgpt-sub-rotate`, plus gateway models whose IDs start with `gpt-` or are `o3`/`o4-mini` (including their exact `2025-04-16` snapshots). `chatgpt-rotate` follows the same shared `/fast` and `/codex-fast` setting and session-off override; this does not make it Ultrafast-eligible. Gateway o-series eligibility follows OpenAI's [Fast pricing](https://developers.openai.com/api/docs/pricing?latest-pricing=fast) and [o3](https://developers.openai.com/api/docs/models/o3) / [o4-mini](https://developers.openai.com/api/docs/models/o4-mini) documentation. Other gateway o-series and namespaced Workers AI models remain excluded. Local regression checks cover serialized requests and footer state; no live gateway o-series measurement is claimed. The priority footer reads `priority enabled`; notifications say `priority requests ON/OFF`. These describe request policy, not confirmed response handling.

Prior **priority**, not Ultrafast, measurements remain useful baselines: gateway `gpt-5.6-sol` echoed `service_tier: "priority"`; on `openai-codex/gpt-5.6-sol`, three interleaved pairs in one session on one account ran roughly 1.5× faster in throughput and 1.4× in completion time ([0.9.14 changelog](../CHANGELOG.md)). Fixed-length output matters: time-to-first-token did not improve (1641ms standard versus 1772ms priority). The Codex response returned `service_tier: "default"`, which does not confirm priority processing or explain backend semantics. Record requested and returned tiers separately, leaving missing returned values unknown. Adding the Codex CLI's `x-codex-routing-hint` measured inside noise at that sample size, so the kit sends no such header.

#### xAI priority

`/xai-fast` requests `service_tier: "priority"` on `xai` and gateway models whose IDs start with `grok-`. Gateway `grok-4.6` is live-verified to echo priority. Time-to-first-token is often unchanged when idle; the tier buys queue priority under load. The footer shows `fast` only while enabled on an eligible model. Reported cost is not request-doubled: Pi applies the 2× Responses multiplier when the response confirms priority (`grok-4.5`); Completions models including `grok-4.6` stay on catalog rates.

#### Anthropic Opus fast mode

`/anthropic-fast` requests Anthropic's research-preview fast mode for Opus 5.5, Opus 5, and Opus 4.8 at double the token price, with reported cost rates doubled to match. It is verified on this setup's Claude subscription OAuth route, where identical output ran roughly 2× faster. The footer shows `fast` only while enabled on an eligible model.

Anthropic fast mode cannot ride the stock hooks: pi-ai assembles `anthropic-beta` (OAuth identity and feature markers) inside its client after extension header hooks run and merges headers last-write-wins. A hook-written value would drop Pi's own markers. The extension therefore owns the `anthropic-messages` stream callback for exactly `anthropic` and `cloudflare-ai-gateway`, appending the mandatory beta at fetch time so `speed` and header travel atomically. Other Opus proxies such as `github-copilot` and `opencode` stay stock; caller-supplied `client` requests stay at standard speed.
Accepted caveats of owning that callback: do not combine it with another Anthropic or gateway provider override without reviewing both, since Pi merges registrations last-write-wins; start a fresh Pi process after disabling or removing it, because `/reload` does not clear model-runtime provider overrides; and revalidate it when upgrading Pi, since it depends on Pi's provider composition and header-merge behavior.

### Image guard

[`anthropic-image-guard`](../extensions/anthropic-image-guard.ts) preserves full-resolution images for other models while resizing only Claude-bound images to Anthropic's inline limits, on every route that speaks `anthropic-messages` (direct, Cloudflare AI Gateway, proxies such as GitHub Copilot). Non-Claude models sharing that wire API keep their source images.

Pi's `images.autoResize` defaults to `true`, which shrinks every image to at most 2000×2000 pixels. I turn it off so models can inspect the original detail:

```json
{
	"images": {
		"autoResize": false
	}
}
```

Anthropic has stricter image limits. The guard handles that one boundary instead of giving up source quality everywhere. It runs only on Claude models over the `anthropic-messages` API regardless of which provider routes them, reuses Pi's native image resizer, caches successful results within an estimated 128 MiB budget for source keys, result strings and entry overhead, clears that cache on session start and compaction, and retries later after resize failures. Cold misses decode in up to four native workers at once, and writer calls reuse the same cache. A bounded request-start snapshot preserves cache hits during newest-first traversal, even when the request exceeds the cache budget; cache eviction never omits an image. The snapshot can temporarily retain another cache budget's worth of strings during preparation. Before native decoding, it omits sources above 32 MiB of base64 and admits the newest images within a 64 MiB source budget, preserving conversation order and saved originals. On the bundled direct Anthropic and Cloudflare routes, and in writer calls, it also budgets the complete serialized request against Anthropic's 32 MB limit, including text and tool definitions. It resizes images further when needed, omitting oldest images first only when resizing cannot fit them; text/tool-only overflow retains native handling. The guard remembers those request-size results for the latest over-limit request's captures: a capture keeps its earlier result while it still fits, so repeated over-limit turns skip native work and resend the same image bytes.

### Prompt-writing commands

[`write-prompt`](../extensions/write-prompt.ts) adds `/draft <text>`, `/ambitious <text>`, `/unreasonable <text>`, and `/side-question <text>`. All four use the current session system prompt once and conversation off-transcript, flattening past tool-call semantics while retaining tool-result images, without replaying historical system messages or exposing tools. `/draft` rewrites the source into an agent request, then offers Accept, Copy prompt, Tweak, Restore original, or Deny. Accept sends normally when idle and steers the active agent when busy. Before sending, it saves the draft and original input in native session metadata outside model context. `/draft` without text reopens the last accepted draft on the current branch without another rewrite, including after a failed send. Restore original puts the original command back in the editor; synchronous send errors keep the dialog open for retry. In the TUI, a draft taller than the viewport is clipped to it with a lines-above/below indicator and scrolls with PageUp/PageDown; arrows, Enter, and Escape keep driving the action list, and terminals tall enough for the whole draft look exactly as before.

`/ambitious` applies [Felix Rieseberg’s ambition principles](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/) to raise the requested outcome and execution rather than add a bigger checklist: specify the outcome and, for recurring reports or toil, seek a repeatable way to achieve it while retaining the requested deliverable and verifying its timing (altitude); use task-appropriate expert methods and primary evidence with adversarial assumption checks and external runnable verification (depth); and borrow an adjacent discipline’s method only when useful (range). Deliberately bounded tasks gain depth rather than an unrequested standing workflow. It preserves supplied targets; improvement work gets a challenging, testable target justified by a measured baseline, not arbitrary numbers, promised feasibility, or mandatory novel findings. Missing semantic choices must be established from the existing contract, not invented.

At session start it uses the request and available project context without inventing prior activity. Mid-conversation it carries forward relevant goals, latest decisions, constraints, and current state—including unfinished work and unverified hypotheses—while ignoring unrelated or superseded material. The result stands alone without a transcript recap or references to earlier turns. New rewrites and Tweak revisions have a hard **1,800 Unicode-character maximum, including whitespace**, and should be shorter when possible. An oversized result gets one shortening attempt; another overflow reports an error instead of truncating constraints or offering the invalid draft. A failed Tweak keeps the previous draft available. It shares `/draft`’s dialog, writer configuration, and delivery behavior, but saves accepted drafts under its own session entry type. Blank `/ambitious` reopens the last accepted ambitious draft without rewriting it, including older saved drafts; recovery stays isolated from the other rewrite commands.

`/unreasonable` turns a tentative request into a forceful, outcome-driven mandate for exceptional completion—not merely a harsher tone or a longer `/ambitious`. It demands the strongest useful, task-appropriate methods and inspectable evidence: root-cause proof at the failing boundary for bounded fixes, genuinely distinct directions and comparison for design exploration, competing explanations and primary evidence for investigations, or rigorous reasoning and source fidelity for non-code work. These are choices, not a mandatory checklist. It preserves the requested deliverable, relevant settled context, constraints, targets, budgets, and authority; review-only stays review-only. It adds no permission to deploy, spend, disclose private data, or change data, and does not require arbitrary repetition or invented discoveries, measurements, or certainty. Compact, direct prose is required, with **no kit-specific character cap** beyond native provider limits. Tweak keeps the same standards. It shares the review dialog, configuration, and idle/busy delivery path above; accepted drafts use the separate `fitch-kit.unreasonable` entry type. Blank `/unreasonable` reopens only its own last accepted draft on the current branch without a writer call; Restore original restores the `/unreasonable` invocation.

`/side-question` answers off-transcript and offers Copy answer, Ask again, or Dismiss; it never sends to the agent. Copy does not touch the editor. All commands share the writer configuration below.

#### Writer provider, model, and thinking

By default, the writer inherits the active session's provider, model, and thinking level when rewriting starts. It uses Pi's native provider-neutral model API and configured authentication, without changing the session's settings. Pi handles provider-specific thinking mappings and token budgets; `/ambitious` additionally checks the completed prompt’s visible character limit, independent of provider tokens. `/draft`, `/unreasonable`, and `/side-question` have no kit-specific size cap. Main-agent verbosity hooks are not applied.

Optional overrides live in `~/.pi/agent/write-prompt.json` (or `write-prompt.json` inside `PI_CODING_AGENT_DIR`). The file is read when each command first calls the writer; edits need no restart. Reopening, accepting, copying, or restoring a saved draft does not need a valid writer configuration. For example:

```json
{
	"provider": "openai-codex",
	"model": "gpt-6-astra",
	"thinkingLevel": "high"
}
```

Every field is optional. `{ "thinkingLevel": "low" }` keeps the session's provider and model; `{ "model": "gpt-6-astra" }` keeps its provider and thinking level. A provider-only override keeps the session's model ID, which must exist under the selected provider. A missing file or `{}` inherits all three values. This is separate from the defaults in Pi's `settings.json`, which initialize sessions rather than override their active selections.

The existing `{ "model": "provider/model-id" }` form remains supported when `provider` is omitted. With an explicit `provider`, `model` is the literal model ID, including any slashes.

`thinkingLevel` accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Pi adjusts unsupported levels to the selected model's capabilities and the writer reports the adjustment, including when `off` is unavailable. Malformed JSON, unknown fields, invalid values, unknown models, and missing authentication produce a named configuration error before a model call; they do not silently fall back to a different model.

## Setup

`/fitch-setup` is a prompt, not an installer program. The main session follows it: it inspects the host, asks for the choices you have not already given, shows one preview, applies it, and verifies the result. `/fitch-setup verify` makes no changes.

Setup does these things:

- Checks that the running Node.js and Pi versions satisfy the manifest's supported version ranges and each selected package's requirements. It stops before any write if a host version is outside those ranges, including an excluded major or vulnerable patch. It does not upgrade Node.js or Pi.
- Checks model routes with the `fitch_setup_models` tool in the running session.
- Installs each selected package with `pi install <source> --no-approve`, exactly as the manifest lists it.
- Keeps a package that is already installed from the other channel. Pi treats npm and Git sources as different packages, and two copies would register the same tools twice.
- Offers to remove an installed package that the manifest lists as retired, because its replacement registers the same tool or command.
- Offers the settings example, the context windows, and the working-agreement blocks as separate choices.
- Preserves everything else: other packages, resource filters, unrelated settings, and fast-mode state.

Setup never reads credentials, adds MCP servers, or makes provider calls. Provider login, MCP server configuration, and the `agent-browser` command-line tool remain your steps. Start a new Pi process after setup installs or removes a package.

### Setup manifest

[`setup-manifest.json`](../setup-manifest.json) is the source of truth for setup.

| Field                      | Meaning                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime`                  | Supported Pi and Node.js semver ranges for the kit itself                                                                                                                                                      |
| `kit`                      | The kit's package name and install source                                                                                                                                                                      |
| `kitResources`             | The extensions, prompts, and theme the package loads, plus the working-agreement template and settings example                                                                                                 |
| `corePackages`             | The packages in complete core. Each entry has an `id`, an unpinned `source`, and what it `provides`. `externalPrerequisite` names a command-line tool the package needs and links to its install instructions. |
| `optionalPackages`         | Packages outside complete core. `platform` limits an entry to one operating system.                                                                                                                            |
| `retiredPackageSources`    | Archived packages that the kit or a core package replaces                                                                                                                                                      |
| `modelContextWindows`      | The model routes this setup uses, and the context window chosen for each                                                                                                                                       |
| `workingAgreementSections` | The managed blocks in the working-agreement template                                                                                                                                                           |

### Settings example

[`examples/settings.json`](../examples/settings.json) is the public subset of my Pi settings. It has no credentials, paths, package list, or trust setting.

| Key                                                       | Value                                                | Effect                                                                                                                             |
| --------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `defaultProvider`, `defaultModel`, `defaultThinkingLevel` | `openai-codex`, `gpt-6-astra`, `xhigh`               | The startup model                                                                                                                  |
| `enabledModels`                                           | Ten routes                                           | The models used for startup selection and model cycling. Each is a key of `modelContextWindows`.                                   |
| `defaultTools`                                            | `+codemode`, `+tool_search`, `+grep`, `+find`, `+ls` | Adds these built-in tools to Pi's default selection                                                                                |
| `extensions`                                              | `-builtin:mcp`                                       | Turns off Pi's built-in MCP support, which `pi-mcp-adapter` replaces. Without it, Pi reports the replacement in a startup warning. |
| `steeringMode`                                            | `all`                                                | Delivers every queued steering message at once                                                                                     |
| `compactView`                                             | `true`                                               | Groups tool activity in the transcript. Fitch Pi documents this setting; official Pi 1.5.2 does not.                               |
| `images.autoResize`                                       | `false`                                              | Sends source images at full detail. See [Image guard](#image-guard).                                                               |
| `terminal.imageWidthCells`                                | `120`                                                | Preferred inline image width                                                                                                       |
| `compaction`                                              | Reserve 64,000; keep 30,000 recent                   | Where automatic compaction starts, and how much recent conversation it keeps. Posthorse uses the same values for rollover.         |

The manifest's `modelContextWindows` sets each route to 400,000 tokens. Setup merges a selected route into `models.json` as `providers.<provider>.modelOverrides.<model-id>.contextWindow`, which keeps the model's native capabilities and pricing. With the example's 64,000-token reserve, context rolls over at about 336,000 tokens.

For some routes, 400,000 is above Pi's native window for the model. On OpenAI routes, input above 272,000 tokens uses long-context pricing for the whole request. Check a route's pricing before you raise its window.

### Working agreement

[`templates/working-agreement.md`](../templates/working-agreement.md) has two managed blocks that setup can merge into `AGENTS.md` in the Pi agent directory:

- **Baseline** covers authority, evidence, and delivery through a repository's PR workflow.
- **Process** adds team habits: an issue tracker, a worktree per task, and a fresh independent review before a shared-team PR is ready.

The process block requires an independent review, not a particular tool. A delegated child session with fresh context is one way to get it. If a required review is unavailable, the gate stays unsatisfied; self-review does not satisfy it.

A working agreement is model policy. It is not a technical authorization boundary.

## Host features

The kit uses these Pi features but does not own them.

**Tool discovery.** Pi 1.5 supplies `tool_search` and `codemode`. An extension can register an optional tool as deferred, which keeps it out of the prompt until `tool_search` loads it or a `codemode` script calls it. Loading a tool does not widen its permissions. The first use of a deferred tool adds a search round.

**Compact view.** On Fitch Pi, `/compact-view` switches between grouped tool activity and the normal transcript, and remembers the choice for new sessions. Installing the kit never turns it on. Official Pi 1.5.2 has no compact view, and setup skips the setting there.

**Restart.** Fitch Pi supplies `/restart` and `pi restart`. On official Pi, quit and start Pi again.

## Trust and security

- Pi extensions run with the permissions of the user who started Pi. Project trust is not a sandbox.
- Every person authenticates their own model providers and services.
- The kit contains no keys, OAuth state, private endpoints, browser profiles, saved sessions, or copied service responses.
- Package sources in the manifest are unpinned: an install follows the package's current release or default branch. Review a package before you install it.
- The settings example leaves out the trust setting. Choose `defaultProjectTrust` for your environment.
- Setup consent covers the previewed installs and file changes only. It is not authority for service writes, deployments, or account changes.

## Repository map

```text
extensions/             footer, session naming, fast modes, image guard, prompt-writing commands, setup model check
prompts/                /fitch-setup and /github-open-issues-prs
themes/                 calm theme
setup-manifest.json     packages, model routes, and bundled resources
examples/settings.json  public subset of my Pi settings
templates/              working-agreement blocks
docs/                   this reference, the usage guide, and development notes
scripts/                validation, package smoke, and regressions
```

For repository checks, see [Development](development.md).
