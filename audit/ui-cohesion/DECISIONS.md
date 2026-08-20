# UI cohesion audit decisions

Pattern rulings are added only after the Phase 1 implementation map is complete enough to compare all sibling sites.

## Binding inputs

- Observed baseline behavior and existing tests outrank later sources.
- `DESIGN.md` is the canonical product design language.
- `AGENTS.md` defines repository engineering, responsive-twin, documentation, performance, and testing rules.
- `emil-design-eng`, `tasteful-product-ui`, and `better-ui` provide the requested cohesion and polish judgment framework.

## Rulings

### Product actions

- `AppButton` is the canonical wrapper for ordinary product actions and links styled as actions. `Button` remains a low-level pressable foundation for `AppButton` and the shell-specific quick-theme icon only.
- Raw buttons remain appropriate for semantic widgets whose interaction model is not an ordinary action button: segmented selectors, chart marks and legends, chip removals, icon grids, the responsive shell/drawer, file-picker drop zones, and the Assistant composer. Their local implementations are deliberate and must retain accessible names, focus treatment, and effective touch targets.

### Fields and choice controls

- `AppFieldLabel`, `AppInput`, `AppNativeSelect`, and `AppTextarea` are canonical for ordinary labeled product fields. Browser-special date/time and file inputs may remain purpose-built where their layout or native affordance requires it.
- `AppSwitch`/`Toggle` represent switch-like boolean preferences. Native checkbox/radio controls using `control-check` remain intentional for dense bulk selection, table/list selection, report option groups, import options, and budget scope choices; their enclosing labels provide the tested mobile target. Converting those groups to Radix would change semantics and interaction without a cohesion benefit.

### Surfaces and page chrome

- `FinancialPanel`, `MetricLane`, and `AppCard` are the canonical general product surfaces. Chart internals, the Assistant transcript/composer, and the application shell may retain specialized surfaces where semantics or performance differ.
- `PageIntro` is canonical for ordinary and analytical route title chrome. Auth/setup cards, the admin elevation gate, and the Assistant title integrated into shell chrome are intentionally distinct product contexts.

### Confirmation and action feedback

- User-reachable confirmations use the shared in-app confirmation dialog. Native browser confirm/prompt/alert chrome is not a product surface.
- Mutation outcomes remain beside the action that produced them: success uses a polite `status`, failure uses an `alert`, and both retain the product's semantic text colors. Admin maintenance actions share `AdminActionFeedback`; other workflows may keep their existing local message state when they do not duplicate a rendering mechanism.

### Intentional implementation boundaries

- `phosphorRuntime.ts` and `phosphorUtils.ts` retain superficially similar icon loading/alias logic: the runtime module keeps common category rendering off the full searchable icon metadata bundle, while the picker utilities load the catalog only where needed.
- The inline theme bootstrap in `index.html` intentionally overlaps the typed runtime theme helper to prevent first-paint theme flash before React loads.
- The Assistant progress shimmer is the one reviewed gradient exception: motion is central to communicating an active streamed response, and reduced-motion mode removes it.
- Desktop and mobile Playwright twins are retained even when structurally similar because the explicit project/file split is a repository testing contract and exercises materially distinct layout and input behavior.
