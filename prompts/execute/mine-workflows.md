---
description: Mine recent agent chats for reusable workflow, skill, prompt, or rule improvements
argument-hint: "[days] [focus] [apply]"
---

<request>
$@
</request>

Use `/skill:workflow-from-chats`.

<objective>
Mine recent agent chats for durable workflow improvements that should become one of:
- a new prompt template,
- an update to an existing prompt template,
- an update to an existing skill,
- a new skill,
- a global or project-local rule,
- a workflow doc,
- or no change because evidence is weak, private, contradicted, stale, or one-off.
</objective>

<mode>
- Default mode is recommendation-only: synthesize findings and propose concrete artifacts, but do not edit files.
- Apply mode is enabled only if <request> explicitly includes words like `apply`, `update`, `write`, `create`, `edit`, or `implement`.
- In apply mode, apply only strong, non-controversial improvements. For medium, weak, contradicted, project-specific, or privacy-sensitive signals, recommend and defer.
</mode>

<scope>
- If <request> includes a time window, use it. Otherwise default to the last 7 days.
- If <request> includes a focus area, limit the corpus to that surface unless adjacent evidence clearly reveals a higher-value fix.
- If <request> says global, consider global skills/prompts/rules only when evidence is truly project-agnostic.
- If evidence is project-specific, keep recommendations or edits project-local. Do not move project-specific skills, prompts, or rules into global locations unless the user explicitly asks for promotion.
</scope>

<loop>
1. State the chosen window, focus, and mode.
2. Use the current harness transcript source and the `workflow-from-chats` helper when available.
3. Discover recent candidate parent conversations.
4. Bound broad corpora before deep reading:
   - use metadata, modified times, file sizes, and quick high-signal marker scans to narrow candidates,
   - prefer representative root parent conversations over reading every recent transcript,
   - use nested subagent transcripts only after their root parent is selected and only as supporting context.
5. Read selected transcripts internally only.
6. Build an internal evidence inventory by parent conversation ID, task shape, date, and evidence type.
7. Extract preference/workflow atoms:
   - trigger,
   - behavior,
   - scope,
   - confidence,
   - conflict status,
   - evidence type,
   - candidate target artifact.
8. Group atoms by workflow shape: skill authoring, validation, code review, debugging, UI/QA, delegation, docs, release, communication, or safety.
9. Prefer updating an existing prompt/skill/rule over creating a duplicate.
10. In recommendation-only mode, produce a ranked action list with exact target files and rationale.
11. In apply mode:
    - make the smallest durable edits for strong signals,
    - preserve the current artifact source of truth,
    - add helper scripts or evals only when they reduce repeatable agent error,
    - validate every changed artifact with its native checks,
    - inspect the diff for private transcript content, local paths, secrets, placeholders, `.DS_Store`, `__pycache__`, and accidental churn.
12. If validation fails, triage and fix the cause before reporting completion.
</loop>

<privacy_rules>
- Do not paste transcript paths.
- Do not paste raw private chat bodies.
- Cite parent conversation IDs only.
- Do not encode secrets, credentials, account-specific data, PII, or incidental private project facts into durable global artifacts.
- Do not quote the user unless the quote is necessary, non-sensitive, and the user explicitly requested quote-level evidence.
</privacy_rules>

<artifact_rules>
- Prompt templates belong in the active prompt source of truth, such as `pi-fitch-kit/prompts/` for package-backed global prompts.
- Global reusable skills belong in `~/.agents/skills/` unless the user names another global source of truth.
- Project-specific skills belong in the project's `.agents/skills/` or `.pi/skills/` and must stay there unless promotion is explicitly requested.
- Existing artifacts win over new artifacts when their trigger surface overlaps.
- Do not create a new global rule for a single weak signal.
</artifact_rules>

<final_handoff>
Return only:
1. Window, focus, and mode
2. Evidence corpus using parent conversation IDs only
3. Adopted changes, if apply mode was used
4. Recommended changes not applied
5. Dismissed or deferred signals and why
6. Files changed
7. Validation evidence
8. Open questions, only if blocking
</final_handoff>
