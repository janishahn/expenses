# Expenses Web Design

These are rules, not suggestions. When a rule and a page disagree, the page is
wrong. Code and tests define feature behavior; this document defines how the
web app looks, moves, and reads.

The app uses bundled Phosphor icons and never loads remote assets.

## Principles

1. Dense and quiet. Content carries the hue; chrome is gray.
2. Depth comes from tone, not lines or shadows. Only floating layers cast shadows.
3. One way to do each thing. One selection style, one card anatomy, one menu.
4. The UI does not narrate itself. Labels name things; they do not explain them.
5. Motion only confirms an action or explains where something came from.

## Frame and Navigation

- The sidebar sits on the canvas. Page content sits in one inset panel, 8px from
  the window edge.
- The app-name menu at the top of the sidebar holds Settings, Admin, and Sign
  out.
- Primary navigation: Dashboard, Transactions, Budgets, Insights, Forecast.
  Transactions has one sub-item, Uncategorized, with its count; it hides at
  zero. Trash lives in the Transactions ⋯ menu. Collapsible groups: Manage
  (Recurring, Templates, Rules, Categories, Tags) and Tools (What If, Reconcile,
  Reports, Digest, Assistant).
- Every page starts with a 44px header bar: title or breadcrumb on the left,
  contextual actions on the right. An optional 40px view row below holds, left
  to right: page views as a segmented control (such as Commitments/Audit on
  Recurring), the period control, then filter pills; the Filter button and
  sort menu sit at the right end. No H1, hero, page intro, or tab strip.
- Create actions are contextual. "Add transaction" lives on Transactions; there
  is no global compose button and the dashboard has no create action.

## Depth and Surfaces

Four levels, from back to front:

| Level | Token | Use |
| --- | --- | --- |
| Canvas | `canvas` | Window background, sidebar |
| Panel | `panel` | The inset page panel |
| Sheet | `sheet` + `edge` ring | Cards, lists, peek, metric strip |
| Float | `float` + shadow | Menus, popovers, tooltips, dialogs, sheets, bulk bar |

- In-flow surfaces never cast shadows. A sheet gets only the 1px `edge` ring.
- No row dividers. Day bands and card headers separate content by tone.
- Hairlines (`line-soft`) are allowed only between metric-strip columns, above a
  dialog footer, and between menu groups.
- Never nest a sheet in a sheet.
- Radius: 12px panels and cards, 10px floating layers, 8px controls, 6px chips.
  Fully round shapes only for switches, dots, and avatars.

## Color

Hue belongs to data. Chrome is ink and gray. Blue appears only as the focus ring,
checked checkboxes, and text links. Red appears only for problems: over budget,
failed, destructive.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `canvas` | `#eaeae7` | `#11100e` | Window, sidebar |
| `panel` | `#f5f5f3` | `#181715` | Page panel |
| `sheet` | `#ffffff` | `#1f1d1a` | Cards, lists, peek |
| `day` | `#f2f2f0` | `#1b1a17` | Day bands, receipt preview, map placeholder |
| `float` | `#ffffff` | `#262420` | Floating layers |
| `ink` | `#1c1c1a` | `#eeebe6` | Primary text, primary button fill |
| `ink-2` | `#55554f` | `#bdb8af` | Secondary text, labels, all text on canvas |
| `ink-3` | `#6b6b65` | `#969087` | Tertiary text and icons. Never on canvas. |
| `control-edge` | `#86867f` | `#77726a` | Checkbox, switch, and field boundaries |
| `income` | `#18704a` | `#4cc38a` | Income amounts |
| `over` | `#b83a26` | `#f07a63` | Over budget, errors, destructive |
| `focus` | `#3b5bdb` | `#7c95ff` | Focus ring, checked state, links |
| `hover` | ink at 3.5% | white at 4% | Hover fill |
| `selected` | ink at 7% | white at 8% | Selected row, active nav, active segment |
| `band` | ink at 7% | white at 8% | Forecast and scenario ranges in charts |
| `saved` | `income` at 10% | `income` at 12% | Area between income and expenses |
| `rec` | budget fill at 38% on `sheet` | budget fill at 38% on `sheet` | Recurring share in charts, weekday bars |

