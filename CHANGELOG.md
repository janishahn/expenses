# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Admin → AI usage, on the web and iOS, shows every AI feature's usage: the Assistant, categorization suggestions, and rule suggestions. A chart shows cost or tokens by day, week, or month for each feature's model and backend. Open a model to see its usage alone, and open an Assistant chat to see the tokens and cost of each of its latest 100 turns. Other users' chats show as "Chat by" their username, without their titles. Models without a published price, such as a self-hosted model, show tokens only.
- `GET /api/admin/ai/usage` and `GET /api/admin/ai/usage/chats/{chat_id}` return this usage. They need admin access.

### Changed
- Admin → Assistant usage is now Admin → AI usage.
- The server keeps every AI run's usage. It still clears the stored prompts and outputs of runs older than 30 days, or beyond each user's latest 1,000, but keeps their time, feature, backend, model, tokens, and cost. Before, it deleted those runs, so All time covered only the last 30 days. A run cut off mid-call, for example by a restart, counts as failed after a day.
- Runs from before this version show their backend's kind, such as `openrouter`, instead of its name. Assistant turns from before this version count in the totals but are not listed under a chat.
- Transaction lists show what a reimbursed expense cost you after reimbursements, matching the day totals. On the web desktop layout the charged amount sits struck through before it, and the printed ledger does the same. On mobile web and iOS the row shows the net with the reimbursement mark, so iOS rows now show reimbursements at all. Reimbursement income is muted and carries the same mark, since its expense already counts it. This applies to Transactions, tags, categories, and the dashboard's Recent list.

### Removed
- `GET /api/ai/usage/summary`. Use `GET /api/admin/ai/usage`.

## [0.8.2] - 2026-10-16

### Fixed
- With an Anthropic backend, every Assistant message failed because Anthropic's API refused the Assistant's tool definitions as too complex. The Assistant now answers with Anthropic models.

## [0.8.1] - 2026-10-16

### Changed
- An Assistant card from 0.8.0 that edits transactions, or that undoes added or edited transactions, says to ask again if it is still waiting after the update. The Assistant can't undo transactions it added or edited under 0.8.0.

### Fixed
- With an Assistant chat open in two windows, retrying an answer in one while approving its card in the other could leave the change applied with its card gone. The chat now keeps the approved answer and its card, and the retried answer isn't saved.
- Approving an Assistant card that edits transactions, or that undoes transactions it added, applied it even when a date, amount, title, or category on the card had changed since, or when the category it moves them to had been archived since. The card now says so and changes nothing.
- After a restart, the server stopped answering every request for several seconds on a Raspberry Pi the first time Admin > AI listed a backend's models, or the first time it made a categorization or rule suggestion, while it loaded the backend's library. Saving AI settings during that pause could fail and leave the Model menu empty. The server now answers other requests while the library loads.

## [0.8.0] - 2026-10-16

### Added
- When a web page can't reach the server, for example while it restarts after an update, the page shows a receipt that keeps trying again and loads the page by itself once the server answers. Retry now tries at once. Errors the server returns still show the reason and Retry, and so does a proxy's 502 or 504 for one request while the server itself still answers.
- Print the web Transactions ledger from ⋯ › Print… or with Cmd+P (Ctrl+P on Windows and Linux). The printout lists every transaction for the current period and filters, grouped by day, and closes with the period's Spent, Cash in, and Net. Hidden amounts stay hidden.
- On iOS Insights, touch and hold the daily spending calendar, then drag to scrub through the days. Each day ticks as you pass it, harder on days you spent more.
- The Assistant reads recurring payments, the forecast, balance history, reimbursements, and durable purchases. It can filter transactions by several categories and tags, amount, and text, and group them by category, tag, merchant, month, week, or weekday, with a comparison period.
- The Assistant keeps your chats on the web and iOS: the header opens Recent chats and starts a New chat, a new chat lists recent ones instead of suggested questions, and on the web the URL names the open chat. While it works, one line names the current step (thinking, a note, or a ledger read); when the answer starts it folds into a summary that opens to list each step and the reasoning summary. Answers write amounts the way the app does (1 234,56 €).
- Ask the Assistant to add transactions, change the category, tags, or title of transactions, allocate a reimbursement to expenses (for example half of each), or set budgets. It shows the exact change on a card, and nothing changes until you tap the card's button; Dismiss, or a new message, leaves your data as it was. Transactions it adds keep the card's category and tags; rules and suggested categories don't change them. Ask it to undo a change it made, and it shows that on a card too. `POST /api/assistant/chats/{chat_id}/approvals/stream` approves or dismisses a card and streams the rest of the answer.
- Assistant answers link the transactions they name. On the web a link opens the transaction in a peek beside the chat; on iOS it opens the transaction's page.
- Settings › Assistant on the web and iOS sets how long the server keeps your Assistant chats: 7, 14, 30, or 90 days after the last message, 14 by default. Older chats, and the record of changes made in them, are deleted each night. `GET` and `PUT /api/assistant/settings` read and change it.
- On iOS, a reimbursement's Allocate button opens a menu with the remaining amount, half, and a third of the expense, like the web's ½ and ⅓ buttons. Pick one to allocate it without typing; Other Amount… opens the amount field as before.
- Allocate a reimbursement from the expense it pays back. On the web, the expense's Reimbursed property has a + that picks a reimbursement with money left and an amount, with ½ and ⅓. On iOS, tap Reimbursed to pick a reimbursement, then Remaining, Half, Third, or Other Amount…. Reimbursements with money left are listed newest first, up to 10, by the new `GET /api/transactions/{id}/open-reimbursements`. With an older server, the iOS row shows only the total.

