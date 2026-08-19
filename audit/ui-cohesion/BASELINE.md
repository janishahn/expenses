# UI cohesion audit baseline

This file freezes Phase 0 evidence. Do not edit it after the Phase 0 commit.

## Revision and environment

| Field | Value |
| --- | --- |
| Captured | 2026-08-19T20:43:31+02:00 (Europe/Berlin) |
| Branch | `ui-cohesion-audit` |
| Baseline revision | `b8f294935389d2e3d4ce14791dbbaeaebc3ac4df` |
| Starting branch | `main`, equal to `origin/main` when the branch was created |
| Host | Linux 6.8.0-137-generic x86_64 |
| uv | 0.7.5 |
| Node | v18.19.1 |
| npm | 9.2.0 |
| Playwright | 1.61.1 |

## Pre-existing untracked worktree state

These files existed before branch creation and before this audit wrote any state. They are preserved and excluded from the Phase 0 commit unless later evidence makes one an in-scope finding:

- `skills-lock.json`
- `ui/playwright.audit.config.ts`
- `ui/playwright.auth-audit.config.ts`
- `ui/playwright.desktop-audit.config.ts`
- `ui/playwright.mobile-chromium-audit.config.ts`
- `ui/tests/visual.mobile.spec.ts-snapshots/add-transaction-mobile-audit-mobile-chromium-linux.png`
- `ui/tests/visual.mobile.spec.ts-snapshots/dashboard-mobile-audit-mobile-chromium-linux.png`

The first file is outside the audit scope. The four Playwright configs and two snapshots are prior audit-oriented artifacts dated 2026-08-16; ownership and reachability are intentionally unresolved at baseline.

## Commands and results

| ID | Exact command | Result |
| --- | --- | --- |
| B-001 | `uv run fast-tests` | Initial sandbox attempt exited 2 before running tests because uv could not open `/home/janis/.cache/uv/sdists-v9/.git` on the read-only filesystem. This is a runner-permission failure, not a repository failure. |
| B-002 | `uv run fast-tests` with approved access to the existing uv cache | Passed: Ruff; 311 backend tests; frontend ESLint; TypeScript and Vite production build. |
| B-003 | `npm run test:e2e -- --project=desktop-chromium` from `ui/` | Exit 0: 233 passed, 1 flaky/retry-green, 2.1 minutes. |
| B-004 | `npm run test:e2e -- --project=mobile-webkit` from `ui/` | Exit 0: 99 passed, 1.9 minutes, no retries or failures reported. |
| B-005 | `npm run test:e2e -- --project=desktop-chromium tests/focus-management.spec.ts --retries=0` from `ui/` | Passed: 5/5 in 11.8 seconds. The B-003 flake did not reproduce in the immediate single-worker focused rerun. |

## Pre-edit failure signatures

### BF-001 — Desktop search reveal focus race

- Project/test: `desktop-chromium`; `ui/tests/focus-management.spec.ts:25`, “search and controlled dialogs return focus to their openers”.
- B-003 first attempt: `expect(getByRole("searchbox", { name: "Search transactions" })).toBeFocused()` timed out after 10 seconds.
- Expected: focused.
- Received: inactive.
- Failing assertion: line 39.
- Original transient artifact path: `ui/test-results/focus-management-Focus-man-6710f-turn-focus-to-their-openers-desktop-chromium/`.
- Disposition: passed on Playwright retry and passed in B-005 with retries disabled. Record as a pre-edit baseline flake; it may not become more frequent or change signature.
- Artifact retention note: the subsequent Mobile WebKit project replaced Playwright's `ui/test-results` directory, so the B-003 screenshot/trace no longer exists on disk. The full assertion signature above was captured from the B-003 runner output before replacement.

No terminal test failure remained after retries in any required baseline command.

## Existing warnings

- Vite reports that Node 18.19.1 is below its supported Node 20.19+/22.12+ range, but the production build succeeds.
- Vite reports chunks over 500 kB after minification.
- Backend tests emit the existing datetime/FastAPI/SQLAlchemy deprecation warnings.
- These warnings are baseline diagnostics, not automatically UI findings.

## Scope count at baseline

- `ui/src`: 98 files.
- `ui/tests`: 78 files, including the two pre-existing untracked audit snapshots above.
- Total inventory: 176 files.

