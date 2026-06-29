# Design Language

This document is the canonical source of truth for the design language used across the expenses application. All UI changes should adhere to these guidelines. When adding new patterns or modifying existing ones, update this document to keep it current.

---

## Philosophy

- **Dark-first presentation**: The visual baseline is a pure-black dark shell, with a persisted `System` / `Light` / `Dark` preference resolving the effective runtime theme
- **Warm accent palette**: Primary emphasis uses a warm gold accent in dark mode and a teal accent in light mode
- **Calm depth over gradients**: Prefer layered surfaces, borders, shadows, and contrast over gradients for visual hierarchy
- **Mobile-first responsive**: Base styles target mobile with progressive enhancement for desktop (861px+)
- **Consistent cross-page structure**: Shared elements (kickers, titles, action placement, summary cards) should feel familiar across the app

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **UI Framework** | React 18 | Component architecture |
| **Build Tool** | Vite 7 | Development server, bundling |
| **Styling** | Tailwind CSS 3.4 | Utility-first CSS |
| **UI Primitives** | Radix UI + shadcn registry | Accessible primitives wrapped locally in `ui/src/components/ui` |
| **Theming** | CSS Custom Properties | Theme tokens selected via `html[data-theme]` |
| **Icons** | Phosphor Icons | Consistent iconography |
| **Charts** | Chart.js + react-chartjs-2 | Data visualization |
| **Rich Text** | TipTap + react-markdown | Text editing and rendering |
| **State** | TanStack Query 5 | Server state management |
| **Routing** | React Router 7 | Client-side navigation |

**Product styling remains custom**: The app uses local Radix/shadcn primitives for low-level building blocks, while product-specific visuals, layout, and component styling are defined with Tailwind utilities and CSS in `ui/src/index.css`.

### shadcn Foundation Standard

The app standardizes on the checked-in shadcn configuration in `ui/components.json`:

- **Style preset**: `radix-luma`
- **Base color**: `neutral`
- **Theme model**: CSS variables enabled (`cssVariables: true`) and wired into `ui/src/index.css`
- **Icon library**: `phosphor`
- **Menu treatment**: `inverted-translucent` with `subtle` accent

Usage conventions:

- Prefer the local wrappers in `ui/src/components/ui/*` over importing raw `radix-ui` primitives in feature/page code.
- Prefer the product-facing wrappers such as `AppButton` and `AppCard` when you need app-standard visual treatment on top of shadcn primitives.
- Treat shadcn as the structural/accessibility baseline and the design tokens in `index.css` as the source of truth for product appearance.
- When adding a new shared primitive, register/configure it through the existing shadcn setup so aliases, CSS variables, icon choices, and preset behavior stay consistent.

---

## Color System

### Theme Architecture

Colors are defined as RGB channel values in CSS variables, enabling Tailwind's `<alpha-value>` syntax for transparency. The HTML boot markup starts at `data-theme="dark"` to avoid a light flash before hydration, then theme bootstrap resolves the persisted preference (defaulting to `system`) and applies the effective light or dark theme.

```css
--accent: 245 185 85;  /* Usage: bg-accent, bg-accent/50, text-accent/80 */
```

### Dark Theme Tokens

| Variable | RGB | Hex | Usage |
|----------|-----|-----|-------|
| `--bg` | 0 0 0 | #000000 | Page background |
| `--surface` | 12 12 12 | #0c0c0c | Card backgrounds |
| `--surface-hi` | 20 20 20 | #141414 | Elevated surfaces, inputs |
| `--faint` | 28 28 28 | #1c1c1c | Subtle backgrounds, hover states |
| `--border` | 40 40 40 | #282828 | Primary borders |
| `--border-hi` | 56 56 56 | #383838 | Hover/focus borders |
| `--text` | 255 255 255 | #ffffff | Primary text |
| `--muted` | 145 145 145 | #919191 | Secondary/tertiary text |
| `--accent` | 245 185 85 | #f5b955 | **Primary interactive color** |
| `--accent-strong` | 255 200 100 | #ffc864 | Brighter accent variant |
| `--accent-soft` | 235 170 70 | #ebaa46 | Softer accent variant |
| `--semantic-green` | 98 196 146 | #62c492 | Credit/income, success, positive |
| `--semantic-red` | 224 114 102 | #e07266 | Debit/expense, error, destructive |
| `--semantic-blue` | 100 180 226 | #64b4e2 | Informational |
| `--semantic-purple` | 145 157 224 | #919de0 | Neutral/special categories |

### Light Theme