### Changed
- **Breaking:** AI configuration moves from `EXPENSES_LLM_*` to named backends in `EXPENSES_AI_BACKENDS`, with `EXPENSES_AI_<NAME>_KIND`, `_BASE_URL`, and `_API_KEY` for each. Kinds are `anthropic`, `openai`, `openrouter`, and `openai-compatible`, so the Anthropic API now works directly. The server refuses to start while any `EXPENSES_LLM_*` variable is set; see the AI section of the README. Docker Compose passes the repo-root `.env` file to the container, so backends of any name reach it.
- An admin turns on each AI feature (the Assistant, categorization suggestions, rule suggestions) in Admin > AI on the web and iOS, and picks its backend, model, and thinking level for the whole server. Per-user AI settings are gone, and every AI feature starts off after the update.
- Admin > Assistant usage covers all users and needs admin elevation. Costs are estimated in US dollars from published model prices.
- **Breaking (API):** The server stores Assistant chats. `POST /api/ai/spending-chat/stream` is replaced by `POST /api/assistant/messages/stream`; `/api/assistant/chats` lists, opens, and deletes chats, and `POST /api/assistant/chats/{chat_id}/retry/stream` answers the last message again. A stopped answer keeps what it wrote so far.
- Redesigned the iOS app to match the web redesign in light and dark. Dashboard, Transactions, Budgets, and Insights are tabs; More lists Forecast, Uncategorized, the Manage screens, the Tools, Settings, and Admin. Every screen takes the web page's content: transaction and Manage details save each field as you edit it, Uncategorized accepts or rejects suggested categories, Trash restores or deletes in bulk, Budgets steps through months with pace, Insights shades overspent months and shows the month grids, daily calendar, and budget history, Reconcile reviews statement rows in suggested, several-match, and no-match groups with ignore reasons, Ignore Remaining Rows, and a Resolved view, Settings and Admin have the web's sections, and the Assistant lists each tool step with its result. Without a stored session the app opens on one sign-in screen.
- The redesigned iOS app adapts to every text size, including the accessibility sizes, and follows Increase Contrast and Reduce Motion. Entry sheets ask before discarding what you entered, screens that fail to load offer Try Again, and the Insights, Forecast, and What If charts label their amounts.
- The iOS Transactions search field starts hidden. Pull down at the top of the list to show it.
- When the iOS app is locked and Face ID is canceled, the app shows a sign-in screen. Sign in with the server account there, or tap Unlock with Face ID to try again.
- Hide amounts on iOS covers every amount in the app, including Assistant answers, and blurs amounts instead of drawing gray boxes.
- iOS CSV export moves from Reports to Settings > Import and Export, next to the portable archive. Reports builds the web's report, including category and tag scope, and opens the PDF in Quick Look.
- The redesigned iOS app needs a 0.7.1 or later server.
- An expense's Durable property shows only while it is tracked. Start tracking from ⋯ › Track as durable… on the web, or ⋯ › Track as Durable… on iOS.
- The amount a reimbursement suggests for an expense it already pays back now includes what is allocated there, because saving replaces that allocation.
- The server records a device's last use at most every five minutes instead of on every iOS request, so the iOS device list can show a last use up to five minutes old.
- The web Transactions, Uncategorized, and Reconcile match searches ask the server once typing pauses instead of on every key. Printing the Transactions ledger loads 1,000 rows per request instead of 100, and Undo after Match All or Ignore Remaining Rows in Reconcile takes one request per 500 rows; rows that changed since stay as they are.
- Saving a transaction on the web no longer reloads every category's and tag's all-time totals for the pickers, and the Insights month grids and daily calendar no longer redraw every cell while the pointer moves.
- After a save, iOS reloads the Transactions pages already loaded four at a time instead of one after another. The Dashboard reloads after a change, or when you return to it a minute or more after its last load, instead of each time it appears. Assistant answers redraw less while they stream, and receipt photos are prepared off the main thread.

### Removed
- Sign in with ChatGPT, the `connect-chatgpt` command, and `EXPENSES_AI_CREDENTIAL_KEY_FILE`. Existing installs can delete `EXPENSES_DATA_DIR/secrets/chatgpt/` and revoke the Expenses connection in ChatGPT's settings.
- The iOS AI triage queue for uncategorized transactions, and the iOS Insights flow, rings, durables, and movement views.
- The Add another switch in the web and iOS add-transaction forms. The form now closes after each add.

### Fixed
- Admin › Assistant usage on the web and iOS rounds costs under 1 to three significant digits, so a cost such as $0.0000213 per chat no longer overflows its card.
- iOS camera receipts are saved at one pixel per point, so their thumbnails stay under the server's pixel limit.
- Canceling Face ID on the iOS lock screen no longer starts Face ID again right away.
- The web Budgets Annual band no longer counts spending and limits twice when an overall annual budget sits next to category budgets. With an overall annual budget, the band shows its figures.
- iOS searches and account labels that contain + no longer reach the server with a space in its place.
- The iOS app no longer keeps server responses, such as receipt images, in its disk cache.
- Editing a transaction on iOS while the phone is in another time zone than the server no longer moves its time or booking date: iOS shows and saves stored times in the server's time zone. Balance snapshot times no longer shift by the UTC offset on iOS, because `GET /api/settings` now returns each snapshot's `as_of_at` with the server zone's offset, as `occurred_at` already does.
- Amounts with a third decimal, such as 12,345, are rejected on the web and iOS instead of being rounded to cents.
- Periods, budgets, the weekly digest, and durable purchase ages now count days in `EXPENSES_TIMEZONE`, not the host's system clock. On a host that runs in UTC, today's transactions no longer drop out of the dashboard, transactions, and insights in the hours before UTC midnight, and This month no longer points at the previous month on the first day of a month.
- Opening a web page whose code can't load no longer leaves a blank window. While the server is down, the page shows the can't-reach-the-server receipt and reloads by itself once the server answers; otherwise, for example after an update renamed the page's files, it keeps the page title and offers Retry. When the add-transaction form's code can't load, a message offers Reload and the page stays.
- Moving a recurring rule's start later kept its earlier next occurrence, so the rule could post before its start. Saving a rule whose start is after its next occurrence now moves the next occurrence to the start.
- Saves made while an AI feature waited for its model, such as an Assistant answer, could stall for five seconds and fail with "database is locked". The AI job no longer holds the database's write lock during the model call.
- CSV and statement imports, archive imports, receipt uploads, and email ingest no longer pause every other request while the server processes them.
- When the iOS app's session expired or was revoked while the Dashboard or Transactions loaded, Sign in stayed disabled until the app restarted. Sign in now works right away.

## [0.7.1] - 2026-10-14

