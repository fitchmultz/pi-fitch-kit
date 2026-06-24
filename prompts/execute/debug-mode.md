---
description: Debug a specific issue with temporary logs and retries
argument-hint: "<issue-or-symptom>"
---

# Debug Mode

You are operating in **Debug Mode**: a hypothesis-driven debugging workflow. You do **not** ship behavioral fixes until runtime logs from a user reproduction discriminate between hypotheses. Temporary instrumentation is mandatory; cleanup is mandatory.

## Non-negotiable rules

1. **No confident fixes before logs.** Read code and form hypotheses in Explore. Add instrumentation in Instrument. Analyze and fix only after Analyze has structured runtime evidence from the user's repro.
2. **3–5 hypotheses before instrumentation.** Each must be falsifiable by specific log patterns.
3. **Instrument branch points, not everything.** Log values that separate hypotheses (branch taken, timing, state before/after mutation, I/O results, async boundaries).
4. **User reproduces the real environment.** You provide numbered repro steps; the user runs them. Static reasoning is not reproduction.
5. **Tagged logs only.** Every debug log includes `sessionId`, `hypothesisId`, `location`, `timestamp`, and a small structured `data` payload.
6. **Minimal fix tied to evidence.** One small change that explains the anomalous log lines. No drive-by refactors.
7. **Verify on the same repro.** After the fix the user reruns the **same** steps; you compare new logs to the pre-fix session.
8. **Mandatory cleanup.** Remove **all** temporary instrumentation in a dedicated Cleanup phase before declaring done.
9. **No secrets in logs.** Never log tokens, passwords, cookies, API keys, or full PII payloads. Redact or hash identifiers if needed.
10. **Flaky bugs need multiple runs.** If timing/races are suspected, ask for 2–3 repros and compare event order and timestamps.

## Phases

Stay in exactly one phase at a time. Advance only when the exit criteria are met.

| Phase | May edit / instrument | Exit criteria | Next |
|-------|-----------------------|---------------|------|
| **Explore** | read only | symptom in one sentence; expected vs actual; repro steps drafted; 3–5 hypotheses, each with a falsifying log prediction | Instrument |
| **Instrument** | edit code (instrumentation only) | tagged probes added; collector/log path documented; repro instructions + expected log signature per hypothesis emitted | Reproduce |
| **Reproduce** | no edits | user confirmed repro done, or non-empty logs collected | Analyze |
| **Analyze** | read only | every hypothesis scored confirmed/weakened/ruled_out; ≥1 confirmed, or all ruled out with a gap identified | Fix (if confirmed) or back to Instrument (if all ruled out) |
| **Fix** | edit code/tests | change is minimal and maps to the confirmed hypothesis; no new instrumentation | Verify |
| **Verify** | no edits | user confirms the same repro passes, or post-fix logs show the invariant restored | Cleanup (if passed) or back to Analyze (if failed) |
| **Cleanup** | edit code | all temporary debug calls and debug-only files removed; tests/lint pass if available | Done |
| **Done** | — | terminal | — |

**Forbidden transitions** (enforce these yourself; no engine does it for you): never jump from Explore/Instrument/Reproduce straight to Fix (no runtime evidence yet); never go Fix→Done or Verify→Done (must complete verify and cleanup).

## Logging contract

Append one JSON object per line to a session sink (default `.debug/<sessionId>.jsonl`). Required fields: `sessionId`, `hypothesisId`, `location`, `timestamp`, `message`. Optional: a small `data` object. Keep a hypothesis table: id, statement, `confirmedIf`, `falsifiedIf`, instrumentation targets, status.

## Optional harness tools

The `debug_session_*`, `debug_log_*`, and `debug_instrument_*` tools referenced by older specs are **not provided by your environment**. Do not assume they exist. Operate Debug Mode with your normal tools (`read`, `bash`, `edit`): add tagged `debugLog(...)` calls with unique `DEBUG_PROBE_<H>_<n>` marker comments, have the user run the repro, read the log file, then remove every marker in Cleanup. Only build a real session/instrument tool if the user explicitly opts into a reusable harness.

Example probe (TypeScript):

```ts
// DEBUG_PROBE_H2_1 — remove in cleanup
debugLog({
  sessionId: "dbg-REPLACE",
  hypothesisId: "H2",
  location: "checkout.ts:submitOrder:pre-tax",
  message: "cart total before tax",
  data: { subtotal, itemCount },
});
```

Minimal file sink:

```ts
export function debugLog(event: {
  sessionId: string;
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
}) {
  const line = JSON.stringify({ ...event, timestamp: Date.now(), level: "debug" });
  fs.appendFileSync(`.debug/${event.sessionId}.jsonl`, line + "\n");
}
```

## Phase outputs

**Explore** — Symptom (one sentence); Expected vs actual; drafted repro steps; hypotheses table (`ID | Statement | Confirmed if logs show | Ruled out if logs show`).

**Instrument** — sessionId and collector path; probes table (`Marker | Hypothesis | Location | What it measures`); exact repro instructions; expected log signature per hypothesis. Ask the user to reply "repro done" (or paste errors).

**Reproduce** — Do not edit code. Wait for user confirmation or collected logs. If logs are empty, troubleshoot the repro — do not fix yet.

**Analyze** — Log summary (event count, time range); hypothesis scoring (`ID | Status | Evidence`); root cause in one sentence tied to the confirmed hypothesis. If all ruled out, add narrower probes and return to Instrument; otherwise proceed to a minimal Fix.

**Fix** — Touch the smallest surface that addresses the confirmed hypothesis only. No new probes. State which log lines the fix explains.

**Verify** — Run the same repro. State the pass criteria (the log/logic invariant). Ask the user to reply "verified" or "still broken" with what they saw.

**Cleanup** — List removed markers and restored files; test status. State the resolution in one sentence (root cause + fix).

## Success definition

Debug Mode is complete only when:

- [ ] Root cause stated with cited log evidence
- [ ] Fix verified on the **same** repro
- [ ] All `DEBUG_PROBE_*` instrumentation removed
- [ ] No debug-only files left in the repo (except optional `.debug/` in `.gitignore`)

## Mission

**Measure with tagged runtime logs during a user repro, then fix minimally, verify, and remove every probe.**

---

$@
