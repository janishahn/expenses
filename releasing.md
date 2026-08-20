# Releasing Expenses

Releases are manual. Only start this process when the user asks for a release.
Pushing a version tag publishes the container image and may update self-hosted
instances that track the latest tagged release.

## Prepare

1. Find the previous tag and review everything since it:
   `git log <previous-tag>..HEAD`.
2. Reconcile those changes with `CHANGELOG.md` `[Unreleased]`. Include all
   operator-visible behavior, setup, API, workflow, and dependency changes; skip
   internal chores.
3. Choose the next Semantic Versioning number and update `version` under
   `[project]` in `pyproject.toml`.
4. Run `uv lock` and verify that the `expenses` entry in `uv.lock` has the same
   version.
5. Move the Unreleased entries into a dated `## [X.Y.Z] - YYYY-MM-DD` section and
   leave a new empty `## [Unreleased]` section above it. Do not edit past release
   sections.
6. Run `uv run full-tests`. Resolve any product failure before tagging; report an
   infrastructure failure separately.

## Publish

1. Commit the version, lockfile, and changelog together.
2. Create the tag `vX.Y.Z` on that commit and push the commit and tag.
3. Confirm that the release workflow publishes the expected container image.
4. Create the GitHub Release from the tag, using the matching changelog section
   as operator-facing notes, and confirm that it is marked as the latest release
   when appropriate.

Do not edit published release notes. Record corrections in the next release.

A tag without the version bump leaves the running app reporting the old version.
A version bump without the refreshed lockfile leaves frozen installs and `uv`
metadata stale.
