# Reapply the Pi 0.84.1 compaction, transient-retry, and Responses diagnostics fixes

## Instructions for the Pi agent handling an update

When Mitch asks you to restore or verify this behavior after Pi is updated, treat the request as an implementation task, not a request for a plan. Read this entire runbook, inspect the active installation, make any necessary changes, run every relevant check, and report the verified end state.

1. Resolve the active executable with `command -v pi`, follow its real path, and record `pi --version`. Never assume npm, Bun, or a previous installation path.
2. Read the current request loop, compaction implementation, extension API, and changelog before editing. Inspect `models.json` and `settings.json` only through a local parser that emits an allowlist of model IDs, context-window numbers, and `compaction.enabled`, `reserveTokens`, and `keepRecentTokens`. Never use a model-visible whole-file read or emit API keys, headers, URLs, environment values, commands, private endpoints, or unrelated settings. Preserve unrelated configuration and provider definitions.
3. Resolve `pi-fitch-kit`'s installed root with `pi list`, then run `npm run regression:codex-context --prefix <package-root>` before editing. A failure may mean the update overwrote the patch, moved private modules, or implemented equivalent native behavior. Use the failure as evidence, not as instructions to copy old code blindly.
4. Determine whether the new Pi version already provides all behavior in this runbook. If it does, do not layer a duplicate patch on top. Adapt the regression test and this runbook to the new native implementation, then verify it. For exact Pi 0.84.1 with missing behavior, use only the guarded reapply command below. A later Pi version requires a newly reviewed patch artifact and hashes; never edit installed core ad hoc.
5. Preserve the provider-agnostic request-boundary scope, native settings, native usage accounting, assistant/tool-result pairing, fail-closed behavior, same-run continuation, and separate transcript-array ownership described below. Do not reintroduce a custom estimator or synthetic overflow response.
6. Rerun every command in **Verification after applying or updating Pi**. Fix failures rather than merely reporting that the update broke the patch.
7. Confirm which running Pi processes loaded the old core. Core changes require those processes to restart; `/reload` is insufficient. Do not kill the session you are using to report results. Tell Mitch exactly which restart remains necessary.
8. Report the active Pi version and path, files changed, whether the behavior is native or locally patched, validation output, and any residual limitation. Do not claim completion while a required check is failing.

The expected user request can be as short as: `Find pi-fitch-kit with pi list, read docs/pi-core-compaction.md, and restore and verify the tool-loop compaction behavior for the active Pi installation.`

## Intended behavior

The request-boundary policy applies to every selected provider and model whose context window can accommodate the configured reserve and retained context. Each model's active `contextWindow` metadata is authoritative, including overrides in `~/.pi/agent/models.json`; preserve those values rather than restoring a number from this runbook. Pi's normal global compaction settings in `~/.pi/agent/settings.json` are also authoritative.

For Pi 0.84.1, derive every boundary independently from active model metadata and settings. Direct OpenAI GPT-5.6 routes default to a 272,000-token context window, but local model overrides remain authoritative. Do not hardcode context windows, reserve, retention, or derived thresholds in Pi's code.

Summary generation can be routed separately by this package's `extensions/codex-context.ts`, but cross-provider routing is off by default. The handler reads `<Pi agent dir>/pi-codex-context.json` at compaction time and must return control to Pi's active-model compaction unless `customCompactionEnabled` is the literal boolean `true`. With that explicit opt-in and no `compactionModels` override, it tries `xai/grok-4.5` at high effort, then `openai-codex/gpt-5.6-luna` at high effort, then returns control to Pi's active-model compaction if neither succeeds. Candidate authentication is raced against the compaction signal so cancellation does not wait for an auth refresh to finish. A valid non-empty override replaces that order; an invalid list fails closed to the active model. The handler must call Pi's native `compact()` with the existing `CompactionPreparation` and dispatch each candidate through Pi 0.84's composed provider stream. OpenAI candidates wrap that stream only to apply the fast-mode payload option. The handler must not replace cut-point selection, retention, cancellation, file tracking, persistence, or compaction ownership.

## Why a Pi core change is needed

