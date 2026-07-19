---



version: alpha
name: Switchboard Ledger
description: A warm, tactile household-finance control board with precise data and playful signal color.
colors:
  primary: "#3B4EE8"
  on-primary: "#FFFFFF"
  ink: "#181D1A"
  ink-soft: "#2B312D"
  canvas: "#EEEFE9"
  surface: "#FBFCF8"
  surface-strong: "#FFFFFF"
  surface-muted: "#E8EBE5"
  muted: "#747A76"
  line: "#D9DCD6"
  success: "#15936D"
  success-soft: "#DAF3E8"
  danger: "#F25F48"
  danger-soft: "#FFE4DD"
  warning: "#EDBD35"
  warning-ink: "#87620A"
  warning-soft: "#FFF0B9"
  info-soft: "#E5E8FF"
  purple: "#7855D8"
  purple-soft: "#EEE8FF"
  dark-canvas: "#111511"
  dark-surface: "#1A201C"
  dark-surface-strong: "#222A25"
  dark-surface-muted: "#2D3630"
  dark-line: "#3C463F"
  dark-muted: "#A7B0A9"
  dark-ink: "#F3F5F0"
  dark-info-soft: "#252B52"
  dark-success-soft: "#173A2F"
  dark-danger-soft: "#452821"
  dark-warning-soft: "#493D1E"
  dark-purple-soft: "#302747"
typography:
  display-balance:
    fontFamily: "IBM Plex Mono"
    fontSize: 52px
    fontWeight: 500
    lineHeight: 1
    letterSpacing: -0.05em
  headline-lg:
    fontFamily: "system-ui"
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.03em
  headline-md:
    fontFamily: "system-ui"
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.02em
  body-md:
    fontFamily: "system-ui"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "system-ui"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "system-ui"
    fontSize: 12px
    fontWeight: 650
    lineHeight: 1.2
  metadata:
    fontFamily: "IBM Plex Mono"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 0.04em
  amount:
    fontFamily: "IBM Plex Mono"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.2
rounded:
  sm: 10px
  md: 12px
  lg: 16px
  xl: 20px
  2xl: 24px
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  gutter: 20px
  page: 24px
elevation:
  panel: "0 8px 24px rgba(31, 38, 34, 0.045)"
  hero: "0 12px 34px rgba(31, 38, 34, 0.065)"
  floating: "0 22px 64px rgba(22, 28, 24, 0.18)"
motion:
  feedback: 120ms
  content: 220ms
  easing: "cubic-bezier(0.2, 0, 0, 1)"
components:
  canvas:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
  canvas-dark:
    backgroundColor: "{colors.dark-canvas}"
    textColor: "{colors.dark-ink}"
  sidebar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    width: 224px
    padding: 12px
  sidebar-hover:
    backgroundColor: "{colors.ink-soft}"
    rounded: "{rounded.md}"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 10px
  nav-item-active:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 20px
  panel-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.lg}"
    padding: 20px
  strong-surface-dark:
    backgroundColor: "{colors.dark-surface-strong}"
    rounded: "{rounded.md}"
  muted-surface:
    backgroundColor: "{colors.surface-muted}"
    rounded: "{rounded.md}"
  muted-surface-dark:
    backgroundColor: "{colors.dark-surface-muted}"
    rounded: "{rounded.md}"
  hero-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: 24px
  metric-tile:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 18px
  metric-tile-dark:
    backgroundColor: "{colors.dark-info-soft}"
    rounded: "{rounded.lg}"
    padding: 18px
  metric-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  metric-success-dark:
    backgroundColor: "{colors.dark-success-soft}"
    rounded: "{rounded.lg}"
  metric-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  metric-danger-dark:
    backgroundColor: "{colors.dark-danger-soft}"
    rounded: "{rounded.lg}"
  metric-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-ink}"
    rounded: "{rounded.lg}"
  metric-warning-dark:
    backgroundColor: "{colors.dark-warning-soft}"
    rounded: "{rounded.lg}"
  metric-purple:
    backgroundColor: "{colors.purple-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  metric-purple-dark:
    backgroundColor: "{colors.dark-purple-soft}"
    rounded: "{rounded.lg}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface-strong}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 16px
  button-accent:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 16px
  input:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 12px
  category-icon:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    size: 36px
  divider:
    backgroundColor: "{colors.line}"
    height: 1px
  divider-dark:
    backgroundColor: "{colors.dark-line}"
    height: 1px
  signal-success:
    backgroundColor: "{colors.success}"
    size: 8px
  signal-danger:
    backgroundColor: "{colors.danger}"
    size: 8px
  signal-warning:
    backgroundColor: "{colors.warning}"
    size: 8px
  signal-purple:
    backgroundColor: "{colors.purple}"
    size: 8px
  muted-text-dark:
    backgroundColor: "{colors.dark-muted}"
    size: 1px