| Variable | RGB | Hex | Usage |
|----------|-----|-----|-------|
| `--bg` | 240 246 248 | #f0f6f8 | Page background |
| `--surface` | 250 252 253 | #fafcfd | Card backgrounds |
| `--surface-hi` | 236 243 246 | #ecf3f6 | Elevated surfaces |
| `--faint` | 228 237 241 | #e4edf1 | Subtle backgrounds |
| `--border` | 205 219 225 | #cddbe1 | Primary borders |
| `--border-hi` | 173 193 201 | #adc1c9 | Hover/focus borders |
| `--text` | 35 52 60 | #23343c | Primary text |
| `--muted` | 101 121 131 | #657983 | Secondary text |
| `--accent` | 22 154 176 | #169ab0 | Primary interactive color |
| `--accent-strong` | 46 182 204 | #2eb6cc | Brighter accent variant |
| `--accent-soft` | 87 195 209 | #57c3d1 | Softer accent variant |
| `--semantic-green` | 45 153 102 | #2d9966 | Credit/income, success, positive |
| `--semantic-red` | 206 98 86 | #ce6256 | Debit/expense, error, destructive |
| `--semantic-blue` | 63 137 195 | #3f89c3 | Informational |
| `--semantic-purple` | 118 123 189 | #767bbd | Neutral/special categories |
| `--surface-highlight` | 255 255 255 | #ffffff | Inset highlight source |
| `--shadow-soft` | n/a | n/a | Standard card shadow |
| `--shadow-raised` | n/a | n/a | Elevated drawer/modal shadow |
| `--shadow-accent` | n/a | n/a | Accent emphasis shadow |
| `--ring-focus` | n/a | n/a | Focus ring token |

### Semantic Color Usage

| Color | Use For |
|-------|---------|
| `accent` | Primary actions, active states, focus rings, links, nav indicators, chart highlights |
| `semantic-green` | Credits, income, success states, budget under-spending, positive values |
| `semantic-red` | Debits, expenses, errors, destructive actions, budget over-spending, negative values |
| `muted` | Labels, placeholders, inactive navigation, secondary text |

Accent and semantic colors are safe to use for emphasis, but they should not be treated as guaranteed AA-compliant small-text colors in every context, especially on light surfaces. For small standalone text, prefer `text`/`muted` or pair accent/semantic colors with supporting fills, borders, or larger/bolder treatments.

### Surface Hierarchy

```
bg (deepest) → surface → surface-hi → faint
  #000000        #0c0c0c    #141414     #1c1c1c
```

Use deeper surfaces for page backgrounds, elevated surfaces (`surface-hi`) for form inputs and interactive elements, and `faint` for hover states on surface elements.

---

## Typography

### Font Families

```css
font-head: "Plus Jakarta Sans", ui-sans-serif, system-ui;  /* Headings, brand */
font-sans: "Manrope", ui-sans-serif, system-ui;             /* Body text */
font-mono: "JetBrains Mono", ui-monospace, monospace;       /* Numbers, code */
```

### Font Size Scale

| Tailwind | Usage | Size |
|----------|-------|------|
| `text-[10px]` | Mobile KPI labels | 10px |
| `text-[11px]` | Uppercase labels, hints | 11px |
| `text-[0.78rem]` | Form labels | ~12.5px |
| `text-[12.5px]` | Tab labels | 12.5px |
| `text-xs` | Small labels, badges | 12px |
| `text-sm` | Body text, descriptions | 14px |
| `text-[0.95rem]` | Form inputs | ~15.2px |
| `text-base` | Default | 16px |
| `text-lg` | Card titles | 18px |
| `text-xl` | Modal titles | 20px |
| `text-2xl` | Secondary headings | 24px |
| `text-[2.15rem]` | Page titles, balance | ~34.4px |

### Font Weights

| Weight | Usage |
|--------|-------|
| `font-medium` | Secondary text |
| `font-semibold` | Buttons, labels, UI text |
| `font-bold` | Card titles |
| `font-extrabold` | Page titles, brand |

### Letter Spacing

| Value | Usage |
|-------|-------|
| `tracking-[-0.045em]` | Page titles |
| `tracking-[-0.04em]` | Brand logo |
| `tracking-[-0.012em]` | Body default |
| `tracking-[0.02em]` | Form labels |
| `tracking-[0.08em]` | Uppercase labels (kickers) |
| `tracking-[0.16em]` | Breadcrumbs |

### Line Heights

| Tailwind | Usage |
|----------|-------|
| `leading-none` | KPI numbers |
| `leading-tight` | Compact text |
| `leading-5` | Compact body |
| `leading-6` | Body text |
| `leading-[1.02]` | Page titles |

---

## Spacing & Layout

### Spacing Scale (Tailwind Default)

