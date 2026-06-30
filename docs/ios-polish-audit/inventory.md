# iOS App Polish — Surface Inventory

Source of truth worklist for the native SwiftUI app (`ios/ExpensesApp/ExpensesApp/**`).
Built by reading the code (RootView navigation spine + per-feature deep reads). Cross-checked
against grep enumeration of every `struct …: View`, `.sheet`, `.alert`, `.confirmationDialog`,
`.swipeActions`, `.toolbar`, `.refreshable`, `.searchable`, `Menu`, `Picker`, `NavigationLink`,
`navigationDestination`. See findings.md for the running fix log.

Status legend: Pending → In Progress → Audited (no issues) / Fixed / Deferred / Blocked.

Verification environment: backend `uv run dev` on :8000 (`llm_enabled=true`), mock DB seeded,
iPhone 17 Pro / iOS 26.4 simulator (UDID 7B6C7A40-2FCA-48C2-9804-19FAF28A5824), logged in as
`test` (admin). UI driven via the **`axe`** CLI bundled with XcodeBuildMCP
(`~/.npm/_npx/99336612077b7094/node_modules/xcodebuildmcp/bundled/axe`): `axe describe-ui --udid`
for the element tree + frames, `axe tap --label/-x -y`, `swipe`, `type`, `key`, `screenshot`.
Theme via `xcrun simctl ui booted appearance dark|light`, Dynamic Type via `… content_size <size>`.

## Navigation spine (RootView.swift)

5 primary tabs: **Dashboard, Transactions, Digest, Insights, More**. More groups:
Planning (Budgets, Forecast) · Manage (Recurring, Organize) · Tools (Assistant†, Reconcile,
Reports, Diagnostics) · Account (Account, Admin). Floating Quick Add FAB shows only on
Dashboard & Transactions; on other tabs it is hidden. † Assistant only listed when `llmEnabled`.

**Reachability note (verified):** `CategoriesView`, `RulesView` (Organize.swift) and
`PlanningView` (Planning.swift) are wired into `destinationView`/`#Preview` but are **not
reachable** by any navigation path — superseded by `OrganizeView`, `DigestView`, `ForecastView`.
See finding F-001. They are excluded from the reachable-surface rows below.