---

# Switchboard Ledger

## Overview

Expenses is a private household-finance switchboard laid out on a warm paper desk. It should feel trustworthy without becoming institutional, playful without becoming childish, and dense enough for real daily work without turning into a spreadsheet. The visual signature is the combination of a dark instrument sidebar, softly lifted paper modules, compact category icon tiles, and precisely typeset financial figures.

The product is an operational money console. It is not a SaaS admin template, editorial portfolio, futuristic command center, or component-library demo. Pages share a stable shell and surface language, but each workflow has its own useful anatomy: a ledger behaves like a ledger, a planning board like a planning board, and an evidence-matching desk like an evidence-matching desk.

Light mode is the primary visual reference. Dark mode is a first-class authored counterpart with deep green-black canvas, lifted charcoal-paper surfaces, warmer foregrounds, and the same semantic signal hierarchy. It is never a mechanical inversion.

## Colors

The light palette begins with warm stone `canvas` (`#EEEFE9`), paper `surface` (`#FBFCF8`), and strong white `surface-strong` (`#FFFFFF`). `ink` (`#181D1A`) carries core text, the sidebar, and primary actions. `muted` and `line` support hierarchy; lines are internal separators, not outlines around every possible group.

Cobalt `primary` is the interaction accent for links, focus, selection, and the single accent action. It must not cover most of a page. Mint, coral, butter, and violet are compact financial signals used for income, expenses, warnings, planning lanes, category tiles, and charts. Their soft companions create distinct semantic fields while keeping text in ink for readability.

Dark mode maps the same roles onto the explicit `dark-*` tokens. Cobalt becomes slightly lighter in implementation where needed for contrast, while semantic colors remain recognizable. A dark screen still needs visible canvas, panel, and strong-surface levels; flattening everything into black is a failure.

Color never carries meaning alone. Icons, labels, signs, amounts, patterns, and accessible names reinforce every state. Normal text and interactive states meet WCAG AA; focus indicators remain obvious in both themes and forced-color environments.

## Typography

System UI is the voice for headings, navigation, forms, and prose. It keeps the dense interface familiar, fast, and privacy preserving. IBM Plex Mono is bundled locally and reserved for balances, amounts, chart axes, dates, short metadata, and compact comparisons. No runtime font request may leave the self-hosted app.

The balance display uses `display-balance`; normal page headings use `headline-lg`; panel titles use `headline-md`; supporting text uses the body tokens. Financial numbers use tabular figures and the `amount` token. Do not shrink production UI to mimic a static reference: body text remains at least 14px and supporting text at least 12px.

Use sentence case for labels and actions. Uppercase mono is reserved for terse metadata such as `Last 60 days` or a chart axis label. It is not a decorative kicker and must not repeat information already expressed by a heading.

## Layout

Desktop uses a persistent 224px sidebar and a compact 56–60px utility bar. The content area uses 24px outer padding, 12–16px module gaps, and a wide but bounded reading canvas. The shell is stable across routes; page-local controls sit with the workflow they affect rather than creating another navigation strip.

