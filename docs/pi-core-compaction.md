# Reapply the tool-loop compaction fix

## Instructions for the Pi agent handling an update

When Mitch asks you to restore or verify this behavior after Pi is updated, treat the request as an implementation task, not a request for a plan. Read this entire runbook, inspect the active installation, make any necessary changes, run every relevant check, and report the verified end state.

1. Resolve the active executable with `command -v pi`, follow its real path, and record `pi --version`. Never assume npm, Bun, or a previous installation path.
2. Read the current request loop, compaction implementation, extension API, and changelog before editing. Inspect `models.json` and `settings.json` only through a local parser that emits an allowlist of model IDs, context-window numbers, and `compaction.enabled`, `reserveTokens`, and `keepRecentTokens`. Never use a model-visible whole-file read or emit API keys, headers, URLs, environment values, commands, private endpoints, or unrelated settings. Preserve unrelated configuration and provider definitions.
3. Resolve `pi-fitch-kit`'s installed root with `pi list`, then run `npm run regression:codex-context --prefix <package-root>` before editing. A failure may mean the update overwrote the patch, moved private modules, or implemented equivalent native behavior. Use the failure as evidence, not as instructions to copy old code blindly.
4. Determine whether the new Pi version already provides all behavior in this runbook. If it does, do not layer a duplicate patch on top. Adapt the regression test and this runbook to the new native implementation, then verify it. If any required behavior is missing, apply the smallest compatible local core change.
5. Preserve the provider-agnostic request-boundary scope, native settings, native usage accounting, assistant/tool-result pairing, fail-closed behavior, same-run continuation, and separate transcript-array ownership described below. Do not reintroduce a custom estimator or synthetic overflow response.
6. Rerun every command in **Verification after applying or updating Pi**. Fix failures rather than merely reporting that the update broke the patch.
7. Confirm which running Pi processes loaded the old core. Core changes require those processes to restart; `/reload` is insufficient. Do not kill the session you are using to report results. Tell Mitch exactly which restart remains necessary.
8. Report the active Pi version and path, files changed, whether the behavior is native or locally patched, validation output, and any residual limitation. Do not claim completion while a required check is failing.

The expected user request can be as short as: `Find pi-fitch-kit with pi list, read docs/pi-core-compaction.md, and restore and verify the tool-loop compaction behavior for the active Pi installation.`

## Intended behavior

The request-boundary policy applies to every selected provider and model whose context window can accommodate the configured reserve and retained context. Each model's active `contextWindow` metadata is authoritative, including overrides in `~/.pi/agent/models.json`; preserve those values rather than restoring a number from this runbook. Pi's normal global compaction settings in `~/.pi/agent/settings.json` are also authoritative.

At this 0.83.0 restoration, the six OpenAI GPT-5.6 routes are 270,000 and `xai/grok-4.5` is 280,000. With the current `reserveTokens: 16384`, Pi's existing `shouldCompact()` rule compacts those routes only above 253,616 and 263,616 tokens respectively. The regression test derives boundaries independently from active model metadata and settings. Do not hardcode context windows, reserve, retention, or derived thresholds in Pi's code.

Summary generation can be routed separately by this package's `extensions/codex-context.ts`, but cross-provider routing is off by default. The handler reads `<Pi agent dir>/pi-codex-context.json` at compaction time and must return control to Pi's active-model compaction unless `customCompactionEnabled` is the literal boolean `true`. With that explicit opt-in and no `compactionModels` override, it tries `xai/grok-4.5` at high effort, then `openai-codex/gpt-5.6-luna` at high effort, then returns control to Pi's active-model fallback. A valid non-empty override replaces that order; an invalid list fails closed to the active model. The handler must call Pi's native `compact()` with the existing `CompactionPreparation`. xAI uses Pi's built-in provider stream; Codex Luna uses the registered `openai-codex` stream when available. The handler must not replace cut-point selection, retention, cancellation, file tracking, persistence, or compaction ownership.

