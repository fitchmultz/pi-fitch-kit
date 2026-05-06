---
description: Review recent work with fresh eyes and fix obvious issues
---

Focus area (optional): $@

Carefully review the recent implementation and the relevant surrounding code with fresh eyes.
If the current branch has staged or unstaged changes, inspect those first. Otherwise inspect the most recent task-relevant changes in the repo.
Be skeptical and evidence-based. Do not invent issues or success.

What to look for:
- correctness bugs and logic errors
- hidden edge cases, regressions, race conditions, or stale assumptions
- misleading naming, stale comments, dead code, or unnecessary complexity
- weak or missing verification for changed behavior
- cleanup opportunities that simplify the touched area without broad churn

What to do:
1. Read the changed files carefully, plus the nearby code needed to understand the full flow.
2. Verify suspicious areas with targeted checks, focused tests, or temporary instrumentation if needed.
3. Fix the problems you can confidently fix.
4. Add or improve tests where warranted.
5. Remove any temporary debugging artifacts before finishing.
6. Re-run the relevant verification.
7. Report what you found, what you changed, and any remaining risks.

Constraints:
- Do not make cosmetic churn unless it meaningfully improves correctness, clarity, or maintainability.
- Do not preserve bad code just because it already existed.
- Do not stop at the first fix if deeper issues are visible in the touched area.
- Prefer simplification and net-negative LOC where practical.
