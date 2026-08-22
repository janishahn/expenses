# Expenses Web Design

This document defines the stable visual language for the web app. It does not
specify page contents, feature behavior, control placement, or current
implementation details. Use the code and tests for those facts.

The CSS tokens and shared components in `ui/src` are the source of truth for
exact values. Update this document only when the design language itself changes.

## Product Character

Expenses is a private household-finance tool. It should feel calm, clear, and
tactile while remaining dense enough for daily work. It is not a generic SaaS
dashboard, an editorial site, or a decorative component gallery.

Light mode uses a warm stone canvas, paper-like surfaces, dark ink, and cobalt
for interaction. Mint, coral, butter, and violet carry compact financial meaning.
Dark mode uses deep green-black and charcoal surfaces while preserving the same
semantic hierarchy. Both themes are authored states, not simple inversions.

## Type and Numbers

- Use the system font for headings, navigation, forms, and prose.
- Use the bundled IBM Plex Mono for amounts, dates, axes, and short metadata.
- Use tabular figures for financial values.
- Keep labels in sentence case. Reserve uppercase mono for terse metadata; do not
  use it as a decorative kicker.
- Do not load fonts or other visual assets from outside the self-hosted app.

## Surfaces and Spacing

- Build depth with the warm canvas, layered paper surfaces, spacing, and restrained
  shadows.
- Use borders as dividers or state indicators, not around every group.
- Use the existing spacing, radius, elevation, and motion tokens. Do not create
  page-local substitutes without a clear need.
- Keep primary content compact and legible. Avoid oversized introductions and
  empty hero space.
- Use gradients, glow, glass, and ornamental blur only when the concept requires
  them; they are not default polish.
- Use pills only for chips, compact status, and controls whose shape has meaning.

## Composition

- Let each workflow choose a suitable structure: ledgers for records, planning
  surfaces for budgets and forecasts, and focused workspaces for review tasks.
- Keep page actions with the page context they affect. Keep filters and other
  temporary state in one coherent control area.
- Prefer flat rows with useful dividers over a separate rounded card for every
  item.
- Keep similar controls recognizable across routes without forcing every page
  into the same layout.
- Use existing shared components and visual roles before adding a new pattern.

## Core Visual Roles

- **Financial panel:** a paper surface for one coherent group of information.
- **Metric lane:** a compact semantic field for a financial value and its context.
- **Ledger row:** a scannable record with concise evidence and an aligned amount.
- **Category tile:** a stable local icon with a deterministic semantic color.
- **Toolbar:** one control area for one job, without stacked framing.
- **Inspector:** a focused view or edit surface that preserves direct navigation
  and browser-back behavior.
- **Recovery panel:** a clear error with a useful next action while retaining page
  context.
- **Confirmation dialog:** the shared in-app confirmation for destructive actions;
  do not use native browser prompts.

Radix and ShadCN may supply behavior, focus management, and keyboard semantics.
Their stock appearance is not the product.

## Responsive Behavior

- Preserve the same capability and meaning on desktop and mobile, while using a
  layout suited to each viewport.
- Keep controls and content inside the viewport at supported widths and at 200%
  zoom.
- Use safe-area-aware mobile surfaces and focused scroll regions.
- Keep touch targets at least 44 by 44 CSS pixels. A compact visible control may
  use a larger non-overlapping hit area.
- Keep important actions visible or in a clearly named menu; do not leave stale
  duplicate controls in one layout.

## Accessibility and State

- Normal text and interactive states meet WCAG AA contrast.
- Color never carries meaning alone. Pair it with text, signs, patterns, icons,
  or accessible names.
- Keep a visible focus indicator and restore focus after dialogs, sheets, and
  temporary controls close.
- Support keyboard use, screen readers, reduced motion, increased contrast, and
  forced colors.
- Keep loading, empty, failed, unavailable, disabled, selected, and destructive
  states distinct.
- Preserve entered data after failed mutations and show readable server errors.
- Keep visible copy brief, but retain accessible names and text that prevents a
  likely mistake.

## Data Visualization

- Every chart must answer a financial question, show units, and retain exact
  values through labels, tooltips, or an adjacent data view.
- Provide a nonvisual equivalent and a clear empty state.
- Use flat semantic fills and strokes. Do not rely on color alone.
- Preserve recorded relationships. Never imply flows, causation, or certainty
  that the data does not contain.
- Keep privacy controls effective without collapsing layout or exposing values in
  tooltips and accessible names.
- Use motion only to clarify a change, and disable it when reduced motion is on.

## Avoid

- Generic page recipes that ignore the workflow.
- Giant dark or cobalt blocks used only to create hierarchy.
- Repeated nested cards and permanent attention sidebars.
- Filler copy, repeated headings, and decorative metadata.
- Hidden actions, silent failures, and controls that appear ready before they can
  work.
