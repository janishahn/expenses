# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added a read-only spending chat streaming API backed by Pydantic AI tools for period summaries, comparisons, breakdowns, transaction search/detail, and budget context.
- Added a web Spending Assistant page that progressively streams the read-only spending chat — a live tool-activity ticker and incrementally rendered Markdown answers with smart typography (em dashes, ellipses) — within a single calm composer surface, and reuses conversation context across turns.
- Added provider-reported LLM usage accounting for spending chat, including cached/reasoning token counters, precise cost decimals when available, structured chat lifecycle logs, and an authenticated usage-summary API for web and future mobile clients.
- Added an Assistant usage panel to the web Admin page summarizing Spending Assistant chats, token totals with cached/reasoning counters, provider-reported cost, average tokens per chat, and p95 latency, with a week/month/all-time period switch.

### Changed
- Simplified LLM configuration to a single OpenAI-compatible base URL, model slug, optional API key, feature-specific reasoning settings, and optional global temperature/output-token overrides.
- Made LLM structured responses use prompted JSON parsing, tightened natural-language search validation against runtime categories and tags, and increased the transaction-triage output cap for reasoning-token headroom.
- Spending chat trace rows now retain output hashes and counts instead of storing the final assistant text and returned message history.

### Fixed
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
