# pi-fitch-kit

This repository documents how I combine public extensions, model-routed subagents, skills, connected MCP services, and local policy.

The kit installs public extension packages without patching [Pi](https://github.com/earendil-works/pi). The extensions work on stock Pi and [my Pi fork](https://github.com/fitchmultz/pi/blob/main/FORK.md). Optional host preferences such as compact view and integration discovery require a runtime that supports them; they are not extension dependencies. Credentials, private provider definitions, and user-local experiments stay user-managed. Provider error diagnostics, message types, and retry policy belong to Pi core; retiring the kit's provider patch did not implement its outstanding [metadata-hardening follow-up](https://github.com/fitchmultz/pi-fitch-kit/issues/19).

## Start here

1. [Enabled extensions](#enabled-extensions)
2. [Subagent bench](#subagent-bench)
3. [Active skills](#active-skills)
4. [Connected MCP services](#connected-mcp-services)
5. [How the workflow fits together](#how-the-workflow-fits-together)
6. [Install the kit](#install-the-kit)

Prompts are deliberately secondary. The daily workflow is driven by tools, agents, skills, and connected context.

## Enabled extensions

These are the extensions loaded in my current setup. Every external extension links to its source repository.

### Orchestration and connected work

| Extension | What I use it for |
|---|---|
| [`pi-subagents`](https://github.com/fitchmultz/pi-subagents) | Fresh specialists, parallel work, chains, isolated worktrees, async review, durable artifacts, and coordination between local sessions |
| [`pi-mcp-adapter`](https://github.com/fitchmultz/pi-mcp-adapter) | One searchable gateway over configured MCP servers and their tools |
| [`pi-agent-browser-native`](https://github.com/fitchmultz/pi-agent-browser-native) | Live documentation, browser automation, screenshots, product QA, and authenticated web flows |

### Coding and task control

| Extension | What I use it for |
|---|---|
| [`pi-apply-edits`](https://github.com/fitchmultz/pi-apply-edits) | `apply_patch`, `replace_text`, `write_files`, and read-only `preview_patch`; contracts live in the owning package |
| [`pi-ask-question`](https://github.com/fitchmultz/pi-ask-question) | Structured user decisions when ambiguity changes scope or safety |
| [`pi-todo-list`](https://github.com/fitchmultz/pi-todo-list) | Persistent nested task state that survives long sessions and compaction |
| [`pi-change-working-dir`](https://github.com/fitchmultz/pi-change-working-dir) | Safe mid-session movement into worktrees and monorepo subprojects |
| [`pi-calculator`](https://github.com/fitchmultz/pi-calculator) | Deterministic high-precision arithmetic instead of model estimation |

### Session quality and small friction reducers

| Extension | What I use it for |
|---|---|
| [`pi-ctx-info`](https://github.com/fitchmultz/pi-ctx-info) | `/ctx` breakdown of reported context usage, estimated composition, loaded resources, and the largest session entries |
| [`pi-verbosity-control`](https://github.com/fitchmultz/pi-verbosity-control) | Per-model OpenAI verbosity and its native footer status |
| [`pi-tool-duration`](https://github.com/fitchmultz/pi-tool-duration) | Model-visible timing on slow tool calls |
| [`pi-edit-session-in-place`](https://github.com/fitchmultz/pi-edit-session-in-place) | Re-edit or remove an earlier user turn in the current branch |
| [`pi-stash`](https://github.com/fitchmultz/pi-stash) | Park and restore a draft message while handling another thought |
| [`pi-copy-message`](https://github.com/fitchmultz/pi-copy-message) | Copy raw session messages without terminal formatting |
| [`ponytail`](https://github.com/fitchmultz/ponytail) | Persistent pressure toward reuse, deletion, native features, and the smallest root-cause fix |

### Extensions bundled by this kit

[`clean-footer`](extensions/clean-footer.ts) removes cumulative token, cache, and cost counters while retaining the latest prompt cache hit rate, working directory, session name, context usage, model, thinking level, and extension statuses. The maintained [verbosity controller](https://github.com/fitchmultz/pi-verbosity-control), `npm:@fitchmultz/pi-verbosity-control`, supplies the same status used by the built-in footer; the kit does not read its configuration. `/fitch-setup` offers replacement of the foreign unscoped `npm:pi-verbosity-control` only when the maintained controller is selected, preserving `verbosity.json`; that older controller cannot supply this native indicator. It uses two lines when everything fits and wraps whole status items onto additional lines instead of truncating them. `/clean-footer` toggles the compact and built-in footers for comparison.

The footer bootstraps file-wide name/cache facts once and reconciles appended facts from the persisted journal after the leaf advances or the run settles, including abandoned branches and later `message_end` replacements. Each reconciliation acquires history once and processes only its new suffix; unchanged redraws do no history work. Native usage is a dirty snapshot keyed by session, leaf and model; resizing, themes and status-only redraws do not rescan history. An SDK owner making out-of-band journal edits must emit a lifecycle refresh; there is no public universal mutation signal. Git, provider/model/thinking and extension statuses remain live.

[`session-name`](extensions/session-name.ts) provides the `name_session` tool and inert session-name metadata that keep `/resume` searchable without renaming sessions for every subtask. It preserves coordinator and numbered subagent identities unless the user confirms their removal. When useful tools are already needed, naming joins the same tool-call batch rather than requiring a naming-only model round. Text-only tasks still receive names; unrelated work must not be invented to batch naming. This guidance works on official Pi and the fork. During migration, it defers to an already loaded standalone `name_session` tool until `/fitch-setup` removes that package and Pi restarts. Name metadata is stored as append-only conversation messages at native run/turn boundaries, not injected near the start of every request. Enabling naming and subsequent renames preserve the previous prompt prefix. A cached backward boundary walk stops at the first compaction (and reconciles committed retain-none drafts on the next request); supplied native request messages still own recovery placement. Native branch projection prevents duplicate metadata across reloads and restores the current name after compaction or tree navigation. Official Pi 1.0 and the maintained fork use the public lifecycle and compaction path, including truthful metadata on the first in-run request after retain-none compaction. Naming preserves other extensions' boundary drafts and continuation decisions. When recovery is needed after those drafts commit, its saved metadata stays at its originally submitted position in later requests, including after rename or reload. Replacing the old synthetic metadata head can cause a one-time cache miss at upgrade.

[`paged-reader`](extensions/paged-reader.ts) lets the agent use `reader_present` for a long, sectioned explanation when paced reading helps; short answers remain normal chat. The reader masks the moving transcript with a full-viewport native overlay but keeps the page itself at most 72×18 cells. Right or Space advances one page, Left goes back, and Escape closes at the saved place. The section heading stays on its own line while labeled page progress and note/reply status appear beneath it; editing a note is explicitly labeled `Note`. Long sections continue through word-wrapped subpages; narrowing or resizing the terminal keeps a content anchor, with no timer, internal reading scroll, or model call for navigation. `/reader` reopens the saved page, `/reader list` browses earlier documents and revisions, and `/reader demo` creates a sample without a model call. `L` opens the library from a page. Fullscreen mode also makes the visible action hints and library rows clickable; regular mode uses the same keyboard controls. Fullscreen temporarily renders inline images as text behind the mask and restores the terminal's image protocol on close. In regular mode, native image rows may remain visible behind the reader.

Press `N` on a section to edit a note in the bounded native editor. Each change is saved as session-only data outside model context; Ctrl+S saves locally and Escape returns to reading without sending. Ctrl+Enter explicitly requests a main-agent response with the immutable document ID/revision, section ID/heading, **full** original section text, and note. When another turn is busy, the request waits locally and is sent through Pi's main agent only after that work succeeds; cancellation leaves it unsent. An unchanged note cannot be sent twice by repeating Ctrl+Enter or reopening the reader; edit it to send new feedback. If a request has no saved reply, `T` deliberately retries the **previously submitted** note, never a newer unsent draft. A structured `reader_present` reply links by feedback ID; an unambiguous ordinary final-text answer also becomes a saved reply. `R` opens a ready reply and `B` returns to the original saved cursor. Ambiguous or incomplete text responses stay readable in the library without being presented as complete answers. Publication and replies never replace the page being read.

Reader state lives in native session custom entries and follows the active branch through restart, `/tree`, and compaction. On official Pi 1.0, sessions created with only `/reader demo` before their first user or assistant message still defer the initial JSONL write; restart durability begins once Pi has persisted that session. Both supported hosts provide native mouse controls in fullscreen; keyboard controls also work in regular mode.

[`setup-models`](extensions/setup-models.ts) provides `fitch_setup_models` for `/fitch-setup` to check requested model routes in the running session's registry. It reads the current snapshot without opening credential files, making network calls, or starting another Pi process; a trusted project's models may be present, so the results describe this session rather than proving user-global availability.

#### Fast modes

[`fast-mode`](extensions/fast-mode.ts) owns shared per-user settings for three providers, plus an optional OpenAI override for one session. Installing or updating the kit never opts you into Ultrafast or changes the default model routes.

| Command | Request policy | State file in the Pi agent directory |
|---|---|---|
| `/codex-fast [on|off|toggle|status|ultrafast]` | Shared OpenAI off, priority, or Ultrafast; only one at a time | `openai-codex-fast.json` |
| `/ultrafast [on|off|toggle|status] [--session]` | Ultrafast toggle, shared by default; `--session` overrides only this session | Shared file above, or native session metadata |
| `/ultrafast reset --session` | Clear this session's override and follow the shared mode | Native session metadata |
| `/anthropic-fast [on|off|toggle|status]` | Anthropic Opus fast mode | `anthropic-fast.json` |
| `/xai-fast [on|off|toggle|status]` | xAI priority | `xai-fast.json` |

Shared settings affect sessions sharing that directory. For OpenAI, a session override takes precedence over the shared mode. OpenAI/xAI settings apply to normal agent requests through Pi's payload hook. Built-in compaction and bare registry/nested streams bypass that hook on the verified hosts and retain their native policy; Anthropic's provider override also covers eligible internal calls. Footers follow changes made in other sessions. Changing a setting does not retier requests already in flight. The maintained 0.99.1 fork uses request-boundary execution, not live native successor chains.

##### OpenAI: priority and explicit Ultrafast

**Shared controls stay compatible with Fast.** `/codex-fast on` selects priority; `/codex-fast off` disables either shared kit mode. Blank `/fast`, or the existing `toggle` action, turns an enabled shared mode off and turns off into priority; none of those actions enables Ultrafast. Blank `/codex-fast` only reports status. Existing `enabled: true` state means priority, not Ultrafast. `/codex-fast ultrafast` remains a global alias with no `--session` form.

**Ultrafast is global by default.** `/ultrafast` with no arguments means `toggle`; `on` selects shared Ultrafast, `off` disables shared kit OpenAI tiers, and `toggle` changes shared Ultrafast to off or any other shared mode to Ultrafast. For example, `/ultrafast on` changes the shared setting like `/fast` does, while `/ultrafast on --session` affects only this session.

**Use `--session` for an override.** `/ultrafast on --session` stores `ultrafast`; `/ultrafast off --session` stores `off`, suppressing both kit priority and Ultrafast injection even when the shared setting is enabled. `/ultrafast toggle --session` changes effective Ultrafast to local off, or any other effective mode to local Ultrafast. Local off does **not** guarantee standard processing: native Auto or project defaults may still select a tier. Only `/ultrafast reset --session` clears the override and resumes the current shared setting; `reset` without `--session` is invalid.

An override takes precedence until cleared. It is saved in native session metadata and survives same-ID resume, reload, `/tree`, and compaction. Durability follows Pi 1.0's normal session saving, starting with the first user message; custom-only sessions are not yet restart-durable. Forks and new session IDs do not inherit it; they follow the current shared setting. Global `/fast` and `/codex-fast` commands never clear an override. `/ultrafast status`, including `/ultrafast status --session`, and the existing Fast status commands are read-only and show both shared and effective settings, including any mismatch. A shared change may therefore leave this session's effective setting unchanged.

The startup-only `--ultrafast` flag still selects the **shared** mode; `--fast` still selects shared priority. Both apply only at process startup, not again on reload, new, resume, or fork. Combining them, or requesting Ultrafast on an unsupported startup route, leaves state unchanged. Interactive Pi blocks requests until an explicit mode-changing command resolves the error; headless Pi reports the error on stderr and exits orderly with a nonzero status before making paid requests. Extension-sourced input is left unchanged, so recovery does not swallow queued extension messages. Startup and restored-Ultrafast notices disclose cost and entitlement requirements.

Explicit Ultrafast enablement validates exact Astra and the native route **before writing** shared state or a session override, without switching models, credentials, or endpoints. Off and session reset remain available on unsupported routes.

Ultrafast eligibility is deliberately narrow:

- exact `gpt-6-astra` on `openai` with `openai-responses` at the native global or US API endpoint;
- exact `gpt-6-astra` on `openai-codex` with `openai-codex-responses` at the native ChatGPT backend, **only with the required Codex plan entitlement**.

Cloudflare AI Gateway, GPT-5.6 preview models, other GPT models, o-series, Completions, and other proxies are not Ultrafast-eligible. Gateway priority support is unchanged; Ultrafast gateway support requires separate live proof before inclusion. If you move an Ultrafast-selected session to an unsupported route, the effective selection remains inactive, with no priority fallback. Shared Ultrafast shows `ultrafast requested` or `ultrafast unavailable`; a local Ultrafast override shows `session ultrafast requested` or `session ultrafast unavailable`. Local off shows `session OpenAI tiers off`. These labels describe kit request policy, not server confirmation. Route recognition cannot prove plan entitlement or residency eligibility.

The kit sends `service_tier: "ultrafast"` through Pi's stock `before_provider_request` payload hook on each eligible ordinary request. It adds no OpenAI provider override, custom transport, or routing header. The hook exposes the selected session model, not an internal call's actual destination: custom code forwarding that agent's payload callback to a different provider or endpoint is unsupported. OpenAI supports HTTP streaming and strongly recommends WebSockets for this mode. This change does not add direct-API WebSockets; the verified fork and official Pi 1.0 use HTTP/SSE there. Codex WebSockets are a different route, not a substitute for direct API support.

**Cost and access, checked 29 September 2026:** [OpenAI's Ultrafast guide](https://developers.openai.com/api/docs/guides/ultrafast-mode) and [pricing](https://developers.openai.com/api/docs/pricing?latest-pricing=ultrafast) make Astra Ultrafast available to all API users at **6× standard API prices (3× Fast)**. Per million tokens, requests with at most 272k input tokens cost $60 input, $6 cached input, $75 cache write, and $300 output; above 272k they cost $120/$12/$150/$450. The [Astra model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra) applies long-context pricing to the whole request. Initial Ultrafast limits are 500k tokens/minute for API tiers 1–3, 1M for tier 4, and 5M for tier 5. Processing supports global processing and US data residency only, not EU or other non-US regional inference. Astra's broad release is recorded in the [API changelog](https://developers.openai.com/api/docs/changelog); Sol remains a preview and is not enabled here.

[Codex Ultrafast access](https://learn.chatgpt.com/docs/agent-configuration/speed) requires the $500 Pro plan or eligible Enterprise/Edu access. Other self-serve plans do not qualify even with purchased credits. Enterprise access is off by default and controlled by workspace owners. Ultrafast consumes **8× included allowance**, or **6× purchased credits/PAYG**; neither multiplier promises an 8× task-speed improvement. Activation, startup, and restored-Ultrafast notifications disclose these costs and plan prerequisites.

**Native accounting is separate from this kit.** Official Pi 1.0 lacks Ultrafast's 6× cost adjustment; it can send the tier while native dollar estimates remain standard-rate. The current [maintained fork (`c2031ab`)](https://github.com/fitchmultz/pi/blob/c2031ab702c8815cd738a32664293541ad184ed6/FORK.md#retained-correctness-deltas) already applies a **6× monetary estimate for exact `gpt-6-astra` on native OpenAI Responses and Codex Responses**, only when the terminal response confirms `service_tier: "ultrafast"`. Requesting the tier alone is insufficient: missing, unknown, or `default` returned tiers do not confirm Ultrafast and do not apply that multiplier. A matching Pi version does not imply accounting parity. Provider billing remains authoritative; a native estimate is not proof of the billed tier or amount. The kit does not manufacture billing estimates or turn Codex's 8× allowance multiplier into a dollar estimate. Stop an old writer before migrating legacy native-window journals; preserve originals and follow that runtime's documented conversion path rather than reopening a live old-format file in another host.

Requested `service_tier` is observable through `onPayload` (`before_provider_request`); returned `response.service_tier` through `onProviderStreamEvent` (`provider_stream_event`). These existing raw hooks do not persist tier metadata or turn absent values into confirmation. No live Ultrafast generation, billing, or speed measurement is claimed here.

Priority continues to use `service_tier: "priority"` on `openai` and `openai-codex`, plus gateway models whose IDs start with `gpt-` or are `o3`/`o4-mini` (including their exact `2025-04-16` snapshots). Gateway o-series eligibility follows OpenAI's [Fast pricing](https://developers.openai.com/api/docs/pricing?latest-pricing=fast) and [o3](https://developers.openai.com/api/docs/models/o3) / [o4-mini](https://developers.openai.com/api/docs/models/o4-mini) documentation. Other gateway o-series and namespaced Workers AI models remain excluded. Local regression checks cover serialized requests and footer state; no live gateway o-series measurement is claimed. The priority footer reads `priority enabled`; notifications say `priority requests ON/OFF`. These describe request policy, not confirmed response handling.

Prior **priority**, not Ultrafast, measurements remain useful baselines: gateway `gpt-5.6-sol` echoed `service_tier: "priority"`; on `openai-codex/gpt-5.6-sol`, three interleaved pairs in one session on one account ran roughly 1.5× faster in throughput and 1.4× in completion time ([0.9.14 changelog](CHANGELOG.md)). Fixed-length output matters: time-to-first-token did not improve (1641ms standard versus 1772ms priority). The Codex response returned `service_tier: "default"`, which does not confirm priority processing or explain backend semantics. Record requested and returned tiers separately, leaving missing returned values unknown. Adding the Codex CLI's `x-codex-routing-hint` measured inside noise at that sample size, so the kit sends no such header.

##### xAI priority

`/xai-fast` requests `service_tier: "priority"` on `xai` and gateway models whose IDs start with `grok-`. Gateway `grok-4.6` is live-verified to echo priority. Time-to-first-token is often unchanged when idle; the tier buys queue priority under load. The footer shows `fast` only while enabled on an eligible model. Reported cost is not request-doubled: Pi applies the 2× Responses multiplier when the response confirms priority (`grok-4.5`); Completions models including `grok-4.6` stay on catalog rates.

##### Anthropic Opus fast mode

`/anthropic-fast` requests Anthropic's research-preview fast mode for Opus 5.5, Opus 5, and Opus 4.8 at double the token price, with reported cost rates doubled to match. It is verified on this setup's Claude subscription OAuth route, where identical output ran roughly 2× faster. The footer shows `fast` only while enabled on an eligible model.

Anthropic fast mode cannot ride the stock hooks: pi-ai assembles `anthropic-beta` (OAuth identity and feature markers) inside its client after extension header hooks run and merges headers last-write-wins. A hook-written value would drop Pi's own markers. The extension therefore owns the `anthropic-messages` stream callback for exactly `anthropic` and `cloudflare-ai-gateway`, appending the mandatory beta at fetch time so `speed` and header travel atomically. Other Opus proxies such as `github-copilot` and `opencode` stay stock; caller-supplied `client` requests stay at standard speed.

Accepted caveats of owning that callback: do not combine it with another Anthropic or gateway provider override without reviewing both, since Pi merges registrations last-write-wins; start a fresh Pi process after disabling or removing it, because `/reload` does not clear model-runtime provider overrides; and revalidate it when upgrading Pi, since it depends on Pi's provider composition and header-merge behavior.

[`anthropic-image-guard`](extensions/anthropic-image-guard.ts) preserves full-resolution images for other models while resizing only Claude-bound images to Anthropic's inline limits, on every route that speaks `anthropic-messages` (direct, Cloudflare AI Gateway, proxies such as GitHub Copilot). Non-Claude models sharing that wire API keep their source images.

[`write-prompt`](extensions/write-prompt.ts) adds `/draft <text>` and `/side-question <text>`. Both use the current session system prompt once and conversation off-transcript, flattening past tool-call semantics while retaining tool-result images, without replaying historical system messages or exposing tools. `/draft` rewrites the source into an agent request, then offers Accept, Copy prompt, Tweak, Restore original, or Deny. Accept sends normally when idle and steers the active agent when busy. Before sending, it saves the draft and original input in native session metadata outside model context. `/draft` without text reopens the last accepted draft on the current branch without another rewrite, including after a failed send. Restore original puts the original command back in the editor; synchronous send errors keep the dialog open for retry.

`/side-question` answers off-transcript and offers Copy answer, Ask again, or Dismiss; it never sends to the agent. Copy does not touch the editor. Both commands share the writer configuration below.

#### Draft provider, model, and thinking

By default, the writer inherits the active session's provider, model, and thinking level when rewriting starts. It uses Pi's native provider-neutral model API and configured authentication, without changing the session's settings. Pi handles provider-specific thinking mappings and output limits; the kit adds no separate output cap. Main-agent verbosity hooks are not applied.

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

### Legacy footer preferences

Pi 1.0 no longer exposes working-session checkpoints, metadata iterators, journal revisions, or usage-source labels. The kit uses public events and leaf identity on both hosts. Cold startup still reads old `clean-footer-checkpoint` entries for the matching session ID; copied parent entries cannot transfer a preference into a fork. New toggles are live instance choices, not a new persistent preference. `/tree` leaves the live choice alone; warm reload/new/resume/fork still create an enabled instance. Fast-mode policy remains in its existing shared files and native custom entries.

### Optional compact view

On a supporting Pi runtime, `/compact-view` switches between compact tool cards and the normal view. `/compact-view on` and `/compact-view off` choose explicitly. The change applies immediately to the current session and is remembered for new sessions; other open sessions are unchanged. Individual tool cards remain expandable by click in fullscreen mode, and Ctrl+O still expands or collapses all tools.

The fork defaults to off. [`examples/settings.json`](examples/settings.json) includes `"compactView": true` as my optional preference, which `/fitch-setup` offers separately only when the installed runtime supports it. Installing the kit never enables it. Official Pi without this feature remains supported and skips this setting. Core owns the view; `pi-subagents` follows it for routine coordination notices. The kit adds no rendering extension and changes no tool results or model context.

### Optional integration discovery

Pi 1.0 supplies native tool exposure, codemode, and tool search. The maintained fork also supplies optional [extension-owned instruction groups](https://github.com/fitchmultz/pi/blob/18acca18fbc5d38e6fcf52da01bea8be2b4f3818/packages/coding-agent/docs/instruction-groups.md) through its built-in `discover_tools`. Enabling instructions must not widen callable tool permissions. Review the owning extension's discovery support; coding tools, safeguards, recovery, and coordination should remain available.

This is an optional host feature, not an extension dependency. Official Pi 1.0 and fork builds without that feature retain ordinary tool exposure; the extensions continue working with their existing tools and instructions. The kit does not enable discovery, install a patched runtime, or change tool selection automatically. First use on a supporting host adds a discovery round; keep integrations eager if discovery harms task outcomes.

### Experimental extension

[`macuse`](https://github.com/fitchmultz/macuse) adds native macOS Computer Use for tasks a browser DOM or CLI cannot handle. It runs on the Computer Use runtime installed with ChatGPT, so it stays outside Complete core and is marked experimental: OpenAI can change that runtime's private interfaces without notice.

### User-local extensions

Personal provider definitions, agent-profile overrides, and experimental extensions remain outside Complete core. The separately managed Posthorse extension uses public compaction hooks for summary-free rollover on official Pi and the maintained fork; it is not a kit dependency. Setup preserves these choices and never copies private configuration into the public package.

### Why the image guard exists

Pi defaults `images.autoResize` to `true`, which protects provider limits by shrinking every image to at most 2000×2000. I disable it globally so vision-capable agents can inspect the original detail:

```json
{
  "images": {
    "autoResize": false
  }
}
```

That exposed stricter Anthropic image limits. The bundled guard fixes the boundary instead of giving up source quality everywhere: it runs only on Claude models over the `anthropic-messages` API regardless of which provider routes them, reuses Pi's native image resizer, keeps eight recent successful transformations, clears that cache on compaction, and retries later after resize failures. Before native decoding, it omits sources above 32 MiB of base64 and admits the newest images within a 64 MiB source budget, preserving conversation order and saved originals. On the bundled direct Anthropic and Cloudflare routes, and in writer calls, it also budgets the complete serialized request against Anthropic's 32 MB limit, including text and tool definitions. It resizes images further when needed, omitting oldest images first only when resizing cannot fit them; text/tool-only overflow retains native handling. The complete safe settings subset is in [`examples/settings.json`](examples/settings.json).

## Subagent bench

[`pi-subagents`](https://github.com/fitchmultz/pi-subagents) supplies both the orchestration runtime and the opinionated defaults: sixteen specialist profiles plus its general-purpose `delegate`. This kit uses that package instead of owning duplicate copies.

| Job | Profiles |
|---|---|
| Map and investigate | [`scout`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/scout.md), [`context-builder`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/context-builder.md), [`debugger`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/debugger.md), [`researcher`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/researcher.md) |
| Monitor changing state | [`watcher`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/watcher.md) |
| Decide and plan | [`planner`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/planner.md), [`oracle`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/oracle.md) |
| Implement bounded work | [`worker`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/worker.md), [`fixer`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/fixer.md) |
| Challenge the result | [`reviewer`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer.md), [`reviewer-gpt`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer-gpt.md), [`reviewer-claude`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer-claude.md), [`reviewer-security`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer-security.md), [`reviewer-ponytail`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer-ponytail.md), [`ui-designer`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/ui-designer.md) |
| Human-facing output | [`writer`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/writer.md) |

The parent session remains responsible for the task. Specialists return evidence; they do not become an autonomous hierarchy.

The exact primary, fallback, thinking, context, tool, and output policy lives in [`pi-subagents/agents`](https://github.com/fitchmultz/pi-subagents/tree/main/agents). The generic delegate inherits the parent model. User and project profiles can override the packaged defaults; setup preserves those files and previews the actual resolved mapping rather than copying a second routing table. Cross-model reviews and explicit provider choices remain available.

## Active skills

Skills load task-specific operating instructions only when the work matches. [`pi-agent-skills`](https://github.com/fitchmultz/pi-agent-skills) carries the active reusable workflow set:

| Skill | What it adds |
|---|---|
| [`ask-clarifying-questions`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/ask-clarifying-questions) | Stop only for ambiguity that materially changes scope, safety, or reversibility |
| [`bro`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/bro) | User-invoked plain-language rewrite with no jargon |
| [`deslop`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/deslop) | Remove AI-generated diff noise and ceremonial test tables without dropping real boundary coverage |
| [`diagram-creation`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/diagram-creation) | Create editable D2 architecture, sequence, data-flow, dependency, lifecycle, and before/after diagrams with rendered SVG/PNG review artifacts |
| [`dogfood`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/dogfood) | Exploratory QA through real browser and terminal/TUI flows |
| [`handoff`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/handoff) | Paste-ready continuation or bounded delegation prompts for a new session |
| [`pi-extension-development`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/pi-extension-development) | Build, debug, validate, package, and release Pi extensions against current runtime contracts |
| [`propose-then-ship-pi`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/propose-then-ship-pi) | Rank one repository improvement, stop for direction, then implement, review, and ship it |
| [`tdd`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/tdd) | Red-green-refactor when test-first behavior is explicitly required |
| [`test-audit`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/test-audit) | Gate new tests and audit low-value, implementation-coupled, or duplicative ones |
| [`thermo-nuclear-code-quality-review`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/thermo-nuclear-code-quality-review) | Strict maintainability review for large or structurally risky diffs |
| [`ux-review`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/ux-review) | Review user-visible workflows for completion, recovery, progress, and truthful outcomes |
| [`verification-before-completion`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/verification-before-completion) | Require current evidence before completion, commit, PR, or passing-check claims |

Companion skills ship beside their extensions:

| Source | Skills |
|---|---|
| [`pi-subagents`](https://github.com/fitchmultz/pi-subagents/tree/main/skills) | `pi-subagents` orchestration and `pi-intercom` coordination guidance |
| [`pi-mcp-adapter`](https://github.com/fitchmultz/pi-mcp-adapter/tree/main/skills/mcp-scripting) | `mcp-scripting` for discovering and composing MCP calls |
| [`ponytail`](https://github.com/fitchmultz/ponytail/tree/main/skills) | `ponytail`, `ponytail-audit`, `ponytail-review` (my runtime filters the debt, gain, and help variants) |

`bro` is intentionally user-invoked only. The rest are selected by task fit rather than loaded into every prompt.

## Connected MCP services

MCP is the context and action bus around the coding loop. Authentication is per-user and is never stored in this repository.

The current setup has authenticated, read-only-discovery-verified connections for:

| Connection | Capability |
|---|---|
| `horizon` | Internal integration gateway, authenticated identity, integration API calls, and nested tool catalogs |
| GitHub | Repositories, issues, pull requests, checks, reviews, releases, and code search |
| Linear | Issues, projects, teams, and planning context |
| Slack, primary and development workspaces | Public and approved private conversation context, threads, users, and canvases |
| Cloudflare | Documentation plus typed account API access |
| Sentry | Issues, events, traces, releases, and project context |
| Datadog | Dashboards, monitors, metrics, logs, traces, and operational context |
| Plain | Support threads, customers, workspace data, and Sidekick sessions |
| Notion | Workspace search, pages, databases, comments, and meeting notes |
| Granola | Meeting notes, summaries, folders, and transcripts |

The organization-specific endpoint and authentication configuration stay private. [`setup-manifest.json`](setup-manifest.json) records only the service choices; `/fitch-setup` stops for each user's own login and never probes by reading service data. My personal runtime is fully approved: MCP is a tool transport, not an authorization layer, so operating boundaries come from the working agreement and the human directing the session. The optional `mcp_script` mode is trusted local code execution when enabled, not a sandbox or an authorization boundary. The setup configures only integrations listed in the manifest and never persists mutable npm specs such as `@latest`.

## How the workflow fits together

A typical substantial change looks like this:

1. The main session reads repository instructions and pulls the relevant issue or service context through MCP.
2. Native repository search and, when useful, a fresh `scout` map the real code path before editing.
3. The main session owns design and integration, using its editor tools or independent `worker` tasks as useful. Delegate scouting, implementation, testing, and review freely when it helps; preserve isolated worktrees and clear ownership.
4. Agent Browser verifies browser-visible behavior when tests cannot prove the user experience.
5. Repository checks and deterministic tools establish current evidence.
6. Complete required reviews and use independent reviewers when helpful. Reviewers reconstruct the claim from the diff and evidence; refresh analysis when substantive changes invalidate it, not for unchanged behavior or metadata alone.
7. The main session closes the loop through authorized PR delivery, check and review remediation, merge, local checkout/installation refresh, and task worktree cleanup. Current or standing authority covers ordinary prerequisites; explicit holds remain binding.

The architecture stays modular:

```text
Pi core
  ├─ public extensions and tools
  ├─ bounded, model-routed subagents
  ├─ task-selected skills and policy
  └─ user-authenticated MCP services
```

This is already the working composition layer for a broader organization harness. Productizing it would add centralized provisioning, policy distribution, scoped credential brokerage, audit and cost visibility, managed local/cloud execution, and multi-user controls. It would not require turning the extensions into a monolith or locking the harness to one model provider.

## Install the kit

The kit requires Node.js 24.15 or newer and Pi 1.0.0 or newer, official or the fork. When using that editor with `pi-subagents`, use subagents 0.39.1 or newer so completion tracking recognizes the new editing tools and partial-error receipts. Setup checks each selected package's documented requirements before installing; installing the kit does not patch or replace Pi.

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
# Complete provider login in Pi, then:
pi install git:github.com/fitchmultz/pi-fitch-kit
# Start a fresh Pi process, then:
/fitch-setup
```

`/fitch-setup` reads [`setup-manifest.json`](setup-manifest.json), previews every package install and file change, and asks which parts to apply. It checks models through the running session's read-only `fitch_setup_models` tool, rather than starting a Pi CLI whose migrations can change files. It never reads or copies credentials. Reruns normalize filtered, pinned, or duplicate kit entries to one canonical source. They also preview removal of retired standalone packages, the archived Intercom package, approved Fold footer and fast-mode loader symlinks, and legacy kit-owned profile symlinks; symlink cleanup never removes regular files or links from another source. A separate consent step merges the manifest's flat context-window overrides into `models.json` per route, keeping existing values unless explicitly overwritten. `/fitch-setup verify` reports all drift without changing anything.

The manifest is the source of truth for package channels, models, bundled resources, and optional service connections. [`examples/settings.json`](examples/settings.json) is a safe subset of my behavioral settings, not a credential-bearing config dump. It selects Astra through a ChatGPT/Codex subscription at medium reasoning; setup falls back to an OpenAI API key when there is no subscription and filters optional routes by availability. The manifest offers 300k context budgets.

### Scoped core installs

These four linked extensions use owned, unpinned scoped npm channels:

```bash
pi install npm:@fitchmultz/pi-subagents
pi install npm:@fitchmultz/pi-ask-question
pi install npm:@fitchmultz/pi-calculator
pi install npm:@fitchmultz/pi-verbosity-control
```

The unscoped npm names are **not these maintained projects**. Git remains a supported manual fallback: use `pi install git:github.com/fitchmultz/<repo>` with the corresponding repository name above. Do not install both channels for the same extension: npm and Git have different Pi package identities. `/fitch-setup` previews source switches, backs up affected package entries, and preserves resource filters and controller configuration. Workflows has its own scoped package, `npm:@fitchmultz/pi-workflows`, but is not a kit core default.

## Prompts

The package registers only two prompts:

- `/fitch-setup` for installing or verifying the kit.
- `/github-open-issues-prs` for the one prompt-backed operational flow still on my normal path.

The older prompt files remain in `prompts/` as source material, but the package does not load them. Nothing is deleted; they simply no longer dominate autocomplete or the README.

## Trust and security boundaries

- Pi extensions run with the permissions of the user who started Pi. Project trust is not a sandbox.
- My personal setup runs with full approvals and does not put a confirmation dialog in front of each MCP call. The working agreement is model policy, not a technical authorization boundary.
- Every person authenticates their own model providers and services.
- The kit contains no keys, OAuth state, private endpoints, browser profiles, raw sessions, generated catalogs, or copied service responses.
- Extension packages use bare Git or npm sources. Agent Browser's separate CLI prerequisite stays on the wrapper's recommended upstream version.
- The settings example deliberately omits personal paths, package filters, credentials, and the trust default. Choose project trust explicitly.
- External writes, deployments, merges, account changes, and production actions follow current or standing user authority and enforced platform boundaries; do not ask again for covered actions or treat setup consent as authority for unrelated service mutations.

## Repository map

```text
extensions/             footer, image guard, fast modes, session naming, paged reader, setup models, and writer commands
examples/settings.json  safe, non-secret behavioral settings
prompts/                setup, one active operational prompt, and retained source material
themes/                 calm theme: event-horizon neutrals, single steel-blue accent family
setup-manifest.json     package sources and selectable integrations
templates/              optional working-agreement blocks
docs/                   technical guide and overview
scripts/                validation, package smoke, and focused regressions
```

## Validation

```bash
npm ci --ignore-scripts
npm run check:compat
```

- `npm run check:compat` reuses `check` plus `smoke` against the actually installed host graph. The locked official development cohort and supported floor are 1.0.0, not CI qualification targets. CI resolves the latest stable official cohort and maintained fork's current `main` once per run, then freezes that version and full commit SHA through every build and qualification lane. Both hosts run on Ubuntu with Node 24 and 26 and on macOS with Node 24; optional fork capabilities are detected, not required. The compatibility runner selects independent official/fork SDK, declaration and CLI graphs; lifecycle checks use the manifest's bundled bin, never Pi from PATH. This does not install the full setup-manifest composition or run paid providers.
- `npm run check` type-checks the bundled extensions, exercises the image guard boundary, the fast toggles, session naming, the paged reader, and writer commands, then validates unpinned package sources, manifest resources, package metadata alignment, the absence of retired patch and duplicate surfaces, the settings example's model, retry, and compaction consistency, and that every enabled or context-window route is manifest-managed with room for the configured compaction reserve and recent context. It also runs the validator against invalid manifest and compaction inputs; policy values live in the manifest and settings example rather than a second frozen validator table.
- `npm run regression:clean-footer` loads the real footer with an offline SDK session. It checks file-wide names and cache hit rates across redraws, append, rename, branch extraction, reload, and new sessions; live context, model, theme, and wrapping stay fresh. It asserts zero history reads on 100 unchanged redraws before persistence and after a real offline response replaced by a later `message_end` handler, and retains cold recovery of legacy footer preferences. An optional host-root argument supports focused read-only SDK probing, not declaration qualification.
- `npm run regression:fast-mode` verifies real serialized requests with fake fetches: Anthropic speed/beta atomicity and gateway dispatch, OpenAI/xAI priority, exact Astra Ultrafast routing and exclusions, shared/session precedence, native persistence and fork isolation, startup validation across factory recreation, cost notices, footer eligibility, and watcher cleanup.
- `npm run regression:session-name` verifies naming, metadata injection, protected identities, single ownership during migration, and serialized prompt-prefix stability and native session lifecycle behavior.
- `npm run regression:paged-reader` checks bounded Markdown pagination, native fullscreen pointer and regular keyboard controls, local-only draft saves, explicit feedback context and duplicate prevention, reply linkage/fallback, immutable revisions, and file-backed cursor recovery. An offline SDK fixture proves busy-session delivery, direct-abort cancellation without a ghost send, and final-text correlation using a faux provider; no paid request is made.
- `npm run regression:write-prompt` verifies provider/model/thinking inheritance, full and partial overrides, configuration errors, native thinking adjustment, idle/busy acceptance, synchronous send failure and original-input recovery, accept/deny, boxed rewrite instructions, `/side-question` ask-again history, session-prefix rewriting, reusable tweak history, and cancellation that aborts the provider call without touching a retired session. It also loads the real extension into offline SDK sessions and checks native completion/HTTP serialization for single-copy instructions, no tools, flattened history with retained screenshots, Responses/Codex serialization, native idle delivery and busy steering, asynchronous send failure with saved-draft retry, file-backed resume, fresh sessions, and public compaction handoffs without leaking pre-boundary history. Run `node scripts/write-prompt-boundary.mjs <pi-coding-agent-package-root>` to check another installed or built Pi host; only HTTP responses and dialogs are stubbed.
- `npm run smoke` loads the checkout through the selected Pi host's real resource loader, checks SDK theme loading without diagnostics and requires the selected host's offline native CLI to accept shipped `calm` and reject a missing-required-color fixture without silently accepting fallback, renders the compact footer at wide and narrow widths, checks its toggle and in-session model status against legacy-file fixtures, and requires nine commands, `name_session`, `fitch_setup_models`, `reader_present`, one provider request hook, seven extensions, and two prompts.
- `npm run smoke:lifecycle` uses an isolated Pi agent dir for real install, stale-filter and duplicate-identity normalization, and resource reload; it also checks that installation leaves compact view unset and reinstall preserves an explicit opt-out.

For the detailed workflow, model table, evidence, and security rationale, read [docs/pi-setup.md](docs/pi-setup.md). For the short version, read [docs/pi-setup-post.md](docs/pi-setup-post.md).
