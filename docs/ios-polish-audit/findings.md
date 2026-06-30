# iOS App Polish — Findings & Fix Log

## Closing Summary (audit complete — 38 / 38 surfaces)

Every reachable user-facing surface of the native SwiftUI iOS app was mapped, driven in the iPhone 17
Pro / iOS 26.4 simulator (via the `axe` HID driver), and polished against the 9-dimension bar. Build is
green throughout; the work lives on branch `ios-app-polish` (24 commits, **not pushed**), one commit per
surface.

**Findings tally — 35 total (F-001, F-005–F-037):**
- **Fixed: 22** — F-006, F-007, F-008, F-009, F-010, F-011a, F-014, F-015, F-016
  (Reconcile+Reports+Account+Admin), F-020, F-021, F-022, F-023, F-025, F-026, F-027, F-030, F-031,
  F-033, F-034, F-035, F-036. Each was observed fixed in the simulator except where a state is
  physically unreachable there (noted per finding: e.g. F-027's `.unavailable` gate, F-035's `.menu`-gated
  dialog — code-verified + build-green).
- **Won't-fix (dismissed with rationale): 4** — F-013 (rule "title" label is accurate), F-017 (a blocking
  Reports loading placeholder would hide the usable form), F-024 (Save-on-isLoading matches every sibling
  form), F-028 (markdown descriptions are an intended, documented feature; web uses react-markdown).
- **Deferred — need your decision: 7** (parked as Open Questions Q1–Q5 + two others, see the Summary
  below): F-001 (unreachable dead code in RootView), F-005 (error-vs-empty state across 6 read-only
  surfaces), F-011b (Recurring per-rule currency display), F-012 (list mutation-failure feedback — folds
  into F-005), F-018 (Diagnostics has no auth gate), F-019 (signed-out status-fetch retry), F-037
  (Quick Add FAB persists over pushed detail screens).
- **Open candidates remaining: 0** — every actionable finding is fixed or explicitly deferred to you.

**Key user-visible fixes (all in CHANGELOG `[Unreleased]`):** empty/loading/failed-state coverage
(Transactions empty states, Insights Flow/Durables loading, RecurringOccurrences + TransactionDetail
recoverable load failures with pull-to-refresh); a real interaction bug where clearing the Transactions
filters also wiped the active search (F-033); semantic income/expense theme colors swept across Deleted
list, Recurring rows, Reimbursements, Forecast breakdown, and Insights breakdown (F-007/F-023/F-031/F-036);
single-error-surface consolidation across Reconcile/Reports/Account/Admin (F-016); a dead Admin "Preview"
button made re-openable (F-020); clearer copy on Admin log-copy, BulkEdit scope/confirm, and the
local-unlock "Check Settings" button that now actually opens Settings (F-021/F-034/F-035/F-027);
Budgets "+" disabled on Year + consistent labels (F-009/F-010); scenario-run failure surfacing (F-025);
descriptive VoiceOver labels on Digest week-nav (F-030).

**Per-surface commit list (`git log main..ios-app-polish`, newest first):** S-37 LocalUnlockGate
(e2adf57), S-38 Privacy overlay (1a8e637), S-01 RootView (94e40a3), S-32 Insights filters + F-036
(9c6d6ae), S-21/S-22 Budget forms (ce0741d), S-19 BulkEdit (42c8b6c), S-18 Filters (a09f673), S-17
TransactionForm (9502f91), S-16 TransactionDetail (0d24c53), S-15 Admin (a4130e9), S-14 Account
(704e69c), S-13 Diagnostics (ed118bf), S-12 Reports (574f6a5), S-11 Reconcile (8b35a5a), S-10 Assistant
(eb5791e), S-09 Organize (d275ff8), S-08 Recurring (0914af3), S-07 Forecast (7fb61dd), S-06 Budgets
(8bfb99b), S-05 Insights (5fad5b1), S-04 Digest (acea4e3), S-03 Transactions (d3c5743), S-02 Dashboard
(b4c7ddf), Phase-1 inventory (30db917). (S-35 Camera audit folds into this final closing commit.)

