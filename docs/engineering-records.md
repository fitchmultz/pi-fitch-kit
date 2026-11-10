# Engineering records

Records for the engineering standard adopted in `docs/engineering-standard.md` (Strict Oxlint and Oxfmt Engineering Standard, v5.1.2). The standard's Appendix B defines the required record shapes.

## Adoption record

- **Repository:** `fitchmultz/pi-fitch-kit`; adopted standard version **v5.1.2**. Adopted copy digest (sha256, after oxfmt): `414820464b9eadfb645ea51dbd1ef3eac9c52958b986f19f44feaf79d2fae333`.
- **Runtimes and package manager:** Node `>=24.15.0` (npm `12.2.0`).
- **Installed tool versions:** oxlint `1.90.0`, oxfmt `0.75.0`, oxlint-tsgolint `7.0.2005`, typescript `7.0.2`.
- **Config paths:** `.oxlintrc.json` (Appendix A baseline plus role-mapped profile overrides), `.oxfmtrc.json` (section 7.1 settings preserving the established tab convention for TypeScript; JSON keeps 2-space output so npm-managed files stay stable).
- **Acceptance paths:** `npm run check` (`scripts/run-gates.ts`: typecheck, lint, format, tests — aggregated so one failure cannot hide the rest), `npm run smoke` for package loading; hosted CI runs `npm run check:compat` through the fleet `pi-compatibility` workflow. `npm run lint` runs the full baseline lint.
- **Compiler projects and source profiles:** single `tsconfig.json` project. Production profile: `extensions/*.ts`, `scripts/validate.ts`. Test profile: the regression/smoke/boundary scripts under `scripts/`. No handwritten declarations exist in this repository, so `skipLibCheck: true` retains no unchecked handwritten declaration (section 4.2 allows an application to retain `skipLibCheck` when no handwritten declarations require a focused check).
- **Formatter and generator ownership:** oxfmt owns all supported maintained files (`.ts`, `.mjs`, `.md`, `.json`, `.yaml`) except `package-lock.json`, whose formatting owner is npm. No maintained generator output exists in this repository.
- **Migration status:** **complete.** Phased per section 9.2: the toolchain and formatter PR, the extensions PR, and the scripts PR each landed with their scope passing the full strict baseline, and this final PR wires repo-wide lint enforcement into `npm run check`. All maintained sources — `extensions/*.ts`, `scripts/*.ts` — pass the strict compiler options (noImplicitReturns, noFallthroughCasesInSwitch, noImplicitOverride, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noUncheckedSideEffectImports, forceConsistentCasingInFileNames) and the type-aware lint baseline with warnings denied, with no finding budgets, baseline filtering, or incomplete-source exemptions remaining. The remaining `.oxlintrc.json` overrides are role-mapped profile settings for test scripts (complexity 15, max-depth 4, max-params 6, size limits off), not migration allowances.
- **Integrated verification:** on the fully integrated tree of this final PR (merge of the scripts-phase head `5411daa` plus this change): `npm run check` exits 0 — typecheck pass, lint pass (oxlint --deny-warnings ., 0 findings), format pass, tests pass (33 tests, 0 failures); `npm run smoke` exits 0 loading all 7 extensions; `npm run regression:clean-footer`, `regression:paged-reader`, `regression:session-name`, `regression:fast-mode`, and `regression:write-prompt` each exit 0 on the integrated tree, and `node --test scripts/validate-regression.ts` exits 0 (the validate suite also runs inside the tests gate). Hosted CI (`pi-compatibility` fleet: official and fork hosts, ubuntu/macos, Node 24 and 26) passed on each phase PR's head revision.

## Quality-exception record

### QX-001 — Five-parameter tool `execute` callbacks in kit extensions

