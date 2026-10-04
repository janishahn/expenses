# Testing

E2E journeys are the primary proof of user-facing behavior. Keep focused backend tests for financial calculations, authorization, migrations, concurrency, and failure recovery that UI tests cannot cover efficiently. This file owns the coverage inventory; the tests define the detailed scenarios.

## Commands

```bash
uv run fast-tests       # backend tests, Ruff, frontend lint and production build
uv run full-tests       # fast-tests, then all Playwright projects
uv run ios-e2e          # native XCUITest journeys; macOS, Xcode and iOS 26 Simulator
```

For web setup, run `npm --prefix ui run test:e2e:install` once. After building with `npm --prefix ui run build`, use focused specs while editing:

```bash
cd ui
npm run test:e2e -- transactions.spec.ts --project=desktop-chromium
npm run test:e2e -- transactions.mobile.spec.ts --project=mobile-webkit
npm run test:e2e:ui
```

Run the fast gate plus affected journeys for feature work. Use `full-tests` for shared browser/startup infrastructure and release candidates. Run `ios-e2e` for native changes on a Mac; a Linux-only check does not validate native compilation or interaction.

PRs and main-branch pushes run backend checks, the web matrix, and native journeys in separate CI jobs. The same checks run weekly, on manual **Full tests** dispatch, and before release publication. CI allows one browser retry for diagnosis but fails retry-only passes. Keep diagnostics when investigating flakes; do not weaken assertions or accept snapshots merely to make a run green.

## Policy

- Update the owning E2E test when a user story changes, on every materially distinct supported client. Update this inventory only when coverage changes. Add missing coverage before deleting its only lower-level protection.
- Assert the outcome, exact amounts where relevant, and persistence after reload/relaunch. Cover meaningful permissions, destructive actions, errors and recovery; avoid one giant dependent journey.
- Seed prerequisites through APIs/fixtures; perform the action under test through the UI and the real backend. Simulate paid/nondeterministic providers at their boundary. Browser request interception is also appropriate for deliberate UI failure injection, but does not prove backend behavior.
- Keep tests isolated and independently provisioned. Reuse authentication outside login tests; never use personal accounts or databases. Use deterministic assertions in CI; AI may help author reviewed test code.
- Remove tests that assert nothing, restate incidental fixture values, or duplicate an existing failure detector. Consolidate unique assertions into the owning journey. Keep small tests when they protect a meaningful invariant; test-count and line-coverage targets are not goals.
- Accessibility, focus, reflow and visual audits add cross-cutting checks instead of repeating feature journeys. Structural axe checks exclude color contrast; reviewed screenshots cover selected stable archetypes. Inspect visual diffs before changing baselines.

## Isolation and platforms

Playwright starts a real FastAPI server and migrated temporary SQLite database per worker, serving `ui/dist` and the API on one origin. Developer `EXPENSES_*` settings and `.env` files are excluded. Fresh-instance auth specs exercise setup/login; other specs reuse a worker login. Scope fixture data with unique users, tags or search keys so reuse cannot change pagination or totals. Files run concurrently and tests within a file remain serial unless independently provisioned.

`desktop-chromium` and `mobile-webkit` own broad web coverage, alongside their fresh-auth projects. Three compatibility projects run the critical ledger journey on desktop Firefox/WebKit and mobile Chromium. Mobile browser projects emulate devices; they do not exercise the native app or physical Safari.

`ios-e2e` creates disposable backends and an owned iPhone simulator, runs the shared `ExpensesApp` scheme, then cleans up. Each ordinary native test uses its own account; first-run setup uses a separate pristine backend. Inference is disabled. Debug/simulator-only launch settings reset app-owned preferences/Keychain state and select the loopback backend. No developer signing certificate is needed. CI pins Xcode 26.3 on macOS 15; locally install Pango (`brew install pango`) for PDF generation if needed.

Native journeys use `--skip-local-unlock`; they do not establish biometric or privacy-lock correctness. Real-device review remains necessary for hardware capture, biometrics, system sharing/permissions and device performance. The native suite is in `ios/ExpensesApp/ExpensesAppUITests/Journeys.swift`; gaps are explicit below.

