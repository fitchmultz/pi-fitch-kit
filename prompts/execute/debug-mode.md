---
description: Debug a specific issue with temporary logs and retries
argument-hint: "<issue-or-symptom>"
---

# Debug Mode Replication Spec (paste-ready)

You are operating in **Debug Mode**: a hypothesis-driven debugging workflow. You do **not** ship behavioral fixes until runtime logs from a user reproduction discriminate between hypotheses. Temporary instrumentation is mandatory; cleanup is mandatory.

## Non-negotiable rules

1. **No confident fixes before logs.** You may read code and form hypotheses in Explore. You may add instrumentation in Instrument. You may analyze and fix only after Analyze has structured runtime evidence from the user's repro.
2. **3–5 hypotheses before instrumentation.** Each hypothesis must be falsifiable by specific log patterns.
3. **Instrument branch points, not everything.** Log values that separate hypotheses (branch taken, timing, state before/after mutation, I/O results, async boundaries).
4. **User reproduces the real environment.** You provide numbered repro steps; the user runs them. You do not treat static reasoning as reproduction.
5. **Tagged logs only.** Every debug log must include `sessionId`, `hypothesisId`, `location`, `timestamp`, and structured `data`.
6. **Minimal fix tied to evidence.** One small change that explains the anomalous log lines. No drive-by refactors.
7. **Verify on the same repro.** After the fix, the user reruns the **same** steps; you compare new logs to the pre-fix session.
8. **Mandatory cleanup.** Remove **all** temporary instrumentation in a dedicated Cleanup phase before declaring done.
9. **No secrets in logs.** Never log tokens, passwords, cookies, API keys, or full PII payloads. Redact or hash identifiers if needed.
10. **Flaky bugs need multiple runs.** If timing/races are suspected, ask for 2–3 repros and compare event order and timestamps.

## Workflow state machine

Stay in exactly one phase at a time. Advance only when the phase exit criteria are met.

```json
{
  "workflow": "debug_mode",
  "version": "1.0",
  "phases": [
    {
      "id": "explore",
      "label": "Explore",
      "agent_may_edit_code": false,
      "agent_may_edit_tests": false,
      "agent_may_add_instrumentation": false,
      "exit_criteria": [
        "symptom_restated_in_one_sentence",
        "expected_vs_actual_documented",
        "repro_steps_drafted_or_confirmed_with_user",
        "hypotheses_count_between_3_and_5",
        "each_hypothesis_has_falsifying_log_prediction"
      ],
      "next": "instrument"
    },
    {
      "id": "instrument",
      "label": "Instrument",
      "agent_may_edit_code": true,
      "agent_may_edit_tests": false,
      "agent_may_add_instrumentation": true,
      "exit_criteria": [
        "debug_session_created",
        "instrumentation_is_temporary_and_tagged",
        "collector_endpoint_or_log_path_documented",
        "repro_instructions_emitted_with_expected_log_signatures_per_hypothesis"
      ],
      "next": "reproduce"
    },
    {
      "id": "reproduce",
      "label": "Reproduce",
      "agent_may_edit_code": false,
      "agent_may_edit_tests": false,
      "agent_may_add_instrumentation": false,
      "exit_criteria": [
        "user_confirmed_repro_completed OR logs_collected_for_session",
        "log_bundle_non_empty"
      ],
      "next": "analyze"
    },
    {
      "id": "analyze",
      "label": "Analyze",
      "agent_may_edit_code": false,
      "agent_may_edit_tests": false,
      "agent_may_add_instrumentation": false,
      "exit_criteria": [
        "each_hypothesis_scored_confirmed_weakened_or_ruled_out",
        "at_least_one_hypothesis_confirmed OR all_ruled_out_with_gap_identified"
      ],
      "branches": {
        "all_ruled_out": "instrument",
        "one_or_more_confirmed": "fix"
      }
    },
    {
      "id": "fix",
      "label": "Fix",
      "agent_may_edit_code": true,
      "agent_may_edit_tests": true,
      "agent_may_add_instrumentation": false,
      "exit_criteria": [
        "change_is_minimal_and_maps_to_confirmed_hypothesis",
        "no_new_instrumentation_added"
      ],
      "next": "verify"
    },
    {
      "id": "verify",
      "label": "Verify",
      "agent_may_edit_code": false,
      "agent_may_edit_tests": false,
      "agent_may_add_instrumentation": false,
      "exit_criteria": [
        "user_confirmed_same_repro_passes OR post_fix_logs_show_invariant_restored"
      ],
      "branches": {
        "failed": "analyze",
        "passed": "cleanup"
      }
    },
    {
      "id": "cleanup",
      "label": "Cleanup",
      "agent_may_edit_code": true,
      "agent_may_edit_tests": false,
      "agent_may_add_instrumentation": false,
      "exit_criteria": [
        "all_temporary_debug_calls_removed",
        "debug_config_files_removed_if_created",
        "tests_or_linter_pass_if_available"
      ],
      "next": "done"
    },
    {
      "id": "done",
      "label": "Done",
      "terminal": true
    }
  ],
  "forbidden_transitions": [
    { "from": "explore", "to": "fix", "reason": "no_runtime_evidence" },
    { "from": "instrument", "to": "fix", "reason": "no_runtime_evidence" },
    { "from": "reproduce", "to": "fix", "reason": "no_runtime_evidence" },
    { "from": "fix", "to": "done", "reason": "skip_verify_and_cleanup" },
    { "from": "verify", "to": "done", "reason": "skip_cleanup" }
  ]
}
```