Light is near-neutral; dark is warm. Both are authored, not inverted. Text must
reach 4.5:1 on every surface it can appear on. Light `ink-3` misses that on
canvas, so `ink-3` is never used there.

Category colors are a provisional palette. Each must reach 3:1 against `sheet`
as an icon glyph and as a chart mark. Assign them deterministically by category.

| Category | Light | Dark |
| --- | --- | --- |
| Housing | `#5563d1` | `#7b86e8` |
| Groceries | `#278a5c` | `#45b882` |
| Restaurants | `#c75f2a` | `#ec8a57` |
| Shopping | `#c2508a` | `#d872a6` |
| Travel | `#21879c` | `#45b5cc` |
| Utilities | `#a8801a` | `#e0bb4a` |
| Transport | `#7a5bd0` | `#9a80e6` |
| Home | `#9a6a22` | `#c99645` |
| Other | `#86867f` | `#77776f` |

These tokens, the money colors, and number formatting are shared with iOS.

## Type and Numbers

- System font stack everywhere. No monospace, including amounts.
- Sizes: 12px metadata, 13px body and controls, 16px detail title, 22px metric
  value, 26–30px entry and detail amount. Weights 400, 500, and 600 only.
- Sentence case. No uppercase labels.
- Amounts use tabular figures. Expenses are ink with no sign. Income is
  `income` with a leading `+`. Never color an expense red.
- Phosphor regular icons at 16px in chrome, 20px in the mobile tab bar.

## Controls

- Primary button: `ink` fill, inverted text. One per view at most.
- Secondary controls: ghost or `sheet` with the `edge` ring. Never colored.
- Segmented controls and active nav use the `selected` tone.
- Sort menus list the sort keys, then a separator and two direction items
  named for the active key: Highest first and Lowest first, A to Z and Z to A,
  Oldest first and Newest first. Each key keeps its own direction. The pill
  shows the key with a direction icon.
- Selection has one look: the `selected` tone fill. No colored rings, left
  borders, or bold text for selection.
- Focus is separate from selection: a 2px `focus` ring on `:focus-visible` only.
- Hover is the `hover` tone, gated by `(hover: hover) and (pointer: fine)`.
- Icon-only buttons have an accessible name and a tooltip with the same text.

## Lists

- Every ledger is a complete, flat list in one sheet. Day bands group rows by
  date and show the day's net.
- One row height per layout: 36px desktop, 44px mobile. Single line always.
- Desktop columns in order: checkbox (on hover), category glyph, title, category,
  tags (two, then `+N`), markers (receipt, location, reimbursed), amount. When an
  expense is reimbursed, its muted net sits before the gross amount.
- Columns drop by container width: tags and markers first. Mobile rows show glyph,
  title, and amount only.
- No per-row buttons. Row actions live in the context menu; multi-row actions
  live in the floating bulk bar that appears with a selection.
- Triage queues are the one exception: Uncategorized, Reconcile, and rule
  suggestions show their accept and reject actions on each desktop row, so a
  queue can be cleared without opening anything. On mobile these actions live
  in the peek.