Pi checks normal threshold compaction after an agent run ends and before a later user prompt. A single agent run can make several provider requests while executing tools. Large tool results can therefore take a continuation past the configured threshold before Pi reaches its existing end-of-run check.

The fix adds the same threshold check at two existing Pi hooks that together cover every in-run provider request. The primary site is Pi's `prepareNextTurnWithContext` turn boundary, which runs after tool results are appended and before the loop drains queued steering and follow-up messages. Compacting there keeps two properties the request-time site cannot provide: messages already enqueued on the agent when the boundary drain runs ride the immediate next provider request instead of arriving one request late, and the hook receives the run's `AbortSignal`, so aborting the run cancels an in-flight compaction promptly. Interactive input typed during a compaction is enqueued by a fire-and-forget flush, so its inclusion in the very next request is best effort; when the flush loses that race the message arrives one request later, which matches the pre-fix behavior. The secondary site is Pi's `transformContext` request boundary, which runs after steering and follow-up messages have been injected and immediately before every provider request. It remains the fail-closed backstop for contexts pushed over the threshold by injected messages and for the first request of continuation runs. Both sites must reuse Pi's own token accounting and compaction implementation. Do not add a character-count tokenizer, serialize the whole context, or synthesize a context-overflow response.

Both sites thread their hook signal through summarization authentication and automatic compaction. Without that, `session.abort()` can hang while authentication or an in-flight boundary summary finishes and then append a compaction entry the user already abandoned. Exits whose combined signal is aborted must surface as one clean `aborted` compaction event; an `AbortError` thrown while the combined signal is still live is a real failure and must keep its error message. A blocked provider request must not retrigger post-run auto-compaction; otherwise pressing Escape during a boundary compaction silently restarts the work it just cancelled.

Stock Pi 0.84.1 still needs a cut-point correction. If the trailing tool-result block itself reaches `keepRecentTokens`, the stock algorithm finds no valid cut point after those results, falls back to the oldest entry, and produces no compaction preparation. The corrected algorithm keeps the preceding assistant message with its tool results so compaction can proceed.

Manual compaction must not interrupt automatic request-boundary compaction or an active continuation. Although Pi's changelog reports a manual-versus-threshold compaction race fix, the released implementation still aborts the agent before checking whether compaction is already running or possible. Any `ctx.compact()` caller can therefore kill the continuation and then fail with `Already compacted`; the July 19 incident was automatically triggered by `pi-codex-goal@0.1.37`, not by a user-entered `/compact` command. Reject concurrent manual compaction and preflight unavailable manual compaction before aborting the agent.

The interactive compaction UI must render one summary card. `buildContextEntries()` already includes the newly persisted compaction entry, so rebuilding the chat and then appending another summary renders the same compaction twice.

Pi 0.84.1 natively persists compaction and branch-summary usage, resumes messages queued during compaction, retries native summarization with lifecycle events, uses fresh routing session IDs, disables one-off prompt-cache writes where supported, and accepts header-only compaction authentication. Preserve those native behaviors, the `compact(..., settingsManager.getRetrySettings(), _summarizationRetryCallbacks(...))` arguments, and `completeSummarization()` request options while restoring the local request-boundary and safety fixes.

## Where to make the change

First resolve the active Pi installation from `command -v pi`; do not assume the path or package manager. The files to inspect are the active package's:

- `dist/core/agent-session.js`
- `dist/core/compaction/compaction.js`
- `dist/modes/interactive/interactive-mode.js`
- `node_modules/@earendil-works/pi-ai/dist/utils/retry.js`
- `node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js`
- `node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js`

The implementation described below targets the released Pi 0.84.1 code and emitted types. On later versions, read the current request loop and compaction code first, then preserve the behavior rather than blindly copying line numbers.

The reviewed source of truth is `patches/pi-0.84.1-compaction.patch`. Do not edit installed core files by hand. From the kit root, inspect and apply it to the active Pi only through the guarded commands:

```bash
npm run status:pi-core-compaction
npm run reapply:pi-core-compaction
```

