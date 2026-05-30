---
description: Manual QA pass through the local app
---

Focus area (optional): $@

Use the dogfood workflow/skill if available.

Start the app locally, determine the correct local URL, and perform a manual QA pass through the meaningful flows.

If a focus area is provided, prioritize it first, then cover adjacent flows that could be impacted.
If no focus area is provided, infer the highest-value flows from the repo and test broadly.

This is discovery-first:
- use real interaction and visual inspection
- capture clear evidence and reproduction steps for each issue
- do not rely on automated tests as proof of correctness
- do not start fixing issues during the QA pass unless the user explicitly asks for remediation
- use the detected local URL as the target for the dogfood workflow
