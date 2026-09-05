# Changelog

## 0.10.3 — 5 September 2026

- `/codex-fast` and its footer now cover Cloudflare AI Gateway `o3` and `o4-mini`, including their `2025-04-16` snapshots, using OpenAI's documented Fast-mode support. Other gateway o-series models remain excluded; direct-provider, GPT, Grok, Workers AI, and toggle-state behavior is unchanged.
- Validate the exact 320000 context-window policy and report missing compaction settings with useful errors. Qualify the v0.9.0 headroom explanation as Anthropic-only.
- Resolve Pi's package root through its native API in the session-name regression so both regular and bundled CLI layouts run the same checks.

## 0.10.2 — 4 September 2026

- Align the Agent Browser prerequisite with `pi-agent-browser-native` 0.6.3 by installing its tested 0.36.0 target instead of the now-unsupported 0.34.0 release.

## 0.10.1 — 31 August 2026

- Restore the latest prompt cache hit rate (`CH`) to the compact footer while keeping cumulative token, cache, and cost counters hidden.

## 0.10.0 — 25 August 2026

- Treat Pi `0.84.2` and Node.js `24` as minimum runtime floors instead of requiring one exact installed Pi version; keep the `0.84.2` development dependencies exact for reproducible checks.
- Update the Agent Browser prerequisite to the live-verified `0.34.0` CLI baseline.
- Retain `/fast` and `--fast` as aliases for the kit's shared OpenAI priority toggle, without restoring the unhelpful `x-codex-routing-hint` header.
- Let `/fitch-setup` preview and retire only provenance-matching Fold footer and standalone fast-mode symlinks while preserving their source files; standalone session naming remains a retired package owned by the kit after reload.
- Keep schema 7 model requirements unchanged pending a separate model-manifest review.

## 0.9.14 — 22 August 2026

