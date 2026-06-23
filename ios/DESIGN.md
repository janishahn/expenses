# iOS Design Rules

This document defines native iOS design guidance for the expenses app. The root
`DESIGN.md` remains the product identity source for the web app; this file
translates the same product into native SwiftUI and iOS 26+ Liquid Glass.

## Principles

- Prioritize native iOS structure over React route or page fidelity.
- Preserve functional parity with the web app, but use iOS-native navigation,
  sheets, lists, forms, document previews, and confirmations.
- Use Liquid Glass as structural material and interaction emphasis, not as a
  decoration applied to every row.
- Keep finance data dense, legible, and scannable.
- Support light mode, dark mode, and Dynamic Type from the start.
- Use English UI text initially with locale-aware date, time, and money
  formatting.

## Liquid Glass

- Use Liquid Glass for navigation-adjacent controls, summary surfaces, floating
  actions, modal surfaces, toolbars, and selected high-level cards.
- Do not wrap every list row or dense table-like surface in glass.
- Use interactive glass only for tappable/focusable elements.
- Keep related glass shapes consistent within a screen.
- Prefer native Liquid Glass APIs over custom blur stacks.

## Information Architecture

The app should preserve the feature map, not the web route map.

Primary native areas:

- Dashboard/Today
- Transactions
- Budgets, Digest, and Insights
- Automation/Recurring
- Organize
- Reconcile
- Reports/Exports
- Settings
- Admin

On iPhone, keep the most common areas immediately reachable and move rare
operator workflows into grouped sections. Future iPad support may use split-view
navigation, but v1 optimizes for iPhone.

The iPhone app shell uses a native `TabView` for Dashboard, Transactions,
Digest, Insights, and More. More is a first-class tab that groups lower-frequency
planning, budgeting, organization, tool, and account destinations in a native list. Avoid
custom edge-swipe drawers for primary navigation on iPhone; they compete with
system gestures and nested screen interactions. Page-specific top-right add
buttons should be avoided unless the action is not covered by the global Add
action.

## Components

Define small shared primitives rather than a broad component framework:

- glass summary surface
- native chart surfaces for category rings, monthly lines, and focused bars
- dashboard overview card: balance-forward hero with income/expense metric strip
- primary, secondary, and destructive action styles
- loading, empty, and error states
- spinner-based first-load states with light glass/blur transitions; reserve
  unavailable states for true empty, error, or unavailable content
- money, date, and status formatting
- transaction, category, and tag chips
- native form rows and picker rows
- request/error detail surface with copyable request ID

## Transactions

- Transaction add/edit is native optimized, not field-for-field copied from web.
- Use an amount-first flow with integer cents in app state.
- Keep plain text search plus native filters; do not expose advanced search
  syntax initially.
- Keep transaction scope and filters secondary by default: use toolbar/menu
  access for list scope, a toolbar button for filter entry, and show inline
  filter summaries only when filters are active.
- Transaction rows should keep metadata scannable: separate date and category
  with a clear divider and truncate long category names instead of wrapping.
- Transaction detail should use a compact, purpose-built summary surface instead
  of generic form rows, and image receipts should render inline while retaining
  Quick Look for full preview.
- Use selection mode for bulk edit.
- Swipe actions may be shortcuts, never the only way to perform an action.

## Dashboard And Insights

- Dashboard should surface category ring charts from the backend donut payload,
  matching the web app's expense/income breakdown intent with native Swift
  Charts rather than embedded web charts. Keep these breakdown charts below the
  operational dashboard content, consistent with the web dashboard.
- Dashboard budget summaries should stay compact and share one section: keep
  overall monthly pace to one dense row, then show only the backend curated
  category pulse rows with a one-line label/remaining amount and a thin progress
  bar. Leave full budget management to the Budgets screen.
- Insights should use native chart marks for monthly income-vs-expense trends,
  category breakdown rings, and selected-category bar trends. Keep the web
  chart semantics, but adapt interaction density and legends for iPhone.
- Insights filters should stay secondary by default: use toolbar access and an
  inline active-filter summary only when filters are applied.

## Budgets And Automation

- Budget summaries should make monthly pace, spent amount, remaining allowance,
  and projected finish readable before drilling into individual budget rules.
- Burn-down details can be compact summary rows before chart polish; preserve the
  backend-owned comparison month and top-day semantics.
- Recurring rule editing should keep schedule preview close to the recurrence
  fields so changes can be checked before saving.

## Privacy

- Hide sensitive content when the app backgrounds or appears in the app
  switcher.
- The dashboard overview card may expose a quick incognito toggle for temporarily
  blurring overview amounts while preserving the card layout.
- Use Face ID/device authentication as local unlock around stored credentials.
- Keep a short return grace period after app switching so brief task hops do not
  force repeated local unlock prompts.
- Do not persist finance domain data on device in the initial implementation.
- Local unlock protects the stored mobile session only; it does not replace
  backend login or admin elevation.

## Files

- Use native camera, Photos, Files, Quick Look, and share sheet flows.
- Server-generated CSV/PDF/backup artifacts remain backend-owned.
- The app owns selection, preview, share, and save interactions.

## Organize

- Category and tag merge flows use native pickers for source and target,
  backend-owned preview counts, and a destructive confirmation before applying.
- Keep merge actions grouped with category/tag maintenance rather than exposing
  them as primary creation actions.

## Account And Settings

- Keep account, session, ingest-token, CSV import, and balance snapshot controls
  in native form sections.
- The app appearance preference belongs in settings/login-adjacent chrome and
  must map to native system, light, and dark color-scheme behavior.
- Generated ingest tokens are one-time values; make them selectable and copyable
  immediately after creation or rotation.
- Mobile session revocation and ingest-token revocation are destructive account
  actions and require confirmation.

## Reconciliation

- Prefer a queue-style review flow over dense desktop tables.
- Keep import preview, commit, row review, reopen, suggestion acceptance, and
  create-transaction actions visible as native list operations.
- Treat bank-row statuses as compact semantic labels so the user can scan
  missing, ambiguous, suggested, matched, and reviewed rows quickly.

## Admin

- Admin actions require backend elevation through password re-entry.
- iPhone admin logs should be a focused troubleshooting view, not a desktop log
  explorer.
- Increase confirmation friction only for irreversible or broad destructive
  actions.
- Use native `Form` sections for health, backups, maintenance, logs, and import
  previews so the page remains operational rather than dashboard-decorative.
- Present backups, CSV exports, and log payloads through Quick Look/share sheet
  affordances after the server-generated artifact or payload is available.
