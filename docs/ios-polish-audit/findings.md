# iOS App Polish — Findings & Fix Log

## Summary

- **Phase:** 2 (per-surface audit/fix loop) in progress.
- **Surfaces:** 26 / 38 done — Dashboard (Audited), Transactions, Digest, Insights, Budgets,
  Forecast(+ScenarioEditor), Recurring(+RuleForm, Occurrences), Organize(+merges, forms),
  Assistant(+LLM-off pass), Reconcile, Reports(+DocumentPreview), Diagnostics, Account
  (F-016 extended; F-019 deferred), **Admin ✅ Fixed** (S-15 + S-34 AdminLogDetail; F-020 re-openable
  preview, F-021 clearer log copy, F-016 extended). Confidence: **high**.
- **Build status:** ✅ green (Debug, iPhone 17 Pro simulator). App installed + logged in (`test`, admin).
- **Findings:** total 30 (F-001, F-005–F-032). By status — Fixed: 15 (F-006, F-007, F-008, F-009,
  F-010, F-011a, F-014, F-015, F-016 [Reconcile+Reports+Account+Admin], F-020, F-021, F-025, F-026,
  F-030, F-031). Won't-fix: 2 (F-013, F-017). Deferred (need user decision): 6 (F-001, F-005, F-011b,
  F-012, F-018, F-019). Open candidates (await their surface's turn): 5 (F-022, F-023, F-024, F-028;
  F-027 Local unlock). By severity of still-open items: P2: 2 (F-022, F-027) · P3: 3 (F-023, F-024,
  F-028). Cross-surface follow-up: PlanningView.swift:545,567 income/expense literal colors.
- **Loading-state verification technique:** because localhost loads are sub-frame, loading
  placeholders are observed by suspending the backend worker (`kill -STOP <pid>` / `-CONT` to
  resume) so the request hangs while the loading card is captured.
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
  4. **F-011b (Recurring currency, EUR/USD):** The rule form lets you pick a per-rule currency, but
     amounts always display in € and the monthly stats sum across currencies as if all EUR. Drop USD
     from the mobile form (euro-only), display per-rule symbols (stats still can't sum mixed
     currencies meaningfully), or leave as-is? Also F-012 (mutation-failure feedback) folds into the
     F-005 error-surfacing decision.
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

### F-030 · Digest · P3 · Accessibility · Fixed
- What: The prev/next-week toolbar chevrons exposed only the SF Symbol default accessibility labels
  "Back" / "Forward" — ambiguous for week navigation (VoiceOver reads "Back button", which suggests
  dismissing the screen rather than stepping to the previous week).
- Where: PlanningView.swift:26-43 (DigestView toolbar).
- Why it's a gap: DESIGN/Accessibility — icon-only controls should carry descriptive accessibility
  labels that name the action, not the glyph.
- Repro: Digest → `describe-ui` showed the chevron buttons as AXLabel "Back"/"Forward".
- Fix: Added `.accessibilityLabel("Previous week")` / `.accessibilityLabel("Next week")` to the two
  chevron buttons. (Digest is the only reachable week-nav surface, so no sibling to mirror.)
- Verified: ✅ rebuilt (green), relaunched; `describe-ui` now reports the buttons as "Previous week"
  and "Next week". Week navigation, light/dark, and large Dynamic Type all render correctly
  (s04-digest-lastweek / s04-digest-dark / s04-digest-xl).

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

### F-008 · Insights (Flow / Durables) · P2 · State coverage · Fixed
- What: The Flow and Durables sections had no loading branch — a cold section switch went straight
  from `if let data` to the "No flow loaded" / "No durable purchases loaded" empty card, so during
  the fetch the user saw a false "empty" state. Charts already had a `LoadingStateSection`. On fast
  localhost the window is sub-frame, but on the project's target slow hardware (Raspberry Pi-class)
  it is a visible, misleading beat.
- Where: InsightsView.swift Flow case (:59) and Durables case (:65), vs Charts (:54).
- Why it's a gap: loading must be distinct from empty (DESIGN: handle states deliberately) and
  consistent with the Charts sibling on the same screen.
