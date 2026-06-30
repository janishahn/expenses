# iOS App Polish — Findings & Fix Log

## Summary

- **Phase:** 1 complete (map + verification gate). Phase 2 (per-surface audit/fix loop) not started.
- **Surfaces:** 0 / 38 audited (all Pending). Inventory coverage confidence: **high**.
- **Build status:** ✅ green (Debug, iPhone 17 Pro simulator). App installed + logged in (`test`, admin).
- **Findings (candidates from static mapping — not yet dynamically verified):**
  P0: 0 · P1: 0 · P2: 12 · P3: 12 · Total: 24 open candidates.
- **Method:** Candidates below were surfaced while reading code. Each will be **driven and verified
  in the simulator** during its surface's Phase-2 iteration before any fix — some may be downgraded
  or dismissed (e.g. an early "More list won't scroll" suspicion was a tooling artifact, not a bug).
- **Open questions for the user:**
  1. **F-001 (dead code):** `CategoriesView`, `RulesView`, `PlanningView` and the per-destination
     `quickAddTrigger` plumbing in RootView are unreachable. Delete them, or are they intended for
     a planned navigation change? (Out of strict "polish" scope; recommend deleting.)
  2. **F-018:** Diagnostics has no auth gate (Backend URL editable by anyone). Intended for a
     config/diagnostics screen, or should it sit behind auth like its siblings?

Severity: P0 broken · P1 major (wrong nav / unhandled state / broken layout / missing critical
feedback) · P2 polish · P3 nit.

---

### F-001 · App shell (RootView) · P3 · Completeness/code-health · Open
- What: `CategoriesView` (Organize.swift:3), `RulesView` (Organize.swift:118) and `PlanningView`
  (Planning.swift:123) are wired into `destinationView`/`#Preview` but have no navigation path.
  The reachable equivalents are `OrganizeView`, `DigestView`, `ForecastView`. The per-destination
  `quickAddTrigger` branches in `performQuickAdd()` for budgets/categories/rules/recurring can never
  fire because the Quick Add FAB only shows on Dashboard/Transactions.
- Where: App/RootView.swift:92-95, :188-202; Organize.swift:3,118; Planning.swift:123.
- Why it's a gap: dead code from an incomplete refactor; misleads maintainers, inflates surface area.
- Repro: static (grep-verified: `.categories`/`.rules` absent from all More section lists).
- Fix: Deferred — needs user decision (delete dead views + unused triggers, or keep for planned nav).
- Verified: n/a (static, grep-confirmed reachability).

### F-005 · Dashboard / Digest / Insights / Forecast / Budgets / Recurring · P2 · State coverage · Open
- What: A failed (or offline) primary load collapses into the same `ContentUnavailableView("No X
  loaded")` used for genuine emptiness — no error message, no retry. Error and empty are conflated.
- Where: DashboardView.swift:63-64; InsightsView.swift:57,63,69; PlanningView.swift (digest/forecast
  empty branches); BudgetsView.swift:42-43; RecurringView.swift:63-64.
- Why it's a gap: State coverage — error/offline must be distinct from empty (DESIGN: handle states
  deliberately). User sees benign emptiness when the network failed.
- Repro: TBD in Phase 2 — kill backend, pull-to-refresh, observe.
- Fix: TBD (shared treatment; audit siblings together per project convention).
- Verified: not yet.

### F-006 · Transactions · P2 · State coverage · Open
- What: When `transactions != nil` but the list is empty, no empty-state renders (ForEach shows
  nothing). Inbox empty shows "Open items: 0" with no guidance. "No transactions loaded" only fires
  when `transactions == nil`.
- Where: TransactionsView.swift:64-66, :69-72.
- Why it's a gap: empty state should guide to next action; a genuinely-empty list is blank.
- Repro: TBD — filter to a query with zero results.
- Fix: TBD.
- Verified: not yet.

### F-007 · Transactions (Deleted) · P3 · Consistency · Open
- What: Deleted-list income amount uses literal `.green` instead of the semantic theme color used
  elsewhere. (Pairs with F-023.)
- Where: TransactionsView.swift:1088.
- Why it's a gap: Layout/consistency — semantic colors must come from the shared theme.
- Repro: TBD.
- Fix: TBD (use ExpensesTheme semantic income color).
- Verified: not yet.

### F-008 · Insights (Flow / Durables) · P2 · State coverage · Open
- What: Flow and Durables sections have no loading placeholder; during load they render
  "No flow loaded" / "No durable purchases loaded" — a false-empty flicker. Charts has a loader.
- Where: InsightsView.swift:59-64, :65-70 (vs :54).
- Why it's a gap: loading must be distinct from empty; inconsistent with the Charts section sibling.
- Repro: TBD — switch to Flow/Durables with cold cache.
- Fix: TBD.
- Verified: not yet.

### F-009 · Budgets (Year) · P2 · Navigation & flow · Open
- What: On the Year tab, the "+" toolbar button and external quickAddTrigger fall back to `.override`
  (the Month Budget form) because `viewMode.defaultSheet` is nil for Year — opens an unexpected form.
