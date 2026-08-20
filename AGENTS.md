# expenses: Agent Instructions

Expenses is a private, self-hosted finance app. It must run well on hardware down
to a Raspberry Pi 4B, so avoid heavy dependencies, unbounded memory use, and
unnecessary background work.

## Project Rules

- Use `uv` for Python dependencies and commands.
- Keep configuration explicit. Use environment variables mainly for secrets and
  deployment-specific values.
- Preserve equivalent behavior for shared web features on desktop and mobile;
  the layouts may differ.
- Do not invent financial relationships or values. Keep exact amounts available
  in accessible text or data views when a visual display summarizes them.

## Project Documents

- For changes to the stable web visual system, read the relevant part of
  `DESIGN.md`. Current code and tests define feature behavior.
- For native iOS appearance or interaction changes, read `ios/DESIGN.md`.
- For browser tests, coverage, or test infrastructure, read `TESTING.md`.
- Update `README.md` only when its documented setup, behavior, or commands change.
- Add an entry under `CHANGELOG.md` `[Unreleased]` for operator-visible behavior,
  setup, API, workflow, or dependency changes. Skip internal chores and docs-only
  changes.
- Use `releasing.md` only when the user asks to prepare or publish a release.

## Verification

- For Python edits, run `uv run ruff check --fix .` and `uv run ruff format .`.
- `uv run fast-tests` is the normal project gate.
- For feature work, also run the focused Playwright specs for each affected web
  layout.
- Use `uv run full-tests` for release candidates, shared browser or startup
  infrastructure, or an explicit request.
- State which checks ran and which did not.