| Value | Size | Common Usage |
|-------|------|--------------|
| `0.5` | 2px | Tight gaps |
| `1` | 4px | Small gaps |
| `1.5` | 6px | Form label gap |
| `2` | 8px | Standard gap |
| `2.5` | 10px | Section gaps |
| `3` | 12px | Card padding (mobile) |
| `3.5` | 14px | Button padding |
| `4` | 16px | Standard padding |
| `5` | 20px | Section padding |
| `6` | 24px | Large section gaps |
| `7` | 28px | Desktop section padding |

### Breakpoints

| Name | Min Width | Usage |
|------|-----------|-------|
| (default) | 0 | Mobile-first base |
| `sm` | 640px | Small tablets |
| `md` | 768px | Tablets |
| `lg` | 1024px | Laptops |
| `desk` | 861px | **Custom: sidebar layout transition** |

### Container Patterns

**Page wrapper**:
```tsx
<section className="space-y-5 md:space-y-6 desk:space-y-4">
  <PageIntro title="Page Title" actions={...} />
  {/* Page content */}
</section>
```

On mobile, `PageIntro` actions wrap onto their own row when needed. Keep action groups compact and touch-safe rather than forcing dense desktop alignment into the mobile header.

**Content padding** (main in AppShell):
- Mobile: `px-5 pt-6 pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))]`
- Desktop: `desk:px-7 desk:pt-7 pb-9`

**Sidebar**: Fixed `w-sidebar` (`theme.spacing.sidebar` = 224px) with `desk:ml-sidebar` content offset. The mobile backdrop starts at `left-sidebar` so its click target covers only the area outside the open drawer.

**Desktop shell controls**: Shared shell controls such as the quick theme toggle live in normal page flow at the top of `main`, aligned to the desktop content gutter with the same `px-7` inset as the page body so they scroll away with page content instead of floating above it.

**Mobile shell controls**: Primary navigation lives behind the hamburger sidebar. The global add affordance is a bottom-right floating action button that respects safe-area insets and hides while the sidebar, add sheet, or a mobile form field is active. Page-level desktop controls should stay behind the `desk` breakpoint so the 768-860px range does not mix desktop controls with the mobile shell.

### Grid Patterns

```tsx
// Two-column (main + sidebar)
<div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">

// Three-column equal
<div className="grid gap-4 lg:grid-cols-3">

// Dashboard KPI layout
<div className="desk:grid desk:grid-cols-[minmax(0,1.45fr)_minmax(0,0.9fr)_minmax(0,0.9fr)]">

// Charts (proportional)
<div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
```

### Common Layout Patterns

**Flex center**: `flex items-center justify-center gap-2`
**Space between**: `flex items-center justify-between gap-3`
**Vertical stack**: `flex flex-col gap-3`
**Inline button group**: `inline-flex items-center gap-1.5`

**Review workspace**: use a two-column desktop grid when a page combines a
primary queue with secondary context, e.g.
`lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]`. The main column holds
the actionable rows; the side column summarizes unresolved work and related
nearby records. On mobile this collapses to a single column with the primary
queue first.

---

## Corner Radius

### Radius Scale

The radius system is proportional to a base value for consistency:

```css
--radius: 1rem;                        /* 16px base */
--radius-xs: calc(var(--radius) * 0.333);  /* ~5px */
--radius-sm: calc(var(--radius) * 0.583);  /* ~9px */
--radius-md: calc(var(--radius) * 0.833);  /* ~13px */
--radius-lg: var(--radius);                 /* 16px */
--radius-xl: calc(var(--radius) * 1.333);   /* ~21px */
--radius-2xl: calc(var(--radius) * 1.667);  /* ~27px */
```

### Element Radius Mapping

| Element | Tailwind Class | Value |
|---------|----------------|-------|
| Primary buttons | `rounded-full` | 9999px (pill) |
| Secondary buttons | `rounded-full` | 9999px (pill) |
| Inline buttons | `rounded-full` | 9999px (pill) |
| Icon buttons | `rounded-full` | 9999px |
| Toggle switches | `rounded-full` | 9999px |
| Nav links | `rounded-full` | 9999px |
| Category icons | `rounded-xl` | ~21px |
| Form inputs | `rounded-lg` | 16px |
| Description editor | `rounded-xl` | ~21px |
| Cards (main) | `rounded-2xl` | ~27px |
| Cards (soft variant) | `rounded-2xl` | ~27px |
| Centered dialogs (`drawer-panel`) | `rounded-2xl` | ~27px |
| Sheet panels (`SheetContent`) | `rounded-[1.75rem]` | ~28px |
| Inner card content | `rounded-[1.1rem]` | ~18px |
| Durable purchase items | `rounded-[1.25rem]` | ~20px |
| Dropdown/container items | `rounded-md` | ~13px |