Dashboard density follows three beats: a full-width balance/history hero, a compact semantic metric grid, then a lower board where recent activity and the six-month spending composition are simultaneously useful. The grid uses four lanes when an overall or category budget adds planning evidence and three equal desktop lanes when it does not. Transaction rows, category libraries, automation lists, and admin tables are dense internally but separated from neighboring concerns by meaningful whitespace.

Mobile uses 11–12px gutters at 390px, safe-area-aware padding, and a compact sticky top bar for brand context, the page's primary create action, theme, and Menu. Menu opens a full-height drawer attached to the left edge, with its navigation independently scrollable above the account footer. Detail and edit tasks become focused pages or sheets, and controls reflow continuously without horizontal overflow.

Spacing follows the 4px base scale. Containers own their gaps. Avoid oversized introductions, empty hero bands, and arbitrary per-page margins. Touch targets are at least 44px; dense desktop rows may be visually shorter only when their full interactive target remains comfortably usable.

## Elevation & Depth

Depth comes from the warm canvas, paper surfaces, strong inner surfaces, soft signal fields, restrained shadows, overlap, and spacing. The three elevation tokens define the available range: panel for normal modules, hero for prominent financial surfaces, and floating for menus, sheets, inspectors, and temporary overlays.

Do not draw a border around every group. Use a line for internal register dividers, form boundaries, and states that need an edge. A panel should usually be recognizable from tone and shadow before its border. Avoid glow, glass, specular highlights, ornamental blur, and gradients.

## Shapes

Structural cards, chart frames, workspaces, sheets, and inspectors use 16–22px radii. Controls use 10–12px. Category icon tiles use 10px. The 24px token is reserved for larger floating or mobile structures. Full pills are appropriate only for chips, compact status, and binary selectors whose shape has semantic value.

Tiny 4–8px radii belong to micro-indicators, progress fills, and chart segments, never primary containers. Do not mix rigid 4px cards with soft 20px modules on the same page.

## Components

Product-specific primitives own the visual grammar:

- **Financial panel:** a paper module with structural radius, restrained lift, and optional domain role such as hero, register, planner, or evidence desk.
- **Metric lane:** a compact semantic field for income, spending, allocation, pace, warning, or forecast context. Its color must correspond to the financial role.
- **Ledger row:** a flat list item with one purposeful horizontal divider, category-specific leading tile, concise evidence, and a right-aligned mono amount. Do not wrap each row in its own rounded, shadowed card. Selection uses a stable checkbox affordance; bulk actions replace quiet register context only after selection exists instead of inserting another control row.
- **Category tile:** a stable Phosphor icon in a deterministic soft signal color. Generic money glyphs are only the uncategorized fallback.
- **Chart frame:** a titled analytical surface with a concrete financial question, direct drill-down, visible units, accessible labels, and a nonvisual data equivalent.
- **Inspector:** contextual view/edit surface that preserves the direct route and browser-back behavior.
- **Toolbar:** one coherent control zone for one job, not a stack of unrelated bordered bars. Page actions stay with the page title rather than mixing with filter state. Labels are visible when needed; mobile collapses filters into a compact trigger that carries the active-filter count.
- **Message surface:** readable, full-height Assistant transcript with quiet tool activity and a composer anchored to the bottom edge. Read-only behavior is a product invariant, not repeated explanatory copy.

Radix and ShadCN may continue to provide headless behavior, focus management, portals, and keyboard semantics. Their stock visual defaults are not the product. Inputs, buttons, tabs, selects, dialogs, sheets, and cards must resolve to the tokens and domain roles above.

Every component includes selected, hover, focus-visible, active, disabled, loading, empty, error, and destructive states where applicable. Motion uses only opacity, transform, and clipped size reveals, stays under the motion tokens, and becomes an immediate cross-fade under reduced motion.
Keyboard focus uses a visible two-pixel accent outline that remains independent of component shadows, including shell actions and visible proxies for hidden file inputs.