| ID | Tab/Group | Surface (View) | File:line | User stories / paths | Key states | Gated by | Status | Finding IDs | Last verified |
|----|-----------|----------------|-----------|----------------------|------------|----------|--------|-------------|---------------|
| S-01 | Root | App shell / TabView + Quick Add FAB | App/RootView.swift:3 | switch 5 tabs; More→push destinations; Quick Add FAB (impact-light haptic) → transaction sheet (only Dashboard/Transactions); FAB disabled+dimmed when unauthenticated; tabBar hides for Assistant | success, unauthenticated | authenticated (FAB) | Pending | F-001 | — |
| S-02 | Dashboard | DashboardView | Features/Dashboard/DashboardView.swift:4 | period segmented picker (This/Last/All); incognito eye toggle (@AppStorage); tap recent row → TransactionDetail; pull-to-refresh; read-only overview/budgets/durables/breakdown rings | loading, empty, success, partial, unauthenticated, (error→empty) | authenticated | Audited | F-005(deferred), F-029 | 2026-06-30 |
| S-03 | Transactions | TransactionsView (list) | Features/Transactions/TransactionsView.swift:3 | mode Menu (Current/Inbox/Deleted); searchable + live search; LLM Ask search; filters sheet; filter summary clear; row→detail; Select/bulk mode; bulk bar (page/clear/bulk edit); inbox triage+suggest; deleted restore/delete-forever (swipe+menu+dialog); pull-refresh | loading(active only), empty, success, partial, error(LLM only), unauthenticated | authenticated; llmEnabled (Ask, suggestions) | Fixed | F-006, F-007 | 2026-06-30 |
| S-04 | Digest | DigestView | Features/Planning/PlanningView.swift:3 | prev/next week toolbar chevrons (disabled when digest nil); pull-refresh; read-only headline/categories/budget-pulse/flagged/auto-posted | loading, empty, success, unauthenticated, (error→empty) | authenticated | Fixed | F-005(deferred), F-030 | 2026-06-30 |
| S-05 | Insights | InsightsView | Features/Insights/InsightsView.swift:4 | section segmented picker (Charts/Flow/Durables); filters sheet (toolbar + summary chip + clear); trend category picker; pull-refresh; read-only charts/breakdown/flow/durables | loading(all 3 sections), empty, success, partial, unauthenticated, (error→empty) | authenticated | Fixed | F-005(deferred), F-008 | 2026-06-30 |
| S-06 | Planning | BudgetsView (+Month/Year/Recurring) | Features/Budgets/BudgetsView.swift:3 | mode segmented picker (Month/Recurring/Year); + add (sheet by mode, disabled on Year); override remove (swipe+menu+dialog); template delete (swipe+menu+dialog); pull-refresh; quickAddTrigger | loading, empty, success, partial, unauthenticated, (error→empty) | authenticated | Fixed | F-009, F-010 | 2026-06-30 |
| S-07 | Planning | ForecastView | Features/Planning/PlanningView.swift:76 | horizon picker (3/6/12); mode picker (recurring/full); What-If→scenario sheet; per-month DisclosureGroups; pull-refresh | loading, empty, success, unauthenticated, (error→empty) | authenticated | Audited | F-005(deferred) | 2026-06-30 |
| S-08 | Manage | RecurringView (list) | Features/Recurring/RecurringView.swift:3 | + add rule; row→occurrences; swipe Manual/Auto(autoPost) + edit; swipe delete + dialog; pull-refresh; quickAddTrigger; read-only stats/mix | loading, empty, success, unauthenticated, (error→empty) | authenticated | Fixed | F-011a, F-031, F-011b(def), F-012(def) | 2026-06-30 |
| S-09 | Manage | OrganizeView (Cat/Tags/Templates/Rules) | Features/Organize/OrganizeView.swift:227 | section segmented picker; + context add; category row edit/archive swipe + merge + archived link; tag edit/delete swipe + merge; template edit/delete swipe + onMove reorder; rule edit/toggle/delete swipe; LLM rule suggestions (mine/accept/reject); 3 delete dialogs; pull-refresh | success, unauthenticated; (no loading/error state) | authenticated; llmEnabled (suggestions) | Fixed | F-014, F-013(dismissed) | 2026-06-30 |
| S-10 | Tools | AssistantView | Features/Assistant/AssistantView.swift:4 | composer TextField; send (impact-light); stop stream (rigid); starter prompts; new chat toolbar; activity disclosure; text selection; streaming/working/tool-ticker | unauthenticated, unavailable(LLM off), empty, streaming/working, success, partial(stopped), error(per-turn) | authenticated; llmEnabled | Pending | F-015 | — |
| S-11 | Tools | ReconciliationView | Features/Reconciliation/ReconciliationView.swift:4 | account label field; choose CSV (fileImporter); preview; commit (destructive+dialog); per-bank-row accept/create/review/reopen; pull-refresh | loading, empty, success, error(double), unauthenticated | authenticated | Pending | F-016 | — |
| S-12 | Tools | ReportsView | Features/Reports/ReportsView.swift:3 | date range pickers; section toggles; tx type/sort/balance/subtotal/cents; category mode + per-cat toggles; notes; generate PDF; export CSV; latest file preview/share; pull-refresh | success, error(double), partial, unauthenticated; (no top-level loading) | authenticated | Pending | F-016, F-017 | — |
| S-13 | Tools | DiagnosticsView | Features/Diagnostics/DiagnosticsView.swift:3 | backend URL field; test connection; reset to local; read-only backend/session; pull-refresh; loading overlay | loading, success, error | none (ungated) | Pending | F-018 | — |
| S-14 | Account | AuthView (signed-in + signed-out) | Features/Auth/AuthView.swift:5 | OUT: username/password/setup-token/device fields; login/setup/signup. IN: identity rows; logout; ingest token create/rotate/revoke/copy; CSV import; balance snapshots CRUD; mobile sessions revoke; appearance picker; pull-refresh | loading, success, empty(token), partial(result), error, unauthenticated | authenticated (in/out branch) | Pending | F-019 | — |
| S-15 | Account | AdminView (+ elevation) | Features/Admin/AdminView.swift:5 | elevate (password); db backup; export CSV; purge/rebuild/catch-up (destructive+dialog); legacy .db import preview+commit; logs filter/search/paginate; log row→detail; latest result preview/share; pull-refresh | unauthenticated, role(non-admin), not-elevated, loading, partial, success, error | authenticated; admin role; elevation | Pending | F-020, F-021 | — |
| S-16 | Modal | TransactionDetailView | Features/Transactions/TransactionDetailView.swift:7 | summary; markdown description; location map; tags; reimbursements sub-flow; receipts (files/photos/camera) add; attachment preview/delete (swipe+buttons+dialog); edit→form; delete→dialog | loading(spinner), error(inline), empty(receipts), success | authenticated (context) | Pending | F-022, F-023 | — |
| S-17 | Modal | TransactionFormView (create+edit) | Features/Transactions/TransactionFormView.swift:4 | templates (create); type picker; date; amount; category; title/desc/tags; reimbursement toggle(income); location toggle/remove; save (success/error haptic); cancel | error(validation), loading(save disabled), success | authenticated (context) | Pending | F-024 | — |
| S-18 | Modal | TransactionFiltersSheet | Features/Transactions/TransactionsView.swift:474 | type/category/tag pickers; Reset (disabled when none); Done apply | form only | reachable when listMode≠deleted | Pending | F-006 | — |
| S-19 | Modal | BulkEditSheet | Features/Transactions/TransactionsView.swift:808 | apply-to picker; lifecycle; set category; tags mode; tag names; preview; apply (destructive+dialog); close | error(form), success, (no loading) | authenticated (context) | Pending | — | — |
| S-20 | Modal | ScenarioEditorSheet (What-If) | Features/Planning/PlanningView.swift:623 | type picker (5 kinds); dynamic fields; add adjustment; list+swipe delete; run scenario; impact section; done/clear | loading, empty, partial(validation), success, error | authenticated (context) | Fixed | F-025 | 2026-06-30 |
| S-21 | Modal | BudgetOverrideFormView | Features/Budgets/BudgetsView.swift:381 | category picker; amount; save/cancel | error(validation), loading, success | authenticated (context) | Pending | — | — |
| S-22 | Modal | BudgetTemplateFormView | Features/Budgets/BudgetsView.swift:452 | frequency; category; amount; starts/ends date; has-end toggle; save/cancel | error(validation), loading, success | authenticated (context) | Pending | — | — |
| S-23 | Modal | RecurringRuleFormView | Features/Recurring/RecurringView.swift:160 | name; type; currency(EUR/USD); amount; category; start; interval stepper+unit; end toggle/date; auto-post; skip weekends; missing-day; preview schedule; save/cancel | error(validation), loading, success | authenticated (context) | Audited | F-011b(def) | 2026-06-30 |
| S-24 | Modal | RecurringOccurrencesView | Features/Recurring/RecurringView.swift:374 | read-only rule detail + posted tx list; pull-refresh | loading(spinner), empty, error, success | authenticated (context) | Fixed | F-026 | 2026-06-30 |
| S-25 | Modal | CategoryFormView | Features/Organize/OrganizeView.swift:1294 | name; type(create only); icon picker; save/cancel | error(validation), loading, success | authenticated (context) | Audited | — | 2026-06-30 |
| S-26 | Modal | TagFormView | Features/Organize/OrganizeView.swift:1382 | name; color; hidden-from-budgets toggle; save/cancel | error(validation), loading, success | authenticated (context) | Audited | — | 2026-06-30 |
| S-27 | Modal | TemplateFormView | Features/Organize/OrganizeView.swift:1451 | name; type; category; amount; title; tags; save/cancel | error(validation), loading, success | authenticated (context) | Audited | — | 2026-06-30 |
| S-28 | Modal | RuleFormView | Features/Organize/OrganizeView.swift:1585 | name; auto toggle; priority; match type/value/tx-type/min/max; set category; add tags; exclude budget; preview matches; save/cancel | error(validation), empty(preview), loading, success | authenticated (context) | Audited | — | 2026-06-30 |
| S-29 | Modal | CategoryMergeView | Features/Organize/OrganizeView.swift:914 | source/target pickers; preview counts; merge (destructive+dialog); cancel | error(inline lastError), loading, partial, success | authenticated; ≥2 categories | Fixed | F-014 | 2026-06-30 |
| S-30 | Modal | TagMergeView | Features/Organize/OrganizeView.swift:1026 | source/target pickers; preview counts; merge (destructive+dialog); cancel | error(inline lastError), loading, partial, success | authenticated; ≥2 tags | Fixed | F-014 | 2026-06-30 |
| S-31 | Push | ArchivedCategoriesView | Features/Organize/OrganizeView.swift:76 | row edit→sheet; restore swipe; edit swipe; sort menu; pull-refresh | loading, empty, success, unauthenticated, (error→empty) | authenticated | Audited | — | 2026-06-30 |
| S-32 | Modal | InsightsFiltersSheet | Features/Insights/InsightsView.swift:203 | period/type/tag pickers; Reset (disabled when none); Done apply | form only | reachable when section≠durables | Pending | — | — |
| S-33 | Sub-flow | ReimbursementsSection (in Detail) | Features/Transactions/TransactionDetailView.swift:505 | mark income as reimbursement; search expenses; allocate amount; delete allocation (dialog); expense-side net cost | loading, empty, error(inline), success | authenticated (context) | Pending | F-023 | — |
| S-34 | Modal | AdminLogDetailView | Features/Admin/AdminView.swift:485 | read-only summary/body/payload (raw JSON); copy req-id/payload; share JSON | success only | admin+elevated (context) | Pending | F-021 | — |
| S-35 | Modal | CameraCaptureView | Shared/CameraCaptureView.swift:4 | UIImagePickerController camera; capture→onCapture; cancel | success, cancel (UIKit) | camera availability | Pending | — | — |
| S-36 | Modal | DocumentPreviewView | Shared/DocumentPreviewView.swift:9 | QLPreviewController; Done dismiss | single-item (QuickLook) | — | Pending | — | — |
| S-37 | Gate | LocalUnlockGate / LocalUnlockView | Shared/LocalUnlockGate.swift:5 | wraps content; auto/retry unlock; privacy cover; grace re-lock | locked, authenticating, unlocked, failed, unavailable | hasStoredToken & not skip-flag | Pending | F-027 | — |
| S-38 | Overlay | PrivacyOverlayModifier | Shared/PrivacyOverlayModifier.swift:3 | snapshot shield when inactive | backgrounded, active | scenePhase | Pending | — | — |

## Coverage cross-check (Phase 1 gate)

Grep enumeration reconciled against rows above:
- `.sheet(` ×18, `.confirmationDialog` ×17, `.swipeActions` ×18, `.alert(` ×1, `.refreshable` ×17,
  `.searchable` ×1, `navigationDestination` ×3, `#Preview` ×11. All map to surfaces above.
- `.fullScreenCover` ×0, `.contextMenu` ×0 (none used).
- Shared chrome (GlassSurface.swift: ExpensesBackground/ScreenStyle/GlassSurface/
  UnavailableStateSection/SignedOutStateSection/LoadingStateSection/MetricPill) is reusable
  empty/loading/unavailable scaffolding, not a reachable surface — referenced by the rows above.
- LLM sub-surfaces (NL search, inbox triage, rule suggestions) are folded into S-03 and S-09.
- Coverage confidence: **high** — every top-level View struct, navigation destination, sheet,
  alert, swipe action, and toolbar button is represented; unreachable views (F-001) are documented
  rather than listed as live surfaces.
