# Releasing Expenses

Releases are manual. Only start this process when the user asks for a release.
Pushing a version tag publishes the container image and may update self-hosted
instances that track the latest tagged release.

`main` changes only through squash-merged pull requests, so every release goes
through its own release PR, and the tag goes on that PR's merge commit. Do not
push release commits to `main` directly.

## Prepare

1. Create the branch `release/X.Y.Z` from the latest `main`. Find the previous
   tag and review everything since it: `git log <previous-tag>..HEAD`.
2. Reconcile those changes with `CHANGELOG.md` `[Unreleased]`. Include all
   operator-visible behavior, setup, API, workflow, and dependency changes; skip
   internal chores.
3. Choose the next Semantic Versioning number and update `version` under
   `[project]` in `pyproject.toml`.
4. Run `uv lock` and verify that the `expenses` entry in `uv.lock` has the same
   version.
5. Move the Unreleased entries into a dated `## [X.Y.Z] - YYYY-MM-DD` section and
   leave a new empty `## [Unreleased]` section above it. Do not edit past release
   sections. Update the reference links at the end of the file so `[Unreleased]`
   compares `vX.Y.Z...HEAD` and `[X.Y.Z]` compares
   `<previous-tag>...vX.Y.Z`.
6. Run `uv run full-tests`. Resolve any product failure before tagging; report an
   infrastructure failure separately.

## Release PR

1. Commit the version, lockfile, and changelog together as `Release X.Y.Z`. The
   release PR contains nothing else; fixes and features merge in their own PRs
   first.
2. Push the branch and open a PR against `main` titled `Release X.Y.Z`.
3. Run the Full tests workflow on the branch
   (`gh workflow run full-tests.yml --ref release/X.Y.Z`) and link the run in
   the PR description. It runs on Linux, so it also covers Firefox and the Linux
   visual baselines.
4. Squash-merge the PR once Fast tests and the Full tests run pass.

## Publish

1. Create the annotated tag `vX.Y.Z` on the merge commit on `main`
   (`git tag -a vX.Y.Z -m vX.Y.Z <merge-commit>`) and push the tag.
2. Confirm that the release workflow publishes the expected container image.
3. Once the image is published, create the GitHub Release `vX.Y.Z` from the tag,
   using the matching changelog section as operator-facing notes, and confirm
   that it is marked as the latest release when appropriate.

Do not edit published release notes. Record corrections in the next release.

A tag without the version bump leaves the running app reporting the old version.
A version bump without the refreshed lockfile leaves frozen installs and `uv`
metadata stale.