## Why a Pi core change is needed

Pi checks normal threshold compaction after an agent run ends and before a later user prompt. A single agent run can make several provider requests while executing tools. Large tool results can therefore take a continuation past the configured threshold before Pi reaches its existing end-of-run check.

The fix adds the same threshold check at Pi's existing `transformContext` request boundary. That hook runs after initial, tool-result, steering, and follow-up messages have been injected and immediately before every provider request. It must reuse Pi's own token accounting and compaction implementation. Do not add a character-count tokenizer, serialize the whole context, or synthesize a context-overflow response.

Pi 0.80.10 and stock 0.81.x, 0.82.x, and 0.83.0 also need a cut-point correction. If the trailing tool-result block itself reaches `keepRecentTokens`, the stock algorithm finds no valid cut point after those results, falls back to the oldest entry, and produces no compaction preparation. The corrected algorithm keeps the preceding assistant message with its tool results so compaction can proceed.

Manual compaction must not interrupt automatic request-boundary compaction or an active continuation. Pi 0.80.10 and stock 0.81.x, 0.82.x, and 0.83.0 disconnect from and abort the agent before checking whether compaction is already running or possible. Any `ctx.compact()` caller can therefore kill the continuation and then fail with `Already compacted`; the July 19 incident was automatically triggered by `pi-codex-goal@0.1.37`, not by a user-entered `/compact` command. Reject concurrent manual compaction before disconnecting, and preflight unavailable manual compaction before aborting the agent.

The interactive compaction UI must render one summary card. `buildContextEntries()` already includes the newly persisted compaction entry, so rebuilding the chat and then appending another summary renders the same compaction twice.

Pi 0.81+ natively persists compaction and branch-summary usage and resumes messages queued during compaction. Pi 0.81.1+ also retries native summarization using the configured retry policy and emits retry lifecycle events. Pi 0.82.0+ gives each summary call a fresh routing session ID and disables prompt-cache writes where supported. Pi 0.82.1+ also accepts compaction authentication resolved entirely through request headers. Preserve those upstream behaviors, the `compact(..., settingsManager.getRetrySettings(), _summarizationRetryCallbacks(...))` arguments, and `completeSummarization()` request options while restoring the local request-boundary and safety fixes.

## Where to make the change

First resolve the active Pi installation from `command -v pi`; do not assume the path or package manager. The files to inspect are the active package's:

- `dist/core/agent-session.js`
- `dist/core/compaction/compaction.js`
- `dist/modes/interactive/interactive-mode.js`

The implementation described below was applied to Pi 0.80.10 and restored through Pi 0.83.0. On later versions, read the current request loop and compaction code first, then preserve the behavior rather than blindly copying line numbers.

## Required modification

Add one private async `_compactBeforeProviderRequest()` helper to `AgentSession` that accepts the messages about to be sent and returns whether it successfully created a new compaction entry.

The helper must:

1. Read the selected model and current compaction settings. Return immediately when no model is selected, compaction is disabled, or `model.contextWindow <= settings.reserveTokens + settings.keepRecentTokens`. The last guard leaves small-window models usable when the global settings cannot create post-compaction headroom. Do not allowlist providers or model IDs.
2. Call Pi's existing `estimateContextTokens(messages)`.
3. Return without compacting when there is no valid prior assistant usage (`lastUsageIndex` is null). This is intentional: do not guess from a whole-context character estimate.
4. Read the assistant message selected by `lastUsageIndex`.
5. Reject stale usage before evaluating the threshold:
   - Every message preceding that assistant in the current context array must have a timestamp less than or equal to the assistant timestamp. A newer prefix message, such as a compaction or branch summary inserted before retained old messages, makes that old usage invalid.
   - If the session branch has a latest compaction entry, the assistant usage timestamp must be newer than that compaction entry.