### Added
- Reconcile can ignore every remaining row to review at once from ⋯ › Ignore remaining rows…, within the account filter. `POST /api/reconciliation/bank-rows/ignore-open` ignores all open rows, optionally for one `account`, and returns their ids.
- The dashboard's `budget_pace` includes the overall budget's `spent_cents`, `remaining_cents`, `daily_remaining_cents`, and `days_remaining`.

### Changed
- On mobile, the dashboard opens with one summary card: Spent, the overall budget with what is left per day and the likely month total, then Balance, Cash in, and Net. Budgets and Recent follow, and Category share shows a small ring with its five largest shares.
- Insights' Income and expenses chart shades months where expenses exceed income as Overspent instead of Saved, and draws the month in progress dashed without shading.

### Fixed
- Category share on the dashboard included only the eight largest categories, so its total fell short of the period's spending.
- Text fields filled in by the browser or a password manager showed the browser's autofill color as a box inside the field.

## [0.7.0] - 2026-10-13

### Added
- API fields and endpoints for the redesigned web UI: a transaction list `total`; net and reimbursed amounts, `created_at`, and the linked bank row on transaction detail; paged Trash with bulk restore and permanent delete; an admin purge preview; month-end balance history; period totals on categories and tags; tag `created_at`; `category_id` on breakdown items; a 6- or 12-month category breakdown; and Insights month grids, recurring split, a 53-week day calendar, budget history, `recurring_cents`, and income and expense totals for the exact period with its month count.
- An optional `rule_anchor_date` on the recurring preview, so a saved rule previewed from its next occurrence keeps its original schedule, and the transaction `type` on Digest auto-posted items.
- Uncategorized transactions show local-model category suggestions while automatic categorization is on and trained. A rejected suggestion is remembered per transaction, follows its category through a merge, and is kept in portable exports.
- `GET /api/settings/auto-categorization`, and the minimum training history (`min_history`) in automatic categorization settings.
- Bulk transaction edits accept an optional `expected_category_id` and skip transactions in any other category, so undoing a category change leaves a transaction changed since as it is.
- Attachment uploads accept an optional `replaces_attachment_id`, which swaps that attachment for the new file in one request, so a receipt can be replaced at the five-attachment limit.
- Bank reconciliation records how each statement row was resolved (matched, created, or ignored) with an optional ignore reason. New endpoints list open and resolved rows by account with paging, list bank accounts, search all transactions of the row's direction for a match, accept suggested matches in bulk (accepting a suggestion returns the matched transaction), and optionally update the transaction amount to a EUR bank amount when matching, returning the replaced amount. Creating a transaction from a row accepts tags and notes. Reopening can move the created transaction to the trash, can require the row's expected outcome and transaction, returning 409 when the row changed, and can restore the amount a match replaced; matching can restore the created outcome, taking its transaction back out of the trash.

### Changed
- Redesigned the web app around one quiet visual system in light and dark. Desktop has a sidebar and an inset page panel; mobile has a tab bar with a More sheet. Every page, chart, dialog, and menu uses the same components, and charts can show their data as a table.
- Transactions open in a side peek or a full view where every field saves as you edit it; a failed save keeps your entry and shows the error. `/transactions/:id/edit` now opens the transaction. Adding a transaction starts from the Transactions header on every layout.
- Settings and Admin are sections with their own URLs, and changes save at once. Admin asks for your password in place before showing server sections.
- Reconcile reviews statement rows in suggested, several-match, and no-match groups, with Match all, a search for any transaction, ignore reasons, create and match, Undo for every action, and a Resolved view filtered by outcome and account.
- Bank rows matched to a transaction that is later moved to the trash are open for reconciliation again.
- Reconcile suggests a match for a non-EUR bank row only from a transaction entered in that currency with the same amount, not from a euro transaction with the same number.
- Upgrading backfills existing bank rows as ignored (if reviewed) or matched. Rows created from a statement before this release are marked matched, because they cannot be told apart from matched rows.

### Removed
- The separate transaction edit page, and the mobile navigation drawer and floating add button.

### Dependencies
- Replaced ESLint and its plugins with oxlint for web linting. `npm run lint` keeps the previous rules and adds design rules that keep pages on the shared component kit.
- Removed Recharts, class-variance-authority, tailwind-merge, and the IBM Plex Mono font from the web app. Tailwind CSS now supplies only the CSS reset.

## [0.6.1] - 2026-10-12

### Dependencies
- Updated Pydantic AI Slim and Pydantic Graph to 1.107.7, including upstream security fixes while remaining on the 1.x release line.
- Updated Mako to 1.4.2 to include upstream security and bug fixes in Alembic's template dependency.

## [0.6.0] - 2026-10-12

### Added
- Per-user local automatic categorization in web and iOS settings, off by default with an adjustable minimum confidence (default 80%). Settings show training progress and issues separately from unsaved changes; the toggle alone indicates when categorization is active. Enabling trains from categorized history; enabled users are checked weekly for changed training data.
- New expenses use calibrated title-neighbor predictions only after manual categories and deterministic rules. Unreviewed predictions are excluded from training, and the previous model remains available during retraining.
- Choose minimum confidence from 0–100% in 1% steps using a number field with up/down arrows on the web or a compact percentage row that opens a native wheel picker in an iOS bottom sheet.

### Fixed
- Restore focus to the mobile Add button after dismissing its dialog in WebKit.
- Ingest audit logs identify automatic category assignments instead of reporting the original category resolution.
- Discard unsaved iOS categorization settings and dismiss the confidence picker when the signed-in account changes.
- Ignore completed categorization saves and errors from an old iOS session after switching accounts.
- Preserve automatic-category confidence in portable exports so unreviewed predictions remain identifiable when migrating data.
- Bound temporary vocabulary collection during local model training to reduce peak memory for long, diverse transaction titles.
- Remember insufficient training histories so weekly checks retry only after eligible data changes, while retaining any previous model.

## [0.5.3] - 2026-10-06

### Added
- Optional Sign in with ChatGPT plan usage, with a local connection helper, protected per-user credentials, renewal, and disconnect controls.
- Per-feature provider, model, and thinking-level settings on web and iOS, with model discovery for ChatGPT and OpenAI-compatible providers.
- Custom ChatGPT model IDs on web and iOS, validated with the connected account before saving when absent from the model catalog.