- Documented the live verification of `/codex-fast` on the `openai-codex` subscription route, which had never been measured. In one session on a single account, `gpt-5.6-sol` with output pinned at 603 tokens per sample ran 55.5 tok/s and 12502ms standard against 82.6 tok/s and 9074ms fast across three interleaved pairs, a 1.49x throughput and 1.38x completion speedup; time-to-first-token did not improve (1641ms standard against 1772ms fast). No code change: the stock `before_provider_request` payload field already carries it. Recorded two measurement traps: the Codex backend echoes `service_tier: "default"` while serving priority (openai/codex#14204), so the echoed tier proves nothing there, and the gain only appears as throughput on a fixed-length output. Adding the Codex CLI's `x-codex-routing-hint` header measured 84.1 tok/s against 82.6 without it, inside noise at that sample size, so the kit does not send it and keeps `before_provider_headers` unused.

## 0.9.13 — 22 August 2026

- `/codex-fast` and `/xai-fast` now also cover Cloudflare AI Gateway routes: gateway models with ids starting `gpt-` join the OpenAI toggle and ids starting `grok-` join the xAI toggle, so `cloudflare-ai-gateway/grok-4.6` and gateway GPT routes honor priority instead of silently ignoring the toggle. Direct `openai`/`openai-codex`/`xai` behavior is unchanged, the toggles stay mutually exclusive per model, and the footer follows the same eligibility. Live-verified through the real gateway: fast legs echoed `service_tier: "priority"` on `gpt-5.6-sol` (median TTFT 1168ms to 877ms) and `grok-4.6` (TTFT unchanged while idle, which matches xAI's queue-priority semantics), and gateway Opus confirmed `usage.speed: "fast"`.

## 0.9.12 — 20 August 2026

- Synced the public-safe settings snapshot to the active runtime: direct OpenAI GPT-5.6 Sol at max thinking, the current ten-route model cycle, five agent-level retries, and a two-minute provider timeout.
- Replaced stale Luna/Terra model requirements with the current direct fallback baseline and optional gateway, Codex, xAI, Fireworks, and cf-google routes. The context-window merge now covers only routes the kit can safely reproduce; private custom model definitions remain user-managed.
- Updated setup guidance and docs from fourteen stale Grok/Codex-heavy roles to the current sixteen-profile OpenAI, gateway Claude, and Kimi routing, including `watcher` and `reviewer-ponytail`.
- Added `pi-ctx-info` to the core extension set, and retired the disabled `pi-ask-question` and `pi-fff` packages in favor of the clarification skill and native repository search.
- Documented the user-local extension exceptions kept outside Complete core: force-disabled nested repository instructions and a loaded 500k Sol Pro alias that is not in the enabled model cycle.

## 0.9.11 — 18 August 2026

- The fast-mode footer shows `fast` only while a toggle is on, instead of a permanent muted `fast:off` whenever an eligible model is selected. Off and ineligible models show nothing, identically across the Anthropic, OpenAI/Codex, and xAI toggles.

## 0.9.10 — 17 August 2026

- `/xai-fast [on|off|toggle|status]` requests xAI Priority Processing (`service_tier: "priority"`) on the `xai` provider through the same `before_provider_request` hook as `/codex-fast`. State lives in `xai-fast.json`. Reported cost is not request-doubled: Pi already applies the 2x Responses multiplier when the response confirms priority, and Completions accounting stays on catalog rates.

## 0.9.9 — 16 August 2026

- `/draft` no longer sends tools to the nested writer. Tool history is flattened to text so the writer cannot stop on `toolUse`. The rewrite instruction now says it is not the session agent.

## 0.9.8 — 16 August 2026

- Renamed `/write-prompt` to `/draft`. `/side-question` can Ask again on the same writer.

## 0.9.7 — 16 August 2026

- `/write-prompt` boxes source with a fence that cannot appear in the text. `/side-question` exits with Dismiss. An override model notifies `Using provider/id` for both commands.

## 0.9.6 — 16 August 2026

- `/write-prompt` wraps the source and says do not answer it, so a question-shaped input is rewritten instead of answered. `/side-question` uses the same session snapshot to answer off-transcript; Copy answer never sends to the agent.

## 0.9.5 — 16 August 2026

- `/write-prompt` rewrites against a snapshot of the current session: same system prompt and conversation prefix, rewrite instructions as the last user turn, `cacheRetention: "short"`, and a fresh nested session id. Tool-bearing history includes the matching tool defs so Anthropic does not 400. Claude-bound images go through the same resize/omit path as the main turn. The draft on the action screen uses the theme body text color instead of the selector accent.

## 0.9.4 — 16 August 2026

- `/write-prompt` shows the rewritten prompt and Accept / Copy prompt / Tweak / Deny on one screen. The extra editor confirm before choosing an action is gone.

## 0.9.3 — 16 August 2026

- Added `/write-prompt <text>`: a nested writer rewrites the text off-transcript, then Accept sends it, Copy prompt puts it on the clipboard without touching the editor, Tweak continues the same writer, and Deny discards it. Optional writer model lives in `~/.pi/agent/write-prompt.json` as `{ "model": "provider/id" }`; missing or invalid config uses the active session model. Print and JSON modes refuse rather than auto-send.

## 0.9.2 — 14 August 2026

- Aligned the shipped compaction policy with the config it was derived from. `examples/settings.json` now carries `compaction.reserveTokens: 64000` (it had drifted to the stock 16384 while the real subset it mirrors uses 64000), and the setup manifest gains `modelContextWindows` (schema 7): flat 320k `contextWindow` overrides for the manifest-managed codex, anthropic, and openai fallback routes, merged narrowly into `models.json` as a new `/fitch-setup` consent step with keep-or-overwrite rerun semantics, preview disclosure, and verify-mode drift coverage. Paired with the 64k reserve the overrides compact at a 256k threshold with roughly 60k of near-threshold generation runway. The override means two things by route family: on the ~1M-catalog anthropic routes it compacts far earlier than the catalog edge (the regime the 0.9.0 rationale described), while on the 272k-catalog openai and openai-codex gpt-5.6 routes it raises the advertised window and requests whose input exceeds 272k bill at OpenAI's long-context tier for the entire request, a deliberate quality-over-cost choice the consent step now discloses. `xai/grok-4.6` is absent because it runs as a full custom model definition already carrying a 320k window. Validation pins the settings example's compaction values, requires every override route to be manifest-managed with a sane positive integer, and asserts the prompt carries the new consent step.
- Documented the one accepted gap from the v0.9.0 patch retirement: stock Pi 0.84.2 does not classify OpenAI's bare transient `Sorry, something went wrong` response as retryable, and the kit will not re-patch core or carry an extension shim around message handling for it; the classification fix belongs upstream. Until it lands those turns fail instead of silently recovering.

## 0.9.1 — 14 August 2026

- `anthropic-image-guard` now gates on Claude models over the `anthropic-messages` wire API instead of the `anthropic` provider name, so Claude behind Cloudflare AI Gateway or proxies such as GitHub Copilot gets the same resize/omission protection as the direct route. Previously a gateway-default setup ran its daily Claude models with no image guard at all. The API alone would be too broad: providers such as `vercel-ai-gateway`, `kimi-coding`, and `minimax` speak `anthropic-messages` for non-Claude models whose image limits differ, so those keep full-resolution sources (Claude ids are matched anywhere in the id to cover namespaced forms like `anthropic/claude-opus-5`). Smoke coverage drives gateway and namespaced-Claude routes and asserts non-Claude `anthropic-messages` models and non-Anthropic APIs stay untouched.

## 0.9.0 — 14 August 2026

- Retired the Pi core patch stack. Pi 0.84.2 plus current settings replaced its motivation: the Cloudflare "exceeded request buffer limit while retrying upstream" retry classification landed upstream in pi-ai, and flat 320k `contextWindow` overrides against ~1M catalog windows (on Anthropic routes) leave stock post-run compaction roughly 700k tokens of headroom before real overflow, with stock overflow recovery behind it. Deleted the patch artifact and archives, the guarded applicator, the core runbook, and the applicator, retry, and Anthropic-stall regressions. The kit no longer modifies any Pi core file, and the manifest no longer declares `piCorePatch`.
- Regrouped the extensions by function. New `extensions/fast-mode.ts` owns both fast toggles: `/anthropic-fast` (Opus fast mode, 2x token price, reported cost rates doubled to match) and `/codex-fast` (OpenAI priority tier), with per-model footer status and the existing `anthropic-fast.json` / `openai-codex-fast.json` state files, so current toggle state carries over. OpenAI priority rides the stock `before_provider_request` hook. Anthropic fast mode keeps the fetch-time beta append inside a scoped `anthropic-messages` stream override, because pi-ai assembles OAuth and feature beta markers after extension header hooks and merges headers last-write-wins, so a hook-written header would drop them; the override now also covers `cloudflare-ai-gateway`, extending Opus fast mode to gateway routes, and reproduces the gateway provider's endpoint-placeholder resolution so off-state dispatch stays base-equivalent, while other Opus proxies (`github-copilot`, `opencode`) stay stock. Live-verified end to end in an isolated Pi sandbox with real credentials: `cloudflare-ai-gateway/claude-opus-5` completes with fast off and fast on through the real gateway, and `anthropic/claude-opus-5` completes with fast on over subscription OAuth, so the appended beta arrives with Pi's OAuth markers intact (Anthropic rejects `speed` without the beta header, and the OAuth route rejects requests missing its identity markers). A fresh Pi process is still required after disabling or removing `fast-mode`; `/reload` does not clear model-runtime provider overrides.
- `anthropic-image-guard` is image handling only again, and `/reload` now suffices for it. Retired `codex-context.ts`: its `/codex-fast` moved to `fast-mode.ts`, and its alternate-model compaction router was removed with its consent block (the config had remained disabled; native active-model compaction is the behavior). Legacy `pi-codex-context.json` files are left untouched. While a stale standalone `pi-codex-context` install is still loaded alongside the kit, Pi exposes the duplicate registrations as `codex-fast:1`/`codex-fast:2` until `/fitch-setup` removes the standalone package.
- Pinned the validated runtime at Pi 0.84.2 across the manifest, devDependencies, lifecycle smoke, and docs. Added `regression:fast-mode`; simplified `npm run check` accordingly.

## 0.8.2 — 12 August 2026

- Compaction now uses Pi's active session model unless `pi-codex-context.json` explicitly enables custom routing and supplies a valid non-empty `compactionModels` list. Literal consent without model candidates, missing or malformed config, and invalid or empty lists all return control to Pi's native active-model compaction.
- Kept explicitly configured alternate-model routing, ordered failover, native retry/cancellation, fast-mode payload handling, usage accounting, and active-model fallback unchanged. The Pi core artifact is unchanged from v0.8.1.

## 0.8.1 — 9 August 2026

- Reverted v0.8.0's elapsed-time and interrupt-hint addition from `WorkingStatusIndicator`, restoring Pi 0.84.1's stock `Working...` row. Organic use proved the timer worked, but it was unrequested and added noise when live child-agent rows already showed progress. Healthy provider slowness is accepted without a token-silence watchdog, provider timeout, or Anthropic-specific retry.
- Kept the Anthropic stall diagnosis and transport regression: a truly byte-idle response still times out, while filtered SSE heartbeat pings can keep a healthy inference alive without visible assistant events. The correct product response is the diagnosis, not a behavior change.
- The runtime artifact is again byte-identical to v0.7.0's six-file OpenAI resilience and compaction stream (`sha256:c7917d7eda6b8d6020b52588f01d0fa2896971ae0362f9687ba13702d8de981e`). The guarded applicator still tracks the status-indicator path so it can recognize, reverse, restore, and recover v0.8.0's seven-file legacy era; complete legacy backups also refresh their recorded patch metadata during migration.
- Existing v0.8.0 installs remain `legacy-patched` until guarded `apply` runs. The UI revert then requires a full Pi process restart and may wait for the next natural approved maintenance window.

## 0.8.0 — 9 August 2026

- Long agent turns now stop looking like a frozen TUI: after 30 seconds the core working row adds turn-scoped elapsed wall time and the configured interrupt key, with `esc` as a defensive fallback (`Working... (9m 24s; esc to cancel)`). Updating a custom working message preserves the original start time, and disposal clears the new timer. This is visibility and user control only; it does not add a provider timeout or retry.
- Identified and reproduced a sufficient mechanism for the reported `anthropic/claude-fable-5` stall. Session evidence shows one normal assistant turn ran for 564.341 seconds with no tools, retries, or errors. Pi's configured HTTP idle timeout still correctly aborts a truly byte-idle response body, while synthetic Anthropic SSE `ping` events keep the transport active and are intentionally filtered before the assistant event stream. Redefining idle as “no visible model token” would kill a healthy long inference. A local synthetic regression now proves both transport cases and pins the v0.7.0 silent indicator red against the v0.8.0 fake-clock green.
- The guarded applicator now tracks seven files. It archives and checksum-pins v0.7.0 as the six-file legacy era, migrates released three-, four-, and six-file backups into the current seven-file layout, and verifies direct restore and interrupted-mutation recovery for the new era. Applying this TUI-only addition still requires a full Pi process restart. TARS may carry the unified patch bytes for parity, but its Slack surface does not use Pi's terminal working indicator and gains no runtime behavior from this line.

## 0.7.0 — 9 August 2026

- Adopted TARS's reviewed OpenAI Responses resilience patch into the kit's Pi 0.84.1 core artifact, unifying the two patch streams. The shared retry classifier now recognizes only the exact bare transient `Sorry, something went wrong` message (optional final period) and continues to use Pi's native bounded, abortable backoff; extra detail remains non-retryable. Vanilla Responses output now preserves HTTP status, `x-request-id`, terminal response status, and provider error code in additive runtime `providerMetadata`, plus terminal response ID in the existing top-level `responseId`: the terminal event's ID is preferred, falling back to the existing value (normal streams carry the same ID in both events). The kit corrects the original patch's SDK field lookup to read OpenAI 6.26's `APIError.requestID` while retaining a `request_id` wrapper fallback; a real local HTTP-500 regression pins request-ID survival. `providerMetadata` remains absent from Pi 0.84.1's emitted `AssistantMessage` type and is part of the upstream type-contract ask. Codex gains the exact generic retry classification and shared success-path response status only: its event mapper throws terminal failures before the patched shared failure branches run, and its catch records no metadata, so Codex failure and HTTP diagnostics remain unchanged.
- Expanded the real-binary retry regression with two distinct red/green contracts. Archived v0.6.0 must reject the exact generic classifier and omit response.failed diagnostics; current must classify the narrow shape and preserve HTTP/request/terminal metadata. The current patched `pi --mode rpc` binary also runs against a local Responses API: one `response.failed` recovers through one bounded retry, while persistent failures stop at the configured budget and surface final-attempt diagnostics. The test explicitly records that `server_error` was already retryable before v0.7.0, so this lifecycle leg does not falsely claim classifier causality.
- The applicator now tracks six files and supports intermediate legacy file bytes explicitly: v0.6.0 changed retry.js to bytes that are neither stock nor current, represented by a checksum-pinned per-era override. Archived 0.4.2/0.4.3/0.5.0 three-file backups and v0.6.0 four-file backups migrate through the existing exact-layout, preflighted, atomic upgrade machinery to the current six-file backup. Restore now also pairs the accepted layout with the installed era before journaling: every file that era's patch can reverse must have a recorded stock preimage, so a v0.6.0 install cannot start restore against an otherwise valid older three-file backup. Archived v0.6.0 remains a permanent migration fixture. The runbook also documents the fail-closed recovery for a hand-built current-patch/four-file-backup state: reinstall exact stock Pi, verify stock, then guarded apply; never forge backup metadata.
- Documented two upstream Pi asks (the narrow retry pattern and additive Responses diagnostics), credited the patch as TARS-original, and carried the shared-parser dead fallback expression as an upstream-only cleanup rather than changing the reviewed adoption.

## 0.6.0 — 9 August 2026

- The core patch now classifies the Cloudflare-edge "exceeded request buffer limit while retrying upstream" response as transient, so Pi's native bounded auto-retry (settings budget, exponential backoff, abortable, honest exhaustion) recovers the turn instead of stalling the session until a manual bump message. Root-caused from live captures: the failed attempt streams no output and Pi rebuilds the request from session state per attempt, so retrying cannot accumulate or loop; an identical follow-up request succeeded immediately.
- Archived the v0.5.0 patch identity for checksum-pinned legacy migration, taught the applicator that legacy patches leave the retry classifier at stock bytes, and added a red/green regression that drives the real patched `pi --mode rpc` binary against a local model server: the archived patch must still stall (one request, no retry), the current patch must recover through one bounded retry and stop honestly after the budget when the error persists.
- Interrupted-mutation recovery preflights that every tracked file outside the backup's manifest already sits at stock bytes and otherwise fails closed without touching anything; a pre-existing recovery journal could previously drive a legacy-layout backup to mutate a fully patched install into a mixed state. Released layouts are recognized per archived legacy patch rather than assuming all archives left the same files untouched.
- Backup manifests must match one of the released layouts exactly (the legacy three-file set or the complete current set); a truncated path set could otherwise make interrupted-mutation recovery restore fewer files than a patch step touched and wedge the install, and a fully patched install with a legacy-layout backup refuses restore before journaling for the same reason.
- Backups written by released kits are now verified against the file set their own manifest records and upgraded in place before mutation: missing stock preimages are staged from the install (which legacy patches never touched) and the manifest is atomically rewritten last, refreshing stale recorded patch metadata. Previously a real released-era backup failed `status` and `apply` with a missing-path error before migration could run. The migration regression now rebuilds era-accurate three-file backups, including a stale-metadata variant, instead of backups the current applicator created itself, and missing tracked core paths fail closed with a named error.

## 0.5.0 — 9 August 2026

- Hardened request-boundary compaction against unsummarizable high-usage sessions, retry-classifier collisions, cancelled-compaction restarts, removed error-assistant resurrection, pre-aborted and pending-auth cancellation races, and stale manual preflight snapshots. Alternate-model compaction now receives Pi's native retry policy and lifecycle callbacks, and cancellation no longer waits for candidate authentication.
- Made the exact-version core applicator concurrency- and crash-safe with `/usr/bin/patch`, atomic PID locking, symlink confinement, staged stock backups, action-scoped artifact checksums, canonical manifests, durable recovery journals, early backup-health failures, and targeted wrapper diagnostics. Read-only status reports interrupted mutations without repairing them, and released 0.4.1–0.4.3 patch identities migrate through checksum-pinned archives. Added isolated security, migration, and interruption fixtures.
- Made `/fitch-setup` consent revocable, normalized filtered/pinned/duplicate kit entries with one identity-aware removal per scope, added separately confirmed Complete-core patch status/apply/restore handling, stopped on the first failed step, and distinguished `/reload` from the full restart required by Pi core changes.
- Added a real isolated install/filter-and-duplicate-normalization/reload smoke, exact theme-manifest validation, and portable consent-gate coverage. Fixed `/anthropic-fast` typo handling, the documented `fast:on|off` label and reload behavior, canonical agent-directory lookup in clean-footer and the Codex regression, and the full-restart requirement after removing the Anthropic provider override.

## 0.4.3 — 8 August 2026

- The tool-loop compaction patch now also compacts at the turn boundary, after tool results and before queued steering drains, so messages queued during an in-run compaction ride the immediate next provider request instead of arriving one request late; interactive input enqueued by the fire-and-forget compaction flush is included on a best-effort basis. The request-boundary check remains as a fail-closed backstop for messages injected after the turn boundary.
- Boundary compaction now threads the run's `AbortSignal` into auto-compaction, so `session.abort()` and `agent.abort()` cancel an in-flight pre-request summarization promptly instead of hanging until it completes and appending a post-abort compaction entry.
- Auto-compaction classifies an exit as a clean `aborted` compaction event only when its combined signal is aborted; an `AbortError` with a live signal stays a failure with its message. A blocked provider request no longer retriggers post-run auto-compaction, and the boundary hook skips already-aborted runs entirely, so cancelling a pre-request compaction with Escape surfaces once instead of silently restarting.
- The guarded reapply command now recognizes installs patched by kit 0.4.1/0.4.2 as a sha-pinned `legacy-patched` state and migrates them in one run — reverse the archived superseded patch, verify the stock intermediate, apply the current patch — with the same fail-closed rollback; `restore` returns them directly to reviewed stock.
- Documented the verified provider-recovery tradeoffs the patch intentionally leaves to stock Pi: no-usage first requests, system-prompt and tool-schema estimate deltas, post-transform final-fit, mid-turn model switches, and terminating tool batches compacting one step early because the loop keeps its continuation decision private.
- Aligned development validation, the setup manifest, and install instructions with Pi 0.84.1 while retaining the reviewed Pi 0.84.0 reapply identity.

## 0.4.2 — 7 August 2026

- Footer model names render as the last path segment of router-style ids, so `(fireworks) accounts/fireworks/routers/kimi-k3-fast` becomes `(fireworks) kimi-k3-fast`.
- Anthropic and Codex fast-mode indicators both read `fast:on|off`. Each appears only for its own provider, so the shared label stays unambiguous.
- Inside a git repository the footer location shows the repo name in a stable per-repo color hashed from the repo root into a low-chroma 256-color palette. Under the `worktrees/<repo>/<slug>` convention it shows `repo/slug` with the color keyed on the repo. Non-repo directories and a home-dir dotfiles repo fall back to the last-two-segments path, and the branch renders only alongside a real project repo.
- Added the bundled `calm` theme: event-horizon's neutrals with accents collapsed to a single steel-blue family, a gray-to-blue thinking ramp in place of the hot-pink top end, and muted labels and syntax colors.

## 0.4.1 — 7 August 2026

- Added guarded Pi 0.84.1 tool-loop compaction restoration while retaining Pi 0.84.0 validation support.
- Made the active-install regression cover each configured GPT-5.6 context-window override without requiring inactive providers.

## 0.4.0 — 6 August 2026

- Raised the minimum supported Pi version to 0.84.0 and pinned development validation to the exact 0.84.0 Pi packages.
- Routed alternate-model compaction through Pi 0.84's composed providers while preserving provider header deletion markers, credential-resolved base URLs, and environment overrides.
- Added a checksum-guarded, idempotent Pi 0.84.0 core reapply/restore command with a reviewed patch artifact and stock backup. Revalidated the bundled extensions, package loader, and tool-loop compaction patch against the released implementation and types.
- Restored `pi-verbosity-control`'s configured `🗣 low`, `🗣 medium`, or `🗣 high` indicator beside model thinking details in the compact footer.

## 0.3.2 — 4 August 2026

- Added a compact footer that removes cumulative input, output, cache, cache-hit, and cost counters while preserving the working directory, session name, context usage, model, thinking level, and extension statuses.
- Footer content wraps instead of truncating at narrow terminal widths. `/clean-footer` toggles between the compact and built-in footers for comparison.

## 0.3.1 — 4 August 2026

- Moved `pi-session-name` into the kit as `extensions/session-name.ts` and retired the duplicate package source from new installs. Existing Pi session names remain in their session files; removing the standalone extension does not reset them.
- Preserved the `name_session` tool, inert context metadata, stable-name guidance, and confirmation before removing coordinator or numbered subagent identities.
- During upgrades, the bundled extension defers when Pi's effective tools already contain `name_session`, then activates after `/fitch-setup` removes the standalone package and Pi reloads. Added a focused regression for naming behavior and both migration load orders.

## 0.3.0 — 4 August 2026

- Moved `pi-codex-context` into the kit as `extensions/codex-context.ts` and retired the duplicate package source from new installs. Existing `openai-codex-fast.json` state and `pi-codex-context.json` consent config remain canonical, so migration does not reset either setting.
- Preserved hook-only OpenAI priority routing, literal opt-in alternate-model compaction, the active-install regression, and the Pi core restoration runbook. Repeated session starts now unwatch before watching the shared fast-mode state file, matching the kit's leak-free Anthropic footer.
- During upgrades, the bundled extension defers when Pi's effective resources already contain the standalone `/codex-fast` command. `/fitch-setup` removes that managed source before restart or reload, keeping the command, request rewriting, and custom compaction single-owner without reimplementing Pi's package resolution.

## 0.2.4

- Added an `anthropic-fast:on|off` footer indicator, matching the one in pi-codex-context. It appears only on Opus 5 and Opus 4.8, is colored by state, and clears on every other model. It reports the toggle and the selected model, which is what a session can know before a request; a request that supplies its own `client` still runs at standard speed while the footer reads `on`.
- The footer watches the shared state file every 5 seconds, so a session picks up a toggle made in another session rather than showing stale state. Toggling inside a session updates its own footer immediately, so the poll only covers cross-session changes and does not need to be fast.

## 0.2.3 — 4 August 2026

- Verified against the live Claude subscription OAuth route on 4 August 2026: `speed: "fast"` and the beta header are both server-validated, the request is accepted, and identical output returned in 4.8s against 9.5s with fast mode off. Reported cost still doubles, which tracks Anthropic's metered pricing exactly for API-key routes and stands in as a premium-usage signal on subscription auth, where Pi's cost figures are notional.
- Added `/anthropic-fast [on|off]` to the Anthropic extension: off by default, persisted in the Pi agent directory, and limited to Opus 5 and Opus 4.8 because fast mode is Opus-only and bills double per token. Reported cost rates double with it so session totals match Anthropic's premium billing.
- Documented the accepted caveat: this override owns Anthropic streaming while loaded, so it should not be combined with another Anthropic provider override unreviewed, Pi should be restarted rather than reloaded after disabling or removing it, and it should be revalidated on each Pi upgrade.
- Pi's provider composer collapses full and simple stream calls into a single extension callback and drops the provenance, so the extension classifies full-stream callers by their Anthropic-native options and leaves everything else on the simple path. Requests that supply their own `client` bypass `options.fetch` in pi-ai and therefore stay at standard speed rather than risk `speed: "fast"` without its required beta header.

## 0.2.2 — 4 August 2026

- Reorganized the public documentation around the active stack: linked extensions, the fourteen-agent bench, directly linked source-managed skills including `diagram-creation`, and authenticated MCP capabilities.
- Reconciled the release manifest with the currently loaded public packages, removed inactive routes, and made every extension install source unpinned.
- Made consolidated `pi-subagents` the sole source for the fourteen specialist profiles and Intercom, then removed this kit's duplicate profiles, sync machinery, and standalone Intercom package.
- Registered only `/fitch-setup` and `/github-open-issues-prs`; retained the rest of the prompt files as unloaded source material.
- Bundled the Anthropic image guard and a safe settings example so full-resolution image handling is reproducible without sharing private configuration; bounded source decoding and added success, failure, and oversize smoke coverage.
- Kept the released Agent Browser wrapper paired with its tested 0.33.0 CLI baseline instead of holding the kit release on an unreleased wrapper update; the CLI keeps the Node.js floor at 24.
- Removed the inactive Cursor model fallbacks from the public agent profiles.
- Added GitHub to the authenticated MCP catalog, documented optional MCP scripting as trusted local execution, prevented setup from persisting mutable npm package tags, and switched to the secured public MCP fork containing the UI capability-isolation fix.
- Made cross-provider custom compaction separately disclosed and consent-gated, with xAI and OpenAI Codex destinations recorded explicitly in the manifest.
- Switched `pi-edit-session-in-place` to its public Git source after removing the stale Node engine ceiling.
- Updated `deslop` to simplify ceremonial test tables while retaining malformed-input coverage at real trust boundaries.
- Documented Macuse as a linked, selective experimental extension for native macOS automation.
- Reframed the kit as a working composition-layer reference for a model-agnostic organization harness.

## 0.2.1 — 3 August 2026

- Made tagged releases explicit known-good setup snapshots instead of claiming continuous parity with the live installation.
- Reconciled replace-mode agent profiles, Luna fallbacks for `scout`, and Sol routing for `reviewer-security`.
- Pinned the documented install path to `v0.2.1`.

## Earlier history

Earlier prompt, routing, and package experiments remain available in Git history. The active public surface is documented by the latest tagged release.