```text
ID and title: QX-001 — five-parameter tool execute callbacks in kit extensions.
Rule, option, or threshold; installed tool versions: eslint/max-params (maximum 4); oxlint 1.90.0, oxlint-tsgolint 7.0.2005, typescript 7.0.2.
Scope: files, authorized operations, origins, or bounded pattern: execute callbacks passed to pi.registerTool in extensions/*.ts; the callback implements Pi's documented tool contract and cannot drop a parameter.
Directive selectors/inventory and optional duplication bounds: oxlint-disable-next-line eslint/max-params on exactly the two execute sites — extensions/session-name.ts:310 and extensions/setup-models.ts:15. No other max-params directive exists in the repository.
Diagnostic and required contract: oxlint reports eslint(max-params) "5 parameters, maximum allowed is 4" on each callback. Pi's installed declaration requires all five — execute(toolCallId, params, signal, onUpdate, ctx) at @earendil-works/pi-coding-agent dist/core/extensions/types.d.ts:514 — and the callbacks are assigned against that declaration.
Actual compliant alternative and demonstrated quality cost: bundling the parameters is impossible because the signature is Pi's, not the kit's; adapter wrappers that take five parameters still trip the rule, and wrappers that hide arguments behind closures add an indirection layer per tool with no behavioral gain.
Chosen adjustment and why its scope is appropriate: one next-line directive per execute site, tagged QX-001 in the reason, so the exception is grep-auditable and suppresses nothing else.
Structural comparison or unsafe-type evidence, where applicable: none needed; the parameter count comes from the upstream declaration cited above.
Verification commands, relevant tests, and results: `node_modules/.bin/oxlint --deny-warnings extensions/` exits 0 with the directives in place, and removing any one directive reproduces the max-params error at that line. `npm run check` passes (typecheck, lint, format, 20 tests) and `npm run smoke` loads all 6 extensions with both tools registered.
Retained protection, lost detection, and established assumptions: only max-params is suppressed on those two lines; every other type-aware rule still applies there, and every other 5+ parameter function in the repository still fails lint. Assumes Pi keeps the five-parameter execute contract.
Review and revisit trigger: any new pi.registerTool execute site, any change to Pi's ToolDefinition.execute arity, or the enforcement-wiring phase's directive verification sweep.
```

### QX-002 — Partial Pi fixtures behind narrowing casts in regression scripts

```text
ID and title: QX-002 — partial Pi fixtures behind narrowing casts in regression scripts.
Rule, option, or threshold; installed tool versions: typescript/no-unsafe-type-assertion; oxlint 1.90.0, oxlint-tsgolint 7.0.2005, typescript 7.0.2.
Scope: files, authorized operations, origins, or bounded pattern: offline regression scripts under scripts/ that drive real kit extensions with deliberately partial fixtures — recorders for ExtensionAPI/ExtensionCommandContext, a setFooter stub, a narrower ui.custom fixture, and a partial handler-context for one hook member.
Directive selectors/inventory and optional duplication bounds: five oxlint-disable/oxlint-disable-next-line typescript/no-unsafe-type-assertion directives, all tagged QX-002 — scripts/test-harness.ts:88 (module-scoped), scripts/clean-footer-regression.ts:293, scripts/image-budget-regression.ts:207, scripts/session-name-regression.ts:488, scripts/write-prompt-regression.ts:85. No other no-unsafe-type-assertion directive exists outside QX-003's transport disables.
Diagnostic and required contract: oxlint reports unsafe narrowing casts (e.g. "type 'X' is more narrow than the original type") where a partial fixture is cast to Pi's complete context interfaces. The fixtures intentionally provide only the members the code under test reads; building complete ExtensionAPI/ExtensionUIContext/TUI implementations would mock the very surfaces these regressions verify against the real host.
Actual compliant alternative and demonstrated quality cost: satisfying the complete interfaces requires either full fake implementations of Pi's extension runtime (duplicating the host under test and drifting from it) or abandoning native entry points for hand-rolled seams, which is exactly what these regressions exist to prevent. The kit's validation rules require driving the real loader, extension entry, and dialog plumbing.
Chosen adjustment and why its scope is appropriate: casts live only at fixture-to-boundary lines, each tagged QX-002 with an inline reason naming the fixture and the member actually read; the shared harness module concentrates the generic allowance so call sites pass raw partial objects rather than casting repeatedly.
Structural comparison or unsafe-type evidence, where applicable: the casts narrow from partial records to Pi interfaces whose extra members are never dereferenced by the code under test in these scenarios; each regression's assertions cover the exercised members, so an accessed-but-absent member fails the test rather than type-checks.
Verification commands, relevant tests, and results: `node_modules/.bin/oxlint --deny-warnings scripts/` exits 0; removing the harness directive surfaces the unsafe-assertion errors it suppresses. `npm run check` passes (typecheck, lint, format, 20 tests) and each affected regression (clean-footer, image-budget, session-name, write-prompt) exits 0.
Retained protection, lost detection, and established assumptions: only no-unsafe-type-assertion is suppressed at the named boundaries; every other type-aware rule still applies, and unsafe casts elsewhere in scripts still fail lint. Assumes the fixtures stay partial — a fixture that grows members should drop its cast where possible.
Review and revisit trigger: any new cast-to-Pi-interface site in scripts/, changes to Pi's context interfaces that make a fixture's members complete, or the annual exception review.
```

