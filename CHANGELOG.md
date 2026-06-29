# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added subtle, click-like haptic feedback throughout the native iOS app: a light tap on the floating Quick Add button, a selection tick on every toggle and segmented picker (the type/range/mode/section switches across Dashboard, Insights, Transactions, Organize, Budgets, Recurring, Reports, Admin, Planning, and Account), success/error feedback when saving a transaction, and a light tap when sending an Assistant message with a distinct sharper tap when stopping a streaming response. Haptics respect the system setting, so there is no separate control.

### Changed
- Refreshed the native iOS app icon with an editable Icon Composer Liquid Glass receipt source.
- Redesigned the native iOS Assistant composer as a floating rounded glass capsule with margins on all sides instead of an edge-to-edge bar, so it reads as an intentional floating control rather than a detached slab when the keyboard raises it.

### Fixed
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
