# Testing

This document is the authoritative testing policy and browser-coverage inventory for Expenses. Product planning or redesign working documents do not define test coverage.

## Commands

```bash
uv run fast-tests
uv run full-tests
```

`fast-tests` is the gate for feature work, shared code or configuration changes, and code changes prepared for a pull request. Docs-only and isolated low-risk local changes may use focused checks. The gate runs Ruff, the backend test suite, frontend lint, and the TypeScript/Vite production build concurrently, with the backend tests distributed across CPU cores by pytest-xdist.

When web behavior or layout changes, pair the gate with focused Playwright specs for each materially distinct affected layout. Do not escalate to the complete matrix because a diff is large or a page was redesigned. After checks pass, repeat or broaden them only for relevant changes, failures, or unresolved concerns.

Reserve `full-tests` for release candidates, changes to shared browser/runtime infrastructure whose risk spans most routes (such as authentication bootstrap, Playwright fixtures, migrations/startup, or global navigation), or an explicit request. It runs the fast gate and then the complete Playwright suite in a single invocation. Every Playwright worker boots its own backend through the fixtures in `ui/tests/fixtures.ts`: a fresh temporary SQLite data directory, applied migrations, and FastAPI on a free local port serving the built `ui/dist` application and API on one origin. It never reuses a developer server or database.

Worker count scales with CPU cores, so spec files run concurrently while tests within a file stay serial against their worker's database by default. Long files whose tests are fully self-sufficient (read-only checks, or every test provisions its own data through the API) opt into per-test distribution with `test.describe.configure({ mode: "parallel" })`; a file may only opt in when no test depends on data or state left by an earlier test in that file. Test and assertion timeouts are set above the Playwright defaults because browser startup and paint slow down while many workers share one machine, and `reportSlowTests` flags any file that grows past two minutes so it can be split or opted into parallel mode before it caps the run again. The desktop and mobile auth specs each run first-run setup on a pristine instance; every other project bootstraps its worker's backend once and shares that authenticated storage state. The run produces one HTML report covering all projects.

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

- Every new or changed web user-facing story has at least one real full-stack browser happy path on every materially distinct supported layout: desktop Chromium and mobile WebKit.
- Permission, destructive-action, recovery, empty, failure, and feature-disabled states are browser-tested when their interaction is part of the story. Domain permutations and backend-only edge cases remain in focused API or unit tests.
- Desktop and mobile files stay explicit. Mobile behavior belongs in `*.mobile.spec.ts`; tests use the controls actually visible in that layout.
- Primary happy paths cross the browser, FastAPI API, service, and temporary database. Request interception is reserved for deterministic failure injection, external resources, and paid or nondeterministic providers.
- Canonical authenticated routes are scanned for automatically detectable structural WCAG A/AA violations and browser runtime errors. Mobile routes additionally assert that the document does not overflow horizontally. Axe color-contrast checks are excluded because translucent and chart surfaces require design-token and screenshot review instead of computed-background inference.
- Stable high-risk page and dialog archetypes have reviewed screenshot baselines. Update snapshots only for intentional UI changes and inspect the image diff before accepting it.
- The three compatibility projects run only the critical create-and-read ledger journey. Broad feature behavior stays in the primary desktop/mobile projects to keep the cross-browser cost bounded.
- New or changed web user stories update the coverage ledger and affected browser tests in the same change. Extend suitable existing specs; add a file only when repository conventions require it or no existing file fits.
- Do not add a test that only makes sure that a removed feature is not in the application. Write such a test only when the application keeps a live route or code path that blocks the removed feature.
- Each browser test must check the behavior that its title tells, and the check must occur in a standard run. Code that only writes optional audit artifacts is not coverage.
- An audit spec must not do a journey again when a feature spec owns that journey. An audit spec adds only checks that apply across features, for example theme, overflow, or accessibility.

## Browser matrix

| Project | Engine and layout | Scope |
|---|---|---|
| `auth-bootstrap-chromium` | Chromium desktop | Fresh setup, login, logout, signup, and route guards |
| `auth-bootstrap-mobile-webkit` | WebKit with iPhone 15 emulation | Fresh setup, login, logout, signup, and route guards on the mobile layout |
| `desktop-chromium` | Chromium, 1280×800 | Complete desktop behavior, accessibility, and visual contracts |
| `mobile-webkit` | WebKit with iPhone 15 emulation | Complete mobile behavior, accessibility, overflow, and visual contracts |
| `critical-desktop-firefox` | Firefox, 1280×800 | Critical authenticated navigation and transaction creation |
| `critical-desktop-webkit` | WebKit, 1280×800 | Critical authenticated navigation and transaction creation |
| `critical-mobile-chromium` | Chromium with Pixel 7 emulation | Critical mobile transaction creation and detail navigation |