- Clicking a row opens the peek. Back restores scroll position and selection.
- Non-ledger lists (budgets, recurring, rules, categories, tags, templates) use
  the same sheet, row height, and bands. Bands name the group and carry its
  total on the right ("Monthly 1.251 of 1.610 €", "Expenses 1.460,61 € per
  month"). Column labels appear in a band only when values would be ambiguous
  without them.
- Short removable lists inside a peek or card (snapshots, adjustments, tag
  chips) show a ✕ on row hover instead of a menu.

## Detail and Editing

- The peek is a 440px sheet docked beside the list, in flow, without a shadow.
  Its bar shows the breadcrumb, an expand button, ⋯, and close. Expand opens the
  full view with the same content. Esc or close dismisses the peek.
- On mobile the peek is a full-screen push with a back button and no breadcrumb.
- Content order: title, amount, properties grid, Notes, Location map, Receipts.
- Properties use a 92px label column: Type, Date, Category, Tags, Location,
  Reimbursed (linked records), Net. Rare properties appear only once set and are
  added from ⋯. Bank ("Girokonto · booked 22 Oct", linking to Reconcile)
  appears only on a transaction matched to, or created from, a statement row.
- Values edit in place. Pickers open as popovers anchored to the value. Changes
  save immediately. A failed save keeps the entered value and shows the error at
  that field.
- Every entity peek uses the same order: name, headline amount with its cadence
  or limit in `ink-2`, properties, then titled sections (Cost, Upcoming, Posted,
  Matches). A section that lists records ends in a link to the full list.
- The full view is the peek's content at page width: a main column for the
  title, amount, notes, and record-specific sections, and a 320px properties
  column on the right. Below 720px it collapses to one column.
- The transaction full view keeps the tracked details together instead. The
  main column holds the title, amount, properties, Notes, and record-specific
  editors (such as reimbursement allocation). A 360px side column holds the
  Location map, then Receipts. Each column keeps its content and order for
  every transaction; a missing location or receipt only shortens the side
  column. Below 720px it collapses to one column in the same order.
- Merging is a ⋯ action ("Merge into…") that opens a dialog with the target
  picker, the affected record counts, and the consequence line.

### Receipts and maps

Receipts are provenance: kept so the record can be checked later, rarely
needed at a glance. They come last and stay small. A receipt is shown whole,
never cropped or stretched. A map fills its box by cropping around the pin.

- Receipts section: a heading with Upload, then a preview of the first file at
  full column width, its height taken from the file's aspect ratio up to 240px,
  fitted on `day` with 12px inset. Below it, the file name, size, and ⋯
  (Download, Replace, Remove). Several files add "1 of N" to the heading and a
  strip of 30×40 thumbnails. Clicking the preview opens the viewer.
- No receipt: the heading and a single dashed drop row ("Drop a receipt or
  choose a file"; "Add a receipt" on mobile). Never a large empty target.
- Viewer: a large dialog (bottom sheet on mobile) with the file name, size,
  previous and next, zoom out, Fit, zoom in, Download, and close. It loads the
  original file; previews and thumbnails use the server thumbnail.
- PDFs: the viewer uses the browser's built-in PDF viewer. Previews and
  thumbnails show a PDF icon, since the server makes no PDF thumbnail.
- Map: full column width, 180px tall, centered on the pin. Tiles follow the
  theme, and the attribution stays visible. The Location property shows the
  coordinates; there is no place-name lookup. No location, no map: the Location
  property reads None.
- The peek and mobile full view use the same sections in the same order.

### Create dialogs

All create actions open the same dialog: centered on desktop, a bottom sheet on
mobile. The header holds the Expense/Income segmented control when the record
has a direction. Amount comes first in the large entry style, then the name,
then chips for the remaining properties; a set chip shows its value with the
`selected` fill. Previews of derived values (next dates, matched count) sit in
one muted line below the chips. The footer holds Cancel and the ink create
button named for the record ("Add transaction", "Add budget").

Add transaction also shows template chips above the amount, Notes below the
chips, and an "Add another" switch in the footer.

## Charts

Every chart is a `ChartCard`:

- 44px header: plain-noun title on the left. Controls on the right in fixed
  order: range segmented control, then ⋯ (Show as table, Open in Insights, Hide
  from dashboard, plus chart-specific toggles).
- Body below, then an interactive legend. Hovering a legend item or a mark
  focuses that category and dims the others to 22% opacity.
- A floating tooltip shows the exact values. It follows the pointer without
  animating its position.
- Clicking a mark opens the ledger filtered to that slice, with a breadcrumb such
  as "Dashboard › Travel · Aug 2026". On touch, the first tap shows the tooltip
  with a Transactions link.

Chart styles:

- Spending by category: one stacked horizontal band per period, 1px gaps between
  segments, period total at the right.
- Balance: an `ink` line for actual balances; the likely projection dashed in
  `ink-3`; the forecast's 80% range (p10 to p90) as a `band` area; a dotted
  vertical mark at today; a hover guide line. The legend reads Actual, Likely,
  80% range. The tooltip shows the likely value and the range for projected
  months. The card title carries the likely end value ("likely 31.690 € in
  Apr"). ⋯ holds "Show forecast range" (on by default) and "Open in Forecast".
- Forecast and What If use the same balance anatomy. What If shades the
  difference between scenario and baseline with `band`.
- Pace (budget burndown): actual cumulative spend in `ink`, even pace dashed in
  `ink-3`, today mark.
- Category share: a donut with the total in the center and a legend table that
  lists the amount and percentage.
- Budgets: neutral fill, `over` when over budget, an `ink` tick at today's pace.
- Income and expenses: an `income` line and an `ink` line with the gap between
  them filled in `saved`. The title carries the saved share ("41 % saved").
- Recurring split: monthly stacked columns, at most 26px wide, with spending
  posted by recurring rules in `rec` at the bottom and other spending in
  `ink-2` on top.
- Month grid: one row per category or tag and one column per month, 22px cells with 3px gaps and a 4px radius, then a
  Total column and a change column. Each row is tinted with its category color
  (tags and other uncolored rows use `ink-2`), from 10% for the row's lowest
  full month to 75% for its highest, mixed onto `sheet`. A month with nothing
  uses `track`. Shading compares months within a row only, and the legend says
  so. Budget history uses the same grid with 16px squares: `rec`-toned when
  within the budget, `over` when over, and an empty outline for months before
  the budget existed.
- Day calendar: 53 week columns by 7 weekday rows of square cells. Five fixed
  amount steps from `track` to `ink` at 82%, with the euro range of each step
  in the legend. On mobile the most recent weeks show and older weeks are
  clipped on the left.
- Y-axis labels appear on full-page analysis charts (Insights, Forecast, What
  If). Dashboard and peek charts omit them; the tooltip and title carry values.

Data integrity:

- Every chart answers a financial question, shows units, and keeps exact values
  in tooltips or "Show as table".
- The current month is in progress. Mark it with a 1px dashed `ink-2` outline,
  keep it out of shading scales and averages, and never compare it with full
  months. Change columns compare the last full month with the average of full
  months ("Sep vs avg").
- A row with values in fewer than half of its full months is irregular; its
  change column shows "–".
- Recurring means posted by a recurring rule. Day-level charts use the booking
  date, never the time, because generated transactions carry a placeholder
  time.
- Provide a nonvisual equivalent and a one-line empty state.
- Color never carries meaning alone; pair it with labels, legend text, or names.
- Never imply flows, causation, or certainty the data does not contain.
- Privacy mode keeps the layout and hides values in tooltips and accessible names.

## Pages

Each page is a metric strip (optional), cards or one list, and a peek. The
pages below fix the structure; the current pages show the content.

- **Dashboard.** Strip: Balance, Cash in, Spent, Net, Budget pace. Then Balance
  and Recent side by side, Spending by category full width, Category share and
  Budgets side by side, Durable purchases. No create action. The header holds
  the privacy toggle. On mobile a summary card replaces the strip: Spent with its
  comparison, the overall budget (bar, left and per day, likely total) when one
  is set, then Balance, Cash in, and Net in one row. Then Budgets, Recent,
  Balance, Spending by category, Category share as a small ring with its five
  largest shares, and Durable purchases.
- **Budgets.** View row: month control. Strip: Overall budget, Spent, Left,
  Projected. Overall pace chart. One list with Monthly and Annual bands; each
  row shows the bar with the pace tick and "left" or "over". The peek shows the
  amount with its usual amount when adjusted, Applies to, Projected (in `over`
  when it exceeds the limit), daily allowance, the pace chart, and top spending
  days.
- **Forecast.** View row: horizon and model segmented controls. Strip: balance
  at the horizon with its 80% range, average monthly net, and Below zero (the
  first month at risk, or "Not expected"). Balance chart with a dashed
  recurring-only line and an ⓘ naming the model, then a monthly outlook list;
  a month's peek splits Recurring, Estimated, and One-time.
- **What If.** Strip: baseline, scenario, difference. Scenario chart, impact
  table, and an Adjustments card with an Add menu.
- **Insights.** One view. View row: the period control and Filter. Then a strip (Income, Spent, Saved with its share of income,
  Recurring with its share of spending), then Income and expenses beside the
  Recurring split, the month grid ("By month", with Expenses, Income, and Tags
  segments), Daily spending (the day calendar without recurring, beside
  average spending by weekday and the weekend share), and Budget history with
  a "Within" count of full months. No horizontal bar lists.
- **Recurring.** Views: Commitments (strip, Expenses and Income bands) and Audit
  (annual totals, Annual mix donut, true-cost list). The peek holds the
  schedule, Cost, Upcoming, and Posted sections.
- **Tags.** Rows: tag, auto-add window or archive date, budget exclusion
  marker, uses, and the tag's expenses in the selected period (the figure its
  detail view shows), with income as a smaller `+` figure before it when
  present. Bands show counts only: tags overlap, so their amounts never add up
  to a total. Sort: Spent, Usage, Name, Date created (oldest first by
  default, for a chronological list). The peek shows the created date. Mobile
  rows show tag, marker, and expenses.
- **Reports.** Generate PDF in the header. One form card at page width; on
  desktop its groups sit in two columns (options left; Sections and Scope
  right; Notes across), so the header action sits above content. Below 720px
  the groups stack in that source order. A generated file appears as a row at
  the top of the card.
- **Uncategorized.** Category suggestions come only from local automatic
  categorization and appear only while it is on; there are no LLM suggestions.
  Columns: Title, Date, Suggestion (a category pill that opens the picker),
  Confidence (right-aligned percentage), accept and reject, Amount. Rows without
  a prediction, such as income, show a Category pill and no confidence. With
  automatic categorization off, every row shows the Category pill. There is no
  "accept all": every suggestion here fell below the user's own confidence
  threshold. On mobile a row shows the suggested category's glyph, title,
  confidence, and amount; the peek shows "72 % confidence" with Accept and
  Reject.
- **Reconcile.** Checks imported statement rows one by one against tracked
  transactions. It never compares totals or balances: a statement covers one
  account, while the app may track several cards and cash. It lists bank rows
  only, never transactions missing from the statement. View row: To review
  with its count, Resolved, an account filter, and the last import on the
  right. To review bands: Suggested match (one candidate; Match on the row,
  Match all in the band), Several matches (Choose opens the peek; nothing is
  preselected), and No match (Create… opens the create dialog filled from the
  row, ending in "Create and match"). Every row has an Ignore menu of reasons:
  Cash withdrawal, Transfer between my accounts, Not something I track, Other
  reason… (free text). The peek shows Booked, Account, Purpose, the candidates
  as radio rows, and a search over all transactions; picking one with another
  amount adds a switch, on by default, to set it to the bank amount. The peek
  footer is always Match, Create…, then Ignore; only the ink fill moves (Match
  when candidates exist, Create… otherwise). Resolved lists matched, created,
  and ignored rows newest first with an outcome filter; its peek shows the
  outcome, the linked transaction or the reason, and Reopen. Reopening a
  created row asks whether to keep the transaction or move it to Trash. Every
  action shows an Undo toast; undoing a create moves the transaction to Trash.
  Import: choose an existing account (or add one) and drop a Commerzbank CSV;
  a preview shows rows, date range, new and already-imported counts, and the
  first rows before "Import 124 rows". An invalid row is named and nothing is
  imported. On mobile, row actions live in the peek; Match all stays in the
  band.
- **Settings and Admin** share one shell: a section list (Account, Appearance;
  Data: Categorization, AI, Balance snapshots, Import and export; Server:
  Health, Maintenance, Assistant usage, Logs, System) and one section at a
  time. On desktop the section list replaces the sidebar, headed by "Back to
  app"; on mobile it is a horizontal chip row. Settings save on change; there
  is no Save button. Server sections need the admin password, shown as a
  single locked card. Health shows current readings, without history. Balance
  snapshots record a known balance at a moment;
  they are not reconciliation and never use that word.
- **Categorization settings.** A switch row, then the training status on its
  own row (Active with the training time, Training, Not enough history with
  its requirement, or Training failed in `over` with the fallback model's
  date), then Minimum confidence as a percentage field.
- **Assistant.** One conversation column. The composer is the only input in a
  bottom-fixed position; on mobile the tab bar hides while it has focus. Tool
  activity collapses to one line ("Reviewed 3 ledger views").
- **Sign in, setup, 404.** Bare pages: a centered sheet with the app name, the
  fields, and one ink button. No marketing copy.
- **404.** The app name, then a monochrome spending calendar in the Insights
  day-calendar style (17 weeks, month and weekday labels, a Less/More legend,
  an outlined today) whose darkest days spell 404, with only faint days around
  the digits so they stay legible. Below it: "This page does not exist", the
  requested path, and Go to dashboard. The calendar is decorative
  and hidden from assistive technology. Under reduced motion the cells only
  fade in.

## Copy

Allowed text beyond labels and data:

- Icon-button tooltips.
- One-line consequence warnings before destructive or irreversible actions.
- One-line empty states that end in an action.

Everything else is banned: subtitles, eyebrows, field helper text, button
sublines, menu-item descriptions, page intros, and "Learn more" prose. Titles are
plain nouns ("Budgets", not "Your budgets at a glance"). Placeholders are a field
name or a real example, never an instruction.

## Motion

Motion is functional. If an action happens many times a day, it does not animate.
The 404 page is the one decorative exception.

| Element | Motion |
| --- | --- |
| Hover, list navigation, page navigation, drill-in | None |
| Menus and popovers | 150–180ms opacity and scale from 0.97, from the trigger, `cubic-bezier(0.23, 1, 0.32, 1)`; exit faster than enter |
| Tooltips | Delay the first one; later ones open instantly |
| Peek, sheets, bulk bar | 200–260ms, `cubic-bezier(0.32, 0.72, 0, 1)`; sheets dismiss on a flick |
| Charts | Re-animate only when the range changes (about 220ms); dimming 120ms; nothing on load |
| Press | `scale(0.98)` |
| 404 calendar | Cells fill in week by week once (about 2s, opacity and scale from 0.3); a few light cells then fade in and out slowly |

Animate only `transform` and `opacity`. Under reduced motion, keep opacity
changes and drop movement.

## Mobile

- Bottom tabs: Dashboard, Transactions, Budgets, Insights, More. More opens a
  navigation sheet.
- Menus, filters, and dialogs become bottom sheets.
- One bottom-anchored layer at a time. The tab bar hides while the bulk bar or a
  sheet is showing, and while an input has focus or the keyboard is open.
- Sheets anchor to the bottom edge and pad for the safe area.
- No inputs in bottom-fixed bars. Search lives at the top.
- Desktop and mobile keep the same capabilities.

## Accessibility and State

- Text meets 4.5:1; component boundaries and meaningful graphics meet 3:1.
- Keep focus visible and restore it after dialogs, sheets, and popovers close.
- Support the keyboard (standard browser behavior plus Esc and Enter), screen
  readers, reduced motion, increased contrast, and forced colors.
- Touch targets are at least 44 by 44px. A compact control may use a larger
  non-overlapping hit area.
- Keep content in the viewport at supported widths and at 200% zoom.
- Keep loading, empty, failed, unavailable, disabled, selected, and destructive
  states distinct.
- Preserve entered data after failed mutations and show readable server errors.
- Use the shared confirmation dialog for destructive actions, never native
  browser prompts.

## Enforcement

**Closed primitive kit.** Pages compose these primitives from
`ui/src/components/ui/` and nothing else visual: `AppFrame`, `Panel`, `Sheet`,
`ChartCard` with the charts `LineChart`, `ColumnChart`, `StackedBands`, `Donut`,
`BudgetBar`, and `WeekdayBars` and the grids `MonthGrid`, `BudgetGrid`, and
`DayCalendar`, `LedgerRow`, `DayBand`, `MetricStrip` with its mobile `SummaryCard`, `ViewRow`, `PeriodControl`,
`MonthPicker`, `Menu`, `Popover`, `Tooltip`, `Dialog`, `EntryDialog`,
`BottomSheet`, `BulkBar`, `Peek` with its `PeekLayout` and `AsideLayout`,
`PropertyList`, `SettingsShell`, `Notes`, `ReceiptSection`, `ReceiptViewer`,
`LocationMap`, `Amount`,
`CategoryGlyph`, `SuggestionBox`, and the controls `Button`, `IconButton`, `SegmentedControl`,
`Switch`, `Checkbox`, `Radio`, `Pill`, `TagChip`, `SortMenu`, `TextField`,
`Field`, `Combobox`, `EmptyState`, `Status`, and `Toast`. Confirmations are a
`Dialog` variant; loading and failed pages are `Panel` variants. A visual difference is a variant on the
primitive, never a page-local class. A new primitive requires a
change to this document.

**Lint.** oxlint replaces ESLint. Rule messages say what to do instead.

- `no-restricted-imports`: `radix-ui` and `@radix-ui/*` only inside
  `src/components/ui/`.
- `react/forbid-dom-props` and `react/forbid-component-props`: outside
  `src/components/ui/`, no `className` or `style`, and no `subtitle`,
  `eyebrow`, `description`, or `caption` props.
- Local rule `design/no-raw-visual-classes` (`ui/lint/design.js`): classes come
  from the kit's CSS module, so a literal class name is an error everywhere,
  except Tailwind's `sr-only`. Tailwind supplies only the CSS reset.
- Keep `react/exhaustive-deps`, `rules-of-hooks`, `only-export-components`, and
  the TypeScript rules.

**Visual snapshots.** Playwright baselines cover the dashboard, transactions
with peek, add dialog, and budgets in light and dark at desktop and mobile
widths. Update a baseline only for an intentional change, after inspecting the
diff.

## Banned

- Shadows on in-flow surfaces; borders around groups; row dividers; nested cards.
- Colored buttons, colored selection, and any hue in chrome outside `focus`.
- Gradients, glow, glass, and decorative blur.
- Monospace numbers, uppercase kickers, eyebrows, subtitles, helper text, and
  page intros.
- Red expenses and minus signs on expenses.
- Per-row action buttons outside triage queues, and a global create button.
- `transition: all`, `ease-in`, `scale(0)`, staggered entrances, load
  animations (except the 404 calendar), and animated layout properties.
- Two bottom-anchored layers at once; inputs in bottom-fixed bars other than
  the Assistant composer.
- Native `alert`, `confirm`, and `prompt`.
- Remote fonts, icons, or other visual assets in the app.