### Fixed
- Preserve ChatGPT usage-limit recovery guidance for standalone streaming errors and SDK error envelopes.
- Compact AI settings on desktop with aligned model controls, responsive spacing, and save and validation feedback beside the save action.
- Apply OpenAI strict tool schemas to ChatGPT requests and preserve provider-specific recovery messages for failed requests.
- Gave the Dashboard recent-transactions link a minimum 44-by-44-pixel touch target on mobile.

### Dependencies
- Updated source-map-js to 1.2.2 to fix a source-map parsing denial-of-service vulnerability in frontend tooling.
- Removed the unused shadcn generator dependency and its vulnerable dependency chain from frontend installs.
- Updated Tiptap, HTTPX2/HTTPCore2, and frontend tooling dependencies to address reported security vulnerabilities. HTTPX2 now uses the operating system certificate trust store and bounds streaming decompression memory.
- Updated WeasyPrint to 70.0, AnyIO to 4.14.2, urllib3 to 2.8.0, ip-address to 10.7.2, undici to 7.30.0, and affected Markdown and frontend tooling dependencies to resolve current dependency audit findings.

## [0.5.2] - 2026-08-22

### Fixed
- Restored Dashboard spending-band categories to their correct stack positions after clearing a tag filter.

## [0.5.1] - 2026-08-22

### Fixed
- Aligned the Budgets and Digest period navigators, replaced the misplaced native iOS budget month picker with an anchored picker, and let both toolbars span the mobile viewport without changing their desktop widths.

## [0.5.0] - 2026-08-22

### Added
- Tags can be archived and restored without losing their settings or existing transaction associations; archived tags leave future assignment pickers while remaining editable and hard-deletable.
- Each tag can be hidden independently from analytical and transaction filter menus.

### Changed
- Historical filter menus continue to offer archived tags unless they are explicitly hidden, and applied hidden tag scopes remain named and removable.
- Editing transactions or applying name-based rules, templates, and bulk changes no longer silently restores archived tags.
- Removed redundant narration, repeated helper text, decorative sublines, and obvious-control copy across the web interface while retaining decision-critical consequences, exact values, states, errors, and accessibility text.
- Clarified that the Admin recurring catch-up action posts all overdue transactions.

### Fixed
- Kept the desktop sidebar's scroll gutter stable while hiding its scrollbar thumb until the navigation is hovered or keyboard-focused.
- Docker Compose now forwards `EXPENSES_AUTH_SIGNUP_ENABLED`, so setting it to `false` in `.env` disables self-service signup as documented.

### Dependencies
- Updated the locked pip tool from 26.1.2 to 26.2.1.

## [0.4.10] - 2026-08-21

### Added
- Dashboard, Insights, and Transactions can temporarily include or exclude several tags; transaction lists, summaries, exports, bulk scopes, drill-downs, and analysis values share the same scope while actual balances and budgets remain unchanged. iOS retains its multi-tag exclusion filter.
- PDF reports can include only transactions with any selected tag or exclude transactions with any selected tag across summaries, breakdowns, trends, subtotals, and transaction tables.
- `uv run dev --tailnet` now creates a temporary, loopback-backed Tailscale Serve preview with automatic port selection and cleanup; detached previews can be managed with `--detach` and `--stop`.

### Changed
- Reworked mobile web chrome around page-owned Menu/Back title rows and one overlay-aware floating create action shared by Dashboard, Transactions, and the planning, automation, and library pages. Removed the persistent web theme toggle so appearance is configured only in a more compact Settings card.
- Unified page-level web filtering around a visible quick period switch plus one shared Filters gateway for occasional type, category, and tag scopes. Desktop uses an anchored apply/cancel panel, mobile uses the matching bottom sheet, active badges count filter kinds, and compact chips summarize the applied scope. Insights keeps chart category and budget month beside the sections they configure.
- Kept Dashboard and Insights filtering focused on include-or-exclude tag scopes; transaction type remains a Transactions-ledger and report-builder option.
- Standardized period-based web pages on one responsive scope header, with title-left and quick period/Filters controls-right when space allows. Insights and Recurring now use URL-backed page tabs for their whole-page modes, and Transactions keeps Search directly available while grouping Inbox, Trash, and CSV export in an overflow menu.
- Tightened the mobile Transactions header by moving its overflow menu beside the page title and moving the four-choice period selector into the staged filter sheet, where non-default periods remain visible in the filter badge and active chips.
- Removed redundant explanatory sentences from filter panels and active-filter rows so the controls and concise state chips carry the interface.
- Hardened temporary Tailnet previews with per-checkout ownership checks, serialized lifecycle operations, private bounded logs, and recoverable cleanup state.

### Removed
- Removed the unused `/api/kpis` endpoint; Dashboard and report calculations continue to use their purpose-built service paths.

### Fixed
- Fixed elevated Admin routes rendering without their shared shell context and restored mobile navigation focus to the current route after drawer navigation.
- Prevented stale or contradictory transaction bulk scopes from being submitted while changed filters are still loading, and reject requests that try to include and exclude tags simultaneously.
- Kept Dashboard spending drill-downs, Insights top tags, and tag-scoped PDF running balances and subtotals within the selected tag scope, including reimbursement adjustments.
- Reduced filtered Dashboard sparkline work to batched monthly calculations suitable for constrained self-hosted hardware.
- Kept the checked-in iOS API contract and fixtures synchronized with report tag filtering, and fixed the native Dashboard request return path.
- Report generation now requires at least one selected tag when Only include or Exclude mode is chosen instead of silently generating an unfiltered report.
- Kept the desktop page canvas stationary when modal dialogs open and close on browsers with classic scrollbars.
- Aligned the mobile Transactions search clear control with the search field's trailing edge.
- Aligned desktop page actions with the centered content canvas on wide displays and kept the page stationary while anchored filter panels open and close.
- Kept the shared quick-period selector and Filters trigger at the same height across mobile and desktop page-scope headers.
- Mobile Transactions search now expands into a field inside the control row instead of opening a popover that rendered below the visible viewport, where tapping Search appeared to do nothing in Safari. Filters slides out of the row while search is open and returns when it closes.
- Kept the desktop page canvas stationary when switching between Insights tabs whose content needs different amounts of vertical space or opening the Transactions overflow menu.
- Kept desktop filter panels and their Apply/Cancel actions inside short browser viewports while allowing long filter lists to scroll.
- Removed the unintended outline-like ring from the Transactions page's search and header action buttons on desktop and mobile.
- Tag filter menus now let users choose Include or Exclude before selecting any tags and stay open for the following selection.
- Tag filter lists now show a distinct checkbox for every choice before it is selected.