## Do's and Don'ts

- Do keep every normal desktop destination visible with icon and label.
- Do use paper, semantic fields, category icons, and spatial grouping before adding borders.
- Do keep core numbers dominant and supporting copy brief.
- Do make light and dark modes equally deliberate.
- Do preserve URLs, filters, back behavior, route guards, and permission gates.
- Do use one cobalt interaction accent and several controlled semantic signals.
- Don't hide ordinary desktop routes behind `More`, overflow, or icon-only navigation.
- Don't use giant black or cobalt slabs as a substitute for hierarchy.
- Don't build pages from `Page intro + generic card + form` when the workflow needs a ledger, planner, library, desk, or conversation.
- Don't use gradients, glass, glow, ornamental blur, or permanent attention sidebars.
- Don't stack more than two levels of bordered rectangles.
- Don't use explanatory microcopy or uppercase metadata as filler.
- Don't silently collapse loading, empty, failed, unavailable, and disabled states.

## Iconography

Use the existing local Phosphor icon system. Navigation icons are 18px with consistent bold weight. Category icons are 16–18px inside 36px soft tiles. The icon catalog remains user-editable and is the source of category identity across transactions, budgets, insights, recurring rules, and charts.

A deterministic category-to-signal mapping keeps the same category visually stable across pages without storing presentation-only color in the database. Uncategorized may use the generic currency mark; known categories must not all fall back to it. Icon-only actions require accessible names and 44px touch targets on mobile.

## Data Visualization

Every chart answers a specific question and exposes a drill-down. Mono axes show units; legends use both color and labels; values remain available to assistive technology. Donut legends use equal responsive columns with right-aligned amounts rather than content-sized wrapping entries or nested scrolling regions; hovering a donut segment shows only its percentage of the whole. Hovering meaningful line-chart points reveals an exact, theme-aware financial tooltip; comparison charts include the difference between series. Charts use flat fills and strokes only.

The dashboard's six-month spending chart is an absolute-value horizontal band chart. Each row is a month. Total band length represents total monthly spend on one shared scale; each segment represents a category amount. Category order and color stay stable between months. The chart shows six months, useful currency guides, compact legend labels, keyboard-focusable month rows, an accessible summary for each row, and a nonvisual table. It is not normalized to 100%.

Actual balance history uses a solid cobalt stroke. Projected continuation uses a visually distinct dashed butter stroke and begins at the final actual point. A forecast's prediction interval is a quiet translucent band behind the expected path, with no visible boundary strokes; it is labeled as an 80% range and never as certainty. Monthly forecast rows show the expected end balance separately from the range and use the expected intra-month low for negative-balance warnings. Forecast styling never implies that likely values are observed facts.

Insights prioritizes monthly income versus expense, category composition, selected-category trend, budget versus actual, and flow. A one-period comparison renders visible data points rather than an apparently empty axis. Empty charts explain the missing data and provide the next useful action; they do not render decorative zero shapes.

## Responsive Behavior

At desktop widths, the labeled sidebar remains fixed and independently scrollable on short displays. The top utility bar stays compact and carries only theme and one page-specific action when the page owns a clear creation flow; period context belongs to the page's own selector instead of being repeated in the shell. Add transaction appears only on Dashboard and Transactions; planning, automation, and library pages expose their own Add budget, rule, template, category, or tag action. Search belongs to the Transactions ledger rather than the global shell. Route-local tabs are limited to true subordinate modes.

At 390px, Dashboard keeps the balance hero but omits the desktop history chart and transaction-type selector. Four metric lanes form a compact 2×2 grid. Without a planning lane, income and spending remain side by side while net movement spans the full second row, avoiding a blank fourth slot. The sticky top bar never reserves or overlays bottom-page space; its action label may collapse to an icon only below 380px while retaining the full accessible name.