## Journey inventory

Web names are spec stems under `ui/tests/` (`auth` means `auth.spec.ts`). A dash means no native E2E yet, not an unsupported product feature. Native entries name the behavior asserted by `Journeys.swift`.

| Journey | Desktop web | Mobile web | Native iOS |
|---|---|---|---|
| Setup, login, logout, sessions and recovery | `auth`, `settings`, `admin-auth` | `auth.mobile` | Setup, login failure/recovery, relaunch, logout, remote revocation, unreachable backend |
| Ledger create/read/edit, validation, deletion and restore | `transactions`, `transactions-detail`, `transactions-deletion`, `transactions-trash`, `core-journey.critical` | `transactions.mobile`, `core-journey.critical.mobile` | Exact amounts, edit/delete/restore, relaunch, invalid input recovery |
| Receipt attachments and location | `transactions-attachments`, `transactions-detail` | `transactions.mobile`, `interaction-audit.mobile` | Receipt download/preview/delete; capture and location remain device checks |
| Search, filters, Inbox and tag scopes | `transactions`, `tag-filters`, `tag-detail` | `transactions.mobile`, `tag-filters.mobile` | Search matching and clearing |
| Categories, tags, templates and categorization rules | `categories`, `tags`, `templates`, `rules` | `categories.mobile`, `organization.mobile` | Category/tag creation, saved template application |
| Dashboard and Insights drill-downs | `dashboard`, `insights`, `tag-filters` | `dashboard.mobile`, `insights.mobile`, `tag-filters.mobile` | Exact totals from known transactions |
| Monthly/annual budgets | `budgets` | `budgets.mobile` | Exact monthly budget persistence |
| Forecast and What If | `forecast`, `scenarios` | `planning.mobile` | Exact What If impact without ledger changes |
| Recurring rules, evaluation and history | `recurring`, `recurring-occurrences` | `recurring.mobile` | Rule creation and persisted schedule |
| Reconciliation import/review/matching | `reconciliation` | `reconciliation.mobile` | Create from a bank row with exact amount |
| Digest and PDF reports | `digest`, `reports` | `summaries.mobile` | PDF generation/preview |
| Settings, balance anchors, CSV and portable export | `settings` | `settings-admin.mobile` | Appearance persistence and CSV preview |
| Valid legacy SQLite import and validation | `admin-import` | `settings-admin.mobile` | — |
| Admin elevation, health, maintenance and logs | `admin-auth`, `admin` | `settings-admin.mobile` | — |
| AI pairing/settings, real Assistant tool round-trip and disconnect | `ai-settings` | `ai-settings.mobile` | — |
| Assistant streaming/error/cancel UI and disabled AI | `spending-assistant`, `llm-disabled.desktop` | `spending-assistant.mobile`, `state-audit.mobile` | — |
| Navigation, themes, focus, loading/error recovery, accessibility and reflow | `navigation.desktop`, `focus-management`, `page-scope-header`, `route-loading`, `state-audit`, `surface-contracts`, `route-theme-audit`, `auth-theme-audit`, `stress-audit`, `visual` | Corresponding `.mobile` specs plus `interaction-audit.mobile`, `visual.mobile` | Navigation within the native journeys above |

AI settings journeys keep the real app/backend and substitute external identity/inference. Assistant stream-shape cases simulate the app stream intentionally. Some forecast/report/digest presentation cases use fixed responses; backend tests remain responsible for calculation permutations, complete export contents and scheduler behavior. A successful download or visible chart alone is not proof of those properties.

## Diagnostics

Playwright writes `ui/playwright-report` and `ui/test-results`; open a trace with `cd ui && npx playwright show-trace test-results/<test>/trace.zip`. Native logs and `.xcresult` bundles are under `test-results/ios/<run>/` (open the result bundle in Xcode). CI retains failure traces and retry results.

Set `UI_POLISH_AUDIT_ARTIFACT_DIR` only when collecting optional visual audit evidence. Artifacts alone are not test coverage.
