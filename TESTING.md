# Testing

This document is the authoritative testing policy for Expenses. Product planning or redesign working documents do not define test coverage.

## Commands

```bash
uv run fast-tests
uv run full-tests
```

`fast-tests` is the gate for feature work, shared code or configuration changes, and code changes prepared for a pull request. Docs-only and isolated low-risk local changes may use focused checks. The gate runs Ruff, the ty type checker, the import layer check, the backend test suite, frontend lint, and the TypeScript/Vite production build concurrently, with the backend tests distributed across CPU cores by pytest-xdist.

When web behavior or layout changes, pair the gate with focused Playwright specs for each materially distinct affected layout. Do not escalate to the complete matrix because a diff is large or a page was redesigned. After checks pass, repeat or broaden them only for relevant changes, failures, or unresolved concerns.

Reserve `full-tests` for release candidates, changes to shared browser/runtime infrastructure whose risk spans most routes (such as authentication bootstrap, Playwright fixtures, migrations/startup, or global navigation), or an explicit request. It runs the fast gate and then the complete Playwright suite in a single invocation. Every Playwright worker boots its own backend through the fixtures in `ui/tests/fixtures.ts`: a fresh temporary SQLite data directory, applied migrations, and FastAPI on a free local port serving the built `ui/dist` application and API on one origin. It never reuses a developer server or database.

Worker count scales with CPU cores, so spec files run concurrently while tests within a file stay serial against their worker's database by default. Long files whose tests are fully self-sufficient (read-only checks, or every test provisions its own data through the API) opt into per-test distribution with `test.describe.configure({ mode: "parallel" })`; a file may only opt in when no test depends on data or state left by an earlier test in that file. Test and assertion timeouts are set above the Playwright defaults because browser startup and paint slow down while many workers share one machine, and `reportSlowTests` flags any file that grows past two minutes so it can be split or opted into parallel mode before it caps the run again. The desktop and mobile auth specs each run first-run setup on a pristine instance; every other project bootstraps its worker's backend once and shares that authenticated storage state. Each worker's server also starts a stub OpenAI-compatible AI backend (`tests/e2e_ai_provider.py`), and the worker turns every AI feature on with it. The run produces one HTML report covering all projects.

Install all browser binaries once after cloning or updating Playwright:

```bash
npm --prefix ui run test:e2e:install
```

Focused browser commands run from `ui/` after `npm run build`:

```bash
npm run test:e2e -- --project=desktop-chromium
npm run test:e2e -- --project=mobile-webkit
npm run test:e2e -- --project=critical-desktop-firefox
npm run test:e2e -- --project=critical-desktop-webkit
npm run test:e2e -- --project=critical-mobile-chromium
npm run test:e2e:ui
npm run test:e2e:headed
```

Visual baselines exist for macOS (`darwin`) and Linux. Regenerate the macOS files locally with `--update-snapshots`. For the Linux files, run the **Full tests** workflow on the branch with `update_snapshots` checked, then copy the files from its `visual-baselines-linux` artifact into `ui/tests/`.

## Policy

Expenses keeps a small test suite. A check that a static tool can make belongs in that tool, and a test protects behavior that the tools cannot see.

### Static checks

- ty type-checks `src`. `ty-baseline.json` lists the errors that existed when the checker was added, and new code adds none. Fix an error that the gate reports on a line you changed. After you fix a listed error, or when an edit only moves one, run `uv run ty check --baseline ty-baseline.json --update-baseline` and commit the smaller baseline. ty is pinned to an exact version because its releases before 1.0 can change results; update the pin and the baseline together.
- Ruff adds rules for likely bugs, async code, string-built SQL, server-clock dates where `local_today()` or `local_now()` belongs, commented-out code, blanket suppressions, swallowed exceptions, stray prints, and unused arguments. A function may branch at most 25 ways; the few older functions above that carry `# noqa: C901` until they are split.
- `lint-imports` keeps the backend layers `cli`, `app`, `api`, `services`, `db`, and `core` in that order: a module never imports from a layer above it.
- Oxlint, TypeScript strict mode, and the local design rules check the web app. Oxlint runs with type information, so it also flags unhandled promises and switches that miss a case. It also checks keyboard access, import cycles, and branching; the same limit of 25 applies, and older components above it carry a disable comment.
- Ruff and Oxlint reject skipped, expected-to-fail, and focused tests. Fix a failing test, or delete it when the policy below no longer keeps it.
- Do not write a test that only repeats what these checks enforce, such as response shapes, argument wiring, or that a removed feature stays removed. Write a test for a removed feature only when the application keeps a live route or code path that blocks it.