6. Call Pi's existing `shouldCompact(estimate.tokens, model.contextWindow, settings)` with the settings read in step 1.
7. If it returns false, do nothing.
8. If it returns true, await `_runAutoCompaction("threshold", false)`.
9. Compare the latest compaction entry ID before and after the call.
10. If no new compaction entry was created, throw a clear error that blocks the provider request. Never proceed with a request known to be over the configured threshold.
11. Return true only when a new compaction entry was created.

Use the existing imports from `./compaction/index.js` and `./session-manager.js`. Pi 0.80.10 through 0.83.0 already import `estimateContextTokens`, `shouldCompact`, and `getLatestCompactionEntry`; avoid adding duplicate implementations.

Install the helper at one request boundary:

1. Add an `_installAgentRequestCompaction()` method next to the existing agent-hook installation methods.
2. Capture any existing `agent.transformContext` function before replacing it.
3. The replacement `transformContext` must await the helper with the request's current messages.
4. When compaction succeeds, replace the contents of the loop-owned messages array with the contents of `agent.state.messages`. Mutate the loop-owned array with `splice` or an equivalent copy operation. **Never assign or return `agent.state.messages` itself.** Agent state and the agent loop must retain separate top-level arrays because both append lifecycle messages independently.
5. After the compaction check, invoke the previously installed transform with the updated loop-owned array, or return that array when there was no previous transform.
6. Call `_installAgentRequestCompaction()` once from the `AgentSession` constructor alongside the existing tool and next-turn hook installers.

Do not add separate checks to `_runAgentPrompt()` or `_installAgentNextTurnRefresh()`. Those sites either run before queued messages are injected or do not run at the true provider-request boundary. The transform wrapper must be awaited; do not run compaction in the background.

## Required manual-compaction safety

In `AgentSession.compact()`:

1. If either manual or automatic compaction is already active, reject the new manual request with `Compaction already in progress` before disconnecting from or aborting the agent.
2. Read the current branch and prepare manual compaction before disconnecting from or aborting the agent.
3. If preparation is unavailable, emit the normal manual `compaction_start` and failed `compaction_end` events and throw `Already compacted` or `Nothing to compact (session too small)` as appropriate. Do not disconnect or abort the current agent run.
4. Once preflight succeeds, create and store a local manual compaction controller synchronously before disconnecting or awaiting agent abort. Use that local controller throughout the operation and clear the shared field in `finally` only when it still owns the field.
5. Retain Pi's remaining manual compaction behavior.

In the interactive `/compact` handler, show `Compaction already in progress` as a warning. Other manual failures are already displayed through compaction events.

## Required compaction ownership

Automatic compaction must claim ownership before its first asynchronous operation:

1. Return without starting when a manual or automatic compaction controller already exists.
2. After confirming a model is selected, create and store a local automatic compaction controller before awaiting authentication.
3. Emit `compaction_start` before authentication so `isCompacting`, queued input, cancellation, and the eventual `compaction_end` remain balanced on every path.
4. Use the local controller's signal throughout preparation, extension hooks, and summary generation. Early authentication or preparation failures must still emit a failed `compaction_end` through the existing catch path.
5. In `finally`, clear the shared field only when it still references that local controller.

These ownership rules close both races: `/compact` or extension-owned `ctx.compact()` cannot enter while automatic authentication is pending, and a second automatic or manual compaction cannot enter while manual compaction is waiting for the active agent to abort.

## `pi-codex-goal` compatibility

`pi-codex-goal@0.1.37` independently triggered `ctx.compact()` for active goals using a hardcoded 50,000-token reserve. For a 272,000-token model this fired above 222,000, not Pi's configured strict threshold above 255,616, and could race host compaction. [pi-codex-goal#46](https://github.com/fitchmultz/pi-codex-goal/issues/46) tracks the incident.

