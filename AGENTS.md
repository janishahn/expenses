# expenses: Agent Instructions

## Purpose
This file defines durable engineering conventions for AI/code agents working in this repository.
Keep guidance stable over time and avoid coupling instructions to transient UI details, folder layouts, or implementation-specific naming.
This project is intended for private self-hosting on hardware down to Raspberry Pi 4B-class devices, so implementation choices should account for constrained CPU, memory, and I/O even when the app also runs on larger hosts such as a Mac mini or small VPS.

## Design Language
- Read `DESIGN.md` before making any UI changes. It is the canonical source of truth for the design language.
- Follow the patterns, colors, typography, spacing, and component conventions documented there.
- When adding new UI patterns or modifying existing ones, update `DESIGN.md` to keep it current.

## Core Principles
- Prefer straightforward, local code over many micro-helpers.
- Keep comments minimal; write code that is clear without narration.
- Avoid defensive programming noise (repetitive validation, redundant checks, broad fallback logic).
- Be explicit about types at boundaries (API/schema/IO parsing), then code against known types.
- Avoid runtime type probing by default (`getattr` fallbacks, frequent `isinstance` branching).
- Catch exceptions narrowly and intentionally; do not use broad exception handling unless there is a strong, documented reason.
- For UI work, keep an eye on recognizable patterns across the app when it is sensible to do so. Similar pages do not need to be identical, but shared affordances, action placement, and page structure should usually feel familiar rather than arbitrary.
- For frontend work, avoid gradients as a generic visual-polish tool. Prefer calm depth from spacing, layered surfaces, contrast, borders, and shadows; use gradients only when they are genuinely central to the concept and clearly stronger than a flat treatment.
- Treat repeated page chrome within a viewport as a product convention, not a page-by-page styling choice. If a shared element such as a kicker label, title row, filter bar, summary-card pattern, or action placement is changed because it is not pulling its weight, audit sibling pages in that same viewport and usually make the change there too. Prefer stable cross-page structure on both mobile and desktop over layouts that jump around without a clear product reason.

## Documentation Duties (Required)
- Keep `README.md` current whenever behavior, setup, workflows, or operator-facing commands change.
- Add a `CHANGELOG.md` `[Unreleased]` entry in the same change for anything that affects behavior, setup, operator workflows, APIs, or dependencies (see **Changelog Maintenance**).
- Keep developer commands discoverable and accurate:
  - Canonical command definitions belong in `pyproject.toml` (for example, under `[project.scripts]`).
  - Prefer `uv run <command>` entrypoints over ad-hoc script paths for repeatable workflows.
  - When adding/removing/renaming commands, update `README.md` in the same change.
- If code and docs diverge, treat it as a bug and fix both in one PR.

## Changelog Maintenance
`CHANGELOG.md` is the hand-maintained, operator-facing record of what shipped, following Keep a Changelog and Semantic Versioning. It is only trustworthy if it stays complete between releases, so maintain it continuously rather than reconstructing it at release time.