### QX-003 — Offline transport disable via WebSocket override

```text
ID and title: QX-003 — offline transport disable via WebSocket override.
Rule, option, or threshold; installed tool versions: typescript/no-unsafe-type-assertion; oxlint 1.90.0, oxlint-tsgolint 7.0.2005, typescript 7.0.2.
Scope: files, authorized operations, origins, or bounded pattern: offline boundary regressions that must guarantee no network transport can leave the process; assigning undefined to globalThis.WebSocket forces Pi's native auto transport onto the stubbed fetch endpoint.
Directive selectors/inventory and optional duplication bounds: two oxlint-disable-next-line directives, both tagged QX-003 — scripts/session-name-boundary.ts:77 and scripts/write-prompt-boundary.ts:151. No other transport-disable cast exists.
Diagnostic and required contract: `globalThis.WebSocket = undefined as unknown as typeof WebSocket` is an intentionally invalid runtime state (the global read thereafter yields undefined), so the assertion is flagged unsafe. The boundary regressions require exactly this: with WebSockets unavailable, the native transport must fall back to the fake HTTP endpoint, and any code path that still constructs a WebSocket fails the run.
Actual compliant alternative and demonstrated quality cost: there is no type-correct way to remove a declared global; alternatives (patching fetch only) leave the WebSocket transport live, which these regressions exist to rule out.
Chosen adjustment and why its scope is appropriate: one directive per boundary script at the single assignment line, tagged QX-003, adjacent to the comment explaining the offline guarantee; nothing else on those lines is suppressed.
Structural comparison or unsafe-type evidence, where applicable: the assertion widens then narrows a deliberately poisoned global; the tests' fetch stub asserts every outbound request URL, proving the fallback path and the absence of WebSocket use.
Verification commands, relevant tests, and results: `node_modules/.bin/oxlint --deny-warnings scripts/` exits 0; `npm run regression:session-name` and `npm run regression:write-prompt` exit 0 with all requests captured by the stub endpoint.
Retained protection, lost detection, and established assumptions: only the two named assignment lines are exempt from no-unsafe-type-assertion; all other rules still apply. Assumes the offline guarantee is still required — if a boundary regression ever permits real transport, the override and its directives go.
Review and revisit trigger: any new offline boundary script needing the transport disable, or Pi gaining a first-class offline switch that replaces the WebSocket override.
```

### QX-005 — Unawaited abort when closing a native dialog

```text
ID and title: QX-005 — unawaited abort when closing a native dialog.
Rule, option, or threshold; installed tool versions: typescript/no-floating-promises; oxlint 1.90.0, oxlint-tsgolint 7.0.2005, typescript 7.0.2.
Scope: files, authorized operations, origins, or bounded pattern: scripts/session-name-boundary.ts:736, a dialog-answer stub that closes the dialog by aborting its own signal.
Directive selectors/inventory and optional duplication bounds: exactly one oxlint-disable-next-line typescript/no-floating-promises, tagged QX-005.
Diagnostic and required contract: current.abort() returns a promise that the stub intentionally does not await. Awaiting it would deadlock: the abort resolves the dialog the awaiting code is inside, and the boundary regression drives the dialog through its real close path.
Actual compliant alternative and demonstrated quality cost: `void current.abort()` trips no-floating-promises' void-return sibling handling only if configured; the idiomatic fix the rule suggests (awaiting) deadlocks the dialog, and silencing via .catch(() => {}) adds a no-op handler that misrepresents the deliberate fire-and-forget abort.
Chosen adjustment and why its scope is appropriate: one next-line directive naming the deadlock; nothing else suppressed.
Structural comparison or unsafe-type evidence, where applicable: the unawaited promise is the abort trigger itself; the subsequent `closed` promise (resolved by the abort listener) is awaited and carries the behavioral assertion.
Verification commands, relevant tests, and results: `node_modules/.bin/oxlint --deny-warnings scripts/` exits 0; `npm run regression:session-name` exits 0 including the dialog-close scenario.
Retained protection, lost detection, and established assumptions: no-floating-promises still enforces every other promise in the repository. Assumes the dialog stub keeps the abort-to-close shape.
Review and revisit trigger: any new fire-and-forget abort in scripts/ or a Pi dialog API change that makes awaiting abort safe.
```

Records for the engineering standard adopted in `docs/engineering-standard.md` (Strict Oxlint and Oxfmt Engineering Standard, v5.1.2). The standard's Appendix B defines the required record shapes.
