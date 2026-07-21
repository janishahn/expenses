# Testing

This document is the authoritative testing policy and browser-coverage inventory for Expenses. Product planning or redesign working documents do not define test coverage.

## Commands

```bash
uv run fast-tests
uv run full-tests
```

`fast-tests` is the normal local and pull-request gate. It runs Ruff, the backend test suite, frontend lint, and the TypeScript/Vite production build concurrently, with the backend tests distributed across CPU cores by pytest-xdist.

For normal feature work, pair `fast-tests` with the focused Playwright specs and materially distinct layouts affected by the change. Do not escalate to the complete matrix because a diff is large or a page was redesigned.

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

## Policy

- Every user-facing story gets at least one real full-stack browser happy path on every materially distinct supported layout: desktop Chromium and mobile WebKit.
- Permission, destructive-action, recovery, empty, failure, and feature-disabled states are browser-tested when their interaction is part of the story. Domain permutations and backend-only edge cases remain in focused API or unit tests.
- Desktop and mobile files stay explicit. Mobile behavior belongs in `*.mobile.spec.ts`; tests use the controls actually visible in that layout.
- Primary happy paths cross the browser, FastAPI API, service, and temporary database. Request interception is reserved for deterministic failure injection, external resources, and paid or nondeterministic providers.
- Canonical authenticated routes are scanned for automatically detectable structural WCAG A/AA violations and browser runtime errors. Mobile routes additionally assert that the document does not overflow horizontally. Axe color-contrast checks are excluded because translucent and chart surfaces require design-token and screenshot review instead of computed-background inference.
- Stable high-risk page and dialog archetypes have reviewed screenshot baselines. Update snapshots only for intentional UI changes and inspect the image diff before accepting it.
- The three compatibility projects run only the critical create-and-read ledger journey. Broad feature behavior stays in the primary desktop/mobile projects to keep the cross-browser cost bounded.
- New or changed user stories update the coverage ledger and the corresponding browser tests in the same change.

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
| Authenticated shell, navigation, period propagation, theme, unknown routes | `navigation.desktop.spec.ts` | `navigation.mobile.spec.ts` | Yes |
| Dashboard metrics, periods, charts, privacy, category focus, quick add | `dashboard.spec.ts`, `visual.spec.ts` | `dashboard.mobile.spec.ts`, `visual.mobile.spec.ts` | Yes |
| Critical create-and-read ledger journey | `core-journey.critical.spec.ts` | `core-journey.critical.mobile.spec.ts` | Cross-browser projects |
| Transaction actions, filtering, search reveal, selection, detail, edit, deletion, attachments, location, durable tracking | `transactions.spec.ts`, `transactions-detail.spec.ts`, `transactions-deletion.spec.ts`, `transactions-attachments.spec.ts`, `navigation.desktop.spec.ts` | `transactions.mobile.spec.ts` | Yes |
| Uncategorized Inbox categorization | `transactions.spec.ts` | `transactions.mobile.spec.ts` | Yes |
| Trash restore and permanent deletion | `transactions-trash.spec.ts` | `transactions.mobile.spec.ts` | Yes |
| Optional read-only spending Assistant and disabled AI surfaces | `spending-assistant.spec.ts`, `llm-disabled.desktop.spec.ts` | `spending-assistant.mobile.spec.ts` | Yes |
| Insights filters, charts, Flow, and drill-through | `insights.spec.ts` | `insights.mobile.spec.ts` | Yes |
| Forecast controls, prediction range, intra-month warnings, drill-down, and What If handoff | `forecast.spec.ts` | `planning.mobile.spec.ts` | Yes |
| What If adjustments and comparison output | `scenarios.spec.ts` | `planning.mobile.spec.ts` | Yes |
| Unified monthly and annual budgets, month-only adjustments, existing-plan compatibility, and burndown | `budgets.spec.ts` | `budgets.mobile.spec.ts` | Yes |
| Weekly digest navigation and decision sections | `digest.spec.ts` | `summaries.mobile.spec.ts` | Yes |
| Category create, edit, archive, restore, icons, and merge guards | `categories.spec.ts` | `categories.mobile.spec.ts` | Yes |
| Tag create, detail update/delete, merge, and budget exclusion | `tags.spec.ts`, `tag-detail.spec.ts` | `organization.mobile.spec.ts` | Yes |
| Recurring create/edit/delete, audit, evaluation, and occurrence history | `recurring.spec.ts`, `recurring-occurrences.spec.ts` | `recurring.mobile.spec.ts` | Yes |
| Template create/edit/delete and reorder | `templates.spec.ts` | `organization.mobile.spec.ts` | Yes |
| Categorization rule create/edit/toggle, preview, and application | `rules.spec.ts` | `organization.mobile.spec.ts` | Yes |
| Commerzbank CSV preview, import, and reconciliation workspace | `reconciliation.spec.ts` | `reconciliation.mobile.spec.ts` | Yes |
| PDF report options, generation, and latest download | `reports.spec.ts` | `summaries.mobile.spec.ts` | Yes |
| Settings, appearance, balance anchors, CSV import, and exports | `settings.spec.ts` | `settings-admin.mobile.spec.ts` | Yes |
| Admin role/elevation, health, backup, logs, maintenance, and Assistant usage | `admin-auth.spec.ts`, `admin.spec.ts` | `settings-admin.mobile.spec.ts` | Elevation route |
| Legacy SQLite import controls and validation | `admin-import.spec.ts` | `settings-admin.mobile.spec.ts` | Admin import reached after elevation |

Backend tests remain authoritative for lower-level calculation, isolation, migration, import, export, reconciliation-matching, recurrence, LLM-provider, and security edge cases. Browser coverage proves that the supported user journey remains coherent through the rendered application.

## Failure artifacts

Playwright writes the HTML report to `ui/playwright-report` and failures to `ui/test-results`. Failed tests retain a screenshot and trace; the manually dispatched **Full tests** workflow uploads both directories. Open a local trace with:

```bash
cd ui
npx playwright show-trace test-results/<test>/trace.zip
```