Playwright mobile projects emulate viewport, user agent, touch, and browser-engine behavior; they do not run physical iOS Safari. Real-device or iOS Simulator Safari remains a supplemental manual check when a browser-engine issue requires it.

## Coverage ledger

`Desktop` and `Mobile` identify the owning Playwright specifications. `Surface contract` means the canonical route is also covered by structural accessibility, runtime-error, and mobile overflow assertions.

| Product story or surface | Desktop | Mobile | Surface contract |
|---|---|---|---|
| First-run setup, login, logout, signup, protected deep links | `auth.spec.ts`, `settings.spec.ts` | `auth.mobile.spec.ts` | Real setup submission in both layouts |
| Authenticated shell with the sidebar and app-name menu, the mobile tab bar and More sheet, focus trapping and focus return for dialogs, sheets, and menus, 44px mobile touch targets for navigation and header actions, Settings-only theme selection, period propagation, and unknown routes | `navigation.desktop.spec.ts`, `focus-management.spec.ts` | `navigation.mobile.spec.ts`, `focus-management.mobile.spec.ts`, `interaction-audit.mobile.spec.ts` | Yes |
| Panel header bar with page actions inside it at constrained desktop widths and on mobile, and the period control and Filter on one row beneath the title | `page-scope-header.spec.ts` | `page-scope-header.mobile.spec.ts` | Covered routes |
| Dashboard metrics, quick periods, tag-only secondary-filter panel with archived/hidden visibility and scoped drill-downs, charts, privacy, category focus, quick add, scheduled-tag defaults and removal, and recent-transactions touch targets | `dashboard.spec.ts`, `tag-filters.spec.ts`, `visual.spec.ts` | `dashboard.mobile.spec.ts`, `tag-filters.mobile.spec.ts`, `summaries.mobile.spec.ts`, `visual.mobile.spec.ts`, `interaction-audit.mobile.spec.ts` | Yes |
| Critical create-and-read ledger journey | `core-journey.critical.spec.ts` | `core-journey.critical.mobile.spec.ts` | Cross-browser projects |
| Transactions ledger with day bands and their nets, header actions, printing every row with the server's totals, period, filter pills and the mobile Filter sheet, multi-tag scopes including stale hidden selections, in-place search with focus return, desktop row selection and mobile Select mode with confirmed bulk edits, peek and full view with inline edits and failed-save recovery, Markdown notes, the add dialog with templates, deletion with Undo, receipts and the viewer, location map, durable tracking from ⋯, reimbursement allocation from the expense | `transactions.spec.ts`, `tag-filters.spec.ts`, `transactions-detail.spec.ts`, `transactions-deletion.spec.ts`, `transactions-attachments.spec.ts`, `navigation.desktop.spec.ts`, `focus-management.spec.ts` | `transactions.mobile.spec.ts`, `tag-filters.mobile.spec.ts`, `focus-management.mobile.spec.ts`, `interaction-audit.mobile.spec.ts` | Yes |
| Uncategorized: category pill with Undo, suggestion accept and reject from the row and the peek, search, confirmed bulk recategorization | `transactions.spec.ts` | `transactions.mobile.spec.ts`, `interaction-audit.mobile.spec.ts` | Yes |
| Trash bulk restore and confirmed permanent deletion | `transactions-trash.spec.ts` | `transactions.mobile.spec.ts` | Yes |
| Route loading placeholder and data-dependent action readiness (only on loads pending past 250ms, never on fast loads) | `route-loading.spec.ts` | `route-loading.mobile.spec.ts` | Transactions skeleton plus Budgets action readiness |
| Cross-route query and mutation error recovery with Retry, the unreachable-server receipt that reloads the page by itself, a proxy's 502 or 504 counted as unreachable only while the server does not answer, pages and the add form whose code fails to load, readable API detail, entered values kept after a failed save, missing-resource return paths, and custom period range validation | `state-audit.spec.ts`, `transactions-deletion.spec.ts` | `state-audit.mobile.spec.ts` | Desktop and mobile state contracts |
| Optional read-only spending Assistant and disabled AI surfaces | `spending-assistant.spec.ts`, `llm-disabled.desktop.spec.ts` | `spending-assistant.mobile.spec.ts`, `interaction-audit.mobile.spec.ts` | Yes |
| Insights page tabs and stable desktop canvas, quick periods, tag-only secondary-filter panel including top-tag scope, chart-local controls, Net view selection/data view, and drill-through | `insights.spec.ts`, `tag-filters.spec.ts` | `insights.mobile.spec.ts`, `tag-filters.mobile.spec.ts`, `interaction-audit.mobile.spec.ts` | Yes |
| Forecast controls, prediction range, intra-month warnings, drill-down, and What If handoff | `forecast.spec.ts` | `planning.mobile.spec.ts` | Yes |
| What If adjustments and comparison output | `scenarios.spec.ts` | `planning.mobile.spec.ts` | Yes |
| Unified monthly and annual budgets with an annual total that does not count an overall budget twice, full-bleed mobile month navigation with an anchored picker, month-only adjustments, existing-plan compatibility, and burndown | `budgets.spec.ts` | `budgets.mobile.spec.ts`, `interaction-audit.mobile.spec.ts` | Yes |
| Weekly digest navigation, full-bleed mobile period navigation, and decision sections | `digest.spec.ts` | `summaries.mobile.spec.ts` | Yes |
| Category create, edit, archive, restore, icons, and merge guards | `categories.spec.ts`, `focus-management.spec.ts` | `categories.mobile.spec.ts`, `focus-management.mobile.spec.ts`, `interaction-audit.mobile.spec.ts` | Yes |
| Tag create, date-range defaults, read-only detail and explicit edit flow, archive, restore, independent filter visibility, delete, merge, and budget exclusion | `tags.spec.ts`, `tag-detail.spec.ts`, `tag-filters.spec.ts` | `organization.mobile.spec.ts`, `tag-filters.mobile.spec.ts`, `interaction-audit.mobile.spec.ts` | Yes |
| Recurring page tabs, create/edit/delete, audit, evaluation, and occurrence history | `recurring.spec.ts`, `recurring-occurrences.spec.ts` | `recurring.mobile.spec.ts` | Yes |
| Template create/edit/delete and reorder | `templates.spec.ts`, `focus-management.spec.ts` | `organization.mobile.spec.ts` | Yes |
| Categorization rule create/edit/toggle, preview, and application | `rules.spec.ts` | `organization.mobile.spec.ts` | Yes |
| Per-user local categorization toggle that saves at once, threshold validation with Escape to revert, failed-save recovery and persistence, first training, new expense prediction, and disable | `settings.spec.ts` | `settings-admin.mobile.spec.ts` | Real background training; backend tests cover weekly checks, correction provenance, and manual/rule priority |
| Reconcile: Commerzbank CSV import with preview and duplicate count, suggested, several and no-match bands, Match all, match search with the bank-amount switch, ignore reasons, ignoring every remaining row, create and match, Undo, the Resolved view with outcome and account filters, and reopen with keep-or-trash for created transactions | `reconciliation.spec.ts` | `reconciliation.mobile.spec.ts` | Yes |
| PDF report options, include/exclude tag scope, generation, and latest download | `reports.spec.ts` | `summaries.mobile.spec.ts`, `interaction-audit.mobile.spec.ts` | Yes |
| ChatGPT pairing, per-feature provider/model/thinking settings, custom model validation and recovery, persistence, and disconnect | `ai-settings.spec.ts` | `ai-settings.mobile.spec.ts` | Real backend; external OpenAI responses simulated |
| Settings sections with URLs: profile and sign out, ingest token, appearance, balance snapshots, CSV import, and exports | `settings.spec.ts` | `settings-admin.mobile.spec.ts` | Yes |
| Admin role/elevation, health, backup, logs, maintenance, and Assistant usage | `admin-auth.spec.ts`, `admin.spec.ts`, `focus-management.spec.ts` | `settings-admin.mobile.spec.ts` | Elevation route |
| Legacy SQLite import controls and validation | `admin-import.spec.ts` | `settings-admin.mobile.spec.ts`, `interaction-audit.mobile.spec.ts` | Admin import reached after elevation |

Backend tests remain authoritative for lower-level calculation, isolation, migration, import, export, reconciliation-matching, recurrence, LLM-provider, and security edge cases. Browser coverage proves that the supported user journey remains coherent through the rendered application.

## Failure artifacts

Playwright writes the HTML report to `ui/playwright-report` and failures to `ui/test-results`. Failed tests retain a screenshot and trace; the manually dispatched **Full tests** workflow uploads both directories. Open a local trace with:

```bash
cd ui
npx playwright show-trace test-results/<test>/trace.zip
```

The audit-oriented browser specs keep their behavioral assertions in normal test runs but do not write bulk screenshots or JSON manifests by default. Set `UI_POLISH_AUDIT_ARTIFACT_DIR` to an explicit repository-relative or absolute directory only when intentionally collecting a review evidence set. Local evidence under `artifacts/ui-polish-audit/` is ignored by Git.
