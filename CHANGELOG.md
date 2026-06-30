# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- The native iOS Transactions list now shows clear empty states instead of a blank screen: a "No matching transactions" card (guiding you to adjust the search or clear filters) when a search or filter returns nothing, a "No transactions yet" card for a genuinely empty list, and an "Inbox zero" card when no transactions are waiting to be categorized.

### Fixed
- The native iOS deleted-transactions list now colors amounts with the app's semantic income/expense theme colors (matching the active list) instead of a literal green for income and an un-themed neutral tone for expenses.
- The native iOS Digest week-navigation chevrons now read "Previous week" and "Next week" to VoiceOver instead of the generic "Back"/"Forward", so their action is clear.
- The native iOS Insights Flow and Durables sections now show a loading indicator while their data loads instead of briefly flashing the "No flow loaded" / "No durable purchases loaded" empty message — most noticeable on slower self-hosted hardware.
- The native iOS Budgets "+" button is now disabled on the Year tab (which has no add action) instead of opening the unrelated "Set Month Budget" form, and the month-budget row's remove action in the "…" menu now reads "Remove Month Budget" to match its confirmation dialog.
- The native iOS Forecast "What If" scenario runner now shows an error message when a scenario fails to run (for example an invalid effective month) instead of silently doing nothing.
- The native iOS Recurring rule list now colors amounts with the app's semantic income/expense theme colors (expenses now read red like every other transaction screen, instead of plain black), and the left-swipe auto-posting toggle is labeled "Manual"/"Auto" to match the row badge instead of the ambiguous "Disable"/"Enable".
- The native iOS recurring-rule occurrences screen now shows a clear "Couldn't load occurrences" message with pull-to-refresh when the load fails, instead of spinning forever with no way to retry.
- The native iOS Organize category/tag merge sheets now open with a clean error slate instead of occasionally showing a leftover error message from an unrelated earlier action.
- The native iOS Assistant's "LLM features are turned off" state now uses the same glass card styling as the other unavailable states on that screen instead of a plain system placeholder.
- The native iOS Reconcile, Reports, Account, and Admin screens now show a single error message at a time instead of occasionally stacking a generic error beneath the action-specific one.
- The native iOS Admin screen's "Latest Result" Preview button now keeps working after the first auto-preview is dismissed — it reliably re-opens the last database backup or CSV export instead of disappearing with no way to view the file again.
- The native iOS Admin log-entry detail now offers separate "Copy Request ID" and "Copy Payload" actions instead of a single ambiguous "Copy Request ID or Payload" button that silently copied one or the other depending on whether the entry had a request ID.
- The native iOS transaction detail screen now shows a "Couldn't load transaction" message with pull-to-refresh when its data fails to load, instead of spinning forever with no way to retry — most noticeable when the connection drops or on slower self-hosted hardware.
- The native iOS transaction detail's reimbursement amounts (linked reimbursement rows and the expense-search results) and the Forecast monthly breakdown amounts (income/expenses totals, recurring rules, variable estimates, one-time events) now use the app's semantic income/expense theme colors instead of literal green/red, so they match every other transaction screen — most visible in dark mode's warmer tones.
- Clearing the native iOS Transactions filters (the filter chip's clear button or the Filters sheet's Reset) now clears only the type/category/tag filters and keeps your active search text, instead of also wiping the search; the search field's own clear button still clears the search independently.
- Clarified copy in the native iOS bulk-edit sheet: the scope option that targets every transaction matching the current filters now reads "All filtered" (was the awkward "All loaded filter"), and the apply confirmation now reads "This will update every transaction in the selection." instead of referencing "the backend" and "resolved" transactions.
- The native iOS Insights Expenses/Income breakdown bars and ring now use the app's semantic income/expense theme colors instead of literal red/green, matching the Monthly Trend chart on the same screen and the rest of the app — most visible in dark mode.

## [0.3.1] - 2026-06-29

### Added
- Added subtle, click-like haptic feedback throughout the native iOS app: a light tap on the floating Quick Add button, a selection tick on every toggle and segmented picker (the type/range/mode/section switches across Dashboard, Insights, Transactions, Organize, Budgets, Recurring, Reports, Admin, Planning, and Account), success/error feedback when saving a transaction, and a light tap when sending an Assistant message with a distinct sharper tap when stopping a streaming response. Haptics respect the system setting, so there is no separate control.