The default command ignores npm-injected local `node_modules/.bin` entries when resolving the active `pi`, so the kit's validation dependency cannot be mistaken for the system installation. A wrapper or shim that does not resolve directly to Pi's `dist/cli.js` fails with an explicit `--pi-root` diagnostic. For an isolated package root, append `-- --pi-root /path/to/@earendil-works/pi-coding-agent`.

The applicator supports only the reviewed Pi 0.84.0 and 0.84.1 package identities and exact stock hashes. It uses `/usr/bin/patch`, never an executable injected through `PATH`; serializes every action with `/usr/bin/shlock` and reclaims dead-owner locks after its brief freshness guard; refuses symlinked mutable, backup, or lock paths; preflights patch anchors; builds and hash-verifies the stock backup in a staging directory before atomically renaming it; validates any existing backup on every action against the file set its own manifest records, with preimage hashes always taken from the compiled-in registry; canonicalizes manifest roots; writes a recovery journal before mutation; reports `recovery-needed` without changing files on read-only `status`; restores exact stock bytes on the next separately authorized `apply` or `restore` after an interrupted mutation; suppresses reject sidecars; verifies patched hashes and JavaScript syntax; and rolls back and verifies the complete pre-operation state after an in-process failure. Patch checksums are required only for artifacts the requested action will execute. The command fails closed on all other divergence and no-ops when already applied. Restore the reviewed stock preimage with `npm run restore:pi-core-compaction` and the same optional `--pi-root` argument.

An install patched by kit 0.4.1 through 0.6.0 is recognized as a sha-pinned `legacy-patched` state. `apply` migrates it in one guarded run: it reverses the matching checksum-pinned archive under `patches/archive/`, verifies the exact stock intermediate, ensures the stock backup exists, then applies the current patch; any failure rolls back to the same verified legacy pre-state. Backups written by those released kits predate later-tracked core files; before mutating, `apply` extends such a backup with the missing stock preimages taken from the install (legacy patches never touched them, and anything else fails closed) and atomically rewrites the manifest last, which also refreshes stale recorded patch metadata. `restore` reverses the matching archived patch directly to stock only after confirming the backup records every file that installed era can reverse; a layout valid for a different release is insufficient. Any other divergence still fails closed.

Every Pi update replaces the installed package with stock core. After any update, rerun the exact-version status/regression checks and this guarded reapply command; never assume the prior patch survived. A later Pi version requires a new reviewed patch and hash set rather than bypassing the guard.

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
8. Before starting automatic compaction, call Pi's existing `prepareCompaction()` on the current branch. If it returns undefined, leave the check advisory and proceed without emitting compaction events. Usage can remain above the threshold while the retained transcript has nothing Pi can summarize; blocking every later request would permanently wedge that valid session.
9. Otherwise await `_runAutoCompaction("threshold", false)`.
10. Compare the latest compaction entry ID before and after the call.
11. If no new compaction entry was created, throw the exact static error `Pre-request compaction was required but did not complete. Provider request blocked.`. Keep it free of interpolated token counts or other digits: Pi's retry classifier treats status-code substrings such as `500` and `429` as transient and could restart a compaction the user just cancelled.
12. Return true only when a new compaction entry was created.

Use the existing imports from `./compaction/index.js` and `./session-manager.js`. Pi 0.84.1 already imports `estimateContextTokens`, `shouldCompact`, and `getLatestCompactionEntry`; avoid adding duplicate implementations.

The helper accepts the hook's `AbortSignal` as a second parameter. Return before all other work when it is already aborted, and otherwise pass it to `_runAutoCompaction("threshold", false, signal)` so run cancellation reaches the summarization request.

Install the helper at both boundaries inside one `_installAgentRequestCompaction()` method, called once from the `AgentSession` constructor after the existing tool and next-turn hook installers:

1. Capture the previously installed `agent.prepareNextTurnWithContext` and replace it with a wrapper that first awaits the captured hook with the turn and signal, preserving every field of the returned snapshot. Chaining after the existing next-turn refresh hook keeps its context, model, and thinking refresh authoritative.
2. The wrapper must skip the check when the hook signal is already aborted, and when the turn produced no tool results and no messages are queued. Stock post-run `_checkCompaction` owns end-of-run and post-abort compaction semantics: its aborted-skip, `willRetry` coordination, and overflow-recovery latch must not be duplicated inside the run. The tool-result predicate is deliberately approximate: the loop keeps its continuation decision private, so a turn whose tool calls all terminated the batch still compacts at the boundary, one step earlier than the post-run check would have. That early compaction is the same work on the same state and is an accepted tradeoff below.
3. When the run continues, await the helper with the messages of the previous snapshot's context when present, otherwise the turn's context, and the hook signal. On success, return the previous snapshot spread with a context whose `messages` is a fresh copy of `agent.state.messages`; leave every other snapshot and context field unchanged. On no-op, return the previous snapshot unchanged.
4. Capture any existing `agent.transformContext` function before replacing it.
5. The replacement `transformContext` must await the helper with the request's current messages and the hook signal.
6. When compaction succeeds, replace the contents of the loop-owned messages array with the contents of `agent.state.messages`. Mutate the loop-owned array with `splice` or an equivalent copy operation. **Never assign or return `agent.state.messages` itself.** Agent state and the agent loop must retain separate top-level arrays because both append lifecycle messages independently.
7. After the compaction check, invoke the previously installed transform with the updated loop-owned array, or return that array when there was no previous transform.

After a successful turn-boundary compaction, the transform-gate check is naturally dormant for the same request: the rebuilt context starts with a summary message newer than the retained assistant usage, so the stale-usage guards skip it. Do not add a third check site, and do not run compaction in the background; both wrappers must be awaited.

In `_checkCompaction`, return false for an assistant message whose `stopReason` is `error` and whose error message contains `Provider request blocked.`. The blocked request already surfaced its pre-request compaction failure or cancellation; re-running compaction from the post-run path would restart work the user may have just cancelled with Escape.

## Required manual-compaction safety

In `AgentSession.compact()`:

1. If either manual or automatic compaction is already active, reject the new manual request with `Compaction already in progress` before aborting the agent.
2. Read the current branch and prepare manual compaction before aborting the agent.
3. If preparation is unavailable, emit the normal manual `compaction_start` and failed `compaction_end` events and throw `Already compacted` or `Nothing to compact (session too small)` as appropriate. Do not abort the current agent run.
4. Once preflight succeeds, create and store a local manual compaction controller synchronously before awaiting agent abort. Use that local controller throughout the operation and clear the shared field in `finally` only when it still owns the field.
5. After agent abort settles, read the branch and prepare compaction again. Agent abort can append aborted assistant or tool entries; the preparation and `branchEntries` handed to `session_before_compact` must describe that settled branch, not the pre-abort snapshot.
6. Add the host retry policy and `_summarizationRetryCallbacks(...)` to the `session_before_compact` event so extension-owned native compaction can preserve the same retry behavior and lifecycle reporting as active-model compaction.
7. Retain Pi's remaining manual compaction behavior.

In the interactive `/compact` handler, show `Compaction already in progress` as a warning. Other manual failures are already displayed through compaction events.

## Required compaction ownership

Automatic compaction must claim ownership before its first asynchronous operation and honor both cancellation sources:

1. Return without starting when a manual or automatic compaction controller already exists.
2. After confirming a model is selected, prepare compaction from one current branch snapshot. If preparation is unavailable, return false without a start or failure event. Otherwise create and store a local automatic compaction controller before awaiting authentication, and reuse that branch snapshot for `branchEntries`.
3. `_runAutoCompaction(reason, willRetry, requestSignal)` accepts an optional request signal. When present, combine it with the local controller through `AbortSignal.any` and use the combined signal everywhere the local controller's signal was used: the pre-auth early-exit check, summarization authentication, the `session_before_compact` extension event, native `compact()`, and the post-generation aborted check. `_getSummarizationRequestAuth` must pass that signal into model-runtime authentication and rethrow cancellation instead of treating it as optional-auth fallback. `session.abort()` and `agent.abort()` then cancel an in-flight boundary compaction promptly, while `abortCompaction()` keeps working through the local controller.
4. Emit `compaction_start` before authentication so `isCompacting`, queued input, cancellation, and the eventual `compaction_end` remain balanced on every path. Immediately after the start event, exit with an `aborted: true` end event when the combined signal is already aborted, before requesting authentication.
5. Add the host retry policy and `_summarizationRetryCallbacks(...)` to the automatic `session_before_compact` event.
6. In the catch path, classify an exit as a clean cancellation only when the combined signal is aborted: emit `compaction_end` with `aborted: true` and no failure `errorMessage`, and return false. An `AbortError` thrown while the combined signal is still live, and any other authentication failure, must still emit a failed `compaction_end` with its error message through the existing catch path.
7. After rebuilding agent state from the compaction entry, do not resurrect a trailing `error` or `length` assistant that retry preparation or the request gate already removed. Provider continuation requires the payload not to end in that assistant response.
8. In `finally`, clear the shared field only when it still references that local controller.