`pi-codex-goal@0.1.38` removed that proactive trigger and makes Pi the sole compaction owner. It retains `session_before_compact` and `session_compact` handling for goal accounting, persistence, recovery, and continuation. Require 0.1.38 or newer when validating this patch with active goals; older versions can still compact early even though the core ownership correction prevents the destructive race.

The intended integration is single-owner: patched Pi performs request-boundary compaction from active `settingsManager` values; the goal extension only observes compaction lifecycle events. Merely changing an extension-owned reserve to 16,384 would leave two callers at the same boundary and would not solve ownership.

## Required cut-point correction

In `findCutPoint()` in `dist/core/compaction/compaction.js`, preserve the existing preference for the closest valid cut point at or after the entry where retained tokens reach `keepRecentTokens`. If no such cut point exists because the context ends with one or more tool results, fall back to the closest preceding valid cut point. In a valid tool turn this is the assistant message containing those tool calls, so the assistant and tool results remain together.

Never cut at a tool result. The correction must work when one tool result reaches the target and when several parallel tool results reach it cumulatively.

## Required native file-detail carryover

Pi marks any `session_before_compact` result as hook-generated, including this extension's result from Pi's native `compact()`. In `extractFileOperations()` in `dist/core/compaction/compaction.js`, carry compatible `details.readFiles` and `details.modifiedFiles` arrays forward from the previous compaction even when `fromHook` is true. Keep the array shape checks. Otherwise the first routed compaction has correct details, but the next one silently drops every file recorded before it.

## Required interactive rendering correction

A successful manual or automatic compaction is persisted before `compaction_end`. The interactive handler must rebuild the chat from `sessionManager.buildContextEntries()` and must not append a second `createCompactionSummaryMessage()` afterward. Rebuilding already renders the persisted summary in the correct transcript position.

## False-positive safeguards

These constraints are required:

- Use `model.contextWindow`; its value comes from active model metadata, including any `models.json` override.
- Use the current `settingsManager` compaction settings; do not duplicate the reserve in code.
- Use Pi's last successful assistant usage plus Pi's estimate for trailing messages.
- Ignore aborted, error, and zero-usage assistant responses through Pi's existing estimator.
- Ignore stale usage retained across compaction or summary boundaries.
- At exactly `model.contextWindow - settings.reserveTokens` tokens, do not compact. Pi's rule is strictly greater than each model's active threshold.
- Do not inspect `thinkingSignature`, encrypted reasoning metadata, or a whole serialized request. Those fields previously caused a real session at about 149,853 tokens to be misestimated as 260,952 tokens.
- Apply the pre-request check uniformly to every selected model with a viable compaction budget. Do not add a provider or model allowlist.
- Skip the check when `contextWindow <= reserveTokens + keepRecentTokens`; attempting fail-closed compaction there can block valid small-context requests without producing usable headroom.
- Once a valid estimate crosses the threshold, do not send the provider request unless a new compaction entry was created.

## Extension responsibilities

This package's `extensions/codex-context.ts` owns summary-model routing through `session_before_compact`, the `/codex-fast` command and footer, and a `before_provider_request` handler that applies the globally persisted priority-service toggle without replacing native provider streams. Explicitly routed OpenAI compaction uses the same payload transform around Pi's native simple stream. Fast mode remains limited to `openai` and `openai-codex`; the installed-core request-boundary safeguard applies to every provider and model. The extension must reuse Pi's native `compact()` and provider dispatch. It must not own compaction triggers, thresholds, token estimation, cut points, persistence, or synthetic overflow handling.

`<Pi agent dir>/pi-codex-context.json` owns the explicit routing consent and ordered custom summary-model candidates. Missing, malformed, false, non-boolean, or empty configuration must not query or send retained context to alternate models. Only literal `customCompactionEnabled: true` activates routing. An omitted model list uses the documented xAI-then-Codex default; a valid non-empty list overrides it; an invalid or empty list fails closed to Pi's native active-model compaction. Unauthenticated, unavailable, or failed enabled candidates fall through in order; if all enabled candidates fail, returning no extension result preserves the active-model fallback.