### What a test protects

Add or keep a test only when it protects one of these:

- Money: amounts, totals, allocation, reimbursements, budgets, forecasts, and currency conversion.
- Access: authentication, admin elevation, and isolation between users.
- Stored data: migrations, imports, exports, backups, and reconciliation.
- Assistant changes: the Assistant changes data only through a card that the user approves.
- A regression: a bug that reached `main` gets one test that fails without the fix.

Prefer one test that checks a rule across many inputs to many tests that each check one example. Extend a suitable existing test or spec; add a file only when no existing file fits.

### Browser tests

- The Playwright suite has a budget of 120 test definitions. A change that would take the suite past the budget removes or merges at least as many tests as it adds.
- Each product surface has one desktop journey that crosses the browser, FastAPI API, service, and temporary database. Request interception is reserved for deterministic failure injection, external resources, and paid or nondeterministic providers.
- A mobile spec covers only interactions that differ on mobile, such as sheets, the tab bar, and Select mode. Mobile behavior belongs in `*.mobile.spec.ts`, and tests use the controls actually visible in that layout.
- Canonical authenticated routes are scanned for automatically detectable structural WCAG A/AA violations and browser runtime errors. Mobile routes additionally assert that the document does not overflow horizontally. Axe color-contrast checks are excluded because translucent and chart surfaces require design-token and screenshot review instead of computed-background inference.
- Stable high-risk page and dialog archetypes have reviewed screenshot baselines. Update snapshots only for intentional UI changes and inspect the image diff before accepting it.
- The three compatibility projects run only the critical create-and-read ledger journey.
- Each browser test must check the behavior that its title tells, and the check must occur in a standard run. Code that only writes optional audit artifacts is not coverage.
- Synchronize browser tests on an observable UI state or a request or response. Lint flags `waitForTimeout` in browser tests and helpers. Use the Playwright clock when testing elapsed time.
- An audit spec must not do a journey again when a feature spec owns that journey. An audit spec adds only checks that apply across features, for example theme, overflow, or accessibility.

## Browser matrix

| Project | Engine and layout | Scope |
|---|---|---|
| `auth-bootstrap-chromium` | Chromium desktop | Fresh setup, login, logout, signup, and route guards |
| `auth-bootstrap-mobile-webkit` | WebKit with iPhone 15 emulation | Fresh setup, login, logout, signup, and route guards on the mobile layout |
| `desktop-chromium` | Chromium, 1280×800 | Desktop journeys, accessibility, and visual contracts |
| `mobile-webkit` | WebKit with iPhone 15 emulation | Mobile-specific interactions, accessibility, overflow, and visual contracts |
| `critical-desktop-firefox` | Firefox, 1280×800 | Critical authenticated navigation and transaction creation |
| `critical-desktop-webkit` | WebKit, 1280×800 | Critical authenticated navigation and transaction creation |
| `critical-mobile-chromium` | Chromium with Pixel 7 emulation | Critical mobile transaction creation and detail navigation |

Playwright mobile projects emulate viewport, user agent, touch, and browser-engine behavior; they do not run physical iOS Safari. Real-device or iOS Simulator Safari remains a supplemental manual check when a browser-engine issue requires it.

## Failure artifacts

Playwright writes the HTML report to `ui/playwright-report` and failures to `ui/test-results`. Failed tests retain a screenshot and trace; the manually dispatched **Full tests** workflow uploads both directories. Open a local trace with:

```bash
cd ui
npx playwright show-trace test-results/<test>/trace.zip
```