These ownership rules close both races: `/compact` or extension-owned `ctx.compact()` cannot enter while automatic authentication is pending, and a second automatic or manual compaction cannot enter while manual compaction is waiting for the active agent to abort. Branch summarization passes its controller into the same auth helper; if that signal aborts during authentication, `navigateTree()` returns its existing `{ cancelled: true, aborted: true }` result so Escape remains a clean cancellation instead of an error.

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

## Required transient-edge retry classification

Cloudflare-fronted provider backends (the chatgpt.com backend behind `openai-codex`, Cloudflare AI Gateway deployments in front of other providers) occasionally answer a provider request with the HTTP error body `exceeded request buffer limit while retrying upstream`: the edge tried to retry its own upstream hop, could not replay the buffered request body within its cap, and aborted. Provider adapters surface that body verbatim as the assistant error message.

Pi's session-level auto-retry (`_prepareRetry`, bounded by `settings.retry`, exponential backoff, abortable, with `auto_retry_start`/`auto_retry_end` events) classifies errors through the shared allowlist `RETRYABLE_PROVIDER_ERROR_PATTERN` in `node_modules/@earendil-works/pi-ai/dist/utils/retry.js`. Unknown text fails fast by design, so this edge error ended the turn and stalled the session even though the state was fully resumable — a live capture shows the failed attempt with empty content and zero usage, followed by a manual user bump re-sending the identical context successfully.

The patch adds `"request buffer limit"` to the retryable pattern list. Retrying is safe for this error class because Pi rebuilds the provider request from session state on every attempt (nothing accumulates client-side), the failed attempt produced no output to lose, and the edge failure depends on its upstream hiccuping on that specific attempt. Bounded budget and exhaustion behavior are Pi's native machinery; the patch must not add a custom retry loop, change the budget, or auto-continue past exhausted retries. If a future Pi version classifies this error natively, drop the hunk rather than layering a duplicate pattern.

## Required OpenAI Responses resilience

This kit adopts the TARS-original `pi-openai-resilience.patch` in v0.7.0 so local Pi and TARS share one reviewed patch stream instead of stacking independent retry.js patches. The adoption has two components:

1. **Exact generic transient classification.** OpenAI Responses can surface the bare assistant error `Sorry, something went wrong` (with an optional final period). The patch adds the deliberately narrow `^Sorry, something went wrong\\.?$` pattern to the shared retry allowlist. Extra text does not match. Retry policy remains Pi's native bounded, abortable backoff; the patch adds no loop or budget. The regression keeps archived v0.6.0 permanently red for this exact shape and current green, while preserving unknown-error fail-fast behavior.
2. **Additive Responses diagnostics.** `openai-responses.js` records HTTP status and `x-request-id`, including SDK error fields when setup or streaming throws. `openai-responses-shared.js` records terminal response status, response ID, and provider error code for `error` / `response.failed` events. These fields live in `providerMetadata` and do not change stop-reason mapping or response content. `openai-codex-responses.js` uses the shared processor for both SSE and WebSocket paths, so terminal status/code/ID diagnostics apply to Mitch's Codex Responses models; the adapter-specific HTTP status and request ID capture is only in vanilla `openai-responses.js`, so Codex HTTP-level diagnostics remain partial.

