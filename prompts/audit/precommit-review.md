---
description: Strict review of the staged diff before commit
thinking: xhigh
---

Review the staged diff first (`git diff --cached`).
If nothing is staged, review the current working tree diff instead.

Focus on:
- correctness bugs and regression risk
- missing edge-case handling
- security or data-safety issues
- test gaps for changed behavior
- misleading naming, dead code, or accidental churn

Return a concise review with:
1. Verdict
2. Findings grouped by severity
3. Required fixes before commit
4. Nice-to-have follow-ups

Be skeptical and evidence-based. Do not invent issues.

Do not make code changes unless the user explicitly asks for remediation after the review.
