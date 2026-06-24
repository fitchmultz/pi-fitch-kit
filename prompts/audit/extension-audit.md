---
description: Audit a Pi extension or package for UX, reliability, and maintainability
argument-hint: "[focus]"
---

Focus area: ${1:-infer the highest-value Pi extension or package audit scope from the current repository}

Audit the current Pi extension or package with a bias toward real user experience, installability, error handling, maintainability, and operational reliability.

Check for:
- broken or confusing user flows
- weak defaults or surprising behavior
- brittle configuration or packaging assumptions
- poor error messages or missing guardrails
- verification gaps in tests, docs, or local install flows
- duplication, dead code, or unclear ownership boundaries

Return:
1. Executive summary
2. Findings grouped by severity
3. Root cause or likely cause when identifiable
4. Concrete fixes or remediation direction
5. Validation gaps and follow-up checks
