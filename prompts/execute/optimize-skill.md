---
description: Optimize an Agent Skill against real behavior, helper scripts, evals, and validation
argument-hint: "<skill-name> [focus]"
---

<skill_request>
$@
</skill_request>

If <skill_request> is blank or only whitespace, stop and ask which skill to optimize. Do not guess.

Use `/skill:agent-skill-engineering` for this task.

<objective>
Harden the named Agent Skill end-to-end so it is current, operational, agent-optimized, validated, and free of stale guidance or accidental debt.
</objective>

<loop>
1. Identify the canonical skill folder without moving it:
   - If the request names a path, use that path.
   - If a matching project-local skill exists in `.agents/skills/<skill-name>` or `.pi/skills/<skill-name>` from the active project, treat that as canonical.
   - Otherwise use `~/.agents/skills/<skill-name>` for global reusable skills.
   - Do not promote, copy, mirror, or move a project-specific skill into global skills unless the user explicitly asks for that migration.
2. Read the skill's `SKILL.md` and any relevant `scripts/`, `evals/`, `references/`, or package metadata.
3. Run the skill validator before changes when available:
   `python3 ~/.agents/skills/agent-skill-engineering/scripts/validate_skill.py <skill-dir>`
4. Identify the skill's trigger contract, core workflow, stop rules, helper scripts, evals, and validation expectations.
5. Verify current reality:
   - read current docs/help/source when they define correctness,
   - run safe CLI/tool smoke checks when relevant,
   - inspect existing user/project instructions that affect the skill,
   - compare the skill's examples and commands against real behavior.
6. Find gaps:
   - stale commands or options,
   - unclear trigger or missing do-not-use cases,
   - missing validation or completion evidence,
   - missing safety/privacy/focus warnings,
   - repeated manual steps that should become helper scripts,
   - missing or weak trigger/output evals,
   - duplicated, tutorial-like, or non-operational content.
7. Apply the smallest durable improvement:
   - keep `SKILL.md` focused on always-needed workflow,
   - add or update scripts only for deterministic repeated work,
   - add or update evals when trigger or output-quality risk is real,
   - remove stale references, placeholders, generated junk, and contradictory instructions.
8. Re-run validation:
   - skill validator,
   - JSON parsing for evals,
   - script `--help` and smoke tests if scripts changed,
   - relevant CLI/tool smoke checks if tool behavior changed,
   - diff inspection for accidental churn.
9. If validation fails, triage the cause, fix it, and repeat the loop.
10. Stop only when the optimized skill is ready for use or a real blocker prevents completion.
</loop>

<constraints>
- Do not stop at a plan when implementation or validation remains.
- Do not create duplicate skills or competing sources of truth.
- Do not move project-specific skills into `~/.agents/skills` or any global location unless explicitly requested.
- Do not discard unrelated user changes.
- Do not leave TODOs, placeholders, hidden assumptions, dead code, `.DS_Store`, `__pycache__`, generated junk, or unvalidated helper scripts.
- Do not cite "best practices" without checking the local skill-engineering guidance and relevant current docs/help/source when behavior depends on them.
</constraints>

<final_handoff>
Return only:
1. Outcome
2. Files changed
3. Trigger contract
4. Validation evidence
5. Remaining blockers or follow-ups, only if real
</final_handoff>
