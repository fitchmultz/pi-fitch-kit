# Engineering records

Records for the engineering standard adopted in `docs/engineering-standard.md` (Strict Oxlint and Oxfmt Engineering Standard, v5.1.2). The standard's Appendix B defines the required record shapes.

## Adoption record

- **Repository:** `fitchmultz/pi-fitch-kit`; adopted standard version **v5.1.2**. Adopted copy digest (sha256, after oxfmt): `414820464b9eadfb645ea51dbd1ef3eac9c52958b986f19f44feaf79d2fae333`.
- **Runtimes and package manager:** Node `>=24.15.0` (npm `12.2.0`).
- **Installed tool versions:** oxlint `1.90.0`, oxfmt `0.75.0`, oxlint-tsgolint `7.0.2005`, typescript `7.0.2`.
- **Config paths:** `.oxlintrc.json` (Appendix A baseline plus role-mapped profile overrides), `.oxfmtrc.json` (section 7.1 settings preserving the established tab convention for TypeScript; JSON keeps 2-space output so npm-managed files stay stable).
- **Acceptance paths:** `npm run check` (`scripts/run-gates.mjs`: typecheck, format, tests — aggregated so one failure cannot hide the rest), `npm run smoke` for package loading; hosted CI runs `npm run check:compat` through the fleet `pi-compatibility` workflow. `npm run lint` runs the full baseline lint.
- **Compiler projects and source profiles:** single `tsconfig.json` project. Production profile: `extensions/*.ts`, `scripts/validate.mjs`. Test profile: the regression/smoke/boundary scripts under `scripts/`. No handwritten declarations exist in this repository, so `skipLibCheck: true` retains no unchecked handwritten declaration (section 4.2 allows an application to retain `skipLibCheck` when no handwritten declarations require a focused check).
- **Formatter and generator ownership:** oxfmt owns all supported maintained files (`.ts`, `.mjs`, `.md`, `.json`, `.yaml`) except `package-lock.json`, whose formatting owner is npm. No maintained generator output exists in this repository.
- **Migration status:** **in progress, phased per section 9.2.** Toolchain, formatter ownership, and the aggregating acceptance runner are enforced now. The extensions phase is complete: all extension sources pass strict compiler options (noImplicitReturns, noFallthroughCasesInSwitch, noImplicitOverride, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noUncheckedSideEffectImports, forceConsistentCasingInFileNames) and the full type-aware lint baseline with warnings denied. Remaining work: extend compiler coverage and strict options to the scripts, record the scripts-phase quality exceptions, then wire repo-wide lint enforcement into `npm run check` and remove this note.
- **Integrated verification:** to be recorded at completion (base/head revision, commands, exit statuses, scopes).

## Quality-exception record

### QX-001 — Five-parameter tool `execute` callbacks in kit extensions

```text
ID and title: QX-001 — five-parameter tool execute callbacks in kit extensions.
Rule, option, or threshold; installed tool versions: eslint/max-params (maximum 4); oxlint 1.90.0, oxlint-tsgolint 7.0.2005, typescript 7.0.2.
Scope: files, authorized operations, origins, or bounded pattern: execute callbacks passed to pi.registerTool in extensions/*.ts; the callback implements Pi's documented tool contract and cannot drop a parameter.
Directive selectors/inventory and optional duplication bounds: oxlint-disable-next-line eslint/max-params on exactly the three execute declaration lines — extensions/session-name.ts:314, extensions/setup-models.ts:15, extensions/paged-reader.ts:75. No other max-params directive exists in the repository.
Diagnostic and required contract: oxlint reports eslint(max-params) "5 parameters, maximum allowed is 4" on each callback. Pi's installed declaration requires all five — execute(toolCallId, params, signal, onUpdate, ctx) at @earendil-works/pi-coding-agent dist/core/extensions/types.d.ts:514 — and the callbacks are assigned against that declaration.
Actual compliant alternative and demonstrated quality cost: bundling the parameters is impossible because the signature is Pi's, not the kit's; adapter wrappers that take five parameters still trip the rule, and wrappers that hide arguments behind closures add an indirection layer per tool with no behavioral gain.
Chosen adjustment and why its scope is appropriate: one next-line directive per execute site, tagged QX-001 in the reason, so the exception is grep-auditable and suppresses nothing else.
Structural comparison or unsafe-type evidence, where applicable: none needed; the parameter count comes from the upstream declaration cited above.
Verification commands, relevant tests, and results: `node_modules/.bin/oxlint --deny-warnings extensions/` exits 0 with the directives in place, and removing any one directive reproduces the max-params error at that line. `npm run check` passes (typecheck, format, 33 tests) and `npm run smoke` loads all 7 extensions with the reader_present tool registered.
Retained protection, lost detection, and established assumptions: only max-params is suppressed on those three lines; every other type-aware rule still applies there, and every other 5+ parameter function in the repository still fails lint. Assumes Pi keeps the five-parameter execute contract.
Review and revisit trigger: any new pi.registerTool execute site, any change to Pi's ToolDefinition.execute arity, or the enforcement-wiring phase's directive verification sweep.
```

Records for the engineering standard adopted in `docs/engineering-standard.md` (Strict Oxlint and Oxfmt Engineering Standard, v5.1.2). The standard's Appendix B defines the required record shapes.
