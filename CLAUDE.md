# CLAUDE.md - Treasuries Project

## Specs Drive Code (read before touching code)

This file is interaction/workflow guidance only — commands, tool gotchas, git hooks. It is **not** a substitute for the specs and must never restate spec content (see the top-level `CLAUDE.md`'s Specs-First Mandate and Single Source of Truth directive). Before touching code in a project that has a `knowledge/` folder, read the governing spec(s) first:

- **TipsLadderManager**: `TipsLadderManager/knowledge/1.0`–`6.0`, plus `DATA_DICTIONARY.md`, `TECHNICAL_REFERENCE.md`, `PROJECT_VISION.md` in the same folder.
- **Shared/global** (R2 data stores, ingestion pipelines, domain terminology used by every app): repo-root `knowledge/DATA_DICTIONARY.md`, `Data_Pipeline.md`, `DataStores.md`, `Bond_Basics.md`, `TIPS_Basics.md`.
- **YieldCurves**: `YieldCurves/knowledge/` (SA/SAO adjustment logic, visual standards) plus the shared specs above for data pipeline facts — YieldCurves has no separate project-level data-pipeline spec of its own.

If a claim below ever conflicts with a spec, the spec wins — fix this file, don't propagate the stale claim.

## Help Text Follows the Specs

**User-facing text follows the specs exactly as code does**, and "specs" includes the repo-root
`knowledge/DATA_DICTIONARY.md`, which is the foundation the rest of them rest on for terminology.
Help modals, popup rows, status strips, column headers and tooltips are all in scope.

- **Terms and phrases are defined once, in the DD, and used from there.** A word appearing in a
  spec is not proof it is a defined term: check the DD. Where a term is missing from the DD that
  should be there, add it rather than working around it.
- **Do not introduce a new term without asking first.** Not in help text, not in a spec, not in a
  reply. If no existing term covers what you mean, say so and ask.
- **Derive a definition from how a term is already used** where the usage settles it, rather than
  asking for something the formula or the code already determines.
- A spec section that restates a definition the DD owns is a duplicate: keep the link, drop the
  second copy.

**No new metaphors.** A metaphor names a thing by something it is not: a *leg*, a *block* of years, a
CPI *print*. This portal already has the ones it uses, and the user introduced them: *bracket*,
*rung*, *ladder*. Reaching for another is not a style choice, it is a new term, so the rule above
applies with no exception — ask first. The user is the sole developer of every portal app and the
only person who can approve one. This holds in help text, in specs, in commit messages, and in
conversation, and it holds for a metaphor that reads as ordinary financial idiom. When no existing
term fits, say what is missing and ask, rather than reaching for an image.

**This rule is enforced, not just stated.** `.githooks/pre-commit` runs
`scripts/check-vocabulary.js`, which blocks a commit that introduces a banned term into prose a
reader meets: the `knowledge/` specs, `Primer/content/`, and the string literals in each app's
`index.html` and `src/`. Only lines the commit adds or changes are gated, so pre-existing wording
never blocks unrelated work. `node scripts/check-vocabulary.js --audit` lists what is already
there. When a commit is blocked, fix the wording; if no defined term fits, ask, and add the term to
the Data Dictionary. Adding a rule to that file is how a term ruled out in conversation stays ruled
out for every session afterwards.

## Multiple Sessions Share One Checkout

Several Claude sessions run against this repo at once, all acting for the one developer, all sharing
the primary checkout `C:/Users/aerok/projects/Treasuries`. Two incidents on 2026-09-02 came from
sessions moving each other's work between branches and worktrees. Both were caused by rewriting
refs, not by the shared index.

Every session follows this section. The developer does not read git diffs or drive git directly, so
a session that is unsure which rule applies asks the developer in plain terms rather than guessing.

- **The primary checkout stays on `main`.** Working directly on `main` there is the default and is
  fine for coordinated work. Do not `git checkout` another branch in it. If you need a different
  branch, use a worktree (below).
- **Never rewrite a ref.** No `git update-ref`, `git branch -f`, a `git reset` that moves a branch,
  or a cherry-pick used to advance one. A branch moves only by `checkout` then `commit` / `merge`.
- **Stage explicit paths, then commit immediately.** `git add <path> <path>` — never `git add -A`,
  `git add .`, or a bare directory, and never leave staged files sitting: a concurrent session's
  commit will sweep them up.
- **If the checkout is not where you expect** — a different branch, or staged/modified files you did
  not make — **stop and ask.** Another session is mid-task; do not work around it.
- **Before a work pass**, run `git status`, `git worktree list`, and `ListAgents`. If a peer is in
  the same project or files, message them (`SendMessage`) before editing. `git diff` a shared file
  before changing it.
- **Pushing is the user's explicit call, every time.** Merge a finished feature branch into `main`
  first, from `main`.
- **Delete a branch only when it is merged into `main`, or the user says so.** `retained-bracket-work`
  is kept unmerged on purpose (see `TipsLadderManager/KNOWN_ISSUES.md`).

### Worktrees

Use one only when the work does not sit alongside others on `main`: multi-phase, many files,
experimental, or churny (the `retained-bracket-work` fixture thrash is the cautionary case). Not for
small localized edits.

```bash
git worktree add ../Treasuries-<topic> -b <topic>   # off main
```

Then tell the user the worktree exists and which port it serves on, so they can point a browser at
it. After it merges to `main`, `git worktree remove` it and `git branch -d` the branch.

### Shipping an urgent fix while `main` has unpushed work

`main` usually carries unpushed work in progress from one or more sessions. When a separate bug
needs to ship **now**, without dragging that work in progress along with it:

1. Tell the user what the bug is and that you are shipping a fix ahead of the work in progress.
2. `git switch -c fix-<bug> origin/main` — a fix branch starting from the last shipped commit, so
   the work in progress is not on it.
3. Make the fix, commit it on `fix-<bug>`. Verify it on a worktree served at 8081, against shipped
   code.
4. `git push origin fix-<bug>:main` — this ships only the fix. The developer approves this push
   like any other.
5. `git switch main` then `git merge origin/main` — folds the shipped fix into the local `main` the
   sessions share. Tell the other sessions this happened.
6. `git branch -d fix-<bug>`.

This never moves the shared `main` ref backward. Do **not** instead reset `main` to the shipped
commit and re-apply the work in progress afterward: that rewrites the ref every other session is
committing to. If the bug genuinely cannot be reproduced or fixed except on a `main` that holds
only shipped code, stop and ask the user — that case needs coordinating so no session loses a
commit.

### Ports

- **8080** is the user's own persistent dev server on the primary checkout. Never start, kill, or
  restart it — that is the user's action, so they can watch test runs live.
- **8081** is the port for a worktree (`npx serve . -p 8081` from the worktree root — the user runs
  this).
- More ports need the user to widen the R2 CORS allowlist (repo-root `knowledge/Data_Pipeline.md`).
  Ask.

## Commands (TipsLadderManager)

```bash
# Unit/algorithm tests
npm test

# E2E regression tests (run after every change)
npm run test:e2e          # headless, ~7s
npx playwright test --headed   # headed (debug)

# Serve locally (no build step required)
npx serve .
```

## Architecture (TipsLadderManager)

**No build step.** Pure ES modules served statically via GitHub Pages. Data fetched from Cloudflare R2 at runtime.

### Module Roles

Module responsibilities and the dependency graph (bond-math.js, gap-math.js, ladder-math.js, ladder-core.js, rebalance-lib.js, build-lib.js) are specified in `knowledge/4.0_Computation_Modules.md`; `render.js`/`drill.js` in `knowledge/5.0_UI_Schema.md`. Do not restate them here.

- `src/modal.js` — `makeDraggableResizable(modalEl, dragHandleEl, opts)`, shared drag/resize frame for every modal (TipsRef, maturity picker). *(Not documented in any spec yet — flagged for review, see task report.)*

### Key Algorithms

Phase 4 Ladder Rebuild: `knowledge/3.0_TIPS_Ladder_Rebalancing.md` §Phase 4. Retained Bracket Excess: `knowledge/2.0_TIPS_Ladders.md` §Retained Bracket Excess (also `DATA_DICTIONARY.md#retained-bracket-excess`, `DATA_DICTIONARY.md#active-lower-bracket`).

- `inferDARAFromCash()` (`src/rebalance-lib.js`): binary-searches for the largest DARA where `costDeltaSum >= 0`. *(Not documented in any spec — the specs describe a different mechanism, `inferScaledDARAFromPortfolio`'s self-financing scale. Flagged for review, see task report.)*

### COLS Schema

Column schema, rendering, and popup routing are specified in `knowledge/5.0_UI_Schema.md`. Do not restate here.

### Data Infrastructure

Yield-source pipeline (default vs. cross-check source) is specified in `knowledge/3.1_Data_Pipeline.md` §4.0. Full R2 file manifest: repo-root `knowledge/DataStores.md` / `DATA_DICTIONARY.md`.

- **Scheduled updates**: Windows Task Scheduler (local)

### Naming Conventions

*(Moved here from the YieldCurves section below, where it was misfiled — `fundedYear`/`runBuild` are TipsLadderManager-only concepts. Not documented in any spec — flagged for review, see task report.)*

- `fundedYear` (not `fy`) everywhere: `d.fundedYear`, `fundedYearQty`, `fundedYearAmt`, `fundedYearCost`; column header "Funded Year"
- `runBuild` (not `runBuildFromScratch`), `renderBuildOutput`, `buildSummary`, `buildDetails`, `build-table`

### Domain Terminology

Definitions (TIPS, funded year, bracket year, gap year, synthetic TIPS, LMI, retained bracket excess, active lower bracket, etc.) are in the repo-root `knowledge/DATA_DICTIONARY.md` §3.0/§4.0. Do not restate here.

## Architecture (YieldCurves)

**No build step.** Pure ES modules served statically via GitHub Pages.

### Commands

```bash
npm run test:e2e          # E2E regression tests (headless, ~14s)
npx playwright test --headed   # headed debug
npx serve .               # Serve locally (run from root of Treasuries repo)
```

### Data Infrastructure (R2)

R2 file manifest, update schedule, and ownership are specified in the repo-root `knowledge/Data_Pipeline.md` and `knowledge/DataStores.md` (covers `Treasuries/YieldsFromFedInvestPrices.csv`, `Treasuries/FidelityTreasuriesTips.csv`, `TIPS/RefCpiNsaSa.csv`, `TIPS/YieldsSaSao.csv`, `misc/BondHolidaysSifma.csv`). Do not restate here.

### Fidelity Download Flow

Specified in the repo-root `knowledge/Data_Pipeline_Local.md` (gitignored — do not reference publicly per that file's own note).

### Windows / Tooling Note

The Edit tool may fail with `EEXIST` on project files (Windows path bug). Use node scripts via Bash to patch files when Edit fails.

**Never edit text files via PowerShell `Get-Content`/`Set-Content`/`Out-File`.** Windows PowerShell's `Get-Content` falls back to the system codepage (Windows-1252) when a file has no BOM, silently mis-decoding UTF-8 multi-byte characters (em dashes, smart quotes, arrows, non-breaking hyphens); writing the result back with `-Encoding UTF8` then bakes that corruption in as real Unicode text and adds a BOM. This exact bug corrupted `index.html` in commit `342e673`. If Edit fails and a script is truly needed, use Node (`fs.readFileSync(path, 'utf8')` / `fs.writeFileSync(path, text)`, both implicitly UTF-8, no BOM) instead. A pre-commit hook (`.githooks/pre-commit` → `scripts/check-encoding.js`, wired via `git config core.hooksPath .githooks`) now blocks commits containing this mojibake pattern or a stray BOM as a backstop.