The real-binary regression keeps causality honest: a `response.failed` event carrying `server_error` was already retryable through Pi's older `server.?error` pattern. That scenario proves the real Responses parser, propagated metadata, bounded recovery, and honest exhaustion, but it is not evidence that the new exact generic pattern enabled that particular retry. Stream-level v0.6.0/current assertions provide the red/green proof for diagnostics.

**Upstream Pi asks:** add the exact generic transient pattern to pi-ai's shared retry classifier and retain the additive Responses diagnostic fields in both adapters. The existing shared-parser expression ``new Error(`Error Code ${event.code}: ${event.message}` || "Unknown error")`` has a dead fallback because a template string is always truthy; carry that as an upstream cleanup only rather than expanding this byte-for-byte TARS adoption.

## Accepted provider-recovery tradeoffs

The following verified deltas are intentional. Each is bounded by stock Pi recovery, and closing it locally would require re-forking machinery this kit deliberately retired: a custom token estimator, a `_prepareProviderRequest` agent-core hook, post-compaction fit fingerprints, or double-running extension context transforms. Do not "fix" these without new evidence that stock recovery fails.

- **First request with no prior usage.** A context that has never produced assistant usage skips the boundary check (step 3 of the helper) and can reach the provider oversized. `prompt()` runs Pi's stock pre-prompt compaction check, and stock overflow recovery (`_checkCompaction` with its `_overflowRecoveryAttempted` latch) removes the failed message, compacts, and retries once for the rest.
- **Raw pre-transform estimate.** The helper estimates the loop-owned messages before extension `context` transforms and `convertToLlm` filtering, so it counts `excludeFromContext` messages the provider never sees and misses extension deltas. The estimate anchors on the last provider-reported usage, which is post-transform ground truth; only the trailing slice is raw. Excluded raw messages make the estimate high, compacting slightly early; extension transform growth makes it low, compacting late and falling to stock overflow recovery. Estimating post-transform would require running extension transforms twice per request, which is unsafe for non-idempotent transforms.
- **System prompt and tool-schema growth.** Mid-turn additions to the system prompt or tool schemas are not in the trailing estimate. They are included in the next provider-reported usage, and the reserve absorbs the transient delta; genuine overflow lands in stock overflow recovery.
- **No post-compaction fit recheck.** After a successful boundary compaction the request proceeds without re-verifying the rebuilt context fits. The new-entry requirement plus the stale-usage dormancy prevent compaction loops, and a context that still exceeds the window ends in the same stock overflow recovery and terminal error as stock Pi.
- **Mid-turn model switch.** The helper reads the currently selected model, while the in-flight request may still use the model captured at the last turn boundary. Stock `setModel` has no active-run guard; the divergence self-heals at the next turn boundary, and overflow recovery backstops the one affected request.
- **Steering injected past the transform gate.** A steering or follow-up message that itself pushes the context over the threshold compacts at the transform gate, after the drain, so a further message typed during that compaction still waits one request. Only the dominant tool-loop path gets the immediate-next-request guarantee.
- **Terminating tool batches compact one step early.** When every tool call in a turn terminates the batch, the loop stops without another provider request, but its continuation decision is private to the loop and the tool-result messages it hands the boundary hook do not carry the terminate flag. The boundary check therefore compacts in-run where stock would have compacted moments later in the post-run check. It is the same compaction on the same state; the stale-usage dormancy keeps the post-run check from repeating it.

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
- Once a valid estimate crosses the threshold and `prepareCompaction()` finds summarizable messages, do not send the provider request unless a new compaction entry was created. Keep the documented unsummarizable-transcript case advisory so it cannot wedge the session.

## Extension responsibilities

This package's `extensions/codex-context.ts` owns summary-model routing through `session_before_compact`, the `/codex-fast` command and footer, and a `before_provider_request` handler that applies the globally persisted priority-service toggle without replacing native provider streams. Explicitly routed OpenAI compaction uses the same payload transform around Pi's native simple stream. Fast mode remains limited to `openai` and `openai-codex`; the installed-core request-boundary safeguard applies to every provider and model. The extension must reuse Pi's native `compact()` and provider dispatch. It must not own compaction triggers, thresholds, token estimation, cut points, persistence, or synthetic overflow handling.