Mobile sheets use safe areas and focused scroll regions. The keyboard may hide the floating dock while a field is active. At 200% zoom, content reflows without clipped actions or horizontal page scroll. Reduced motion, increased contrast, forced colors, and system theme preferences remain first-class branches.

## Page Archetypes

- **Board:** Dashboard, Digest, and high-level admin health use metric lanes plus compact evidence lists.
- **Ledger:** Transactions, Inbox, Trash, tag activity, and recurring occurrences use one lifted register with contextual controls.
- **Planning canvas:** Budgets, Forecast, and What If emphasize allocations, projections, and comparisons. Budget creation and editing use focused modals instead of persistent editor rails.
- **Automation board:** Recurring, Templates, and Rules show condition/action or commitment anatomy, state, next occurrence, and audit evidence. Creation and editing happen in focused modals; Templates use a dedicated drag handle to make their persisted order explicit.
- **Library:** Categories and Tags use compact identity tiles with modal create/edit or merge workflows plus contextual archive and restore actions.
- **Evidence desk:** Reconciliation pairs statement evidence with matched or missing records and makes state transitions explicit.
- **Composer:** Reports groups configuration, preview/generation state, and follow-up actions without nesting generic form cards.
- **Utility workspace:** Settings and Admin use grouped sections, stable section navigation, clear status, and the same shapes and type system.
- **Conversation:** Assistant uses a full-height transcript and persistent composer, not a generic card containing a chatbot.
- **Identity:** Setup, Login, Signup, and Admin elevation use a quiet product mark, one paper form surface, and explicit security context.

## Feature-Specific Patterns

Dashboard keeps This month, Last month, All time, and Custom obvious. The first viewport contains balance/current position, income, spending, comparison, recent activity, and the six-month spending bands. Recent activity fills the available desktop panel with complete rows only and never creates a nested scrolling region; mobile caps the list at four rows. The balance hero does not repeat net movement already shown in its dedicated lane; its desktop history chart exposes exact actual and likely values on hover and is omitted on mobile where the current balance and metric grid carry the same decision value more efficiently. The planning metric reflects the planning model the user actually uses: an overall monthly budget shows plan pace, category-only budgets show their aggregate at-risk count and single highest-risk category, and no budgets means no planning metric or setup prompt. Incognito mode conceals headline and analytical values and disables value tooltips without collapsing layout, while budget health and recent transaction amounts remain readable. Durable purchases and attention items appear only when data exists.

Transactions keeps its page actions with the page title, separate from filtering: desktop shows labeled Inbox, Trash, and Export CSV buttons beside the search reveal, while mobile keeps one compact icon cluster beside the page title in the same row — search, an icon-only filter trigger with an active-filter count badge, and an overflow menu holding Inbox, Trash, and Export CSV. On desktop, the search trigger morphs into a search bar in the same row; on mobile it opens as a full-width floating popover beneath the title row. Search updates the URL-backed ledger directly, matches the whole query against transaction titles and descriptions with typo tolerance, and always preserves chronological order. A trailing clear control appears only when there is text, Escape clears or collapses the bar, and an active mobile search persists as a removable chip after the popover closes. Desktop exposes period, type, category, and tag in one immediate filter toolbar where every filter shares the same label-plus-control anatomy; mobile keeps those same filters in a focused bottom sheet. Search never interprets filter syntax: users apply period, type, category, and tag through the visible controls. Transaction checkboxes remain discoverable, while the permanent register header changes in place from result context to a segmented bulk scope and bulk-edit action after selection. Direct detail/edit URLs and return context remain canonical.

Budgets uses separate soft allocation, spent, remaining, and pace modules. Category budgets surface actual, limit, remaining, pace, and projection as a planning card, with burndown evidence available contextually. Month, recurring, override, and yearly modes stay distinct; creation happens in a scope-aware modal, and recurring plans form one vertical list. Every single-selection button group across the app uses the same measured sliding indicator, quick transform-led motion, and reduced-motion fallback rather than page-specific active-button surfaces.