## [0.4.9] - 2026-08-20

### Changed
- Unified analytical page headers, ordinary form fields, inline actions, and ledger surfaces around the shared web UI patterns so sibling workflows now keep the same hierarchy and control treatment on desktop and mobile.
- Admin purge, rollup rebuild, and recurring catch-up actions now report accessible inline outcomes instead of interrupting the workflow with native browser alerts.

## [0.4.8] - 2026-08-19

### Changed
- Reconciliation now processes CSV files into one focused inbox, makes likely transaction matches easier to scan, preserves a reviewed outcome for known discrepancies, and lets users edit a new transaction before creating and linking it to a bank row.

## [0.4.7] - 2026-08-16

### Changed
- Web charts now use Recharts SVG rendering, rounded chart geometry, roomier mono axes, quieter grid lines, compact theme-aware hover tooltips, and 15%-faster animation across the dashboard, Insights, Forecast, What If, Budgets, Tags, Recurring, and Admin views. Financial meaning, drill-downs, keyboard access, privacy behavior, and the surrounding page design remain unchanged; the native iOS app continues to use Swift Charts.

### Fixed
- Dashboard spending-band tooltips now render above their chart rows and nearby cards instead of being clipped to the 24px band, while the chart legend stays inside its card.
- Dashboard, Forecast, What If, and budget range areas now use their intended 16-18% shading instead of Recharts reducing them by another 40%.
- Dashboard actual and likely balance strokes now animate as one continuous timeline instead of drawing as two separate lines at the same time.
- Tag detail sparklines now preserve the full backend trend instead of treating coordinate pairs as raw values and plotting the wrong shape.
- Keyboard focus now enters and stays within the responsive navigation drawer without being reset mid-navigation, returns to the invoking control after drawers, dialogs, and sheets close, moves into revealed transaction search, and remains on a template after keyboard reordering; Admin logs also expose explicit keyboard and screen-reader Inspect actions.
- Mobile controls now keep at least a 44px effective touch target across navigation, filters, tags, selection, reports, imports, switches, chart data, and transaction maps while preserving compact desktop density; Transactions actions also stay beside the page title, and long native-select options no longer widen transaction editors beyond the viewport.
- Route and subquery failures now retain consistent page context and offer Retry, missing resources provide a direct return path, and failed mutations—including FastAPI validation responses—show accurate, readable detail instead of raw JavaScript or JSON error text.
- The Budgets Add action now appears only after its route data is ready, preventing a click during loading from being silently discarded.

### Dependencies
- Replaced Chart.js and react-chartjs-2 with Recharts and react-is in the web frontend.

## [0.4.6] - 2026-08-16

### Changed
- Replaced the web Sankey and the native iOS source/use lists with a responsive Net view built from recorded income and expense totals. Small categories group under Other without inventing links between income sources and spending; both clients include selection, details, and a full data view, while web keeps expense drill-downs.

### Dependencies
- Removed the web Sankey plug-in after replacing that chart with the focused Net view.

## [0.4.5] - 2026-08-15

### Changed
- Destructive and bulk actions across the web app now confirm through a shared in-app dialog instead of the browser's native confirm prompt, and rule deletion plus budget-plan removal now ask for confirmation before deleting.
- Web dialogs and bottom sheets now animate open and closed; previously they appeared and disappeared instantly because the motion styles never ran.
- Buttons across the web app share one press response (a subtle scale with fast, named transitions) instead of mixed or missing feedback per button style.
- Web pages now show their title and a panel-shaped placeholder while route data loads, replacing the bare "Loading …" text line that shifted the whole layout on arrival. The placeholder only appears when a load is still pending after 250ms, so fast page switches swap straight to content without a flash.
- Analytics charts no longer play Chart.js's default one-second redraw animation when periods or filters change, keeping updates instant and cheap on small hosts.

### Fixed
- Segmented controls (time range and mode selectors) no longer slide their selection highlight in from the control's corner when a page or sheet first renders; the highlight now appears directly under the active option and animates only on selection changes.

## [0.4.4] - 2026-08-14

### Changed
- Reworked the web tag detail page into a balanced summary, activity, settings, and breakdown layout. Tag settings now stay read-only until Edit opens the focused editor, matching the rest of the app instead of leaving a form permanently visible.

### Fixed
- Automatic start and end date fields now stay within tag modals on iPhone Safari instead of overflowing when WebKit miscalculates padded controls at full width.

## [0.4.3] - 2026-08-14

### Dependencies
- Updated Python AI and frontend dependencies to resolve the current published security advisories.

## [0.4.2] - 2026-08-14

### Added
- Tags can now define an inclusive automatic date range. Web and iOS transaction forms show matching tags as removable defaults, while token-authenticated ingest attaches them silently; recurring posts, reconciliation, and imports remain unchanged.

### Changed
- The Dashboard's six-month spending chart now shows the current month at the top instead of the bottom.

## [0.4.1] - 2026-07-23

### Changed
- Simplified the web login screen to one centered sign-in form, removed promotional copy, and capitalized the Expenses name consistently.

### Dependencies
- Updated frontend development dependencies to address high-severity security advisories.

## [0.4.0] - 2026-07-21