- Where: BudgetsView.swift:51, :91-93 (with :151-160).
- Why it's a gap: row taps/buttons must do what the context implies; adding on Year opens a Month form.
- Repro: TBD — Budgets → Year → tap "+".
- Fix: TBD (disable "+" on Year, or route to the correct affordance).
- Verified: not yet.

### F-010 · Budgets · P3 · Consistency · Open
- What: Override removal has redundant entry points with inconsistent labels: row Menu "Remove
  override", swipe "Remove", dialog "Remove month budget?".
- Where: BudgetsView.swift:201, :307, :68-75.
- Why it's a gap: same control/job should read consistently.
- Repro: TBD.
- Fix: TBD (unify copy).
- Verified: not yet.

### F-011 · Recurring · P2 · Content & copy / consistency · Open
- What: (a) Rule form currency picker offers EUR/USD but every amount is rendered with
  `AppFormatters.euros(...)`, so a USD rule still shows "€". (b) Leading swipe label "Disable/Enable"
  actually toggles `autoPost`, while the row badge says "Auto/Manual" — mismatched vocabulary.
- Where: RecurringView.swift:220-223 (currency) vs :19-21/:142/:386; :36 (swipe) vs :145 (badge).
- Why it's a gap: copy must be unambiguous; a control's label must match its effect.
- Repro: TBD — create a USD rule; swipe a rule row.
- Fix: TBD (verify backend currency support before changing; may be a label-only fix).
- Verified: not yet.

### F-012 · Recurring · P3 · Interaction feedback · Open
- What: Swipe toggle/delete and the delete dialog fire async mutations with no inline success/failure
  feedback on the list; if `model.lastError` is set, nothing shows here.
- Where: RecurringView.swift:36-49, :97-101.
- Why it's a gap: mutation outcomes should be visible (optimistic vs confirmed; error surfaced).
- Repro: TBD.
- Fix: TBD.
- Verified: not yet.

### F-013 · Organize (Rules) · P3 · Content & copy · Open
- What: Rule row subtitle hardcodes the word "title" as the match field regardless of the rule's
  actual match configuration.
- Where: OrganizeView.swift:1234.
- Why it's a gap: label can misrepresent the rule.
- Repro: TBD — inspect a rule row.
- Fix: TBD (derive label from match field, or drop it).
- Verified: not yet.

### F-014 · Organize (Merge sheets) · P3 · State coverage · Open
- What: Category/Tag merge sheets render the global `model.lastError` inline but never clear it on
  entry — a stale error from an unrelated prior op can appear at the bottom of the form on open.
- Where: OrganizeView.swift:970-975, :1073-1078.
- Why it's a gap: error must reflect this surface's state, not leak global state.
- Repro: TBD — trigger an error elsewhere, then open a merge sheet.
- Fix: TBD (clear lastError on appear, or use a sheet-local error).
- Verified: not yet.

### F-015 · Assistant · P2 · Consistency · Open
- What: LLM-disabled state uses a raw `ContentUnavailableView` instead of the shared
  `UnavailableStateSection`; the empty-conversation state is a third hand-rolled empty pattern. The
  unauthenticated state right above it does use the shared `SignedOutStateSection`.
- Where: AssistantView.swift:30-37, :93-112 (vs :23).
- Why it's a gap: shared empty/unavailable chrome should be consistent within a screen and vs siblings.
- Repro: TBD — toggle EXPENSES_LLM_ENABLED off; open Assistant signed-out and empty.
- Fix: TBD.
- Verified: not yet.

### F-016 · Reconcile & Reports · P2 · State coverage / copy · Open
- What: Both screens can render two stacked red error sections simultaneously (`formError` +
  `model.lastError`), and `formError` is set to the raw `error.localizedDescription` (unmapped
  system string).
- Where: ReconciliationView.swift:42-57, :184; ReportsView.swift:117-150.
- Why it's a gap: one clear error per failure; no raw system-error dumps.
- Repro: TBD — force an import/report failure.
- Fix: TBD.
- Verified: not yet.

### F-017 · Reports · P2 · State coverage · Open
- What: No top-level loading/empty placeholder during the initial category fetch; the only progress
  indicator is the inline ProgressView in the Actions section. Category list is silently empty until
  loaded.
- Where: ReportsView.swift:155-159 (vs inline :112).
- Why it's a gap: loading must be visible at first paint.
- Repro: TBD — open Reports cold.
- Fix: TBD.
- Verified: not yet.

### F-018 · Diagnostics · P3 · Navigation & flow · Open
- What: No auth gate (unlike Admin/Reconcile/Reports). Editable Backend URL + "Reset to local backend"
  exposed unconditionally.
- Where: DiagnosticsView.swift:3.
- Why it's a gap: possibly intentional for a config screen; flagged for confirmation.
- Repro: static.
- Fix: Deferred — needs user decision (see Summary Q2).
- Verified: n/a.

