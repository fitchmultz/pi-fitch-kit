# Changelog

## 0.6.0 — 9 August 2026

- The core patch now classifies the Cloudflare-edge "exceeded request buffer limit while retrying upstream" response as transient, so Pi's native bounded auto-retry (settings budget, exponential backoff, abortable, honest exhaustion) recovers the turn instead of stalling the session until a manual bump message. Root-caused from live captures: the failed attempt streams no output and Pi rebuilds the request from session state per attempt, so retrying cannot accumulate or loop; an identical follow-up request succeeded immediately.
- Archived the v0.5.0 patch identity for checksum-pinned legacy migration, taught the applicator that legacy patches leave the retry classifier at stock bytes, and added a red/green regression that drives the real patched `pi --mode rpc` binary against a local model server: the archived patch must still stall (one request, no retry), the current patch must recover through one bounded retry and stop honestly after the budget when the error persists.

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