### Fixed
- Transaction search now accepts untitled records.
- Filtered transaction summaries now evaluate fuzzy title and description matching once per request instead of repeatedly scanning the ledger for each total.
- Query-wide bulk actions now wait for the authoritative matching count before they can run, preventing the selection copy from understating how many transactions will be affected; changing search or filters mid-selection re-disables them until the new count arrives instead of trusting the previous filter's count.
- Mobile transaction periods now remain staged until Apply, long Assistant replies stay scrolled within the conversation, and the Dashboard skips its desktop-only forecast request on mobile and historical periods.
- Keyboard focus is visible on shell actions and the reconciliation file picker; future budgets no longer show premature pace labels, Insights reports the selected range length, and reopened category/tag dialogs clear prior create errors.
- The Dashboard planning metric now shows overall pace when configured, otherwise summarizes category-budget health, and disappears without budgets; the no-budget layout uses three equal desktop metrics and a full-width mobile net-movement row instead of leaving a blank slot or permanent setup prompt.
- The web Dashboard now fills the available desktop recent-transactions panel with complete rows while keeping four rows on mobile, and category donuts use aligned responsive legends plus percentage-only segment tooltips, removing nested scroll regions that previously intercepted normal page scrolling.
- The Dashboard privacy toggle now keeps budget pace and recent transaction amounts readable while still concealing headline and analytical financial values.
- Forecasts now include expected cash flow between today and the end of the current month, removing the previous gap before the first projected month.
- Forecasts and the forecast backtest no longer double-count auto-posted recurring rules: a rule's monthly amount is only subtracted from months where the rule did not post its own transaction, so categories with an auto-posting rule keep their genuine variable spending in the model instead of it being zeroed out.
- Forecasts no longer learn manually recorded USD, yearly, or already-ended recurring payments as variable spending before projecting the same patterns again, and Dashboard balance history no longer plots unsupported points from before the first balance snapshot.
- The Dashboard balance chart and six-month category bands now label months correctly in timezones west of UTC; previously every month label rendered one month early there.
- Applying a bulk transaction change now leaves its outcome summary (resolved, skipped, deleted, and restored counts) visible on both desktop and mobile until dismissed, instead of closing the bulk panel with no confirmation.
- Accent-colored controls in dark mode now use dark ink text that meets WCAG AA contrast instead of low-contrast white, and the category-band chart assigns colors in stable first-appearance order so different categories no longer collide on the same color.

### Added
- Spending-chat `tool_call_end` stream events now carry a display-ready `result_summary` (for example "23 matches · €412.80 total") that the web Assistant shows in its expanded tool activity rows.
- Added an accessible six-month category-band view to the web Dashboard, backed by real monthly category totals and balances, plus filtered transaction summary totals for the working ledger.
- Added a comprehensive production-built Playwright gate covering desktop Chromium, mobile WebKit, route accessibility and overflow contracts, reviewed visual baselines, and critical Firefox, desktop WebKit, and mobile Chromium journeys.
- Added `uv run forecast-backtest` for read-only rolling historical accuracy and prediction-interval coverage checks.

### Changed
- Consolidated the web Budgets route into one monthly-first workspace: usual monthly plans, selected-month adjustments, and annual plans now share one editor and consistent rows instead of separate Month, Recurring, and Year tabs. Existing recurring plans, month overrides, annual budgets, and native iOS budget APIs remain compatible; changing a usual amount from a selected month now preserves prior periods and any already-scheduled future change.
- Reworked the web Assistant into a native chat-style workspace: its title and new-chat action now live in the top utility bar, the transcript is no longer enclosed in a card, tool lookups group into one expandable activity line, and scrolling up during a streamed reply no longer drags the reader back to the bottom. While a turn works, a shimmering progress line shows the active tool or the model's latest narration (static text plus spinner under reduced motion), sending scrolls the question to the top of the conversation with the reply streaming below in reading position, live answer text ends in an animated braille-sweep cursor, finished answers and sent questions offer copy actions, stopped or failed turns offer Try again without retyping the question, and screen readers get one completion announcement instead of per-chunk updates.
- Transaction search now uses case-insensitive substring matching plus RapidFuzz typo tolerance across titles and descriptions while retaining chronological ordering; period, type, category, and tag remain explicit filters.
- Tightened the mobile web Transactions header: Inbox, Trash, and Export CSV moved into an overflow menu, the filter trigger became a compact icon button with an active-filter count badge (replacing the mostly empty filters card), the search, filter, and overflow buttons now sit beside the page title in one row, and search opens as a full-width popover below that row.
- Reworked the web Transactions controls so higher-contrast page actions are separate from a height-aligned desktop filter bar whose period and type buttons keep comfortable spacing and whose category and tag filters widen into the available space; the desktop page-header search icon stretches sideways into an inline same-row title-and-description search bar with a text-only clear control and Escape/outside-click handling, while the mobile popover carries the same plain search and the filter sheet holds only period/type/category/tag. The redundant date-range readout was dropped from the collapsed mobile filters card to match desktop, page actions right-align on both viewports, and always-available row checkboxes plus an in-place segmented bulk scope replace the old Select mode and inserted bulk-controls row.
- Forecast now uses robust recent variable cash-flow medians, learns shrunken month-of-year patterns after two years of history, includes variable income, shows a deterministic 80% prediction range, and warns about expected intra-month balance lows. What-If comparisons reuse the same uncertainty paths so their deltas remain attributable to the selected changes.
- Replaced the old all-in-one `uv run test` command with `uv run fast-tests` for the normal Ruff, backend, frontend lint, and build gate plus `uv run full-tests` for deliberate complete browser verification; automatic CI now runs the fast gate while the full suite is manually dispatched.
- Reduced test-suite runtime: the fast gate now runs its checks concurrently with backend tests distributed across CPU cores, and the full Playwright suite gives every test worker its own isolated backend and temporary database so browser coverage scales with the machine in a single run with one report.
- Redesigned the complete web app as a responsive financial switchboard: desktop now exposes every available destination in a grouped sidebar, mobile uses a compact top action bar plus a labeled edge-attached menu, and each workflow now uses purpose-built planning, ledger, evidence, library, report, or conversation surfaces instead of generic card stacks.
- Dashboard, Transactions, Budgets, Insights, Forecast, What If, Digest, Recurring, Rules, Categories, Tags, Templates, Reconciliation, Reports, Assistant, Settings, Admin, and authentication now share the same warm paper surfaces, semantic signal colors, category icon language, monospaced financial figures, and intentional light/dark themes without changing their routes or supported actions.
- Refined the redesigned web workflows with flat divided ledger rows, compact dashboard composition charts and interactive category-band tooltips, a space-efficient Transactions filter sheet, page-specific create actions, modal Budget and Recurring editors, clearer transaction detail actions, a visual weekly Digest composition, and a bottom-anchored Assistant composer.
- Moved Templates, categorization Rules, Categories, and Tags to page-owned modal creation and editing, replaced compact row action labels with accessible icons, added a dedicated Tags merge modal, and made Templates directly reorderable by drag handle.
- Unified single-choice button groups around one sliding selection indicator, aligned the yearly Budget toolbar and Reconciliation file picker, removed duplicated period and balance-delta copy, and added exact custom hover values to Dashboard and What If balance charts.
- Reworked the mobile web layout around an unobtrusive top bar and full-height menu drawer, condensed Dashboard metrics and Transactions controls, removed the mobile balance history chart, made one-month Insights data visible, moved Budget and recurring-rule creation into the top-right action, and shortened recurring History controls.