- Repro: suspend the backend worker (`kill -STOP <pid>`), switch to a cold section → previously the
  empty card showed.
- Fix: Added `else if model.isLoading { LoadingStateSection(title: "Loading flow" / "Loading durable
  purchases") }` before the empty branch in both cases, mirroring Charts.
- Verified: ✅ rebuilt (green). With the backend worker suspended, the cold Durables switch now shows
  the glass "Loading durable purchases" card (screenshot s05-durables-loading.png); on resume the
  data loads normally (no regression). Light/dark + large Dynamic Type all render correctly.

### F-009 · Budgets (Year) · P2 · Navigation & flow · Fixed
- What: On the Year tab, tapping "+" opened the "Set Month Budget" (override) form — because Year's
  `defaultSheet` is nil and the button fell back to `?? .override`. An illogical click-through
  (Year budgets are read-only/computed; there is no Year add).
- Where: BudgetsView.swift:51 (toolbar), :91-93 (quickAddTrigger), with :151-160 (defaultSheet).
- Why it's a gap: a control must do what its context implies; "+" on Year opened a Month form.
- Repro: Budgets → Year → tap "+" → "Set Month Budget" sheet appeared (screenshot s06-year-add.png).
- Fix: The "+" now only presents a sheet when `viewMode.defaultSheet != nil`, and is `.disabled`
  when it is nil (Year). Mirrored the same guard on the quickAddTrigger path. Disabling (vs hiding)
  keeps the toolbar stable across tab switches.
- Verified: ✅ rebuilt (green). On Year, `describe-ui` reports the Add Budget button `enabled: false`
  and tapping it opens no form; Month/Recurring still open their correct forms.

### F-010 · Budgets · P3 · Consistency · Fixed
- What: The override-budget row Menu read "Remove override" — internal jargon ("override") that
  disagreed with the row's own subtitle "Month budget", the swipe action "Remove", and the dialog
  "Remove month budget?" / "Remove Month Budget".
- Where: BudgetsView.swift:307 (menu) vs :201 (swipe) vs :68-69 (dialog) vs :298 (row subtitle).
- Why it's a gap: the same action should read consistently and avoid dev jargon.
- Repro: Budgets → Month → row "…" menu showed "Remove override".
- Fix: Menu label "Remove override" → "Remove Month Budget", matching the dialog button and the row
  subtitle. (Swipe stays the conventional short "Remove"; the menu + dialog now agree. The dual
  menu+swipe affordance is the same pattern the deleted-transactions list uses, so it stays.)
- Verified: ✅ rebuilt (green); `describe-ui` of the opened row menu now reports "Remove Month Budget".

### F-011a · Recurring · P2 · Content & copy · Fixed
- What: The leading-swipe label "Disable/Enable" actually toggles `autoPost` (the row badge says
  "Auto/Manual"), so the verb implied enabling/disabling the rule itself rather than auto-posting.
- Where: RecurringView.swift:36 (swipe) vs :145 (badge).
- Why it's a gap: a control's label must match its effect and the surrounding vocabulary.
- Repro: Recurring → swipe a rule from the left → button read "Disable".
- Fix: Swipe label `rule.autoPost ? "Disable" : "Enable"` → `rule.autoPost ? "Manual" : "Auto"`,
  matching the row's "Auto/Manual" badge (the swipe offers the opposite posting mode).
- Verified: ✅ rebuilt (green); `describe-ui` of the revealed leading swipe now reports "Manual".

### F-011b · Recurring · P2 · Content & copy / backend contract · Deferred
- What: The rule form has a Currency picker (EUR/USD) bound to the real `RecurringRule.currencyCode`,
  but every amount on the Recurring screens is rendered with `AppFormatters.euros(...)` (always €),
  and the Monthly stats (Income/Expenses/Net) sum across rules ignoring currency.