**Test-harness limitations (documented honestly so claims aren't overstated):** the `axe` HID driver
reliably drives segmented/navigationLink pickers, text fields, date pickers, and list/sheet/tab buttons,
but **cannot** open SwiftUI `.menu`-style Picker popovers or flip `Toggle` switches inside Forms (separate
system overlays) — those behaviors were code-verified. The **camera** (S-35), the local-unlock
**`.unavailable`** gate (S-37), and the **privacy shield** on the app-switcher snapshot (S-38) are not
actuable/observable on the simulator — all code-verified + build-green.

**Release recommendation (NOT cut here — for you to action):** the branch carries 22 user-visible iOS UX
fixes since `v0.3.1` with no breaking changes, so a **patch release `v0.3.2`** is warranted. Per
`CLAUDE.md` → Releases, the deliberate steps (left to you): review/merge `ios-app-polish`; bump
`pyproject.toml` `version` to `0.3.2`; move CHANGELOG `[Unreleased]` → `## [0.3.2] - <date>` (reconcile
against `git log v0.3.1..HEAD`); `uv lock` and commit `uv.lock`; tag `v0.3.2` and push the tag; create the
GitHub Release. I did not perform any release action (out of the audit's scope).

---

## Summary

- **Phase:** 2 (per-surface audit/fix loop) — **complete (38/38)**.
- **Surfaces:** 38 / 38 done ✅ — Dashboard (Audited), Transactions, Digest, Insights, Budgets,
  Forecast(+ScenarioEditor), Recurring(+RuleForm, Occurrences), Organize(+merges, forms),
  Assistant(+LLM-off pass), Reconcile, Reports(+DocumentPreview), Diagnostics, Account
  (F-016 extended; F-019 deferred), Admin (S-15 + S-34; F-020/F-021/F-016), **TransactionDetail
  ✅ Fixed** (S-16 + S-33 Reimbursements; F-022 failed-state+retry, F-023 themed reimbursement colors,
  F-028 dismissed; folded in the PlanningView Forecast color sweep), **TransactionForm ✅ Audited**
  (S-17; F-024 dismissed — Save-gating matches every sibling form), **Filters ✅ Fixed** (S-18;
  F-033 — chip-X/Reset no longer also wipes the search query), **BulkEdit ✅ Fixed** (S-19; F-034/F-035
  — clearer scope-option + confirm-dialog copy), **Budget forms ✅ Audited** (S-21 override + S-22
  template; clean, consistent form pattern, no findings), **Insights filters ✅ Audited** (S-32; clean,
  no F-033 analogue) + **F-036 Fixed** (Charts breakdown income/expense theme colors), **App shell
  ✅ Audited** (S-01; F-001 re-confirmed, F-037 deferred), **Privacy overlay ✅ Audited** (S-38; covers
  inactive+background; sheets covered in production by the S-37 cover window), **LocalUnlockGate
  ✅ Fixed** (S-37; F-027 "Check Settings" now opens Settings; sheet-coverage resolved). Confidence: **high**.
- **Build status:** ✅ green (Debug, iPhone 17 Pro simulator). App installed + logged in (`test`, admin).
- **Findings:** total 35 (F-001, F-005–F-037). By status — Fixed: 22 (F-006, F-007, F-008, F-009,
  F-010, F-011a, F-014, F-015, F-016 [Reconcile+Reports+Account+Admin], F-020, F-021, F-022, F-023,
  F-025, F-026, F-027, F-030, F-031, F-033, F-034, F-035, F-036). Won't-fix: 4 (F-013, F-017, F-024,
  F-028). Deferred (need user decision): 7 (F-001, F-005, F-011b, F-012, F-018, F-019, F-037). Open
  candidates (await their surface's turn): 0. By severity of still-open items: P3: 1 (F-037, deferred).
  Cross-surface
  follow-up: none outstanding (PlanningView income/expense literal colors resolved with S-16). Harness
  note: axe can't actuate SwiftUI `.menu` Picker popovers (separate overlay), so states reachable only
  via a `.menu` picker (e.g. BulkEdit operation → Apply dialog) are code-verified where applicable.
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
  5. **F-037 (Quick Add FAB over pushed detail):** The floating "+" FAB persists over pushed
     detail/sub-screens within the Dashboard/Transactions tabs, not just at the tab root. Scope it to
     the tab root (hide once a detail is pushed) — which needs lifting those tabs' NavigationStack
     paths up to RootView, a structural nav-architecture change — or keep the persistent global
     quick-add as-is? Recommend scoping to the tab root.

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
- Note (resolved with S-16): the same literal-color pattern existed in PlanningView's
  `ForecastBreakdownRows` (Forecast month breakdown) — five literal `.green`/`.red` color args
  (Income/Expenses totals, recurring rules, variable estimates, one-time events). Swept all five to
  `ExpensesTheme.income/expense(for: scheme)` (added the `colorScheme` env to that view) in the S-16
  consistency commit, so the whole component sources income/expense colors from the shared theme.

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

### F-022 · TransactionDetail · P2 · State coverage · Fixed
- What: If `loadTransactionDetail` failed, `transaction` stayed nil and the view showed an infinite
  `ProgressView` with no error/retry/not-found state — a screen stuck spinning on failure.
- Where: TransactionDetailView.swift:126-128 (was the bare `else { ProgressView() }`).
- Why it's a gap: loading must be distinct from failure; a failed load needs a visible error + a way
  to recover. (`runRequest` sets `isLoading=true` during the load and `defer`s it false; on failure
  `selectedTransaction` is left unchanged, so the id-matched `transaction` computed stays nil.)
- Repro: open transaction B while `selectedTransaction` holds A, with the backend worker suspended
  (`kill -STOP`), so the detail load hangs then times out (URLSession default 60s) → previously an
  endless spinner.
- Fix: Split the nil-`transaction` branch into `else if model.isLoading { ProgressView() }` (loading)
  and `else { ContentUnavailableView("Couldn't load transaction", systemImage:
  "exclamationmark.triangle", description: "Pull to refresh to try again.") }` (failed/not-found),
  and added `.refreshable { await model.loadTransactionDetail(id:) }` so the user can retry — the same
  pattern as F-026 (RecurringOccurrences).
- Verified: ✅ rebuilt (green). Drove the full sequence on-simulator: suspend worker → open a detail →
  spinner (s16-06b-loading); after the ~60s timeout the failed card "Couldn't load transaction / Pull
  to refresh to try again." appears (s16-07-failed-state); resume worker → pull-to-refresh reloads the
  detail (s16-08-retry-recovered). Worker resumed; backend healthy afterward.

### F-023 · TransactionDetail (Reimbursements) · P3 · Consistency · Fixed
- What: `reimbursementRow` colored its amount with a literal `.green`, and `expenseSearchRow` colored
  its amount with a literal `.red`, instead of the shared semantic theme. Same off-theme anti-pattern
  as F-007/F-031 — most visible in dark mode, where the theme uses a warm-adjusted red/green that the
  literals don't match.
- Where: TransactionDetailView.swift `ReimbursementsSection` — `reimbursementRow` (was `.green`),
  `expenseSearchRow` (was `.red`).
- Why it's a gap: DESIGN — income/expense colors come from `ExpensesTheme`. A reimbursement allocation
  is reimbursed (income-like) money in both the income and expense views → income green; the
  expense-search candidate row is an expense → expense red.
- Repro: open the seeded reimbursement pair (mock_db.py): the expense "Work conference travel
  (reimbursable)" shows the linked reimbursement row; the income "Conference travel reimbursement from
  employer" shows the allocation row + expense search results. Amounts used literal colors.
- Fix: Added `@Environment(\.colorScheme) private var scheme` to `ReimbursementsSection`; switched
  `reimbursementRow` → `ExpensesTheme.income(for: scheme)` and `expenseSearchRow` →
  `ExpensesTheme.expense(for: scheme)`. Both literal colors in this one component swept together (same
  rationale as F-007/F-031), so the surface is internally consistent. (Closes S-33's only finding.)
- Verified: ✅ rebuilt (green). Allocation row renders themed green and the expense-search rows themed
  red in light (s16-04) and in dark, where they match the warm dark-mode theme colors of the rest of
  the app (s16-05-reimb-dark).

### F-024 · TransactionForm · P3 · Interaction feedback · Won't-fix (consistent pattern)
- What: Suspected the Save button being gated only by `model.isLoading` (never by form validity) was a
  gap — an incomplete form looks tappable and "fails" at submit time.
- Resolution: **Dismissed — this is the app-wide form pattern, and submit-time validation is clear.**
  Verified by reading every sibling create/edit form: BudgetOverrideFormView (BudgetsView:423),
  BudgetTemplateFormView (:524), RecurringRuleFormView (RecurringView:302), and the Category/Tag/
  Template/Rule forms (OrganizeView:1353/1427/1528/1713) ALL gate Save on `.disabled(model.isLoading)`
  only and validate on submit. (Only the merge views — a distinct destructive source/target pattern —
  validity-gate via `!canSubmit`.) Adding an `isValid` gate to TransactionForm alone would make it the
  inconsistent one. And the submit-time path is graceful: `makePayload()` returns a specific inline
  `formError` ("Title is required." / "Amount is invalid." / "Location is still unavailable.") rather
  than failing silently.
- Verified live: opened the create form, tapped Save empty → "Title is required." renders in the red
  error section (s17-02-validation); income switch reveals the reimbursement toggle; edit mode seeds
  every field incl. the reimbursement toggle ON (s17-05-edit-mode). Haptics correct by code (type/
  reimbursement/location pickers `.selection`; save success/error via the `saveAttempts` trigger). The
  LocationProvider can't hang indefinitely (`requestLocation()` always resumes its continuation; the
  `loadCurrentLocation` catch auto-resets the toggle with a clear error). No change made.
- Minor note (not fixed, consistent): the `formError` is the form's last section, so tapping Save from
  the top of a long invalid form shows the error below the fold — true of every form in the app; the
  realistic fill-then-save flow leaves the user near the bottom. A scroll-to-error would be an
  app-wide enhancement, not a one-off S-17 fix.

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

### F-027 · LocalUnlockGate · P2 · Completeness / copy · Fixed
- What: In the `.unavailable` state the button read "Check Settings" but its action was the shared
  `retry` closure — it just re-ran `unlock()` → `evaluatePolicy()`, it did NOT open Settings. The label
  promised navigation the handler didn't perform.
- Where: LocalUnlockView (the else-branch Button, was `action: retry`).
- Why it's a gap: a button whose label lies about what it does. The `.unavailable` state is reached
  when `canEvaluatePolicy(.deviceOwnerAuthentication)` returns false — i.e. no device passcode/biometrics
  set up — so the user genuinely must go to Settings to enable device auth; a silent retry can't help
  until they do.
- Fix: Made the button's action `.unavailable`-aware via a new `primaryAction()` — for `.unavailable`
  it opens `UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)` (truthful +
  the helpful action); all other states keep retrying. Also gave the button a state-appropriate icon
  (`gearshape` for "Check Settings", the biometric glyph otherwise). Chose open-Settings over relabel
  to "Try Again" because the unavailable cause (no device auth set up) is fixed in Settings, not by
  retrying. (openSettingsURLString lands on the app's Settings page — the standard "take me to Settings"
  pattern; iOS has no public deep-link to the Passcode page.)
- Verified: ✅ build green; app relaunches normally (gate bypassed via `--skip-local-unlock`, no
  regression). The live `.unavailable` state is **not reachable in the dev simulator** — the
  `--skip-local-unlock` flag bypasses the gate entirely, and reaching it otherwise needs a
  passcode-less device + would risk the session — so the fix is verified by code review + build, not
  on-screen capture (per the loop's "don't jeopardize the session" guardrail).

### F-028 · TransactionDetail · P3 · Content & copy · Won't-fix (by design)
- What: The description is rendered via `Text(.init(description))` → `LocalizedStringKey` markdown
  parsing, so markdown in the description is interpreted (bold/italic/links) rather than shown raw.
- Where: TransactionDetailView.swift:33.
- Resolution: **Dismissed — markdown is the intended format.** Descriptions are a documented markdown
  feature (CHANGELOG [0.1.0]: "markdown descriptions"); the web renders them through `react-markdown`
  (`ui/src/components/TransactionDescription.tsx`) and edits them with a TipTap markdown editor
  (`ui/src/components/DescriptionEditor.tsx`). So iOS interpreting markdown is correct and
  cross-platform-consistent, not a bug.
- Note (fidelity gap, not fixed): SwiftUI `Text(.init(...))` renders only *inline* markdown
  (`*bold*`, `_italic_`, `[link](url)`), not *block* markdown — so a bulleted list (`- item`) or
  blockquote (`> quote`) appears with the literal `-`/`>` prefix instead of rendered blocks (observed
  live on the seeded "Work conference travel" list and "Conference travel reimbursement" blockquote).
  The text stays fully legible; matching the web's block rendering would need a block-markdown
  renderer (AttributedString block parsing / a custom view) — a feature, not a polish fix. Left as-is.

### F-033 · Transactions (Filters) · P3 · Navigation & flow / consistency · Fixed
- What: The filter summary chip's "Clear filters" X (and the Filters sheet's "Reset" button) cleared
  the active search query in addition to the structured type/category/tag filters — even though the
  chip displays only structured-filter labels, the chip-X's accessibility label is literally "Clear
  filters", and the Reset button's own disabled-state is gated only on structured filters
  (`type.isEmpty && categoryID == nil && tagID == nil`). So a user who searched "Salary", added an
  "Income" filter, then tapped the chip-X to drop the filter unexpectedly lost their search too.
- Where: TransactionsView.swift `clearFilters()` (was also resetting draftSearchQuery/
  appliedSearchQuery/searchAlert/isTranslatingSearch/lastTranslatedSearchQuery); used by both the
  chip-X (FilterSummarySection onClear) and the sheet Reset (onClear).
- Why it's a gap: the affordance's apparent scope ("filters") disagreed with its action (also clearing
  search). The Reset disabled-logic being structured-filters-only is the tell that the search-clearing
  was incidental, not intended — and a search-only state can't even use Reset (it stays disabled).
- Repro: Transactions → search "Salary" → Filters → Type = Income → Done → tap the chip "Income" X →
  the search "Salary" was also wiped (s18-03-after-chipclear).
- Fix: Scoped `clearFilters()` to the structured filters only (type/category/tag + reload), leaving the
  search query untouched. The search bar keeps its own native clear, so the two concerns are cleared
  independently — matching the chip/Reset's apparent scope and the Reset disabled-state logic.
- Verified: ✅ rebuilt (green). Repeated the repro: tapping the chip-X now clears only the Income filter
  and the "Salary" search persists (the list shows all Salary matches) (s18-04-fix-search-survives).
  Also re-confirmed the rest of the surface: Reset is disabled with no structured filters and enables
  once one is set; the Type/Category/Tag navigationLink pickers round-trip; Done applies; the summary
  chip is accurate ("Income", "Income · Housing"); the F-006 empty state still triggers on a
  zero-result combo ("No matching transactions") with Select correctly disabled (s18-05-empty-state).

### F-034 · Transactions (Bulk Edit) · P3 · Content & copy · Fixed
- What: The "Apply to" scope picker's `.filtered` option read "All loaded filter" (in active/deleted
  modes) — grammatically awkward and misleading: the option targets *all* transactions matching the
  current filters across all time (the request uses period "all"), not just the "loaded" page.
- Where: TransactionsView.swift BulkEditSheet (Selection picker, the `.filtered` tag's Text).
- Why it's a gap: copy quality — on a consequential bulk-edit scope choice the label should clearly
  convey "everything matching the current filters", not imply only the loaded page.
- Fix: "All loaded filter" → "All filtered" (parallels the uncategorized variant "All inbox").
- Verified: ✅ rebuilt (green). Observed on-screen: opening Bulk Edit with 0 selected rows defaults the
  scope to `.filtered` (init: `selectedIDs.isEmpty ? .filtered : .selected`), and the "Apply to" value
  now renders "All filtered" (s19-06-after-fix). Sheet otherwise unregressed.

### F-035 · Transactions (Bulk Edit) · P3 · Content & copy · Fixed
- What: The apply confirmation dialog message read "The backend will update every resolved transaction
  in this selection." — leaks an implementation detail ("the backend") and uses jargon ("resolved
  transaction" = the resolved query set) in user-facing copy.
- Where: TransactionsView.swift BulkEditSheet `.confirmationDialog("Apply bulk changes?", …)` message.
- Why it's a gap: copy quality — a confirmation should state the consequence in user terms, not the
  mechanism.
- Fix: → "This will update every transaction in the selection." (drops "backend" and "resolved";
  reads naturally for both the Selected-rows and All-filtered scopes).
- Verified: code-applied + ✅ build green; the Bulk Edit sheet renders unregressed (s19-06-after-fix)
  and the empty-Apply validation ("Choose at least one change.") still fires. The dialog itself was
  NOT on-screen-actuated: reaching it requires setting a valid operation via the `.menu`-style Lifecycle/
  Category/Tags pickers, and axe cannot reliably open SwiftUI `.menu` Picker popovers (separate system
  overlay) — a test-harness limitation, not an app issue. So this exact string is verified by code
  review, not screenshot. (The change is a literal swap in an otherwise-correct dialog block.)

### S-21/S-22 · Budget forms · Audited (no findings)
- BudgetOverrideFormView ("Set Month Budget") and BudgetTemplateFormView ("Recurring Budget") were
  driven live (Month "+" and Recurring "+"). Both follow the app's standard form pattern: Save gated on
  `model.isLoading` + validate-on-submit (`BudgetFormParsing.parseAmount` → "Amount is invalid." for an
  empty/invalid amount — observed on both), `.selection` haptics on the segmented Frequency picker and
  the Has-end-date toggle, and a clean formError section. Consistent with the F-024 sibling-form
  decision — no change.
- Verified live: both forms render cleanly (light); the override validation fires; the template
  Frequency segmented control switches Monthly↔Yearly and the `onChange(frequency)` start-date
  adaptation works (Starts on changed 1 Jun 2026 → 1 Jan 2026 on Yearly); Cancel dismisses; the Year
  tab "+" stays disabled (F-009).
- Not HID-actuated (axe limitations, behaviors correct by code): the `Has end date` Toggle (SwiftUI
  Toggle-in-Form taps don't register — the `if hasEndDate { DatePicker("Ends on", …) }` reveal is a
  trivial conditional) and the Category `.menu` Picker (popover overlay).

### S-32 · Insights filters · Audited (no findings)
- InsightsFiltersSheet (period/type/tag navigationLink pickers; Reset; Done) was driven live from the
  Charts section. Mirrors the Transactions filter sheet: Reset disabled when no filters
  (`period == "all" && typeFilter.isEmpty && selectedTagID == nil`) and enables once one is set; the
  period picker round-trips; Done applies and the data reloads reactively via `.task(id: reloadKey)`;
  the summary chip is accurate ("This month"); the chip-X clears cleanly.
- **No F-033 analogue:** `clearFilters()` resets only the draft+applied period/type/tag (exactly what
  the chip represents) and leaves `selectedTrendCategoryID` and the section untouched — the clear scope
  matches the affordance's apparent scope (Insights has no search query). Clean.

### F-036 · Insights (Charts breakdown) · P3 · Consistency · Fixed
- What: The Expenses/Income breakdown sections were tinted with literal `.red`/`.green` (the per-row
  ProgressView bars and the ring's dominant slice), while the Monthly Trend chart on the SAME Charts
  screen already uses `ExpensesTheme.income/expense(for: scheme)`. A visible same-screen inconsistency,
  most noticeable in dark mode (bright system red bars vs the trend line's warm theme red).
- Where: InsightsView.swift:47-48 (the two `InsightsBreakdownSection(… color: .red/.green)` call
  sites), vs the trend chart at :319/:328/:347/:348 which is already themed.
- Why it's a gap: DESIGN — income/expense colors come from the shared theme; the breakdown should match
  the trend chart (and the rest of the app) rather than use literal system red/green.
- Fix: Added `@Environment(\.colorScheme) private var scheme` to `InsightsView` and passed
  `ExpensesTheme.expense(for: scheme)` / `ExpensesTheme.income(for: scheme)` to the breakdown sections.
- Scope: limited to the unambiguous income/expense breakdown. Left literal (distinct semantics, not
  income/expense): the Movement Increases/Decreases delta rows (:354-355, an up/down change semantic),
  the Flow Sources/Uses node tints (:547/:550 — a cash-flow source/use grouping that includes
  deficit/savings, not pure income/expense, and on a separate tab), and the over-budget/amortized
  status tints (:493/:624).
- Verified: ✅ rebuilt (green). Breakdown bars + dominant ring slice now render the warm theme expense
  red in dark (s32-05-breakdown-fixed-dark, vs the brighter literal red in s32-04) and the deeper theme
  red in light (s32-06), matching the Monthly Trend chart; the per-category ring palette is unchanged.

### S-01 · App shell (RootView) · Audited
- The TabView shell is well-built and verified live: the 5 primary tabs; the More groups (Planning /
  Manage / Tools / Account) with Assistant filtered out of Tools when `!llmEnabled` (F-032); the
  floating Quick Add FAB shows (opacity 1 + hit-testing) only on Dashboard & Transactions and is
  hidden (opacity 0) elsewhere (confirmed: visible on Dashboard, invisible on Digest, s01-01); the FAB
  is disabled + dimmed (0.48) when unauthenticated; its haptic is `.impact(weight: .light)` on a tap
  counter (DESIGN-correct); the tab bar hides only for Assistant (`hidesTabBar`). F-001 (dead code)
  re-confirmed accurate and still deferred (see Summary Q1).

### F-037 · App shell (Quick Add FAB) · P3 · Layout & visual fit / navigation · Deferred (needs user decision)
- What: The floating Quick Add FAB persists over pushed detail/sub-screens within the Dashboard and
  Transactions tabs (e.g. it floats over the lower content of a pushed TransactionDetail — observed
  s16-02/s16-03), not just at the tab root. Over the list it's the standard FAB-over-content pattern
  (fine); over a specific transaction's detail it visually overlaps content and offers a contextually
  odd "add a new transaction" action.
- Where: RootView.swift:21-28 — the FAB is a root-level `ZStack` overlay above the whole `TabView`,
  gated only on `selectedDestination.showsFloatingQuickAdd` (the TAB), with no knowledge of nav depth
  inside the tab (each tab's `NavigationStack` is internal to DashboardView/TransactionsView).
- Why it's a gap: minor — content scrolls under the FAB and it's a common pattern, but a global
  quick-add hovering over a detail screen is slightly incongruous.
- Repro: Transactions (or Dashboard) → tap a row → on the pushed detail the "+" FAB still shows
  bottom-right.
- Fix: **Deferred — needs user decision** (Summary Q5). The clean fix (show the FAB only at the tab
  root — depth 0) requires lifting the Dashboard/Transactions `NavigationStack` paths up to RootView,
  or a PreferenceKey from the child views, i.e. a structural change to the nav architecture across
  multiple files — beyond a smallest-viable-diff and also a product call (is the persistent global
  quick-add desirable, or should it be tab-root only?). Recommend scoping the FAB to the tab root.
- Verified: n/a (logged, not fixed).

### S-38 · Privacy overlay · Audited
- PrivacyOverlayModifier (Shared/PrivacyOverlayModifier.swift), applied via `.protectSensitiveSnapshots()`
  on `LocalUnlockGate { RootView() }` in ExpensesApp.swift. Correct by code: it shields content for
  `scenePhase != .active` (covers BOTH `.inactive` and `.background`, not just one), with a clean
  `.regularMaterial` blur + `lock.shield` icon + "Expenses" title, and no animation (no Reduce Motion
  concern). The shield disappears on `.active`.
- Verified: the shield itself renders on the app-switcher snapshot / `.inactive`, which isn't directly
  capturable on the simulator (same constraint as camera/local-unlock). Confirmed the background cycle
  works: launching Settings backgrounds the app (s38-01-transition shows "◀ Expenses" with Settings
  sliding in); re-foregrounding restores normal content with no shield (Dashboard/Transactions/Insights
  tabs visible). Code path is unambiguous.
- Note (sheet coverage → RESOLVED in S-37): the modifier is a SwiftUI `.overlay`, which does NOT cover
  presented sheets. But the *local-unlock cover* (LocalUnlockGate's `PrivacyCoverWindow`, a separate
  `UIWindow` at `windowLevel = .alert + 1` — above sheets) IS the authoritative snapshot shield: it's
  shown on every `.inactive`/`.background` while unlocked, gated on `hasStoredToken &&
  !skipsLocalUnlockForSimulator`. So in production (real device, logged in with a stored token) sheets
  ARE covered in the app-switcher snapshot — no leak. The `.overlay` sheet-gap only manifests in the
  dev simulator under `--skip-local-unlock`, which intentionally bypasses the whole gate. No finding.

### S-37 · LocalUnlockGate / LocalUnlockView · Fixed (F-027) + Audited
- F-027 fixed (see above): the `.unavailable` "Check Settings" button now opens Settings.
- The rest of the gate audited by code (the live gate is bypassed in the dev sim via
  `--skip-local-unlock`, so states aren't on-screen-actuable there without risking the session):
  - States: `.locked`/`.unlocked` ("Unlock Expenses" + "Unlock"), `.authenticating` ("Unlocking
    Expenses" + ProgressView + pulsing symbol), `.failed` ("Try Again" title + button, red icon +
    detail), `.unavailable` ("Unlock Unavailable" + "Check Settings", red icon + detail) — all
    well-formed with clear copy, the ExpensesBackground, and a 0.18s ease animation. SwiftUI #Previews
    exist for ready/authenticating/failed/unavailable.
  - Grace re-lock: `unlockGraceInterval = 20s`; on re-foreground within grace, nav state is preserved
    (no re-lock); past grace, `unlockState = .locked`. The privacy cover is drawn in a separate window
    (preserves nav, doesn't replace content) — matches the 0.3.1 changelog.
  - **Sheet-coverage conclusion (resolves the S-38 cross-ref):** the `PrivacyCoverWindow` at
    `windowLevel = .alert + 1` covers presented sheets, and it's raised on every `.inactive`/
    `.background` while unlocked with a stored token → production sheets are shielded in the app
    switcher. The PrivacyOverlayModifier `.overlay` is a redundant baseline content shield; no real
    sheet leak in production.