### Removed
- Removed the legacy `search` metadata block from transaction-list and uncategorized-inbox API responses. No current client reads it; iOS apps older than this release fail to decode transaction lists until updated, so update the iOS app together with the server.
- Removed technical transaction-search syntax and its token metadata; search-like text such as `tag:Work` is now treated literally and filters are applied through the visible controls.
- Removed LLM-backed search translation, including its API endpoint and web/iOS client surfaces; natural-language transaction requests remain available through the read-only spending Assistant.

### Dependencies
- Added axe-core Playwright integration for automated accessibility checks across canonical web routes.
- Bundled IBM Plex Mono with the web app for privacy-preserving financial typography instead of loading a font from a third-party service at runtime.
- Added dnd-kit for accessible pointer and keyboard sorting of transaction templates.
- Updated Click and Pillow to releases that resolve their current published security advisories.
- Updated frontend transitive dependencies to resolve the current npm audit advisories.

## [0.3.4] - 2026-07-09

### Changed
- The native iOS transaction detail screen now shows the date and time on two separate rows (date above, time below) instead of on a single line.

### Fixed
- Transaction timestamps are no longer shown shifted by the timezone offset in the native iOS app (for example a transaction entered at 10:23 previously displayed, and pre-filled when editing, as 12:23 in Central European Summer Time). `occurred_at` is stored as a naive datetime in the configured local timezone; the API now emits it with that zone's offset so clients that would otherwise assume UTC display the correct local time. The web app was already correct and is unaffected. This applies to both manually entered and auto-ingested transactions.

## [0.3.3] - 2026-07-09

### Changed
- The native iOS transaction detail screen now shows a transaction's exact time next to the date (labeled "Date & time") when a time was recorded, instead of only the date. Transactions with no recorded time still show just the date. This matches the web detail page, which already displayed the time.
- Adding or editing a transaction now assigns tags by choosing from your existing tags instead of typing free text. The web Add/Edit forms show your current selection as removable chips plus a short "recent tags" chip row for one-tap picking and a search field to find the rest — a compact picker that stays small even with a large, growing tag set (for example many single-use, event-specific tags). The native iOS form's Tags row opens a searchable checklist of your tags, ordered newest-first. This makes the predefined tag list discoverable and avoids accidental typo-duplicates; new tags are still created on the Tags page (web) or in Organize (iOS), and archiving a finished tag removes it from the picker. A tag already on a transaction that has since been archived stays selected and is preserved unless you remove it.

### Fixed
- The native iOS app icon now follows the system's icon appearance, switching between its light, dark, and tinted variants automatically (for example when a Focus mode forces all icons dark, or in Dark Mode / tinted home-screen styles). The appearance-aware Icon Composer icon was present in the project but never wired into the app target's build, so the build fell back to a light-only icon set that ignored the system appearance.
- The web app's date and time fields (for example "When" in the Add transaction sheet) now center their displayed value on iPhone Safari and other mobile WebKit browsers. The previous centering rule targeted a pseudo-element that iOS Safari never renders, so the value sat left-aligned against the field edge.
- The web transaction detail page's Edit and Delete buttons now sit in the top-right corner of the header on mobile, on the same row as the "Transaction" title, instead of stacking on their own row beneath it.

### Dependencies
- Upgraded WeasyPrint (PDF report rendering) from 68.1 to 69.0 to resolve CVE-2026-49452.

## [0.3.2] - 2026-07-02

### Added
- The native iOS Transactions filter sheet now includes a "Time range" filter (All time / This month / Last month) alongside the existing type, category, and tag filters, so you can scope the list to the current or previous month. The active range shows as a filter chip and counts toward the filter button's active-state indicator (it applies to the active and uncategorized lists, and Bulk Edit's "All filtered" scope respects the selected range so bulk operations never reach transactions outside it).
- The native iOS Transactions list now shows clear empty states instead of a blank screen: a "No matching transactions" card (guiding you to adjust the search or clear filters) when a search or filter returns nothing, a "No transactions yet" card for a genuinely empty list, and an "Inbox zero" card when no transactions are waiting to be categorized.

### Changed
- The native iOS Assistant progress line now holds a freshly started tool's verb phrase for up to 3 seconds (was 2) before falling back to the model's reasoning or "Thinking…", so short-lived tool labels are easier to read.
- The native iOS Assistant now shows a single, ChatGPT-style shimmering progress line above the answer while it works, replacing the previous stacked "Thinking…" plus separate tool-ticker rows. It shows "Thinking…" by default, swaps in a verb phrase for the active tool (for example "Getting spending overview…"), and surfaces the model's intermediate reasoning in the same line — never in a bubble. No answer bubble appears until the final response arrives; a slow tool's label is capped at ~2 seconds before falling back so the line can't get stuck, and rapid tool bursts roll smoothly instead of flickering back to "Thinking…". A turn that ends with no answer (stopped, failed, or empty) now reads as a quiet status line rather than an empty bubble.
- The native iOS Assistant now scrolls a freshly sent question to the top of the viewport (instead of leaving the reply pinned to the bottom), so the answer has room to render in a natural reading position while earlier messages stay scrollable above. Extremely long questions are collapsed to a few lines with a "See more" toggle so a pasted wall of text can't dominate the transcript.