- **Log as you go.** The same change that alters behavior, setup, operator workflows, APIs, or dependencies adds its entry under `## [Unreleased]`. Do not defer entries to release time: an empty `[Unreleased]` when cutting a release almost always means changes were missed, not that nothing shipped.
- **Group entries.** File each entry under one of `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, or `Dependencies`, and write it for the operator who reads it rather than restating a commit message.
- **Skip pure chores; document only operator-relevant routine changes.** Do not document every small technical cleanup. Pure housekeeping with no operator-facing effect goes undocumented — regenerating `uv.lock` to match a version bump, formatting or comment cleanups, internal-only refactors, and CI or dev-tooling tweaks that do not change the shipped app. Routine changes that still affect what operators run, such as runtime or security dependency bumps (Dependabot/Renovate), still earn at least a brief rolled-up line — typically a single entry such as "Updated frontend and CI dependencies" under `Dependencies`. When in doubt, apply the **Log as you go** test: if it does not affect behavior, setup, operator workflows, APIs, or the dependency set, leave it out.
- **Reconcile before tagging.** When cutting a release, diff the changelog against what actually landed since the previous tag using `git log <last-tag>..HEAD` and that range's merged PRs. Anything present in history but absent from `[Unreleased]` is a gap to fill first. A release documents every change since the previous tag, not only the change that prompted it.
- **Treat released sections as immutable.** Once a version is tagged, do not rewrite or retroactively amend its section or its GitHub release notes. If a past release missed entries or a feature is later removed, record the correction under a new version instead.

## Releases
A release is a deliberate, versioned, deployable checkpoint. It is made up of four related actions; treat them as one coherent change rather than separate afterthoughts. They are intentionally manual and are not triggered automatically by merging to the default branch.

- **Bump the version in `pyproject.toml`.** Do this whenever cutting a release. This is the version the running app reports (it is read at startup and surfaced to clients and generated reports), and it is decoupled from the git tag, so a tag alone leaves the app self-reporting the old version. Follow Semantic Versioning: major for breaking changes, minor for backward-compatible features, patch for fixes. After bumping, regenerate the lockfile with `uv lock` and commit `uv.lock` in the same change so its own `expenses` entry matches the new version; CI and the Docker image install with `uv sync --frozen`, which neither updates nor validates the lockfile, so a stale lock silently leaves frozen installs and `uv` introspection reporting the old version.
- **Update `CHANGELOG.md`.** Move the accumulated `[Unreleased]` entries into a new versioned, dated section, and reconcile against history per **Changelog Maintenance** so that section captures every change since the previous tag — not just the change that prompted the release. This is the human-readable record of what shipped and is what operators read before updating.
- **Create and push the git tag `vX.Y.Z`.** This marks the commit as a published version and triggers the release workflow that builds and publishes the container image. Some deployments are configured to update automatically to the newest tagged release, so a tag is not just a bookmark — it can change what self-hosted instances actually run. Because of this, when the scope of a change or PR warrants a new deployable version, recommend to the user that a new tagged release be cut so auto-updating deployments pick it up; do not assume every merge should become a release.
- **Create the GitHub Release.** This is the operator-facing announcement attached to the tag (release notes plus the "latest" marker). Create one when you want to communicate to anyone running the project what changed and why.

## Python Environment and Tooling
- Use `uv` for dependency management and command execution.
- Add runtime dependencies with `uv add ...`.
- Add development-only dependencies with `uv add --dev ...`.
- Run Python tooling through `uv run ...` rather than calling global binaries directly.

## Code Quality Expectations
- For Python edits, run Ruff fix + format:
  1. `uv run ruff check --fix .`
  2. `uv run ruff format .`
- Run relevant tests after changes; run the broader test command for significant or cross-cutting changes.
- If tests are skipped or cannot run, state that explicitly in the final handoff.

## Testing Expectations
- New behavior should include tests.
- Bug fixes should include a regression test when practical.
- Prefer targeted, deterministic tests over broad, brittle integration coverage when validating local logic.
- For native iOS simulator UI checks, use the local-dev launch path documented in `README.md`: keep the local backend running, preserve the simulator Keychain session, and pass `--skip-local-unlock` as an app launch argument in Debug simulator builds. This flag is only a local-unlock bypass; it does not bypass backend login. If the app stays on login, verify the backend port with `/api/mobile/status`, update the simulator app default `expenses.baseURL` when `uv run dev` bound to a port other than `8000`, then complete one real mobile login such as `test` / `test` for the mock DB. Plain launches are only appropriate when explicitly testing the local unlock gate itself.
- To build and install the native iOS app onto a connected physical device, use `uv run run-ios-device` rather than ad-hoc `xcodebuild`/`devicectl` invocations. It auto-detects the only paired iPhone (pass `--device <name|UDID>` when several are connected), builds against a generic iOS destination so a momentary device-tunnel drop cannot fail the build, reuses the project's existing automatic code-signing so the developer stays trusted between reinstalls, then installs over the previous build and launches it (`--no-launch` to skip). The device must be unlocked and connected for the install/launch step; macOS with Xcode is required. This command is dev tooling for on-device builds, so it is intentionally untested. See `README.md` for details.
- Keep test names and file names stable over time:
  - Name tests by behavior/domain (`templates`, `durable_purchases`, `admin_system_health`), not by delivery phase or milestone labels.
  - Do not introduce ambiguous time-bound labels like `phase1`, `v2`, `next`, or `new` in long-lived test files.
  - If an existing test name is milestone-scoped, rename/rework it to behavior-scoped in the same change.
- For Playwright UI layout regressions, attach a screenshot artifact on failure so CI and local reruns preserve visual context.
- When debugging a failing Playwright test that provides a screenshot artifact, review that artifact first and use it to guide the fix before changing code.
- Playwright layout matrix is explicit and must stay that way:
  - `desktop-chromium` runs non-mobile specs (default `*.spec.ts` and `*.desktop.spec.ts`).
  - `mobile-webkit` runs only mobile specs (`*.mobile.spec.ts`) using iPhone emulation.
- Keep layout intent in the test file, not ad-hoc viewport switching in shared specs:
  - Put desktop-only assertions/flows in desktop or shared specs.
  - Put mobile-only assertions/flows in `*.mobile.spec.ts`.
- For navigation and controls, use layout-correct selectors (desktop sidebar vs mobile bottom-nav/sheet/sidebar) instead of generic selectors that can match hidden elements.

## Configuration Guidance
- Prefer explicit config surfaces (typed settings, CLI args, checked-in config files) over environment-variable sprawl.
- Use environment variables primarily for secrets or deployment-specific values.
- Document any new required configuration in `README.md` at the time it is introduced.

## Change Hygiene
- Keep changes focused and cohesive; avoid opportunistic refactors unrelated to the task.
- Do not introduce one-off patterns that future agents must reverse-engineer.
- When repository structure or workflows evolve, update this file to preserve accurate, future-proof guidance.
- Keep Sankey flow grouping heuristics in sync with category behavior: when categories, naming conventions, or flow-grouping logic change, update the hard-coded heuristic mapping in the same change.

## Performance Expectations (Constrained Self-Hosted Hardware)
- Optimize for low resource usage and predictable latency on modest hardware down to Raspberry Pi 4B-class devices.
- Prefer simple, efficient algorithms and avoid unnecessary background work.
- Keep memory growth bounded; avoid long-lived caches without explicit limits or eviction strategy.
- Be cautious with heavy rendering, large dependency additions, and expensive startup-time initialization.
- Treat avoidable CPU/memory regressions as correctness issues, not polish.