- Where: RecurringView.swift:220-223 (picker) vs :19-21/:57/:142/:386 (euro-only display).
- Why it's a gap: a USD rule displays as € and is summed as if EUR — but fixing it properly needs
  per-rule symbol formatting AND a decision on mixed-currency aggregation (you can't meaningfully
  sum EUR+USD without FX). That's a product/backend-contract decision, not a polish fix.
- Fix: **Deferred — needs user decision** (Summary Q4): (a) drop USD from the mobile form (euro-only),
  (b) format each amount with its currency symbol but acknowledge stats can't sum mixed currencies,
  or (c) leave as-is. Recommend (a) unless the backend actually supports multi-currency reporting.
- Verified: n/a.

### F-031 · Recurring (RecurringRuleRow) · P3 · Consistency / Layout · Fixed
- What: The rule-row amount used `rule.type == "income" ? .green : .primary` — a literal system green
  for income and an un-themed `.primary` (so expenses rendered plain black, not the semantic red used
  on every other transaction surface). Same anti-pattern as F-007.
- Where: RecurringView.swift:144.
- Why it's a gap: DESIGN — semantic green/red for income/expense from the shared theme.
- Repro: Recurring → expense rules (Rent, Gym, …) showed black amounts, not red.
- Fix: Added `@Environment(\.colorScheme)` to `RecurringRuleRow` and switched to
  `ExpensesTheme.income/expense(for: scheme)`, like the canonical `TransactionRow`.
- Verified: ✅ rebuilt (green). Dark theme now shows income green and expenses the warm theme red
  (s08-recurring-dark). Light/large Dynamic Type OK.
- Note: the same literal-color pattern for income/expense also exists at PlanningView.swift:545,567
  (Forecast month breakdown rows, `? .green : .red`) — tracked here; will fix in a small consistency
  pass without re-auditing that surface.

### F-012 · Recurring · P3 · Interaction feedback · Deferred
- What: Swipe toggle/delete and the delete dialog fire async mutations with no inline failure feedback
  on the list. On success the list visibly updates (the rule changes/disappears); on failure nothing
  shows (lastError set but not surfaced here).
- Where: RecurringView.swift:36-49, :97-101.
- Why it's a gap: mutation failures should be visible. BUT this is the same app-wide question as F-005
  (how to surface async-mutation errors on list screens — toast vs inline banner). The success case
  already gives visible feedback via the list update.
- Fix: Deferred — folds into the shared error-surfacing decision (see F-005). Not worth a one-off
  pattern here; resolve once for all list screens.
- Verified: n/a.

### F-013 · Organize (Rules) · P3 · Content & copy · Won't-fix (not a bug)
- What: Suspected the rule-row subtitle "title `<matchType>` 'value'" hardcoded "title" misleadingly.
- Where: OrganizeView.swift:1234.
- Resolution: **Dismissed.** Rules only match on the transaction *title* — the rule form's sole
  text-match field is "Title text". So "title" accurately names the matched field. Confirmed live:
  rows read "Priority 10 · title contains 'netflix'", "title regex 'uber|bolt'", etc. The label is
  correct; no change made.

### F-014 · Organize (Merge sheets) · P3 · State coverage · Fixed
- What: The Category/Tag merge sheets render the global `model.lastError` inline but never cleared it
  on entry — a stale error from an unrelated prior operation could appear at the bottom on open.
- Where: OrganizeView.swift:970-975 (CategoryMerge), :1073-1078 (TagMerge).
- Why it's a gap: the error shown should reflect this sheet's own operations, not leak global state.
- Fix: Added `.onAppear { model.lastError = nil }` to both merge sheets, so each opens with a clean
  error slate; preview/merge failures still set and show it afterward.
- Verified: ✅ rebuilt (green). The Tag merge sheet opens cleanly (Source/Target pickers, Merge/Preview
  correctly disabled, no error text) — no regression (s09-tagmerge2). The stale-error-clearing is
  correct by construction; the exact stale-error trigger (an unrelated error with no intervening
  clearing load, then opening merge) is a narrow edge case not easily staged on localhost.