## Session and hypothesis schema

```json
{
  "debugSession": {
    "sessionId": "dbg-<uuid>",
    "createdAt": "ISO-8601",
    "symptom": "string",
    "expected": "string",
    "actual": "string",
    "reproSteps": ["string"],
    "collector": {
      "type": "http | file",
      "endpoint": "http://127.0.0.1:9999/log",
      "filePath": ".debug/<sessionId>.jsonl"
    },
    "hypotheses": [
      {
        "id": "H1",
        "statement": "string",
        "falsifiedIf": "string",
        "confirmedIf": "string",
        "instrumentationTargets": ["file:line or symbol"],
        "status": "open | confirmed | weakened | ruled_out"
      }
    ],
    "phase": "explore | instrument | reproduce | analyze | fix | verify | cleanup | done"
  }
}
```

## Log event schema (one JSON object per line)

```json
{
  "sessionId": "dbg-<uuid>",
  "hypothesisId": "H1",
  "location": "path/to/file.ts:functionName",
  "timestamp": 1716211200123,
  "level": "debug",
  "message": "short human-readable label",
  "data": {}
}
```

**Required fields:** `sessionId`, `hypothesisId`, `location`, `timestamp`, `message`.  
**Optional:** `data` (small structured object only).

## Tool contracts (implement these in your harness)

### `debug_session_create`

Creates a session and returns `sessionId` + collector config.

**Input:**
```json
{
  "symptom": "string",
  "expected": "string",
  "actual": "string",
  "reproSteps": ["string"],
  "hypotheses": [
    {
      "id": "H1",
      "statement": "string",
      "falsifiedIf": "string",
      "confirmedIf": "string"
    }
  ],
  "collector": { "type": "file", "filePath": ".debug/<sessionId>.jsonl" }
}
```

**Output:**
```json
{
  "sessionId": "dbg-...",
  "collector": { "type": "file", "filePath": ".debug/dbg-....jsonl" },
  "phase": "explore"
}
```

### `debug_session_get`

**Input:** `{ "sessionId": "dbg-..." }`  
**Output:** full `debugSession` object including phase and hypothesis statuses.

### `debug_session_set_phase`

**Input:** `{ "sessionId": "dbg-...", "phase": "instrument", "reason": "exit criteria met" }`  
**Output:** updated session; **reject** if transition is in `forbidden_transitions`.

### `debug_log_emit` (runtime SDK — called by instrumented app code)

Appends one JSON line to the session log sink. Implement as HTTP POST or append-only file.

**Input:** log event schema above.  
**Output:** `{ "ok": true }`

### `debug_logs_collect`

**Input:**
```json
{
  "sessionId": "dbg-...",
  "sinceTimestamp": 0,
  "hypothesisId": null
}
```

**Output:**
```json
{
  "sessionId": "dbg-...",
  "events": [],
  "summary": {
    "count": 0,
    "byHypothesis": { "H1": 0, "H2": 0 },
    "timeRange": { "min": null, "max": null }
  }
}
```

### `debug_instrument_apply` (agent tool — edits source)

Adds **temporary** tagged probes. Must be reversible.

**Input:**
```json
{
  "sessionId": "dbg-...",
  "probes": [
    {
      "hypothesisId": "H1",
      "file": "src/foo.ts",
      "anchor": "function submitOrder",
      "kind": "entry | exit | branch | before | after | io_result",
      "message": "cart total before tax",
      "dataKeys": ["subtotal", "itemCount"]
    }
  ]
}
```

**Output:**
```json
{
  "applied": [{ "file": "src/foo.ts", "line": 42, "marker": "DEBUG_PROBE_H1_1" }],
  "collectorInstructions": "Logs write to .debug/dbg-....jsonl"
}
```

**Implementation note:** Prefer a tiny `debugLog(sessionId, hypothesisId, location, message, data)` helper imported only during debug sessions. Every probe must have a unique `marker` comment for cleanup grep.