### Inset Radius Pattern

When nesting rounded elements within a parent container:

- Parent container: `rounded-2xl` (~27px)
- Inner elements: Use reduced radius like `rounded-[1.1rem]` (~18px) to maintain visual hierarchy
- The inner radius should be smaller than the parent to create clear containment

---

## Shadows & Depth

### Shadow Variables

```css
--shadow-soft:
  0 24px 56px -32px rgb(0 0 0 / 0.85),
  0 1px 0 rgb(255 255 255 / 0.03);

--shadow-raised:
  0 28px 64px -34px rgb(0 0 0 / 0.92),
  0 1px 0 rgb(255 255 255 / 0.04);

--shadow-accent:
  0 18px 38px -20px rgb(var(--accent) / 0.35);
```

### Shadow Usage

| Context | Shadow |
|---------|--------|
| Cards (`surface-card`) | `var(--shadow-soft)` |
| Drawers/modals | `var(--shadow-raised)` |
| Accent buttons | `var(--shadow-accent)` |
| Icon buttons | `shadow-[0_16px_30px_-24px_rgba(0,0,0,0.82)]` |
| Category icons | `shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_24px_-20px_rgba(0,0,0,0.75)]` |
| Sidebar | `shadow-[var(--shadow-raised)]` |
| Mobile add FAB | `shadow-[var(--shadow-accent)]` |

### Z-Index Layers

| Context | Z-Index |
|---------|---------|
| Main content | (none/auto) |
| Header | `z-30` |
| Mobile add FAB | `z-40` |
| Sidebar backdrop | `z-40` |
| Sidebar | `z-50` |
| Page-local drawers/sheets | `z-[65]` |
| App-level drawers/modals | `z-[70]` |

---

## Components

### Surface Cards

```tsx
// Standard card
<div className="surface-card p-4 md:p-5">
  {/* Content */}
</div>

// Softer variant (less elevation)
<div className="surface-card-soft p-4">
  {/* Content with inset highlight */}
</div>

// Card with header/body sections
<div className="surface-card">
  <div className="surface-section-header">
    <h2 className="font-head text-lg font-bold">Title</h2>
  </div>
  <div className="surface-section-body space-y-4">
    {/* Content */}
  </div>
</div>
```

**CSS definitions** (from `index.css`):
- `surface-card`: `rounded-2xl border bg-surface` with `shadow-soft`
- `surface-card-soft`: `rounded-2xl border bg-surface-hi` with inset highlight
- `surface-list-shell`: `overflow-hidden rounded-[1.1rem] bg-surface-hi/18`
- `surface-section-header`: `border-b px-5 py-4`
- `surface-section-body`: `px-5 py-5`

### Buttons

```tsx
// Primary CTA
<button className="btn-primary">Save</button>

// Ghost/secondary
<button className="btn-ghost">Cancel</button>

// Compact inline
<button className="btn-inline">
  <Icon className="h-3.5 w-3.5" />
  Edit
</button>

// Danger
<button className="btn-danger">Delete</button>

// Inline danger
<button className="btn-inline-danger">
  <TrashIcon className="h-3.5 w-3.5" />
  Remove
</button>
```

**Button CSS** (from `index.css`):
- `btn-primary`: `rounded-full px-4 py-2 text-sm font-semibold`, accent background with shadow-accent
- `btn-ghost`: `rounded-full border px-4 py-2 text-sm font-semibold`, border with surface-hi background
- `btn-inline`: `px-3.5 py-1.5 text-xs font-semibold`, compact variant with surface-hi background
- `btn-danger`: `rounded-full border px-4 py-2 text-sm font-semibold`, red border and background tint

**Auth screen switch affordance**: The sign-in and sign-up screens are separate centered-card
pages that share structure. Each shows its primary action as a full-width `btn-primary`, then an
`or` divider (`h-px flex-1 bg-border` on each side), then a full-width `btn-ghost` that navigates
to the sibling auth screen (e.g. "Create account" on sign-in, "I already have an account" on
sign-up). The ghost switch button on sign-in is only shown when self-service signup is allowed.

### Form Fields

```tsx
// Standard field
<label className="form-label">
  <span>Label Text</span>
  <input className="w-full field" placeholder="..." />
</label>

// Small field variant
<input className="field field-sm" />

// With description
<label className="form-label">
  <span>Label Text</span>
  <input className="w-full field" />
  <span className="text-xs text-muted mt-1">Helper text</span>
</label>
```

