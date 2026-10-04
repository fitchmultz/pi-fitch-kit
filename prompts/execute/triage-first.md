---
description: Triage a task, resolve uncertainty, and complete the authorized outcome
argument-hint: "<task>"
---

<task>
$@
</task>

If <task> is blank or only whitespace, ask for the task. Do not guess.

## Triage and execute

1. Read the task's original requirements, settled decisions, project guidance, and current state. Review and planning requests remain read-only unless changes are also requested.
2. Trace relevant behavior and callers, discover available facts, and reproduce defects before choosing a fix. Use safe experiments and useful specialist help to resolve uncertainty; complexity, cross-file scope, or several plausible approaches alone are not reasons to stop.
3. Make ordinary reversible implementation, dependency, and layout choices yourself. Use existing project mechanisms or maintained OSS when they cover the required semantics; do not build custom substitutes merely to avoid dependencies.
4. Complete the authorized outcome, supporting setup, and proportional verification. For repository delivery, use isolated worktrees and PRs, resolve required checks and actionable reviews, merge under current or standing authority, refresh the primary checkout and required local installation, then check for uncommitted and untracked work and remove only this task's clean, completed worktrees and obsolete branches; preserve unsaved or unrelated work.

## Real boundaries

Pause only dependent work when a material decision or access cannot be discovered and must come from the user, an unrequested action risks irreversible loss, private-data disclosure, or substantial new cost, or an explicit hold or enforced safeguard blocks progress. Preserve unrelated work and continue independent authorized work. Do not repeat settled approvals or abandon a task because it needs deep reasoning.

If a specialist can resolve the gap, delegate a bounded task with exact context, scope, and verification while retaining integration ownership. If a genuine blocker remains, report the attempted paths, evidence, remaining requirement, and exact recovery action. A requested handoff must preserve the real state and authority; do not claim the unfinished outcome is delivered.

## Finish

Report the result, relevant changed files, actual verification, delivery/local-refresh state, and any concrete remaining blocker. Stop when the requested outcome is complete or the remaining boundary genuinely requires user action.
