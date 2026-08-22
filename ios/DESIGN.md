# Expenses iOS Design

This document defines the stable native design rules for the SwiftUI app. It does
not record current screen contents or feature-specific behavior. Use the code,
API contracts, and tests for those facts.

## Native Structure

- Preserve product capability, not the web route or component structure.
- Use native navigation, lists, forms, sheets, dialogs, search, previews, and
  sharing where they fit the task.
- Keep frequent destinations easy to reach and group lower-frequency work in a
  clear secondary area.
- Use focused screens or sheets for detail and edit work instead of copying dense
  desktop layouts.
- Keep finance data compact, legible, and scannable.

## Liquid Glass and Surfaces

- Use native Liquid Glass for navigation-adjacent controls, floating actions,
  modal surfaces, and selected summary surfaces.
- Do not wrap every list row or dense data surface in glass.
- Use interactive glass only for interactive elements.
- Prefer native material and animation APIs over custom blur stacks.
- Use semantic color, spacing, and type to carry hierarchy before adding effects.

## Components and Data

- Build a small set of shared native styles for summaries, actions, states,
  formatting, chips, form rows, and error details.
- Use Swift Charts for native charts. Keep units, exact values, accessible labels,
  and a useful nonvisual reading of the data.
- Use monospaced digits for amounts and other data that benefits from alignment.
- Use native camera, Photos, Files, Quick Look, and share-sheet flows. Keep
  generated reports, exports, and backups owned by the server.
- Keep destructive actions explicit and confirm irreversible or broad changes.

## Interaction and Accessibility

- Support light mode, dark mode, Dynamic Type, VoiceOver, and Reduce Motion.
- Keep touch targets large enough without making dense information hard to scan.
- Keep loading, empty, failed, unavailable, disabled, and destructive states
  distinct.
- Use haptics only for committed actions and clear state changes. Do not add them
  to navigation, scrolling, or continuous updates.
- Keep in-progress text readable without animation. Do not use fake percentages
  or motion as the only sign that work continues.
- Preserve user input after errors and show a readable error with a next action.

## Privacy and Security

- Conceal sensitive content when the app enters the background or app switcher.
- Respect the existing local-unlock and stored-session boundaries; local unlock
  does not replace backend login or admin elevation.
- Do not persist finance-domain data on device unless the product design changes
  that boundary explicitly.
- Keep one-time tokens and generated secrets selectable and copyable when first
  shown, and require confirmation before revocation.

## Avoid

- Recreating web navigation or desktop tables in SwiftUI.
- Decorative glass on every row.
- Custom controls when a clear native control already fits.
- Persisting transient progress or tool activity as settled content.
- Hiding an action behind a swipe gesture with no visible alternative.