### F-015 · Assistant · P2 → P3 · Consistency · Fixed (chrome) / partly dismissed
- What: The LLM-disabled state used a raw `ContentUnavailableView`, while the signed-out state right
  above it (line 23) uses the shared glass `SignedOutStateSection` — two "unavailable" states on one
  screen with different chrome.
- Where: AssistantView.swift:30-37 (vs :23).
- Fix: LLM-disabled state now uses `UnavailableStateSection(title: "Assistant unavailable",
  systemImage: "sparkles", message: "LLM features are turned off.")`, matching the signed-out chrome.
- Empty-conversation state (:93-112): **dismissed** — it's an intentional guiding first-use state
  (bubble icon + tappable starter prompts), not an "unavailable" state, so a custom VStack is correct
  (ContentUnavailableView/UnavailableStateSection can't host the interactive prompts as cleanly).
- Verified: ✅ rebuilt (green). The reachable Assistant states were driven live and are all polished:
  empty/first-use (starter prompts), streaming ("Thinking…" + red Stop, Send↔Stop swap), per-turn
  error ("The spending assistant is temporarily unavailable" in red), and New-chat reset. Haptics
  verified by code: send `.impact(.light)`, stop `.impact(.rigid)`, both on the stable composer HStack
  driven by sendTick/stopTick counters — exactly per DESIGN. NOTE: the LLM-*disabled* branch itself is
  nearly unreachable (the More>Tools Assistant entry is hidden when `llmEnabled` is false), so it only
  shows if `llmEnabled` flips false while the Assistant screen is already open — the fix is a harmless
  consistency improvement for that edge case and was not directly observable.

### F-032 · Cross-cutting · LLM-off gating · Audited (note)
- What: Verified the `EXPENSES_LLM_ENABLED=off` behavior by restarting the backend with the flag off
  and relaunching the app: AI surfaces are **cleanly absent**, not visible-but-broken — no Assistant
  entry in More>Tools (Tools = Reconcile/Reports/Diagnostics only), no "Ask" natural-language search
  row in Transactions, no "Mine"/rule-suggestions card in Organize>Rules. Backend restored to
  `llm_enabled=true` afterward. (Inbox triage Suggest and Admin assistant-usage share the same
  `llmEnabled` gate.) No issue — gating is correct.

### F-016 · Reconcile & Reports & Account & Admin · P2 · State coverage / copy · Fixed
- What: Each screen could render two stacked red error sections at once — a "Import Error"/"Error"
  section for `formError` plus a separate "Error" section for `model.lastError`. (In practice they
  fire from different sources — formError = file-picker/validation, lastError = API — and rarely
  co-occur, but two red sections is inelegant.)
- Where: ReconciliationView.swift:42-57; ReportsView.swift:117-150; AuthView.swift (signed-in);
  AdminView.swift:75-84.
- Fix (Reconcile, this turn): chained the two error sections into `if formError … else if lastError …`
  so at most one ever shows (the specific import error wins over a generic global one). The raw
  `error.localizedDescription` set in selectCSV (file-picker catch) is left as-is (file-picker errors
  are rare and the system message is acceptable).
- Fix (Reports, S-12): made the lastError "Error" section conditional on `formError == nil`
  (`if formError == nil, let lastError = …`) — the layout keeps the "Latest File" section between
  them, so a plain `else if` wasn't possible; this still guarantees at most one error section.
- Fix (Account, S-14): AuthView signed-in branch had the same shape — a `formError` Section("Error")
  plus a `model.lastError` ErrorDetailsView (also "Error"), separated by the Appearance section.
  Gated the ErrorDetailsView on `formError == nil` (`if formError == nil, let error = …`). Verified
  safe: `formError` is only rendered/set in the signed-in branch, so the signed-out branch (always
  `formError == nil`) still shows `lastError` normally — no regression.
- Fix (Admin, S-15): AdminView had the same shape with the two error surfaces adjacent — a `formError`
  Section("Error") immediately followed by a `model.lastError` ErrorDetailsView. Neither `perform`
  (validation/maintenance) nor `storeDownload` (file-write catch) clears `model.lastError`, so a
  lingering API error plus a new validation message could stack. Chained them into
  `if formError … else if let lastError …` (the Reconcile shape — adjacent, so a plain `else if`
  works), so at most one ever shows and the specific formError wins.
- Verified: ✅ rebuilt (green). Reconcile success + Bank Queue render in light/dark (s11-*); Reports
  form usable + PDF generation success (s12-*); Account all sections render in light/dark with no
  error in the success state (s14-*); Admin elevated (health/backup/import/info/logs) renders in
  light + dark with no error in the success state (s15-02, s15-10-admin-dark). Error states are hard
  to stage via automation (Admin's would need a lingering lastError plus a new formError without
  triggering a destructive op), so the one-error-at-a-time behavior is by construction.

### F-017 · Reports · P2 · State coverage · Won't-fix (premise wrong)
- What: Suspected the lack of a top-level loading placeholder during the initial category fetch was a
  gap.
- Resolution: **Dismissed.** The Reports *form* (date range, section/transaction toggles, type/sort
  pickers, notes, generate/export) renders and is fully usable immediately — it does not depend on
  the categories load. A blocking top-level `LoadingStateSection` would *hide* the usable form, i.e.
  a regression. The only load-dependent piece is the per-category checklist shown when category mode =
  "selected" (default is "all", so it isn't shown), which briefly reads "No active categories." during
  the background fetch — a narrow, self-resolving edge case not worth a state change. No fix.

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

### F-019 · Auth (signed-out) · P3 · State coverage · Deferred
- What: In the SIGNED-OUT branch, when `model.status` is nil the Create-account/Setup buttons are
  disabled with the helper "Checking tracker status..." and there is no retry/timeout — pull-to-
  refresh in AuthView only reloads account settings when authenticated, so a signed-out user whose
  status fetch failed has no in-app recovery besides relaunching.
- Where: AuthView.swift:204-212 (signed-out branch).
- Why it's a gap: a stuck "checking" state with no recovery — but it requires the backend to be
  unreachable at launch *while signed out*, a narrow edge case.
- Fix: **Deferred.** It's in the signed-out flow, which can't be reached/verified without logging out
  the persistent test session (the loop must preserve the Keychain login). A small fix (a "Retry"
  button or making the signed-out view refreshable) is plausible but unverifiable here. Recommend the
  user decide whether it's worth a signed-out retry affordance.
- Verified: n/a (cannot safely reach the signed-out branch).

### F-020 · Admin · P2 · Completeness / navigation · Fixed
- What: The "Preview" button in Latest Result was effectively dead. `storeDownload` set
  `previewDocument`, which auto-presents the sheet; on dismiss SwiftUI nils the binding, so the
  `if let previewDocument` guard hid the button, and its body just reassigned the value to itself.
  Unlike Reports, Admin kept no persistent `lastDocument`, so Preview never re-opened.
- Where: AdminView.swift:60-66 (vs ReportsView.swift:127-129).
- Why it's a gap: a control that does nothing / cannot function as labeled.
- Repro: Admin → Download database backup → the auto-preview opens; dismiss it → the Latest Result
  section showed only the filename + Share, no Preview button (confirmed live, s15-05-bug-no-preview).
- Fix: Mirrored Reports' pattern exactly — added a persistent `@State lastDocument`, set it alongside
  `previewDocument` in `storeDownload`, guarded the button on `lastDocument`, and made the button
  present `previewDocument = lastDocument`. (Read-only ops only: verified via Download backup, never
  the destructive maintenance/import actions.)
- Verified: ✅ rebuilt (green). After downloading a backup and dismissing the auto-preview, the Latest
  Result section now keeps a working Preview button (s15-07 region) that re-opens the document
  (s15-08-preview-reopened), alongside Share. No regression to the auto-present-on-create behavior.

### F-021 · Admin (logs) · P3 · Content & copy · Fixed
- What: The log-detail copy action read "Copy Request ID or Payload" — a single button that copied
  `entry.requestID ?? entry.prettyPayload()`, i.e. the request ID when present and silently the whole
  payload otherwise. The label doesn't say which, and the request ID could not be copied separately
  from the payload (or vice versa).
- Where: AdminView.swift (AdminLogDetailView Payload section).
- Why it's a gap: copy quality — an action label should name exactly what it does. (Admin is a
  power-user surface, so P3.)
- Repro: Admin (elevated) → Application Logs → tap a log row → Payload section showed the ambiguous
  "Copy Request ID or Payload" (confirmed live, s15-07-logdetail-buttons).
- Fix: Split into two explicit actions — "Copy Request ID" (shown only when the entry has a request
  ID) and "Copy Payload" (always) — so each names exactly what it copies and both are independently
  available; "Share Log JSON" unchanged. The raw pretty-printed `prettyPayload()` JSON block itself is
  **left as-is and that half dismissed** — verbatim JSON is appropriate (and expected) on an admin log
  inspector, and `prettyPayload()` already indents/sorts it; there is no lossless structured
  alternative worth a new pattern here.
- Verified: ✅ rebuilt (green). The Payload section now shows "Copy Request ID" / "Copy Payload" /
  "Share Log JSON" as three distinct labeled rows (s15-09-logdetail-fixed).

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

### F-025 · ScenarioEditor (What-If) · P2 · State coverage · Fixed
- What: `runScenario()` discarded the result (`_ = await model.runForecastScenario(...)`), so a
  failed scenario run did nothing visible — no impact section, no error. The free-text "Effective
  month" / "Month" fields are validated only for non-empty, so a malformed month reached the server
  and failed silently.
- Where: PlanningView.swift:859-865 (runScenario).
- Why it's a gap: a failed mutation must be visible; silently doing nothing reads as a broken button.
- Repro: What If → Change rule → set "Effective month" to "2026-07xx" → Add Adjustment → Run Scenario
  → previously nothing happened.
- Fix: `runScenario()` now captures the `Bool` result and sets the existing `formError` to
  `model.lastError?.message ?? "Scenario could not be run."` on failure (clearing it first),
  mirroring the formError pattern used across the app's forms. This also makes the unvalidated
  free-text month fail gracefully with a visible error.
- Verified: ✅ rebuilt (green). Success path renders the Result/impact section (s07-scenario-result);
  the malformed-month run now shows "Request failed." in red (s07-scenario-error). Run Scenario /
  Clear disabled states correct; light/dark + large Dynamic Type OK.
- Note (minor, not fixed): a client-side `yyyy-MM` format check on the month fields would give a
  clearer message than the generic server "Request failed." and avoid the round-trip — optional
  follow-up; the silent-failure gap itself is closed.

### F-026 · RecurringOccurrences · P2 · State coverage · Fixed
- What: The view showed `ProgressView()` whenever `data` was nil — including after a failed load — so a
  failed occurrences fetch spun forever, and there was no way to retry (no pull-to-refresh).
- Where: RecurringView.swift RecurringOccurrencesView (was the `else { ProgressView() }` branch).
- Why it's a gap: a screen stuck spinning on failure with no recovery.
- Repro: occurrences load fails → indefinite spinner.
- Fix: Split the nil-data branch into `else if model.isLoading { ProgressView() }` (loading) and
  `else { ContentUnavailableView("Couldn't load occurrences", … "Pull to refresh to try again.") }`
  (failed/empty), and added `.refreshable` so the user can retry.
- Verified: ✅ rebuilt (green). Success path loads correctly for multiple rules (Salary, Rent); the
  loading path is unchanged during a normal load (no regression). The error-card branch follows the
  same pattern as the other state-coverage fixes this session; the occurrences endpoint returns 200
  for valid rules, so the failure state itself isn't reproducible on localhost (same constraint as
  F-022). The `.refreshable` retry is new and was the missing recovery affordance.

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