**Field CSS** (from `index.css`):
- Base input: `rounded-lg px-3.5 py-2.5 text-[0.95rem]`, `min-h-[2.75rem]`
- Border: `border` with hover `border-hi` and focus accent ring
- Background: `bg-surface-hi` with inset highlight
- Use `.form-label` for standard field labels and helper text stacks.
- Use `text-[11px] uppercase tracking-[0.08-0.12em]` for section kickers or sublabels, not field labels.

### Pill Groups & Tabs

```tsx
// Pill group (multi-select toggle)
<div className="pill-group">
  {options.map(opt => (
    <button
      className={`pill-button ${active === opt ? 'pill-button-active' : ''}`}
    >
      {opt.label}
    </button>
  ))}
</div>

// Tab panel (single-select)
<div className="ptabs">
  {views.map(view => (
    <button className={`ptab ${active === view ? 'ptab-active' : ''}`}>
      {view.label}
    </button>
  ))}
</div>
```

**Pill CSS**:
- Container: `inline-flex flex-wrap items-center gap-1 rounded-full border p-1`
- Item: `border border-transparent px-3.5 py-1.5 text-xs font-semibold`
- Active: Accent-tinted background with accent text for clear visibility

### Neutral Chips

```tsx
<span className="chip">Recurring</span>
```

Use `chip` for non-interactive display pills such as counts, tags, and status badges that should feel lighter than buttons but more structured than plain text.

### Page Header

```tsx
<PageIntro
  title="Page Title"
  titleAccessory={
    <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">
      Hidden from budgets
    </span>
  }
  actions={
    <>
      {isFetching ? <span className="loading-hint">Updating…</span> : null}
      <button className="btn-primary">Add</button>
    </>
  }
  backHref="/parent"
  backLabel="← Back"
/>
```

### Drawer/Modal

Use the local Radix-backed overlay primitives instead of hand-rolled one-off wrappers:

```tsx
// App-level centered dialog
<DialogContent className="drawer-panel drawer-motion">
  ...
</DialogContent>

// Page-local sheet / filter drawer
<SheetContent side="bottom" className="drawer-motion">
  ...
</SheetContent>
```

- `DialogContent` uses the shared `drawer-panel` styling with `rounded-2xl` and `z-[70]`.
- `SheetContent` uses `z-[65]` plus side-aware placement and `rounded-[1.75rem]`.
- `drawer-overlay` provides the shared blurred backdrop for both patterns.
- Promote overlays to `z-[70]` only when they must sit above page-local sheets, such as the add-transaction flow.
- App-level dialogs dismiss on backdrop click and Escape unless the flow explicitly protects unsaved work.

### Agent Chat Surface

The Spending Assistant (`/assistant`) is the canonical pattern for conversational, read-only AI surfaces. It reads as a focused chat column rather than a dense data page.

- **Layout**: The `PageIntro` spans the normal page width like every other page so the title, page actions, and desktop theme toggle align with the rest of the app; a centered `max-w-3xl` column directly below it holds the scrolling conversation and the docked composer as a narrower readable measure. The section fills the viewport (`min-h-[calc(100dvh-…)]`) so the composer rests at the bottom even on an empty thread. On `/assistant` the shell drops its main bottom padding and hides the mobile add FAB so the composer docks cleanly and nothing overlaps it.
- **Messages**: User turns are right-aligned accent-tinted bubbles (`rounded-2xl rounded-br-md border-accent/25 bg-accent/12`, `whitespace-pre-wrap`). Assistant turns are left-aligned with a small round chat avatar and render Markdown through the shared `transaction-markdown` prose styles (GFM plus SmartyPants smart typography, so plain model output like `--` renders as an em dash and `...` as an ellipsis while code spans stay verbatim; links open in a new tab).
- **Tool ticker**: While the assistant works, show a compact wrap of status pills — a spinning `CircleNotch` (accent) for running, a `Check` (green) for success, a `Warning` (red) for failure — labeled with friendly tool names. Show activity and status only; never render raw tool output (`result_preview`) or the opaque `message_history`, and never fabricate a reasoning trace.
- **Streaming**: Render events as they arrive — tool pills appear and resolve live, and answer text streams in incrementally — never deferring the whole turn to the final result. While streaming with no answer text yet and no tool running, show a single muted "Thinking…" hint. The NDJSON response must reach the client unbuffered; the stream route sets `Content-Encoding: identity` so `GZipMiddleware` does not hold events in its deflate buffer until the turn ends.
- **Composer**: A `sticky bottom-0` band (`bg-bg`, safe-area bottom padding) holds a single elevated `composer-surface` card — one `surface-hi` `rounded-2xl` surface that owns a single calm focus affordance on `:focus-within` (a warmer accent border plus a subtle accent glow and the standard soft elevation, not the hard 4px `--ring-focus`) — wrapping a transparent, chrome-free auto-growing textarea plus a single trailing action. The textarea carries no border, background, or focus ring of its own; the surface owns the focus state, so keep the composer to that one bordered surface rather than nesting borders or rings within borders. Enter sends, Shift+Enter inserts a newline. The trailing action is a circular accent Send button while idle and a circular red Stop button while streaming; Stop aborts the in-flight request and leaves any partial answer in place.
- **Empty state**: Center a short hero (chat icon, one-line invitation) above a row of tappable prompt chips that send immediately.

