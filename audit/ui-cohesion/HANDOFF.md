# UI cohesion audit handoff

## Current checkpoint

- Phase: Phase 2 in progress; legacy and shared-pattern batches complete and verified.
- Branch: `ui-cohesion-audit`.
- Commits: Phase 0 audit state is `e2991c1`; Phase 1 inventory is `47739f8`; legacy cleanup is `c6b8c9c`; shared-pattern consolidation is `e879074`; product baseline remains `b8f294935389d2e3d4ce14791dbbaeaebc3ac4df`.
- Baseline: `uv run fast-tests` green; desktop Chromium 233 passed plus BF-001 retry-green flake; focused no-retry rerun 5/5; Mobile WebKit 99/99.

## Exact next action

Commit this audit-state checkpoint, then fix F-0008 by replacing Admin purge/rebuild native alerts with narrow inline feedback, adding browser regression coverage for success and failure behavior, and verifying desktop and mobile Admin layouts.

## Verified progress

- All 176 baseline files under `ui/src` and `ui/tests` were individually reviewed; the inventory has zero pending rows.
- All frontend root configuration files relevant to build, lint, Tailwind, PostCSS, TypeScript, and Playwright were reviewed.
- Runtime/test module reachability, exported-symbol references, raw interactive elements, canonical wrapper usage, stylesheet selector reachability, and all twelve visual baselines were audited.
- F-0001 through F-0004 are fixed by `c6b8c9c`: ten unreachable modules/assets, unused API/components/variants, and ten dead CSS selectors were removed; the switch transition was narrowed.
- Batch verification is green: frontend lint, production build, 6 focused desktop Chromium tests, and 4 focused Mobile WebKit tests. The first sandboxed Playwright attempt could not read the uv cache; the elevated rerun passed.
- F-0005 through F-0007 are fixed by `e879074`: ordinary actions, fields, surfaces, and four analytical page headers now use their canonical product components; `DESIGN.md` and the changelog record the user-facing convention.
- Cohesion-batch verification is green: frontend lint/build, 65 focused desktop Chromium tests, and 23 focused Mobile WebKit tests. The mandated `agent-browser` helper was attempted but is not installed, so rendered-route verification used the repository's production-built Playwright harness.
- F-0008 remains open. Intentional divergences and retained performance/testing boundaries are recorded in `DECISIONS.md`.

## Open work

- Phase 2 must fix and verify F-0008 in a focused commit.
- Phase 3 must reconcile documentation/changelog requirements, run final branch review, execute the required final commands, and close every finding.

## Blocked items

None.

## Preserved uncommitted state

The seven files listed in `BASELINE.md` predate this audit and remain untracked and untouched. The only additional uncommitted files before this checkpoint are the finding-status and handoff updates. No process is intentionally left running.