There must be no separate `codex-fast` or standalone `pi-codex-context` package. This kit must be the only loaded owner of the command, footer, compaction handler, and OpenAI priority payload handler.

## Verification after applying or updating Pi

Run all of the following against the active installation:

1. `pi --version` and confirm the installation path resolved from `command -v pi`.
2. Run `pi --list-models 'openai/gpt-5.6'` and `pi --list-models 'openai-codex/gpt-5.6'`, then use the allowlisted local structural parser from step 2 to confirm Sol, Terra, and Luna match the active context-window overrides in `models.json` under both providers.
3. Using the allowlisted local structural parser from step 2, confirm global settings still have compaction enabled with the intended reserve and keep-recent values. Use the same local allowlist for only the structural routing keys in the optional `<Pi agent dir>/pi-codex-context.json`: absent or non-literal consent must keep custom routing off; if `customCompactionEnabled` is `true`, confirm the user approved the exact listed destinations. An omitted model list means xAI Grok 4.5 high before Codex Luna high; a valid override replaces that order.
4. Run `node --check` on all three modified Pi JavaScript files.
5. If `pi-codex-goal` is installed, require version 0.1.38 or newer and confirm its runtime has no proactive `ctx.compact()` trigger.
6. Resolve `pi-fitch-kit`'s installed root with `pi list`, then run:

   `npm run regression:codex-context --prefix <package-root>`

7. Confirm Pi loads one bundled `codex-context` extension, one `session_before_compact` handler, one `before_provider_request` handler, zero replacement provider registrations, and one `/codex-fast` command.

The regression check must prove at least these cases:

- A 148,861-token valid usage plus a small trailing tool result does not compact, even if the assistant message contains more than one million characters of provider-only signature metadata.
- Each tested viable route uses its own active context window. Usage at that route's derived threshold does not compact, while usage strictly above it does. Coverage includes all six OpenAI GPT-5.6 routes, a different OpenAI model ID, and a non-OpenAI provider.
- Representative 8K and 32K models, plus a model exactly at `reserveTokens + keepRecentTokens`, skip the pre-request check instead of entering a fail-closed compaction loop.
- Stale pre-compaction usage does not trigger another compaction.
- Mid-run compaction keeps the agent-state and loop transcript arrays separate, so finalized assistant and tool-result messages are not duplicated.
- A queued steering or follow-up message that crosses the threshold is included before the pre-request check runs.
- A single trailing tool result at `keepRecentTokens`, and several trailing tool results that cumulatively reach it, produce a valid compaction preparation that keeps the assistant/tool-result group together.
- If threshold compaction creates no new compaction entry, the request boundary throws and the provider request remains blocked.
- A concurrent or unavailable manual compaction does not disconnect from or abort the active agent run.
- Deferred-auth automatic compaction owns the operation before awaiting authentication, rejects concurrent manual compaction without disconnecting or aborting, and persists exactly once.
- Manual compaction owns the operation before awaiting agent abort, so a second compaction cannot enter its destructive path.
- Successful compaction rebuilds the interactive transcript without appending a duplicate summary card.
- Custom summary routing makes no alternate-model lookup or request for missing, malformed, false, truthy non-boolean, empty, or invalid configuration. Literal opt-in uses native xAI Grok 4.5 first at high effort by default, falls back to Luna high on provider or authentication failure, honors a valid override, preserves native summary usage, fresh routing session IDs, disabled one-off prompt-cache writes, header-only authentication, and OpenAI priority mode, honors cancellation, and returns control to Pi's active-model fallback when every configured candidate fails.
- Native file-operation details remain cumulative across consecutive extension-routed compactions, including a prior entry marked `fromHook: true`.

After core changes, start a new Pi process or restart each existing affected process; `/reload` only reloads extensions and is insufficient for core changes.
