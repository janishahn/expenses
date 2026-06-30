# iOS App Polish — Findings & Fix Log

## Summary

- **Phase:** 2 (per-surface audit/fix loop) in progress.
- **Surfaces:** 2 / 38 done — **S-02 Dashboard ✅ Audited**, **S-03 Transactions ✅ Fixed**
  (F-006, F-007). Inventory coverage confidence: **high**.
- **Build status:** ✅ green (Debug, iPhone 17 Pro simulator). App installed + logged in (`test`, admin).
- **Findings:** total 26 (F-001, F-005–F-029). By status — Fixed: 2 (F-006, F-007). Deferred (need
  user decision): 3 (F-001, F-005, F-018). Open candidates (await their surface's turn): 21.
  By severity of still-open items: P2: 9 · P3: 11.
- **Method:** Candidates were surfaced while reading code; each is **driven and verified in the
  simulator** on its surface's turn before any fix — some get downgraded or dismissed (e.g. the
  "More list won't scroll" suspicion was a tooling artifact).
- **UI-driver upgrade (this session):** switched from the hand-rolled CoreGraphics `simui.py` to the
  **`axe`** CLI bundled with XcodeBuildMCP (`~/.npm/_npx/99336612077b7094/node_modules/xcodebuildmcp/
  bundled/axe`). `axe describe-ui --udid <UDID>` returns the real iOS accessibility tree with
  device-point frames (no coordinate calibration); `axe tap --label "<AXLabel>"` / `tap -x -y` /
  `swipe` / `type` / `key` / `gesture` / `screenshot` drive the app via the simulator's real HID, so
  it reliably actuates UIKit-backed controls (e.g. the segmented period picker that `simui.py`
  couldn't) — confirming that picker is a working control, not an app bug.
- **Open questions for the user (parked — loop continues on unaffected surfaces meanwhile):**
  1. **F-001 (dead code):** `CategoriesView`, `RulesView`, `PlanningView` and the per-destination
     `quickAddTrigger` plumbing in RootView are unreachable. Delete them, or are they intended for
     a planned navigation change? (Out of strict "polish" scope; recommend deleting.)
  2. **F-018:** Diagnostics has no auth gate (Backend URL editable by anyone). Intended for a
     config/diagnostics screen, or should it sit behind auth like its siblings?
  3. **F-005 (error-vs-empty state, 6 surfaces):** A failed primary load with no cache shows the
     generic "No X loaded" empty card instead of a distinct error. The common case (refresh failure
     with cached data) is already graceful (stale data retained); only the rare cold-load-failure
     hits it, and it is **not reproducible on-simulator** (auth + data share one backend). Recommend
     a minimal shared fix — distinguish the `.failed` load state and reuse the existing
     `UnavailableStateSection` with the error message (no new pattern). Implement across Dashboard /
     Digest / Insights / Forecast / Budgets / Recurring, or leave as-is? Deferred because it spans 6
     shared surfaces and the fixed state can't be dynamically verified here.

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

### F-005 · Dashboard / Digest / Insights / Forecast / Budgets / Recurring · P2 · State coverage · Deferred
- What: A failed primary load with no cached data collapses into the same
  `ContentUnavailableView("No X loaded")` used for genuine emptiness — no error message, no retry.
  Error and empty are conflated. (Mechanism confirmed: on failure with `!hadContent`,
  `dashboardLoadState = .failed` and `lastError` is set, but `showsInitialPlaceholder` is false for
  `.failed`, so the view falls to the generic `else` empty branch — the error data exists, unused.)
- Where: DashboardView.swift:63-64 (confirmed); InsightsView.swift:57,63,69; PlanningView.swift
  (digest/forecast empty branches); BudgetsView.swift:42-43; RecurringView.swift:63-64.
- Why it's a gap: State coverage — error/offline should be distinct from empty. BUT the common
  failure (refresh with cached data) is already graceful: `if !hadContent` guards the `.failed`
  transition, so a failed refresh retains stale data. Only the rare cold-load-failure-while-authed
  hits the generic empty card.
- Repro: **Not reproducible on-simulator.** Auth (`loadCurrentSession` → live `mobileMe` call) and
  data share one backend, so a cold start with the backend down yields "Sign in required" (unauth),
  never the authed-but-data-failed branch. Triggering only the data endpoint to fail needs backend
  mutation (out of scope).
- Fix: **Deferred — needs user decision** (see Summary Q3). Recommended minimal fix: add a precise
  `dashboardLoadFailed` computed (`dashboard == nil && state == .failed`) and, in the `else` branch,
  show `UnavailableStateSection(title: "Couldn't load dashboard", systemImage:
  "exclamationmark.triangle", message: lastError?.message ?? …)` — reuses existing chrome, no new
  pattern. Apply consistently across the 6 sibling surfaces.
- Verified: n/a — fixed state can't be observed on-simulator; not implemented to avoid claiming an
  unverifiable fix.

### F-029 · Dashboard (BudgetPaceCompactRow) · P3 · Layout & visual fit · Open
- What: At `accessibility-extra-large` Dynamic Type, the Projected pace figures truncate to
  "1.215… of 2.5…" and "Velocity" crowds the row. No clipping/overflow of the card; progress bar and
  velocity multiplier stay visible.
- Where: DashboardView.swift:117 (`BudgetPaceCompactRow`), rendered at :26-28.
- Why it's a gap: DESIGN asks layouts to survive large Dynamic Type without awkward truncation;
  borderline-acceptable at this extreme AX size but the currency figure is lost.
- Repro: `xcrun simctl ui booted content_size accessibility-extra-large`, open Dashboard. (Observed
  — screenshot s02-dark-xl.png.)
- Fix: Deferred as low-value P3 (extreme AX size only; private Dashboard row). Candidate: allow the
  pace figures to wrap or reduce to a vertical layout at AX sizes. Not fixed this pass.
- Verified: observed at AX-XL; no fix applied.

### F-006 · Transactions · P2 · State coverage · Fixed
- What: When `model.transactions` was loaded but `items` was empty (e.g. a search/filter with zero
  results), the list rendered nothing — a blank screen below the search bar. Uncategorized empty
  showed "Open items: 0" with no guidance.
- Where: TransactionsView.swift active case (was :54-66), uncategorized case (was :67-95).
- Why it's a gap: State coverage — empty must be handled distinctly and guide the next action;
  a blank screen reads as broken/stuck. (Deleted mode already had a proper empty state, so this was
  also a within-surface inconsistency.)
- Repro: Transactions → search "Zzqqxxnope" → blank below the bar (screenshot s03-empty-search.png).
- Fix: Active case now branches on `transactions.items.isEmpty`: a contextual
  `ContentUnavailableView` — "No matching transactions / Try a different search or clear your
  filters." when `hasActiveQueryOrFilters` (new computed), else "No transactions yet / Add your
  first transaction with the + button." Uncategorized case shows an "Inbox zero / Every transaction
  has a category." card when `transactions.total == 0`. Reuses the existing `ContentUnavailableView`
  pattern already used by this view (no new component).
- Verified: ✅ rebuilt (green), relaunched. Zero-result search → "No matching transactions"
  (s03-empty-fixed.png); empty inbox → "Inbox zero" (s03-inbox.png); non-empty modes unregressed.

### F-007 · Transactions (Deleted) · P3 · Consistency / Layout · Fixed
- What: Deleted-list amount used `transaction.type == "income" ? .green : .primary` — a literal
  system green for income and an un-themed `.primary` (black/white) for expenses, instead of the
  semantic `ExpensesTheme.income/expense(for: scheme)` the canonical `TransactionRow` (and the rest
  of the app) uses. Internally inconsistent (income colored, expense not) and off-theme.
- Where: TransactionsView.swift:1088 (now :1118) in `DeletedTransactionsList`.
- Why it's a gap: DESIGN — semantic green/red for income/expense, sourced from the shared theme.
- Repro: Transactions → Deleted → expense amounts were neutral black, not the theme red.
- Fix: Added `@Environment(\.colorScheme)` to `DeletedTransactionsList` and switched the amount to
  `transaction.type == "income" ? ExpensesTheme.income(for: scheme) : ExpensesTheme.expense(for:
  scheme)`, matching `TransactionRow`.
- Verified: ✅ rebuilt (green). Deleted expenses now render theme red in light (s03-deleted.png) and
  the warm dark-mode red in dark (s03-deleted-dark.png).

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