```tsx
<section className="flex min-h-[calc(100dvh-5.5rem)] flex-col desk:min-h-[calc(100dvh-2rem)]">
  <PageIntro title="Spending Assistant" />
  <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
    <div role="log" aria-live="polite" className="flex flex-1 flex-col gap-5 pt-5 pb-4">
      {/* user + assistant turns */}
    </div>
    <form className="sticky bottom-0 z-10 bg-bg pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
      <div className="composer-surface flex items-end gap-2 rounded-2xl border p-2">
        {/* auto-growing textarea + circular Send/Stop */}
      </div>
    </form>
  </div>
</section>
```

---

## Interactive States

### Buttons

| State | Primary | Ghost | Danger |
|-------|---------|-------|--------|
| Default | `bg-accent` + shadow | `border` + `bg-surface-hi/0.6` | `border-semantic-red/0.4` + `bg-semantic-red/0.08` |
| Hover | `brightness-110` | `border-hi` + `bg-surface-hi/0.9` | `bg-semantic-red/0.14` |
| Focus | Accent ring | Accent ring | Accent ring |
| Disabled | `opacity-60` | `opacity-60` | `opacity-60` |

### Pills/Tabs

| State | Classes |
|-------|---------|
| Inactive | `text-muted` |
| Hover | `text-text` + `bg-faint/0.72` |
| Active | `bg-surface` + `text-text` + inset shadow |

### Form Inputs

| State | Styling |
|-------|---------|
| Default | `border` + `bg-surface-hi` + inset highlight |
| Hover | `border-hi` |
| Focus | `border-accent` + focus ring |
| Disabled | `border-border` + `bg-surface` + `text-muted` + `cursor-not-allowed` |
| Placeholder | `text-muted` |

### Icon Buttons

| State | Classes |
|-------|---------|
| Default | `rounded-full` + `border/0.80` + `bg-surface-hi/0.80` + `text-muted` + shadow |
| Hover | `border-hi` + `text-text` |

### Border Opacity

- Primary containers use `border-border`.
- Nested dividers and navigation chrome use `border-border/80` or `divide-border/80`.
- Subtle icon containers may use `border-border/70`.

---

## Animation & Transitions

### CSS Keyframe Animations

```css
/* Page enter */
@keyframes pagein {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.page-enter { animation: pagein 0.25s ease-out; }

/* Toast notification */
@keyframes toast-in-out {
  0%   { opacity: 0; transform: translateY(8px) scale(0.96); }
  12%  { opacity: 1; transform: translateY(0) scale(1); }
  80%  { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(-4px) scale(0.98); }
}
.toast-flash { animation: toast-in-out 2s ease-out forwards; }
```

### Transition Classes

```css
/* Standard interactive element */
transition  /* 150ms ease */

/* Menu/accordion */
.menu-transition {
  transition: opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0.9, 0.2, 1);
}

/* Drawer/modal */
.drawer-motion {
  transition: transform 220ms cubic-bezier(0.2, 0.9, 0.2, 1), opacity 180ms ease;
}

/* Accordion content */
.accordion-content {
  transition: max-height 260ms cubic-bezier(0.2, 0.9, 0.2, 1), 
              opacity 180ms ease, transform 180ms ease;
}

/* Sidebar */
transition-transform duration-[280ms] ease-[cubic-bezier(.4,0,.2,1)]
```

### Timing Guidelines

| Duration | Use Case |
|----------|----------|
| 150ms | Default interactive transitions |
| 180ms | Opacity fades |
| 220ms | Transform movements |
| 260ms | Accordion content |
| 280ms | Sidebar slide |
| 250ms | Page enter |
| 2000ms | Toast lifecycle |

### Easing Functions

- **Default**: `ease` (standard)
- **Smooth open**: `cubic-bezier(0.2, 0.9, 0.2, 1)` - menus, accordions
- **Sidebar**: `cubic-bezier(.4, 0, .2, 1)` - smooth slide

---

## Mobile Design

### Navigation Architecture