Pi 0.84.1 request authentication can resolve a provider-specific base URL and `ProviderHeaders` values containing `null` deletion markers. Alternate-model compaction must apply the resolved base URL to its request model and pass the header object through unchanged; never filter or stringify deletion markers before forwarding.

`<Pi agent dir>/pi-codex-context.json` owns the explicit routing consent and ordered custom summary-model candidates. Missing, malformed, false, non-boolean, or empty configuration must not query or send retained context to alternate models. Only literal `customCompactionEnabled: true` activates routing. An omitted model list uses the documented xAI-then-Codex default; a valid non-empty list overrides it; an invalid or empty list fails closed to Pi's native active-model compaction. Unauthenticated, unavailable, or failed enabled candidates fall through in order; if all enabled candidates fail, returning no extension result preserves the active-model fallback. When the patched host includes `retry` and `retryCallbacks` on `session_before_compact`, forward both to native `compact()` so a transient failure retries the same candidate before failover and native retry lifecycle events remain intact.

There must be no separate `codex-fast` or standalone `pi-codex-context` package. This kit must be the only loaded owner of the command, footer, compaction handler, and OpenAI priority payload handler.

## Verification after applying or updating Pi

Run all of the following against the active Pi 0.84.1 installation:

1. `pi --version` and confirm the installation path resolved from `command -v pi`.
2. Run `pi --list-models 'openai/gpt-5.6'` and `pi --list-models 'openai-codex/gpt-5.6'`, then use the allowlisted local structural parser from step 2 to confirm Sol, Terra, and Luna match every active context-window override in `models.json`.
3. Using the allowlisted local structural parser from step 2, confirm global settings still have compaction enabled with the intended reserve and keep-recent values. Use the same local allowlist for only the structural routing keys in the optional `<Pi agent dir>/pi-codex-context.json`: absent or non-literal consent must keep custom routing off; if `customCompactionEnabled` is `true`, confirm the user approved the exact listed destinations. An omitted model list means xAI Grok 4.5 high before Codex Luna high; a valid override replaces that order.
4. Run `node --check` on all six modified Pi JavaScript files, including `node_modules/@earendil-works/pi-ai/dist/utils/retry.js`, `openai-responses.js`, and `openai-responses-shared.js`.
5. If `pi-codex-goal` is installed, require version 0.1.38 or newer and confirm its runtime has no proactive `ctx.compact()` trigger.
6. Resolve `pi-fitch-kit`'s installed root with `pi list`, then run:

   `PI_REGRESSION_PATH=/path/to/pi-0.84.1/node_modules/.bin:$PATH npm run regression:codex-context --prefix <package-root>`

   Omit `PI_REGRESSION_PATH` only when the normal active `pi` is the isolated 0.84.1 installation.

   Then run `npm run regression:pi-core-retry --prefix <package-root>` to prove the transient-edge stall class stays fixed: the archived legacy patch must stall, the current patch must recover through one bounded retry and surface exhaustion honestly.

7. Confirm Pi loads one bundled `codex-context` extension, one `session_before_compact` handler, one `before_provider_request` handler, zero replacement provider registrations, and one `/codex-fast` command.

The regression check must first assert that it is running against Pi 0.84.1, then prove at least these cases:

- A 148,861-token valid usage plus a small trailing tool result does not compact, even if the assistant message contains more than one million characters of provider-only signature metadata.
- Each tested viable route uses its own active context window. Usage at that route's derived threshold does not compact, while usage strictly above it does. Coverage includes every configured OpenAI GPT-5.6 override, a different OpenAI model ID, and a non-OpenAI provider.
- Representative 8K and 32K models, plus a model exactly at `reserveTokens + keepRecentTokens`, skip the pre-request check instead of entering a fail-closed compaction loop.
- Stale pre-compaction usage does not trigger another compaction.
- Mid-run compaction keeps the agent-state and loop transcript arrays separate, so finalized assistant and tool-result messages are not duplicated.
- A queued steering or follow-up message that crosses the threshold is included before the pre-request check runs.
- A steering message queued while a turn-boundary compaction is running is present in the immediate next provider request together with the compacted context, without an extra round-trip.
- A run whose final turn produced no tool results and has no queued messages does not compact in-run; end-of-run compaction stays owned by the stock post-run check.
- A terminating over-threshold tool batch compacts once at the boundary and the run still completes cleanly on its tool result with no further provider request.
- The boundary wrapper chains a previously installed next-turn hook with the loop's exact turn and signal, preserves every snapshot and context field it returns, replaces only the messages with a fresh copy of agent state, and passes the prior snapshot through unchanged on a no-op boundary.
- The run's abort signal reaches an in-flight boundary compaction end to end: aborting the run settles it promptly as `aborted`, appends no compaction entry, issues no further provider request, and emits one `compaction_end` with `aborted: true` and no failure message.
- An `AbortError` thrown while the combined signal is still live surfaces as a failed `compaction_end` that keeps its error message.
- The reapply script recognizes the sha-pinned legacy-patched state on an isolated fixture root, migrates it to the current patch in one guarded apply, restores both patched and legacy-patched fixtures to reviewed stock, and refuses a corrupted install with the divergence report.
- Applicator fixtures prove trusted patch resolution, active-lock refusal and stale-lock reclaim, mutable and backup symlink refusal, canonical manifest aliases, atomic backup validation, missing/corrupt backup detection, journal recovery from a mixed install, action-scoped patch checksums, and the wrapper `--pi-root` diagnostic.
- A request-boundary signal already aborted before the check starts skips the gate entirely; a signal aborted after automatic ownership begins exits with one clean aborted `compaction_end`, both before authentication and while authentication is pending.
- Cancelling branch summarization while authentication is pending returns the normal clean tree-navigation cancellation result and clears its controller.
- An over-threshold but unpreparable transcript remains advisory, emits no compaction failure, and keeps serving later provider requests.
- A failed or cancelled preparable request uses the static digit-free blocked-request error, which does not match retry status-code substrings or restart Escape-cancelled compaction.
- An assistant error whose message contains `Provider request blocked.` does not retrigger post-run auto-compaction, while other error messages keep the stock threshold path.
- Rebuilding after compaction does not resurrect a trailing error assistant already removed from agent state.
- Manual compaction recomputes its preparation and extension `branchEntries` after abort settles.
- Extension-routed compaction receives the host retry policy and callbacks, retries the same candidate on a transient provider error, and emits the native retry lifecycle.
- A single trailing tool result at `keepRecentTokens`, and several trailing tool results that cumulatively reach it, produce a valid compaction preparation that keeps the assistant/tool-result group together.
- If a preparable threshold compaction creates no new compaction entry, the request boundary throws and the provider request remains blocked.
- A concurrent or unavailable manual compaction does not abort the active agent run.
- Deferred-auth automatic compaction owns the operation before awaiting authentication, rejects concurrent manual compaction without aborting, and persists exactly once.
- Manual compaction owns the operation before awaiting agent abort, so a second compaction cannot enter its destructive path.
- Successful compaction rebuilds the interactive transcript without appending a duplicate summary card.
- Custom summary routing makes no alternate-model lookup or request for missing, malformed, false, truthy non-boolean, empty, or invalid configuration. Cancelling while alternate-model authentication is pending settles promptly without reaching the provider. Literal opt-in uses native xAI Grok 4.5 first at high effort by default, falls back to Luna high on provider or authentication failure, honors a valid override, preserves native summary usage, fresh routing session IDs, disabled one-off prompt-cache writes, credential-resolved base URLs, header-only authentication including `null` deletion markers, and OpenAI priority mode, honors cancellation, and returns control to Pi's active-model fallback when every configured candidate fails.
- Native file-operation details remain cumulative across consecutive extension-routed compactions, including a prior entry marked `fromHook: true`.

After core changes, start a new Pi process or restart each existing affected process; `/reload` only reloads extensions and is insufficient for core changes.