### Fixed
- The web category-breakdown donut legend (the Dashboard's Expenses/Income charts, and the same charts on the Tag detail and Recurring pages) no longer truncates category names to a single letter (for example "H…" instead of "Housing") when the chart sits in a narrow column. The donut and its legend now respond to the width actually available — stacking the legend below the chart at full width when the column is narrow — so names and amounts stay readable at every layout width and in both light and dark themes.
- The web mobile filter and bulk-edit sheets (Transactions filters, Transactions bulk edit, and Insights filters) now place their close (✕) button on the same line as the sheet title instead of dropping it onto its own line below the heading, removing an awkward empty gap at the top of each sheet.
- The web Reconciliation page's "Review queue" and "Only in Expenses" side cards no longer wrap a currency amount across two lines (for example "150,00" and "€" on separate lines) when an entry's title is long; the amount now stays on one line as a unit and the title truncates instead. The Digest page's "Top 5 categories this week" rows receive the same fix for long category names.
- The web recurring-rule occurrences page now shows the rule Type as "Income"/"Expense" (title-cased) instead of the raw lowercase "income"/"expense", matching how the transaction detail page presents it.
- The native iOS Insights "Monthly Trend" chart Y-axis now labels its gridlines in euros (for example "6.000 €") instead of raw cent values (for example "600.000"), which read as a wrong, inflated unit.
- The dashboard's budget pace and per-category budget progress now follow the selected time range's month instead of always showing the current month: choosing "Last month" shows that month's budgets and spending (evaluated as a completed month, so the pace reflects actual spend rather than a partway projection), while "This month" and "All time" continue to show the current month. This affects the web and native iOS dashboards.
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
- The native iOS transaction-detail and recurring-rule occurrences screens no longer briefly flash their "Couldn't load…" error during a normal cold open: each now tracks its own per-screen load state instead of the app-wide loading flag, which could read false on the first render (before the load starts) or be cleared by an unrelated concurrent request while the screen's own load was still in flight.
- The native iOS transaction detail's reimbursement amounts (linked reimbursement rows and the expense-search results) and the Forecast monthly breakdown amounts (income/expenses totals, recurring rules, variable estimates, one-time events) now use the app's semantic income/expense theme colors instead of literal green/red, so they match every other transaction screen — most visible in dark mode's warmer tones.
- Clearing the native iOS Transactions filters (the filter chip's clear button or the Filters sheet's Reset) now clears only the type/category/tag filters and keeps your active search text, instead of also wiping the search; the search field's own clear button still clears the search independently.
- Clarified copy in the native iOS bulk-edit sheet: the scope option that targets every transaction matching the current filters now reads "All filtered" (was the awkward "All loaded filter"), and the apply confirmation now reads "This will update every transaction in the selection." instead of referencing "the backend" and "resolved" transactions.
- The native iOS Insights Expenses/Income breakdown bars and ring now use the app's semantic income/expense theme colors instead of literal red/green, matching the Monthly Trend chart on the same screen and the rest of the app — most visible in dark mode.
- The native iOS local-unlock screen's "Check Settings" button (shown when device authentication isn't available) now actually opens Settings instead of silently re-running the failed unlock check, so the label matches what the button does.
- The native iOS Recurring screen now shows each rule's amount in its own currency ($ for USD rules) instead of always rendering euros — matching the web. The monthly Income/Expenses/Net totals stay in euros, with USD rules folded in at the backend's converted rate.
- The native iOS floating "+" Quick Add button now appears only at the root of the Dashboard and Transactions tabs and hides once you open a transaction's detail, instead of hovering over the detail content.
- The native iOS sign-in screen now recovers from a failed tracker-status check: it shows "Couldn't reach the tracker." with a Retry button (and supports pull-to-refresh) instead of staying stuck on "Checking tracker status…" with the setup/create-account buttons disabled.
- The native iOS Dashboard, Digest, Insights, Forecast, Budgets, and Recurring screens now show a distinct "Couldn't load …" error card (with the underlying reason and pull-to-refresh) when an initial load fails, instead of the same "No … loaded" empty state used for genuinely empty data.
- The native iOS Insights "Monthly Trend" chart Y-axis labels now render in a neutral secondary tone instead of picking up the accent color (the previous hierarchical `.secondary` style resolved against the app's accent tint, so the labels showed up teal in light mode and gold in dark), and the "Movement" Increases/Decreases amounts now use the app's semantic expense/income theme colors instead of literal system red/green — so they match the chart's own income/expense lines and the rest of the app, most visible in dark mode.
- The native iOS date+time timestamps on the Account (session expiry, ingest-token updated/last-used, balance-snapshot time), Diagnostics (session expiry), and Admin (elevation expiry, database/log modified) screens now use the app's abbreviated date style — for example "Sep 29, 2026 at 12:32" — instead of the terse all-numeric system default like "29.9.2026, 12:32", matching the "Jul 1, 2026" dates shown everywhere else in the app.
- The native iOS floating "+" Quick Add button now hides while the Transactions list is in multi-select mode, instead of hovering over the bulk-action bar and partly occluding its "Bulk Edit" button (which showed only as "Bulk"). It reappears when you leave selection mode.
- The native iOS form sheets now tint their controls with the app's current theme accent — most visibly menu-style pickers such as the Category selector, whose selected value now reads gold in dark mode instead of the light-mode teal. Presented sheets don't inherit the app's tint, so these pickers were falling back to the light accent regardless of appearance; this is now fixed consistently across the Add/Edit Transaction, recurring-rule, budget (month and recurring), forecast-scenario, and category/tag/rule/template editor sheets. Light mode is unchanged.

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

[Unreleased]: https://github.com/janishahn/expenses/compare/v0.8.2...HEAD
[0.8.2]: https://github.com/janishahn/expenses/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/janishahn/expenses/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/janishahn/expenses/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/janishahn/expenses/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/janishahn/expenses/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/janishahn/expenses/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/janishahn/expenses/compare/v0.5.3...v0.6.0
[0.5.3]: https://github.com/janishahn/expenses/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/janishahn/expenses/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/janishahn/expenses/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/janishahn/expenses/compare/v0.4.10...v0.5.0
[0.4.10]: https://github.com/janishahn/expenses/compare/v0.4.9...v0.4.10
[0.2.1]: https://github.com/janishahn/expenses/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/janishahn/expenses/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/janishahn/expenses/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/janishahn/expenses/releases/tag/v0.1.0