**Mobile (< 861px)**:
- Hamburger menu for primary and secondary navigation
- Bottom-right floating Add button with safe-area inset handling
- Add button hides while the sidebar, add sheet, or a mobile form field is active
- Content padding accounts for the floating Add button: `pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))]`

**Desktop (≥ 861px)**:
- Fixed left sidebar (224px width)
- No bottom navigation
- Content margin: `desk:ml-[224px]`

### Touch Targets

| Element | Minimum Size |
|---------|--------------|
| Mobile Add FAB | 56px (h-14 w-14) |
| Menu/action buttons | 40px (h-10 w-10) |
| Form inputs | 44px (min-h-[2.75rem]) on mobile |
| Inline buttons | ~32px (px-3.5 py-1.5) |

### Mobile-Specific Components

**Filter sheet**: Collapsed by default, opens as drawer with explicit Apply/Cancel

**Bulk actions**: Inline selection bar appears when items selected

**Safe area handling**:
```tsx
// Mobile Add FAB
<button className="fixed right-5 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]">

// Main content padding
<main className="pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))]">
```

### iOS Input Handling

```css
@media (max-width: 768px) {
  input, select, textarea {
    font-size: 16px;  /* Prevents iOS zoom on focus */
    min-height: 2.95rem;
  }
}
```

### No Horizontal Scroll Policy

The test suite (`mobile-overflow.mobile.spec.ts`) enforces no horizontal overflow on all major pages at iPhone viewport (402×874). Screenshot artifacts are captured on failure.

---

## Responsive Patterns

### Mobile-First Approach

Base styles target mobile, with responsive variants (`sm:`, `md:`, `lg:`, `desk:`) for larger screens:

```tsx
// Mobile: stacked, desktop: grid
<div className="space-y-2.5 md:space-y-3 desk:grid desk:grid-cols-[...]">

// Mobile: hidden, desktop: visible
<button className="hidden desk:inline-flex">Add</button>

// Mobile: visible, desktop: hidden
<button className="desk:hidden">Open Menu</button>

// Progressive padding
<div className="p-4 md:p-5 desk:p-6">
```

### Common Responsive Patterns

| Pattern | Mobile | Desktop |
|---------|--------|---------|
| Filter bar | Button + drawer | Full grid |
| Actions | Overflow menu (`...`) | Inline buttons |
| Navigation | Hamburger sidebar + Add FAB | Sidebar |
| Forms | Full width | Constrained width + sticky rail |
| KPI cards | Stacked | Grid layout |

---

## Chart Visualization

### Theme-Aware Palette

Charts read theme colors dynamically via `readThemeColor()` in `ui/src/components/charts/chartSetup.ts`:

```typescript
// Example palette colors
["#6eb5c4", "#d4a56e", "#9d8edd", "#d68fa4", "#7db8a8", "#8e9dc4", "#c49a6e", "#a890c4"]
```

### Chart Color Usage

| Type | Color Source |
|------|--------------|
| Accent/highlight | `readThemeColor('--accent')` |
| Grid lines | `readThemeColor('--border')` |
| Text | `readThemeColor('--text')` |
| Muted text | `readThemeColor('--muted')` |
| Income | `readThemeColor('--semantic-green')` |
| Expense | `readThemeColor('--semantic-red')` |

---

## Common Patterns

### Lists with Dividers

```tsx
<div className="divide-y divide-border">
  {items.map(item => (
    <div className="px-4 py-3">...</div>
  ))}
</div>
```

### Transaction Row

```tsx
<div className="surface-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between border-l-2 border-l-semantic-red/55">
  <div className="flex items-start gap-3">
    <CategoryIcon icon={icon} />
    <div>
      <p className="font-semibold text-text">{title}</p>
      <TransactionDescription markdown={description} compact clamp />
      <p className="text-xs text-muted">{date} · {category}</p>
    </div>
  </div>
  <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
    <p className="font-mono text-sm font-semibold tabular-nums text-semantic-red">
      -{formatCurrency(amount)} €
    </p>
  </div>
</div>
```

### KPI Card

```tsx
<div className="surface-card relative overflow-hidden p-4 md:p-5">
  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted md:text-xs">
    Balance
  </p>
  <p className="mt-1 font-mono tabular-nums font-semibold text-semantic-green">
    <span className="text-[1.8rem] leading-none md:hidden">
      {formatCurrency(value, false)} €
    </span>
    <span className="hidden text-[2.15rem] leading-none md:inline">
      {formatCurrency(value)} €
    </span>
  </p>
</div>
```

### Progress Bar

```tsx
<div className="h-[5px] rounded-full bg-faint">
  <div
    className="h-[5px] rounded-full bg-semantic-green"
    style={{ width: `${percent}%` }}
  />
</div>
```