### `debug_instrument_cleanup`

**Input:** `{ "sessionId": "dbg-..." }`  
**Output:** `{ "removedMarkers": ["DEBUG_PROBE_H1_1"], "filesTouched": ["src/foo.ts"] }`

Must remove all probes and debug-only imports/config for that session.

### `debug_hypothesis_score`

Agent-facing analysis helper (can be pure prompt + `debug_logs_collect`).

**Input:**
```json
{
  "sessionId": "dbg-...",
  "scores": [
    { "hypothesisId": "H1", "status": "confirmed", "evidence": ["event ids or log lines"] }
  ]
}
```

## Instrumentation templates

Use the project's language. Examples:

**TypeScript / JavaScript**
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

**Python**
```python
# DEBUG_PROBE_H2_1 — remove in cleanup
debug_log(session_id="dbg-REPLACE", hypothesis_id="H2", location="checkout.py:submit_order:pre_tax", message="cart total before tax", data={"subtotal": subtotal, "item_count": len(items)})
```

**Minimal file sink (MVP collector)**
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

## Phase scripts (what you must output each phase)

### Explore — output format
```markdown
## Symptom
<one sentence>

## Expected vs actual
- Expected: ...
- Actual: ...

## Repro steps (draft)
1. ...
2. ...

## Hypotheses
| ID | Statement | Confirmed if logs show | Ruled out if logs show |
|----|-----------|------------------------|------------------------|
| H1 | ... | ... | ... |
| H2 | ... | ... | ... |
| H3 | ... | ... | ... |

## Next
Create debug session and move to Instrument.
```

### Instrument — output format
```markdown
## Debug session
- sessionId: dbg-...
- Collector: .debug/dbg-....jsonl

## Probes added
| Marker | Hypothesis | Location | What it measures |
|--------|------------|----------|------------------|

## Repro instructions (run exactly)
1. ...
2. ...

## Expected log signatures
- H1: ...
- H2: ...
- H3: ...

Reply "repro done" when finished (or paste errors if blocked).
```

### Reproduce — agent behavior
- Do not edit code.
- Wait for user confirmation or call `debug_logs_collect`.
- If logs empty: troubleshoot repro steps, do not fix yet.

### Analyze — output format
```markdown
## Log summary
- Events: N
- Time range: ...

## Hypothesis scoring
| ID | Status | Evidence |
|----|--------|----------|
| H1 | confirmed / weakened / ruled_out | cite log lines |

## Conclusion
Root cause: <one sentence tied to confirmed hypothesis>

## Next
- If all ruled out: add narrower probes → Instrument
- Else: minimal Fix
```

### Fix — constraints
- Touch the smallest surface that addresses the **confirmed** hypothesis only.
- Do not add new probes.
- State which log lines the fix explains.

### Verify — output format
```markdown
## Verification
Same repro:
1. ...

## Pass criteria
- Log/logic invariant: ...

Reply "verified" or "still broken" with what you saw.
```

### Cleanup — output format
```markdown
## Cleanup complete
- Removed markers: [...]
- Files restored: [...]
- Tests: pass / fail / skipped

## Resolution
<one sentence root cause + fix>
```

## Guardrail pseudocode (enforce in harness)

```text
on tool_call "apply_fix" or "edit_file" (behavioral):
  if session.phase in ["explore", "instrument", "reproduce"]:
    reject("Debug Mode: fixes forbidden before Analyze")

on tool_call "edit_file" (instrumentation):
  if session.phase != "instrument" and not tagged DEBUG_PROBE:
    reject("Debug Mode: only Instrument phase may add probes")

on declare_done:
  if session.phase != "done":
    reject("Debug Mode: must complete verify and cleanup")

on transition to "fix":
  require at least one hypothesis.status == "confirmed"
```

## MVP without custom IDE extension

1. `debug_session_create` writes `.debug/<sessionId>.jsonl`
2. Agent adds `debugLog(...)` calls with unique `DEBUG_PROBE_*` markers
3. User runs repro locally
4. Agent calls `debug_logs_collect`
5. Agent scores hypotheses, applies minimal fix
6. User reruns repro; agent collects post-fix logs
7. `debug_instrument_cleanup` removes all markers

## Success definition

Debug Mode is complete only when:

- [ ] Root cause stated with cited log evidence
- [ ] Fix verified on the **same** repro
- [ ] All `DEBUG_PROBE_*` instrumentation removed
- [ ] No debug-only files left in repo (except optional `.debug/` in `.gitignore`)

## One-line mission

**Measure with tagged runtime logs during a user repro, then fix minimally, verify, and remove every probe.**

---

$@
