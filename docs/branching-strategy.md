# Branching Strategy

> SpecFuse uses a **simplified GitFlow** model: feature, fix, release, and hotfix branches merge into a protected `main` branch via pull requests.

This document defines the branching conventions, merge rules, and release workflow for the SpecFuse project. It supports collaborative development while keeping the `main` branch stable and deployable at all times.

---

## Branch Types

| Type | Prefix | Example | Purpose |
|------|--------|---------|---------|
| Feature | `feature/` | `feature/add-shopping-cart` | New functionality or enhancements |
| Bug fix | `fix/` | `fix/drift-hash-mismatch` | Bug fixes targeting `main` |
| Release | `release/` | `release/v4.1.0` | Stabilization branch for a version milestone |
| Hotfix | `hotfix/` | `hotfix/v4.0.1` | Urgent fix against a tagged release |
| Docs | `docs/` | `docs/api-reference` | Documentation-only changes |

### Naming conventions

- Use **kebab-case** for branch slug names (e.g. `feature/add-shopping-cart`, not `feature/addShoppingCart`).
- Keep names **short and descriptive** — the PR title carries the full context.
- Match the branch slug to the SpecFuse change proposal name when applicable (e.g. `feature/add-shopping-cart` corresponds to `.specfuse/changes/add-shopping-cart/`).

---

## Merge Rules

### Protected `main` branch

`main` is the only long-lived branch. It must always be in a deployable state.

- **All changes reach `main` through pull requests.** Direct commits to `main` are prohibited once branch protection is enabled.
- **Every PR requires at least 1 approving review** before merge.
- **CI must pass** (tests + spec drift check) before a PR can be merged.
- **No force pushes** to `main` (branch protection rule).

### Merge strategy

- **Squash merge** is preferred for feature and fix branches. This keeps `main` history linear and readable — each merge is one commit describing the full change.
- **Merge commit** is used for release branches merging back to `main`, preserving the release branch history.
- **Rebase merge** is discouraged — it rewrites branch history and complicates hotfix tracking.

---

## Feature Branches vs Direct Commits

| Scenario | Approach |
|----------|----------|
| New feature or enhancement | Feature branch (`feature/xxx`) → PR → squash merge |
| Bug fix | Fix branch (`fix/xxx`) → PR → squash merge |
| Documentation update | Docs branch (`docs/xxx`) → PR → squash merge |
| Trivial typo or formatting | Fix branch is still recommended, but a direct commit may be acceptable **only before branch protection is enabled** |

Once branch protection is active, **there are no exceptions** — every change must go through a PR.

---

## Release Workflow

### Creating a release branch

When preparing a version milestone:

1. Branch from `main`:
   ```bash
   git checkout main
   git pull
   git checkout -b release/v4.1.0
   ```

2. On the release branch, only **bug fixes** and **documentation updates** are allowed. No new features.

3. When the release is ready:
   ```bash
   # Merge release branch back to main (merge commit, not squash)
   git checkout main
   git merge --no-ff release/v4.1.0

   # Tag the release on main
   git tag -a v4.1.0 -m "SpecFuse v4.1.0"

   # Push both the merge and the tag
   git push origin main
   git push origin v4.1.0
   ```

4. Delete the release branch after the tag is pushed:
   ```bash
   git branch -d release/v4.1.0
   git push origin --delete release/v4.1.0
   ```

### Release tagging convention

SpecFuse follows **Semantic Versioning** (`MAJOR.MINOR.PATCH`):

- **Stable releases**: `v4.0.0`, `v4.1.0`, `v4.1.1`
- **Pre-release tags**: `v4.0.0-alpha.N`, `v4.0.0-beta.N`, `v4.0.0-rc.N`
  - `alpha` — early development, features incomplete or unstable
  - `beta` — feature-complete, gathering feedback
  - `rc` — release candidate, final validation before stable release

All tags are **annotated** (`git tag -a`) with a message summarizing the release.

---

## Hotfix Workflow

When an urgent fix is needed against a tagged release:

1. Branch from the affected tag:
   ```bash
   git checkout -b hotfix/v4.0.1 v4.0.0
   ```

2. Apply the fix, commit, and push.

3. Open PRs targeting **both** `main` and the active release branch (if one exists). If no active release branch, target only `main`.

4. After the PRs are merged:
   ```bash
   # Tag the hotfix release on main
   git checkout main
   git tag -a v4.0.1 -m "SpecFuse v4.0.1 — hotfix for <description>"
   git push origin v4.0.1
   ```

5. Delete the hotfix branch:
   ```bash
   git branch -d hotfix/v4.0.1
   git push origin --delete hotfix/v4.0.1
   ```

---

## GitHub Repository Settings (Recommendations)

These settings require **owner/admin access** to the GitHub repository and cannot be applied by agents or non-admin contributors.

### Branch protection rules for `main`

| Rule | Setting |
|------|---------|
| Require a pull request before merging | **Enabled** |
| Required approving reviews | **1** (increase to 2 as the team grows) |
| Require status checks to pass | **Enabled** |
| Required status checks | `ci` (tests + drift check) |
| Require branches to be up to date before merging | **Enabled** |
| Do not allow force pushes | **Enabled** |
| Do not allow deletions | **Enabled** |

### How to configure

1. Go to **Settings → Branches → Branch protection rules**.
2. Click **Add rule**, enter `main` as the branch name pattern.
3. Enable the rules listed above.
4. Save.

---

## Workflow Diagram

```
                    ┌───────────┐
                    │   main    │  ← protected, always deployable
                    └───────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
   feature/xxx     release/v4.1.0    hotfix/v4.0.1
   (squash merge)  (merge commit)   (cherry-pick / PR)
          │              │              │
          └──→ PR ──→ main ←── merge ──←── PR ──→ main
                         │
                      tag v4.1.0
```

---

## Summary

- **One long-lived branch**: `main` (protected)
- **All other branches are short-lived** and deleted after merge
- **PRs required** for every change to `main`
- **Squash merge** for feature/fix branches; **merge commit** for release branches
- **Annotated tags** for all releases (`v4.0.0`, `v4.1.0`, etc.)
- **Hotfixes** branch from tags, merge to `main` (and active release branch if present)