### Toast Notification

```tsx
{showToast && (
  <div className="fixed inset-x-0 bottom-6 z-[80] flex justify-center pointer-events-none">
    <div className="toast-flash pointer-events-auto rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-semantic-green shadow-lg shadow-black/30">
      Changes saved
    </div>
  </div>
)}
```

---

## Native iOS App

The SwiftUI app should share the web app's product tone while using native iOS structure and interactions.

- Use grouped lists and forms for dense tracker workflows, with a shared adaptive background and restrained glass surfaces for hierarchy.
- Apply Liquid Glass to grouped controls, metric cards, empty states, and bottom action bars; avoid turning every row into a decorative glass card.
- Prefer native interactions where they fit the workflow: pull-to-refresh for data screens, navigation search for transaction search, segmented pickers for primary modes, swipe actions for existing row operations, and system sheets/dialogs for confirmation.
- Use icon-only toolbar refresh actions with accessibility labels so navigation bars stay quiet.
- Keep colors aligned with the web app: warm gold accent in dark mode, teal in light mode, semantic green/red for income and expenses, and neutral surfaces for dense data.
- Use monospaced digits for metric-heavy surfaces and keep spacing compact enough for one-handed iPhone use.
- Keep haptics tight, subtle, and reserved for committed actions and discrete state changes — never for navigation, scrolling, or per-keystroke streaming. Use the declarative `.sensoryFeedback` modifier driven off the relevant state (no UIKit feedback generators): `.selection` for every toggle and segmented picker so like controls feel uniform across the app, `.impact(weight: .light)` for primary commit actions (the floating Quick Add button, sending an Assistant message), `.impact(flexibility: .rigid)` for interrupting an in-flight action (stopping a streaming response) so it reads as distinct from sending, and `.success`/`.error` for the outcome of a data mutation such as saving a transaction. When a control is swapped out at the moment it is tapped (for example the Send/Stop button toggling on streaming state), attach the feedback to a stable parent driven by a tap counter so the modifier is not torn down before it fires. The system haptic setting is honored automatically, so no separate enable/disable control is needed.

---

## Accessibility

### Focus States

- All interactive elements have visible focus indicators
- Primary focus: `var(--ring-focus)` - 4px accent ring with transparency
- Inputs: Accent border + ring-shadow on focus
- Buttons: Visible focus ring on keyboard navigation

### Cursor Patterns

```css
/* Clickable elements */
a[href], button, [role="button"], [role="menuitem"], [role="tab"],
input[type="button"], input[type="submit"], input[type="reset"],
input[type="checkbox"], input[type="radio"], label:has(input) {
  cursor: pointer;
}

/* Disabled elements */
button:disabled, input:disabled, [aria-disabled="true"] {
  cursor: not-allowed;
}
```

### Color Contrast

- Primary text (`--text`) on primary surfaces meets WCAG AA
- Muted text is intentionally lower contrast and should stay secondary
- Accent and semantic colors are emphasis colors, not guaranteed small-text contrast colors across both themes

---

## Best Practices

### Do's

- Use semantic color names (`text-semantic-green`, `bg-surface`, `border-border-hi`)
- Follow the surface hierarchy: `bg` → `surface` → `surface-hi` → `faint`
- Use mobile-first responsive design
- Apply `page-enter` animation to page content
- Use `font-mono tabular-nums` for numeric values
- Preserve period state (`periodSearch`) across navigation
- Account for safe area insets on mobile

### Don'ts

- Don't use gradients for generic visual polish
- Don't create one-off patterns - follow existing conventions
- Don't skip the `desk:` breakpoint when adding responsive behavior
- Don't use hardcoded colors - always use theme variables
- Don't change radius values arbitrarily - follow the proportional scale
- Don't add horizontal scroll on mobile - always test viewport constraints

### When Making Changes

1. Check existing patterns in similar components/pages first
2. Update this DESIGN.md if introducing new patterns
3. Maintain cross-page consistency for shared elements
4. If changing shared theme tokens or theme-sensitive styling, validate both dark and light theme tokens
5. Test mobile viewport (390px width minimum)
6. Run Playwright mobile overflow tests

---

## File References

| File | Purpose |
|------|---------|
| `ui/src/index.css` | CSS variables, base styles, component classes |
| `ui/tailwind.config.js` | Tailwind theme config (colors, fonts, radius, breakpoints) |
| `ui/components.json` | shadcn registry configuration and UI alias mapping |
| `ui/src/app/AppShell.tsx` | Navigation shell, layout patterns |
| `ui/src/components/ui/` | Local Radix/shadcn primitive wrappers |
| `ui/src/components/` | Shared UI components |
