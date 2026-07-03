---
description: Optimize an Agent Skill against current docs/changelogs/source, real behavior, helper scripts, evals, and validation
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
2. Read the skill's `SKILL.md` and any relevant `scripts/`, `evals/`, `references/`, `assets/`, client metadata, package manifests, and neighboring skills with overlapping triggers.
3. Run the skill validator before changes when available:
   `python3 ~/.agents/skills/agent-skill-engineering/scripts/validate_skill.py <skill-dir>`
4. Identify the skill's dependency contract before editing:
   - What tool, command, API, product, package, repo, or workflow does the skill teach?
   - What local source of truth owns that behavior?
   - What upstream docs, changelog, release notes, CLI help, source files, schemas, examples, or tests define current correctness?
   - Which guidance is version-sensitive, convention-sensitive, or likely stale after updates?
5. Vet current reality thoroughly, especially for tool/command skills:
   - read the latest relevant changelog/release notes and migration notes,
   - read current docs/help/source/types/schemas for the touched surface,
   - explore the implementation code paths enough to verify real behavior, not just docs,
   - run safe version/help/list/smoke commands when available,
   - inspect existing user/project instructions that affect the skill,
   - compare every example command, option, path, default, tool name, validation gate, and stop rule against real behavior.
6. Identify the skill's trigger contract, core workflow, stop rules, helper scripts, evals, and validation expectations.
   - Treat the frontmatter `description` as a router, not the workflow.
   - Aim for ~180-320 chars unless collision risk needs more.
   - Keep trigger nouns, implicit trigger cases, and near-miss exclusions.
   - Cut process detail already present in `SKILL.md`, repeated "Use this skill when" phrasing when not needed, and generic quality claims.
   - Quote YAML descriptions when they contain `:` or other punctuation likely to confuse frontmatter parsing.
7. Find gaps:
   - stale commands, options, APIs, file paths, install locations, defaults, model/tool names, or conventions,
   - old workarounds that current releases fixed,
   - guidance copied from old versions instead of current source of truth,
   - unclear trigger or missing do-not-use cases,
   - missing validation or completion evidence,
   - missing safety/privacy/focus warnings,
   - repeated manual steps that should become helper scripts,
   - missing or weak trigger/output evals,
   - duplicated, tutorial-like, or non-operational content.
8. Apply the smallest durable improvement:
   - keep `SKILL.md` focused on always-needed workflow,
   - add or update scripts only for deterministic repeated work,
   - add or update evals when trigger or output-quality risk is real,
   - remove stale references, placeholders, generated junk, and contradictory instructions.
9. Re-run validation:
   - skill validator,
   - JSON parsing for evals,
   - script `--help` and smoke tests if scripts changed,
   - relevant CLI/tool smoke checks if tool behavior changed,
   - current docs/help/source/changelog checks for version-sensitive guidance,
   - diff inspection for accidental churn.
10. If validation fails, triage the cause, fix it, and repeat the loop.
11. Stop only when the optimized skill is ready for use or a real blocker prevents completion.
</loop>

<constraints>
- Do not stop at a plan when implementation or validation remains.
- Do not create duplicate skills or competing sources of truth.
- Do not move project-specific skills into `~/.agents/skills` or any global location unless explicitly requested.
- Do not discard unrelated user changes.
- Do not leave TODOs, placeholders, hidden assumptions, dead code, `.DS_Store`, `__pycache__`, generated junk, or unvalidated helper scripts.
- Do not cite "best practices" without checking the local skill-engineering guidance and relevant current docs/help/source when behavior depends on them.
- Do not preserve old guidance for compatibility unless the current tool still needs it and the cleanup/removal condition is explicit.
</constraints>

<final_handoff>
Return only:
1. Outcome
2. Files changed
3. Trigger contract
4. Currentness evidence
5. Validation evidence
6. Remaining blockers or follow-ups, only if real
</final_handoff>
