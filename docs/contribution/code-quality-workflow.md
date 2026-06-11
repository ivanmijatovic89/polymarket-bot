# Code Quality Workflow

This page defines the repository workflow for code quality from local commit to merge into `main`.

## Purpose

We use this workflow to get both:

- fast local iteration (auto-fix only staged files),
- strict merge safety (full-project checks in CI).

This reduces style churn, catches type/lint problems early, and prevents broken code from entering `main`.

## The 6 Commands

These are the core quality commands used in this repository:

1. `npm run code:prettier`
2. `npm run code:prettier:check`
3. `npm run code:eslint`
4. `npm run code:eslint:fix`
5. `npm run code:typecheck`
6. `npm run code:typecheck-eslint`

### What each command does and when to use it

#### `npm run code:prettier`

- What it does: formats files with Prettier (`--write`).
- Use when:
  - you want to apply formatting locally,
  - you intentionally run a formatting pass.

#### `npm run code:prettier:check`

- What it does: verifies formatting without changing files.
- Use when:
  - validating before push/PR,
  - in CI for formatting gate.

#### `npm run code:eslint`

- What it does: runs ESLint checks (no auto-fix).
- Use when:
  - you want to see current lint violations,
  - CI/local verification.

#### `npm run code:eslint:fix`

- What it does: runs ESLint auto-fix where possible.
- Use when:
  - cleaning local code before final review.

#### `npm run code:typecheck`

- What it does: runs TypeScript typecheck for root project.
- Use when:
  - validating TypeScript correctness quickly.

#### `npm run code:typecheck-eslint`

- What it does: combined root gate (`typecheck` + `eslint`).
- Use when:
  - final local check before opening/updating PR.

## Pre-commit Behavior (Local)

Pre-commit is implemented with Husky + lint-staged and runs only on staged files.

### Hook

- `.husky/pre-commit` runs:
  - `npx lint-staged`

### lint-staged rules

- `*.{ts,tsx,js,jsx,json,css,html,yml,yaml}` -> `prettier --write`
- `src/**/*.{ts,tsx}` -> `eslint --fix`

### What auto-fixes

- formatting for staged supported files,
- ESLint fixable issues in staged root `src/**/*.ts|tsx`.

### What blocks commit

Commit is blocked if lint-staged command fails after attempting fixes, for example:

- non-fixable ESLint errors in staged root `src` files,
- command/tool execution failure.

## CI Behavior (GitHub Actions)

CI workflow file:

- `.github/workflows/quality.yml`

### Triggers

- `pull_request`
- `push` to `main`

### Jobs

#### Root (Prettier + Typecheck + ESLint)

Runs:

1. `npm ci`
2. `npm run code:prettier:check`
3. `npm run code:typecheck-eslint`

#### WebUI (Typecheck + Build)

Runs in `webui`:

1. `npm ci`
2. `npm run code:typecheck`
3. `npm run build`

## PR and Merge Policy

Branch protection/ruleset for `main` should require:

1. Pull request before merge.
2. Required status checks:
   - `Root (Prettier + Typecheck + ESLint)`
   - `WebUI (Typecheck + Build)`
3. (Recommended) `Require branches to be up to date before merging`.
4. (Recommended) at least `1` required approval.
5. Block force pushes on protected branch.

### Bypass Smoke Check

Repository admins may use a direct push only for a deliberate bypass smoke check or
small low-risk changes. CI still runs on `push` to `main`, so failures should be
fixed forward immediately.

## Typical Daily Developer Flow

1. Create/update feature branch.
2. Edit code.
3. Stage files (`git add ...`).
4. Commit:
   - pre-commit auto-fixes staged files,
   - commit proceeds only if hook passes.
5. Push branch.
6. Open/update PR.
7. Wait for CI checks to pass.
8. Rebase/merge latest `main` into branch if required by rules.
9. Merge PR to `main` after approvals and green checks.

## Troubleshooting

### Commit fails in pre-commit hook

- Run:
  - `npm run code:typecheck-eslint`
- Fix reported errors.
- Re-stage changed files and commit again.

### CI fails on formatting

- Run:
  - `npm run code:prettier`
- Re-commit and push.

### CI fails on TypeScript/ESLint

- Run:
  - `npm run code:typecheck-eslint`
- Fix errors locally, commit, push.

### WebUI CI fails

- Run:
  - `npm --prefix webui run code:typecheck`
  - `npm --prefix webui run build`
- Fix and push.

### Required checks not visible in ruleset UI

- Ensure workflow is pushed.
- Run at least one PR/push so check names are registered.
- Then re-select required checks.

## Do / Don’t

### Do

- Do keep pre-commit scope staged-only for speed.
- Do rely on CI as full-project gate.
- Do run local combined checks before large PR updates.

### Don’t

- Don’t run repo-wide formatting casually on Markdown-heavy docs with complex tables.
- Don’t bypass CI/ruleset for `main`.
- Don’t mix broad formatting-only changes with unrelated feature changes unless intentional.

## Notes on Prettier Ignore

Current ignore policy intentionally excludes:

- `CLAUDE.md`
- `AGENTS.md`
- `.claude/`

This avoids unwanted formatting churn on tooling/internal docs.
