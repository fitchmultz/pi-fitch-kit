---
description: Run a strict no-caveats subagent review gate with temp artifacts
argument-hint: "[scope]"
---

Scope: ${1:-current uncommitted diff or most recent task-relevant changes}

Run a hard review gate. Quality bar: no known caveats, no shortcuts, no fragile paths, no hidden tech debt, and no false sign-off. Do not weaken this into a quick or material-only review.

Manual workflow prerequisites:
- This retained prompt is not registered by the kit. It requires a compatible installed delegation runtime with effective-profile discovery, separate fresh-context launches, lifecycle/status control, and durable review artifacts. Native Pi and this kit do not supply that runtime.
- Discover executable effective profiles and inspect their instructions, model routing, fallbacks, filters, and overrides through the installed owner's current documented tools. This gate requires two independent reviewers: one GPT-family review and one Claude-family review. Profile identifiers are not fixed, and a name alone does not prove model family.
- Preserve any additional explicit named-reviewer or model-family requirement, human review, repository protection, and authority limit. If required independent review is unavailable, report the missing capability, profile, or model family and keep the gate unsatisfied. Do not substitute self-review, duplicate a profile under an alias, silently change families, or claim an incomplete review passed.

Process:
1. Inspect the repo state and identify the exact review scope.
2. Create a unique temp artifact directory with `mktemp -d "/tmp/pi-hard-review.XXXXXXXXXX"`.
3. Use the installed owner's effective-profile discovery if the executable inventory is not already known in this session. If either required family (GPT or Claude) lacks a suitable independent reviewer, stop the gate as incomplete with the exact prerequisite; do not attempt a nonexistent profile.
4. Launch the two selected independent fresh-context reviewers through the installed owner's documented API with:
   - no edits
   - strict “everything is perfect” acceptance bar
   - permission to run focused read-only inspection commands, tests, typechecks, linters, or builds when needed
   - a distinct review artifact file inside the temp directory and file-only output when supported
   - enough time for a real review
   - evidence of the actual model used, including fallbacks, so each required family is verified
5. For high-risk code quality, lifecycle, auth, permissions, data-loss, release, or large-refactor changes, add an independent strict maintainability reviewer when available, also writing to the temp artifact directory. The `thermo-nuclear-code-quality-review` skill can guide that brief when installed; a skill name is not an executable agent profile.
6. Read the review artifact files yourself. For a review-only request, report valid blockers without edits. If remediation is also authorized, fix valid findings or rebut incorrect ones with evidence, then refresh affected review using a new temp artifact path; do not ask again for already requested fixes.
7. Do not claim green unless the reviewed scope, required validation, and reviewer evidence are enough for the strict bar. If coverage is incomplete, say exactly what evidence is missing.

Required subagent task wording:
- Include the repo path and branch when relevant.
- Include exact files, diff scope, plan paths, or product requirements to verify.
- Say: “Do not edit files.”
- Say: “If you could not inspect enough to enforce the strict acceptance bar, do not sign off; name the missing evidence.”
- Say: “If there are no findings, say exactly: `No findings. Everything I checked is acceptable.`”

Artifact rules:
- Do not write review artifacts into the project tree.
- Do not reuse output filenames across parallel subagents.
- Prefer temp/session artifact paths over repo-relative paths.
- Keep the artifact directory path in the final answer so the review can be re-read.

Final response:
- Verdict: pass/fail/incomplete.
- Review artifact paths.
- Validation commands you or reviewers ran and status.
- Fixes applied after review, if any.
- Remaining missing evidence or risks; say none only when true.