### Changed
- Renamed the web Assistant page title from "Spending Assistant" to "Assistant" (matching the navigation label) and turned its New Chat control into a compact icon-only button pinned beside the title, so it no longer wraps onto a second line under the title on narrow viewports.
- Refreshed the native iOS app icon with an editable Icon Composer Liquid Glass receipt source.
- Redesigned the native iOS Assistant composer as a floating rounded glass capsule with margins on all sides instead of an edge-to-edge bar, so it reads as an intentional floating control rather than a detached slab when the keyboard raises it.

### Fixed
- Transaction location maps now render OpenStreetMap tiles by default instead of a blank map. Tiles previously appeared only when the optional `VITE_MAP_TILE_URL` build setting was set, so self-hosted deployments that left it unset saw an empty map; the provider stays overridable via `VITE_MAP_TILE_URL`.
- Mobile Safari no longer zooms in when focusing web form fields (the transaction title and description, tags, selects, and other shared inputs): the shared field styles now render at 16px on mobile — keeping the compact 15.2px size on desktop — instead of a flat sub-16px size that overrode the existing 16px-on-mobile rule.
- Native iOS app no longer resets to the Dashboard after a brief background (for example pulling down the notification shade): the open Assistant chat, navigation depth, and an open Add-Transaction sheet now survive quick app switches within the local-unlock grace window. The local-unlock cover is now drawn in a separate top-level window above the live content — including any presented sheet — instead of replacing the content, so it preserves navigation state while still hiding sensitive content (sheets included) in the app switcher and under the notification shade.

## [0.3.0] - 2026-06-29

### Added
- Added a read-only spending chat streaming API backed by Pydantic AI tools for period summaries, comparisons, breakdowns, transaction search/detail, and budget context.
- Added a web Spending Assistant page that progressively streams the read-only spending chat — a live tool-activity ticker and incrementally rendered Markdown answers with smart typography (em dashes, ellipses) — within a single calm composer surface, and reuses conversation context across turns.
- Added a native iOS Assistant screen under More > Tools that streams the read-only spending chat over a mobile bearer session, surfacing work with a stable thinking row plus a second rolling tool ticker that retires once the final answer streams — with a compact working indicator kept visible while streaming — alongside Markdown-rendered assistant bubbles, a tab-bar-free composer, a stop control, and a new-chat reset, and reuses conversation context across turns.
- Added provider-reported LLM usage accounting for spending chat, including cached/reasoning token counters, precise cost decimals when available, structured chat lifecycle logs, and an authenticated usage-summary API for web and future mobile clients.
- Added an Assistant usage panel to the web Admin page summarizing Spending Assistant chats, token totals with cached/reasoning counters, provider-reported cost, average tokens per chat, and p95 latency, with a week/month/all-time period switch.

### Changed
- All AI features now respect `EXPENSES_LLM_ENABLED`: when it is off (the default), the web and iOS apps hide every AI surface — the Assistant nav entry and route, the rule-mining and suggestions controls, transaction triage, natural-language search, and the admin Assistant-usage panel — and every `/api/ai/*` endpoint returns `503`, so the feature is cleanly absent rather than failing on use. The flag is surfaced to clients via `/api/auth/bootstrap-status` and `/api/mobile/status`.
- Simplified LLM configuration to a single OpenAI-compatible base URL, model slug, optional API key, feature-specific reasoning settings, and optional global temperature/output-token overrides.
- Made LLM structured responses use prompted JSON parsing, tightened natural-language search validation against runtime categories and tags, and increased the transaction-triage output cap for reasoning-token headroom.
- Spending chat trace rows now retain only hashes and counts for both the request input and the response output, instead of persisting the prompt, the running message history, the final assistant text, or returned tool data.
- Polished the native iOS Assistant streaming presentation: the model's intermediate progress sentences now appear as an ephemeral full-width status row that stays out of the saved answer, the working status hands off cleanly to the Markdown answer, a trailing typing caret replaces the streaming progress spinner, a subtle shimmer marks ongoing status, and a quiet collapsed activity disclosure above each tool-using turn surfaces only high-level steps; all new motion is gated behind Reduce Motion, the tool ticker scales with Dynamic Type without clipping, and VoiceOver no longer narrates every status flip.