Recurring amounts retain their native currency while monthly summary equivalents remain euros. Add rule and row edit actions open focused modals; compact rows keep the auto-post toggle self-explanatory, History content-sized, and destructive actions icon-only with accessible names. Templates use the same modal editor and a pointer- and keyboard-operable drag handle for their quick-add order. Rules read from conditions into actions, keep the enable switch first in each action cluster, and use the shared modal editor. Categories create and edit in one responsive modal; Tags expose separate Add and Merge modal flows. Compact edit, delete, and archive actions remain icon-only with accessible names. Reconciliation states remain explicit rather than relying on green/red alone. Reports retain generation state and the last successful PDF. Admin elevation never leaks behind visual polish.

Assistant is read-only without repeating that invariant beside the composer. Suggested prompts appear only when empty. Streaming, stop, cancellation, tool activity, failure, disabled, and history states remain distinct. The composer sits at the bottom of the available page without competing with persistent bottom chrome.

## Native iOS App

The SwiftUI app should share the web app's product tone while using native iOS structure and interactions.

- Use grouped lists and forms for dense tracker workflows, with a shared adaptive background and restrained glass surfaces for hierarchy.
- Apply Liquid Glass to grouped controls, metric cards, empty states, and bottom action bars; avoid turning every row into a decorative glass card.
- Prefer native interactions where they fit the workflow: pull-to-refresh for data screens, navigation search for transaction search, segmented pickers for primary modes, swipe actions for existing row operations, and system sheets/dialogs for confirmation.
- Use icon-only toolbar refresh actions with accessibility labels so navigation bars stay quiet.
- Keep colors aligned with the web app: warm gold accent in dark mode, teal in light mode, semantic green/red for income and expenses, and neutral surfaces for dense data.
- Use monospaced digits for metric-heavy surfaces and keep spacing compact enough for one-handed iPhone use.
- Assistant progress: while a turn streams, show a single shimmering progress line above the answer (not inside a bubble), and only render the answer bubble once final user-visible content exists. The one line carries, in precedence order, the active tool's verb phrase (a freshly started tool shows for a bounded ~2s window so a slow tool can't pin the line), then the model's latest intermediate reasoning, then a default "Thinking…"; each new tool resets the window so bursts roll smoothly rather than flickering. Keep tool verb phrases for this line separate from the shorter noun labels used in the collapsed Activity disclosure. Under Reduce Motion, drop the shimmer for a small `ProgressView` plus static text. A turn that ends with no answer reads as a quiet status line, not an empty bubble.
- Assistant scrolling: when a message is sent, scroll the new question to the top of the viewport (not the bottom) so the reply renders in a natural reading position with earlier turns still scrollable above. Reserve just enough space below the newest exchange for the question to reach the top, shrinking that reserve as the answer grows so completed conversations don't carry a large trailing gap. Only user turns collapse: extremely long questions truncate to a few lines with a "See more"/"See less" chevron toggle; assistant answers are never truncated this way.
- Keep haptics tight, subtle, and reserved for committed actions and discrete state changes — never for navigation, scrolling, or per-keystroke streaming. Use the declarative `.sensoryFeedback` modifier driven off the relevant state (no UIKit feedback generators): `.selection` for every toggle and segmented picker so like controls feel uniform across the app, `.impact(weight: .light)` for primary commit actions (the floating Quick Add button, sending an Assistant message), `.impact(flexibility: .rigid)` for interrupting an in-flight action (stopping a streaming response) so it reads as distinct from sending, and `.success`/`.error` for the outcome of a data mutation such as saving a transaction. When a control is swapped out at the moment it is tapped (for example the Send/Stop button toggling on streaming state), attach the feedback to a stable parent driven by a tap counter so the modifier is not torn down before it fires. The system haptic setting is honored automatically, so no separate enable/disable control is needed.

---