### F-019 · Auth (signed-out) · P3 · State coverage · Open
- What: When `model.status` is nil, the Create-account/Setup buttons are disabled with the helper
  "Checking tracker status..." indefinitely — no timeout/retry affordance if status never loads.
- Where: AuthView.swift:204-212.
- Why it's a gap: a stuck "checking" state with no recovery.
- Repro: TBD — start app with backend unreachable, open Account.
- Fix: TBD.
- Verified: not yet.

### F-020 · Admin · P2 · Completeness / navigation · Open
- What: The "Preview" button in Latest Result is effectively dead. `storeDownload` sets
  `previewDocument`, which auto-presents the sheet; on dismiss SwiftUI nils the binding, so the
  `if let previewDocument` guard hides the button, and its body just reassigns the value to itself.
  Unlike Reports, Admin keeps no persistent `lastDocument`, so Preview never re-opens.
- Where: AdminView.swift:60-66 (vs ReportsView.swift:127-129).
- Why it's a gap: a control that does nothing / cannot function as labeled.
- Repro: TBD — Admin → download/export → after the auto-preview dismisses, try Preview.
- Fix: TBD (mirror Reports' persistent lastDocument, or remove the button).
- Verified: not yet.

### F-021 · Admin (logs) · P3 · Content & copy · Open
- What: Raw JSON `rawBody`/`prettyPayload()` dumped verbatim in monospaced Text; "Copy Request ID or
  Payload" label ambiguous (silently falls back to full payload when no request ID).
- Where: AdminView.swift:502-518.
- Why it's a gap: dev-style raw output; ambiguous action label. (Admin is a power-user surface — low.)
- Repro: TBD.
- Fix: TBD.
- Verified: not yet.

### F-022 · TransactionDetail · P2 · State coverage · Open
- What: If `loadTransactionDetail` fails, `transaction` stays nil and the view shows an infinite
  `ProgressView` with no error/retry/not-found state.
- Where: TransactionDetailView.swift:126-128, :196-198.
- Why it's a gap: a screen stuck spinning on failure.
- Repro: TBD — open a detail while backend errors.
- Fix: TBD.
- Verified: not yet.

### F-023 · TransactionDetail (Reimbursements) · P3 · Consistency · Open
- What: `reimbursementRow` amount is hardcoded `.green` even on the expense side, instead of the
  semantic theme color. (Pairs with F-007.)
- Where: TransactionDetailView.swift:611-612.
- Why it's a gap: semantic colors must come from the shared theme; expense isn't income-green.
- Repro: TBD.
- Fix: TBD.
- Verified: not yet.

### F-024 · TransactionForm · P3 · Interaction feedback · Open
- What: Save is only disabled by `model.isLoading`, never by form validity; an incomplete form looks
  tappable and fails at submit time.
- Where: TransactionFormView.swift:165-170, :225.
- Why it's a gap: disabled states should signal "not ready"; may be acceptable (verify against siblings).
- Repro: TBD — open create form blank, observe Save enabled.
- Fix: TBD (decide vs sibling forms; consistency matters more than the individual call).
- Verified: not yet.

### F-025 · ScenarioEditor (What-If) · P2 · State coverage · Open
- What: `runScenario()` discards the result (`_ = await …`); a scenario-run failure is never surfaced
  (no error label). Free-text month fields are validated only for non-empty (no format guidance).
- Where: PlanningView.swift:857-863, :769/:779.
- Why it's a gap: failed mutation silently does nothing; malformed input passes client validation.
- Repro: TBD — run a scenario while backend errors.
- Fix: TBD.
- Verified: not yet.

### F-026 · RecurringOccurrences · P2 · State coverage · Open
- What: A failed load keeps `data == nil` → indefinite `ProgressView`, no error. (Same family as F-022.)
- Where: RecurringView.swift:410-417.
- Why it's a gap: screen stuck spinning on failure.
- Repro: TBD.
- Fix: TBD.
- Verified: not yet.

### F-027 · LocalUnlockGate · P2 · Completeness / copy · Open
- What: In the `.unavailable` state the button reads "Check Settings" but its action just re-runs
  `evaluatePolicy()` (retry) — it does NOT open `UIApplication.openSettingsURLString`. The label
  promises navigation the handler doesn't perform.
- Where: LocalUnlockGate.swift:250, :323-326.
- Why it's a gap: a button whose label lies about what it does.
- Repro: hard to reach on simulator (biometrics unavailable); verify via code + a device note.
- Fix: TBD (open Settings, or relabel to "Try Again").
- Verified: not yet.

### F-028 · TransactionDetail · P3 · Content & copy · Open
- What: The description is rendered via `Text(.init(description))` → `LocalizedStringKey` markdown
  parsing, so user free-text containing `*`, `_`, `[]()` is reinterpreted as markdown.
- Where: TransactionDetailView.swift:33.
- Why it's a gap: user content shown differently than entered. (May be intentional if descriptions
  are meant to support markdown — verify against the web app's behavior.)
- Repro: TBD — add a description with `*stars*`.
- Fix: TBD (confirm intended; the web Transaction Row renders markdown, so this may be by design).
- Verified: not yet.