### Fixed
- Native iOS bottom tab bar now animates back in together with the pop transition when leaving the Assistant chat, instead of blinking into existence after the pop finishes; tab-bar hiding is now driven by the More navigation stack rather than the pushed detail view.
- Native iOS Assistant answers now render Markdown with real block structure — paragraph and list spacing is preserved instead of collapsing into one run, so sentences and bold category names no longer jam together.
- Spending chat streaming now separates model progress narration from final answer chunks before they reach clients, preventing intermediate narration from flashing as assistant answer text on iOS.
- Spending Assistant category breakdown tools now use SQL aggregation instead of hydrating transaction rows, and transaction-search tool chips include query/type details when present.
- Spending Assistant "largest transactions" searches now order by amount in the query, so the biggest transactions over long periods are no longer missed when they fall outside the most recent candidate window.
- Admin Assistant-usage cost totals now label the unit as `mixed` whenever costed jobs disagree on a unit, including when some jobs report a cost with no unit, instead of letting row order pick a single label for incompatible costs.
- Admin Assistant-usage average cost now keeps enough decimal scale for the division instead of rounding to the inputs' scale, so an average of `0.01` and `0.02` reports `0.015` rather than `0.02`.
- Spending Assistant now derives the current date and timestamp from `EXPENSES_TIMEZONE` instead of the process/UTC clock, so "today", "this month", and budget-progress answers use the configured local day even when the server runs in another timezone near midnight.
- Natural-language search now returns a clarification instead of a server error when LLM output cannot be made valid after retries.
- Natural-language search now rejects unsupported boolean connector syntax from LLM translations instead of treating it as title text.
- Docker Compose now forwards the current LLM endpoint, model, API key, temperature, and output-token environment variables.

## [0.2.1] - 2026-06-24

### Changed
- Renamed remaining legacy hyphenated app, service, API, export, and package identifiers to `expenses`.
- Renamed the Python import package to `expenses`.

## [0.2.0] - 2026-06-24

### Added
- Added a self-describing portable ZIP export for current-user data, including schema, manifest, NDJSON datasets, and receipt files for migration or agent-assisted import workflows.

### Changed
- Self-service account signup is now enabled by default; set `EXPENSES_AUTH_SIGNUP_ENABLED=false` to restrict the app to existing accounts.
- Reworked the web sign-in and sign-up screens into clearly separated flows, each with its primary action plus a labeled button to switch between signing in and creating an account.
- Reworked the README into a product-oriented feature tour, added native iOS app screenshots, and documented changelog-maintenance conventions for contributors.

### Fixed
- Pinned the mobile status and admin info tests to the running app version instead of a hard-coded value, so CI no longer breaks after a release version bump.

## [0.1.1] - 2026-06-24

### Removed
- Removed the non-functional iOS "Capture Wallet Transaction" App Shortcut; a working version may return in a future release.

## [0.1.0]

Initial public source-available release.

### Added
- Income and expense ledger with categories, tags, advanced search, bulk edit, soft-delete, markdown descriptions, locations, and receipt attachments.
- Monthly budgets with pace/burn-down indicators, recurring budget templates, and per-month overrides.
- Dashboard, digest, forecast, scenarios, and insights views, including cash-flow Sankey grouping.
- Recurring rules with idempotent auto-posting and subscription-style cost framing.
- CSV import/export, PDF reports, legacy SQLite import, and Commerzbank CSV reconciliation.
- Multi-user auth with per-user data isolation, one-time bootstrap setup, persistent web sessions, mobile bearer sessions, and short-lived admin elevation.
- Native SwiftUI iOS client targeting a self-hosted backend, with a Wallet transaction App Shortcut.
- Token-authenticated `/api/ingest` endpoint for external automations.
- Optional, disabled-by-default LLM assistance through an OpenAI-compatible endpoint.
- Docker and bare-metal deployment paths, with a recommended Tailscale tailnet serving model.

[Unreleased]: https://github.com/janishahn/expenses/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/janishahn/expenses/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/janishahn/expenses/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/janishahn/expenses/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/janishahn/expenses/releases/tag/v0.1.0
