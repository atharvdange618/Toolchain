# Agent-Friendly Update and Doctor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent with no terminal adopt and update a project. `update` gets `--keep`/`--overwrite` choices, doctor and update print the exact next command, and `doctor --json` gives machine-readable output.

**Architecture:** A new pure module, `src/manifest/choices.ts`, turns flag patterns into the `Map<string, Choice>` that `decide()` already takes, and builds the copyable `update` command. `chooseConflicts` applies the flags first and prompts only for what is left. Doctor reuses the same command builder for its `Next:` line and its JSON `next` field.

**Tech Stack:** TypeScript 7 (strict, ESM, `.js` imports), Commander, prompts, Vitest.

**Spec:** this conversation's agreed design (2026-11-17), restated in Global Constraints. Branch: `feat/agent-flags`, updated to `main` at `1770b38` after PR #6 merged. `isStricterRule` is available on that base.

## Global Constraints

- `--keep <path>` and `--overwrite <path>` are repeatable. Each value is an exact entry path or a pattern where `*` matches any run of characters. No other glob syntax.
- A `*` may appear only after the `#` in a path, and the file name before `#` must be literal (`.oxlintrc.json#rules.*` and `.oxlintrc.json#*` are allowed; `*`, `.*`, `*#rules.x` and `.prettier*` are rejected). The broadest a pattern can reach is one file's entries, the same as the prompt's per-file "Keep all". So `--keep '*'` can't bring back the bare form. A rejected pattern fails before the project is read.
- Explicit paths only: there is no bare `--keep` or `--keep-all`.
- Flags only choose for `conflict` and `unknown-origin` rows, which are the rows the prompts cover. A flag `keep` records the base exactly like an interactive keep (`keep-recorded`).
- A pattern that matches no `conflict`/`unknown-origin` row in its own pass is an error, and it fails before any write. Hook patterns (`isHookPath(pattern)`; they have no `#`, so they are literal) belong to the hook pass; every other pattern belongs to the non-hook pass. Non-hook patterns are checked for use right after the non-hook pass, before its no-TTY error, so a retry command never carries a typo.
- A row matched by both a `--keep` and an `--overwrite` pattern is an error, and it fails before any write.
- Rows the flags leave open are prompted when there's a TTY, kept unrecorded with `--yes`, and otherwise cause an error that prints the full command.
- Every printed command starts with `${pmDlx(pm)} @atharvdange/toolchain update --pm <pm>`, using the project's own manager: `bunx`, `npx --yes`, `pnpm dlx` or `yarn dlx` (the existing `DLX` map in `src/detectors/project.ts`). An npm or bun user can run the command with no pnpm installed. `--pm` stays in the command so the rerun uses the same manager doctor resolved, even if a lockfile appears in between. After that come sorted, deduplicated `--keep` values followed by sorted, deduplicated `--overwrite` values. Paths are single-quoted for a POSIX shell, with `'` written as `'\''`; the README says so, since PowerShell and cmd don't read that quoting. New suggestions use `--keep`, since keep is the prompt default. A no-TTY retry preserves all supplied keep and overwrite patterns, including choices for the other stage, and adds keeps only for unresolved rows in the current stage. A later stage may reveal another choice, but its retry must retain every earlier explicit choice.
- `doctor --json` writes only one JSON document to stdout. Errors still go to stderr with exit 1 and nothing on stdout.
- No new dependencies. No `Co-Authored-By` trailer in commits.
- Do not stage or commit unless Atharv explicitly requests it. Each task's final step prepares a reviewable diff; a request to implement this plan does not authorize commits.

## Review Focus

- **`--keep '*'` or another cross-file wildcard** would keep every entry unseen, which is the bare form ruled out on 2026-11-17. Expected: exit 1 before reading the project, with an error saying the file name must be literal (Task 1 `assertPattern`, Task 2 `update.test.ts`).
- **A typo'd `--keep` path** matches nothing. Expected: exit 1 before writes, with an error naming the flag (Task 2, `update.test.ts`). With no TTY and another non-hook row unresolved, the unused-flag error must win over the retry error, so the agent never pastes a command that carries the typo.
- **A `--keep` that names a hook path** gets decided in update's second (hook) pass, so it must not be reported unused after the first pass (Task 2).
- **A partial no-TTY choice** must survive the printed retry, including an overwrite supplied before an unresolved hook. Test retries in both stages and assert no prompt, write or dependency lookup happens before all required choices pass (Task 2).
- **A path containing `'`** in a suggested command must still paste into a POSIX shell (Task 1, `shellQuote`).
- **A broad pattern** (`'.oxlintrc.json#rules.*'`) that also matches in-sync or stale rows counts as used, but only changes the conflict and unknown-origin rows (Task 1).
- **`doctor --json` in a project with no manifest, or with a broken `package.json`,** must give parseable stdout or none (Task 4).

---

### Task 1: Flag choices and the command builder

**Files:**

- Create: `src/manifest/choices.ts`
- Test: `src/manifest/choices.test.ts`

**Interfaces:**

- Produces:
  - `interface ChoiceFlags { keep: string[]; overwrite: string[] }`
  - `assertPattern(pattern: string): void` throws when a `*` appears before the first `#`, or anywhere in a pattern with no `#`.
  - `matchesEntry(pattern: string, entryPath: string): boolean`
  - `flagChoices(rows: Comparison[], flags: ChoiceFlags, used: Set<string>): Map<string, Choice>`. Adds `--keep <pattern>` / `--overwrite <pattern>` labels to `used` for every pattern that matched an eligible row.
  - `unusedFlags(flags: ChoiceFlags, used: Set<string>, include: (pattern: string) => boolean = () => true): string[]` returns the labels never added to `used`, limited to patterns where `include` holds. Update passes `(p) => !isHookPath(p)` after the non-hook pass and `isHookPath` after the hook pass.
  - `shellQuote(value: string): string`
  - `updateCommand(pm: PackageManager, keep: string[], overwrite?: string[]): string`. Prefix with `pmDlx(pm)`. Default `overwrite` to `[]`; sort and deduplicate each list without mutating the inputs.

- [x] **Step 1: Write the failing tests** in `choices.test.ts`:
  - `assertPattern`:
    - It does not throw for `.prettierrc`, `.oxlintrc.json#rules.*` or `.oxlintrc.json#*`.
    - It throws `/file name before # must be literal/` for each of `*`, `.*`, `*#rules.x`, `.prettier*` and `**`.
  - `matchesEntry`:
    - `('.prettierrc', '.prettierrc')` is true.
    - `('.prettierrc', '.prettierrc.bak')` is false (whole-string match).
    - `('.oxlintrc.json#rules.*', '.oxlintrc.json#rules.react/purity')` is true.
    - `('.oxlintrc.json#rules.*', '.oxlintrc.json#overrides')` is false.
    - `('a.b', 'axb')` is false, so `.` is literal.
  - `flagChoices`:
    - With rows `.prettierrc` (unknown-origin), `.oxlintrc.json#rules.x` (conflict) and `.oxlintrc.json#rules.y` (in-sync), and flags `{ keep: ['.oxlintrc.json#rules.*'], overwrite: ['.prettierrc'] }`, it returns `Map { '.prettierrc' => 'overwrite', '.oxlintrc.json#rules.x' => 'keep' }`, has no entry for `rules.y`, and `used` holds both labels.
    - A row `.oxlintrc.json#rules.x` matched by `keep: ['.oxlintrc.json#*']` and `overwrite: ['.oxlintrc.json#rules.x']` throws `/\.oxlintrc\.json#rules\.x matches both --keep and --overwrite/`.
  - `unusedFlags({ keep: ['a', 'b'], overwrite: ['c'] }, new Set(['--keep a']))` equals `['--keep b', '--overwrite c']`.
  - `unusedFlags({ keep: ['.husky/pre-commit', '.nope'], overwrite: [] }, new Set(), (p) => !isHookPath(p))` equals `['--keep .nope']`.
  - `shellQuote("it's")` equals `` `'it'\''s'` ``.
  - `updateCommand('npm', ['b', 'a'])` equals `"npx --yes @atharvdange/toolchain update --pm npm --keep 'a' --keep 'b'"`, and `updateCommand('pnpm', [])` equals `'pnpm dlx @atharvdange/toolchain update --pm pnpm'`.
  - `updateCommand('bun', [])` equals `'bunx @atharvdange/toolchain update --pm bun'`, and `updateCommand('yarn', [])` equals `'yarn dlx @atharvdange/toolchain update --pm yarn'`.
  - `updateCommand('npm', ['b', 'a', 'a'], ['z', 'c', 'c'])` emits keeps for `a`, `b`, then overwrites for `c`, `z`, with no duplicates. Both input arrays remain unchanged; quote overwrite values with the same `shellQuote` helper.

- [x] **Step 2: Run** `pnpm vitest run src/manifest/choices.test.ts`. Expected: FAIL, module not found.

- [x] **Step 3: Implement** `choices.ts`. `matchesEntry` escapes regex characters, turns `*` into `.*` and anchors with `^…$`. `flagChoices` skips rows whose state isn't `conflict` or `unknown-origin`.

- [x] **Step 4: Run** the same command. Expected: PASS.

- [x] **Step 5: Review the diff.** Do not run these commands unless Atharv explicitly requests a commit; first run full lint, typecheck and tests. Suggested commands for that later request:

```bash
git add src/manifest/choices.ts src/manifest/choices.test.ts
git commit -m "feat(manifest): resolve keep and overwrite choices from flag patterns"
```

### Task 2: `update --keep/--overwrite`

**Files:**

- Modify: `src/commands/update-prompts.ts` (`chooseConflicts`)
- Modify: `src/commands/update.ts` (`update`, plus the final keep warnings)
- Modify: `src/index.ts:47-54` (update command options)
- Modify: `README.md` (`update` section), `AGENTS.md` (`update.ts` bullets), `CHANGELOG.md` (`[Unreleased] → Added`)
- Test: `src/commands/update-prompts.test.ts`, `src/commands/update.test.ts`

**Interfaces:**

- Consumes: everything from Task 1.
- Produces:
  - `chooseConflicts(rows: Comparison[], options: { yes: boolean; isTTY: boolean; pm: PackageManager; flags: ChoiceFlags; used: Set<string> }): Promise<Map<string, Choice>>`
  - `update(options: { pm?: string; targetDir?: string; yes?: boolean; keep?: string[]; overwrite?: string[] }): Promise<number>`

- [x] **Step 1: Write the failing tests.**
  - In `update-prompts.test.ts`:
    - Pass `pm: 'pnpm', flags: { keep: [], overwrite: [] }, used: new Set()` in the existing calls.
    - Change the TTY test's regex so the thrown message must contain `"pnpm dlx @atharvdange/toolchain update --pm pnpm --keep '.prettierrc'"` and `--overwrite`.
    - Add: flags `{ keep: ['.prettierrc'], overwrite: [] }` with `isTTY: false` and no `--yes` resolves to `Map { '.prettierrc' => 'keep' }` without calling `select`.
    - Add: with rows `.prettierrc` and `.editorconfig`, a keep flag on `.prettierrc` and `isTTY: true`, `select` is called once and its message starts with `.editorconfig`.
    - Add: no TTY, `.prettierrc` already chosen with overwrite and `.editorconfig` unresolved. The error command includes `--keep '.editorconfig' --overwrite '.prettierrc'`; `select` is never called.
  - In `update.test.ts`, keep the existing fixture's TTY default for existing tests. For each new no-TTY case, explicitly set `vi.spyOn(process.stdin, 'isTTY', 'get').mockReturnValue(false)` after setup. Assert `select` was never called in every no-TTY case:
    - Remove `.prettierrc` from the manifest's `entries` (use the existing `base('.prettierrc', undefined)` helper) and change its content, so it's unknown-origin. Then `update({ targetDir, pm: 'pnpm', keep: ['.prettierrc'] })` returns 0, `.toolchain.json` gets a base for `.prettierrc`, and a following `doctor` returns 0.
    - `update({ …, keep: ['*'] })` returns 1, stderr matches `/file name before # must be literal/`, and every file is byte-identical to before.
    - `update({ …, keep: ['.nope'] })` returns 1, stderr contains `No differing entry matches --keep '.nope'`, and every file is byte-identical to before.
    - Make `.prettierrc` and `.editorconfig` unknown-origin, then `update({ …, keep: ['.nope', '.prettierrc'] })` with no TTY returns 1. Stderr contains `No differing entry matches --keep '.nope'` and does not contain `Rerun with a choice`.
    - Remove `.husky/pre-commit` from the manifest's `entries` and edit the file, so it's unknown-origin in the hook pass. `update({ …, keep: ['.husky/pre-commit'] })` returns 0, so a hook-pass match is not reported unused.
    - `update({ …, yes: true })` with the same unknown-origin `.prettierrc` prints `Next: pnpm dlx @atharvdange/toolchain update --pm pnpm --keep '.prettierrc'` in stdout (allow the existing `info` prefix).
    - Make `.prettierrc` and `.editorconfig` unknown-origin. Supply only overwrite for `.prettierrc`: exit 1, and the retry retains that overwrite while adding keep for `.editorconfig`. Run the retry choices: exit 0, `.prettierrc` matches generated content and `.editorconfig` retains local content.
    - Make `.prettierrc` and `.husky/pre-commit` unknown-origin. Supply only overwrite for `.prettierrc`: the second-stage error retains that overwrite and adds keep for the hook. Run the retry choices: exit 0, the config changes and the hook stays local. Also test that an original hook choice stays in a first-stage retry when a non-hook row remains unresolved.
    - Overlapping keep and overwrite patterns on one eligible rule return 1, naming that rule. An unused exact path and a wildcard matching only in-sync/stale rows also return 1. Run each with `yes: false` and `yes: true` to prove `--yes` does not bypass flag validation. After every rejected attempt, assert `files()` is unchanged, `getToolchainDeps` and `execSync` were never called, and no backups appeared. Include the same no-write/no-lookup assertions on both partial-choice failures above.

- [x] **Step 2: Run** `pnpm vitest run src/commands/update-prompts.test.ts src/commands/update.test.ts`. Expected: the new tests FAIL.

- [x] **Step 3: Implement.**
  - **`chooseConflicts`:** start from `flagChoices(rows, flags, used)`. Group only the eligible rows not in that map. With `--yes`, return the flag map. With nothing left, return it too. With no TTY, throw:

    ```
    Update needs a choice for <n> entr(y|ies) and has no terminal to ask. Rerun with a choice for each:
      <updateCommand(pm, [...flags.keep, ...remainingPaths], flags.overwrite)>
    Swap --keep for --overwrite '<path>' to take the generated value, or add --yes to keep them without recording a choice.
    ```

    `flags` contains the complete original invocation in both stages, not just patterns matching the current rows. Preserve those patterns in the retry, including overwrites and choices for the other stage. Otherwise prompt per file as today, merging the answers into the flag map.

  - **`update`:** build `flags` from the options (default `[]`) and call `assertPattern` on every value before `loadProject`. Then create one `used` set. In each pass, run `flagChoices` first, then check that pass's patterns with `unusedFlags` (non-hook patterns in the first pass, `isHookPath` patterns in the second), then prompt or throw the no-TTY error. That order means a typo fails on its own and never ends up in a retry command. Split `chooseConflicts` so the check can sit between those steps, or pass it a callback; pick whichever leaves the smaller diff. The unused error is `No differing entry matches ${labels.join(', ')}. Run doctor to see entry paths.`, with each label's pattern shell-quoted. Both checks finish before `getToolchainDeps`.
  - **End of `update`:** after the keep warnings, if any `keep` row is unresolved (conflict/unknown-origin), call `info(\`Next: ${updateCommand(project.pm, paths)}\`)`.
  - **`index.ts`:** add `.option('--keep <path>', 'Keep this differing entry and record it (repeatable; * allowed after #)', collect, [])` and the matching `--overwrite`, where `collect = (value: string, previous: string[]) => [...previous, value]`. Also add both to the action's options type.
  - **Docs:**
    - README `update`: one paragraph on the flags, the explicit-path rule, the no-TTY command (quoted for a POSIX shell such as Git Bash), and an example. Say that the printed command uses the project's manager (`npx --yes`, `bunx`, `pnpm dlx`, `yarn dlx`).
    - AGENTS.md: the `update.ts` bullets.
    - CHANGELOG: an Added bullet.

- [x] **Step 4: Run** `pnpm test && pnpm run typecheck && pnpm run lint:strict`. Expected: all pass.

- [x] **Step 5: Review the diff.** Commit only on Atharv's explicit request after full lint, typecheck and tests pass. Suggested commands for that later request:

```bash
git add src/commands src/index.ts README.md AGENTS.md CHANGELOG.md
git commit -m "feat(update): choose conflicts with --keep and --overwrite"
```

### Task 3: Doctor prints the next command

**Files:**

- Modify: `src/manifest/report.ts` (add `nextCommand`)
- Modify: `src/commands/doctor.ts`
- Modify: `README.md` (doctor section)
- Test: `src/manifest/report.test.ts`, `src/commands/doctor.test.ts`

**Interfaces:**

- Consumes: `updateCommand`, `needsAction`.
- Produces: `nextCommand(rows: Comparison[], pm: PackageManager, hasManifest: boolean): string | undefined`.

- [x] **Step 1: Write the failing tests** in `report.test.ts` for `nextCommand`:
  - Unknown-origin `.prettierrc` plus conflict `.editorconfig` gives `updateCommand('npm', ['.editorconfig', '.prettierrc'])`.
  - Only a `stale` or `missing` row gives `updateCommand('npm', [])`.
  - A mixture of stale/missing rows and conflict/unknown-origin rows still includes every conflict/unknown-origin keep path; automatic repairs must not replace those choices with a bare command.
  - All `in-sync` with `hasManifest: true` gives `undefined`. All `in-sync` with `hasManifest: false` gives `updateCommand('npm', [])`.
  - A lone `removed-locally` `.husky/pre-commit` with `hasManifest: true` gives `undefined`, because the repair line already covers it.

  In `doctor.test.ts`:
  - Delete the manifest and change `.prettierrc`. Doctor output then contains `No .toolchain.json found.` and `Next: pnpm dlx @atharvdange/toolchain update --pm pnpm --keep '.prettierrc'`, and does not contain `interactive`.
  - Fresh init prints no `Next:` line.
  - The same no-manifest case with `pm: 'npm'` prints `Next: npx --yes @atharvdange/toolchain update --pm npm --keep '.prettierrc'`, so the doctor path uses the project's manager and not a fixed pnpm.

- [x] **Step 2: Run** `pnpm vitest run src/manifest/report.test.ts src/commands/doctor.test.ts`. Expected: FAIL.

- [x] **Step 3: Implement.**
  - Paths come from rows where `needsAction` holds and the state is conflict or unknown-origin.
  - If there are conflict/unknown-origin paths, include all of them even when other rows need action or the manifest is missing. Otherwise return the bare command for an automatic repair or missing manifest. Return `undefined` when neither applies. A `removed-locally` hook alone is not an automatic repair; its repair line already covers it.
  - In doctor:
    - Keep the line `No .toolchain.json found.`.
    - Drop "Run interactive update to adopt this project."
    - Print `Next: <cmd>` last when `nextCommand` returns one.
  - Add one README sentence.

- [x] **Step 4: Run** `pnpm test`. Expected: PASS.

- [x] **Step 5: Review the diff.** Commit only on Atharv's explicit request after full lint, typecheck and tests pass. Suggested commands for that later request:

```bash
git add src/manifest/report.ts src/manifest/report.test.ts src/commands/doctor.ts src/commands/doctor.test.ts README.md
git commit -m "feat(doctor): print the update command that resolves each finding"
```

### Task 4: `doctor --json`

**Files:**

- Modify: `src/commands/doctor.ts`, `src/index.ts:35-45`
- Modify: `README.md`, `AGENTS.md` (doctor bullet), `CHANGELOG.md`
- Test: `src/commands/doctor.test.ts`

**Interfaces:**

- Consumes: `nextCommand`, `isStricterRule`, `needsAction`.
- Produces: `doctor(options: { pm?: string; targetDir?: string; json?: boolean }): number`. The JSON shape, with keys in this order:

```ts
interface DoctorJson {
  manifest: boolean;
  needsAction: boolean;
  next: string | null;
  rows: Array<{
    path: string;
    state: State;
    disk: string | null;
    want: string | null;
    needsAction: boolean;
    stricter: boolean;
  }>;
}
```

`disk` and `want` carry the same content as `Comparison`: whole-file text for file entries, the `JSON.stringify`'d value for `#` entries, and `null` when absent. An agent needs the content to show or judge a diff, and the text report already prints that content. `base` is left out because it holds the manifest's SHA-256 hash, which tells an agent nothing it can act on. `state` already encodes how base relates to the other two.

This is an object rather than the bare array we discussed. The `next` command and the manifest flag need a home, and an array can't hold them without breaking its shape later.

- [ ] **Step 1: Write the failing tests** in `doctor.test.ts`. Capture `process.stdout.write`.
  - Fresh init with `json: true` returns 0. The output passes `JSON.parse` and gives `manifest: true`, `needsAction: false` and `next: null`. Every row has all six keys, and absent values are `null`, not missing.
  - Delete `.toolchain.json`, set `import/no-cycle` to `"error"` (the generator writes `warn`) and change `.prettierrc`. Then `manifest` is `false`, and:
    - The JSON row for the rule has `state: 'local-edit'` and `stricter: true`.
    - The `.prettierrc` row has `needsAction: true`.
    - `next` equals the Task 3 command.
    - `console.log` was never called, so there's no text report.
  - Write `package.json` as `{`. Then `json: true` returns 1, stdout gets nothing, and stderr is non-empty.

- [ ] **Step 2: Run** `pnpm vitest run src/commands/doctor.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** With `json`, skip `reportComparisons` and the text lines, and write `JSON.stringify(document, null, 2) + '\n'` to `process.stdout`. Add `.option('--json', 'Print one JSON document for scripts and agents')` in `index.ts`. Docs: a README example, AGENTS.md's doctor bullet and a CHANGELOG Added bullet.

- [ ] **Step 4: Run the full gate and a real-project check.** Run the shell steps in Git Bash:

```bash
pnpm test && pnpm run typecheck && pnpm run lint:strict && pnpm run build
node bin/index.js doctor --pm pnpm
```

Both commands must exit 0; this repo's doctor must report `0 need action`.

Then run the agent path once by hand in Git Bash on a Shikai snapshot. This is a manual check: write no harness and commit nothing. Unit tests already cover the logic, and this run only proves the built CLI works end to end on the project that started this work.

```bash
SCRATCH=$(mktemp -d)
git -C C:/Shikai archive main | tar -x -C "$SCRATCH"
cd "$SCRATCH"
node <repo>/bin/index.js doctor --pm npm --json; echo "doctor exit $?"
```

- Doctor must exit 1 with one JSON document whose `next` names a `--keep` for every `conflict`/`unknown-origin` row. If the snapshot is already clean, say so and stop: a clean run proves nothing about adoption.
- `next` must start with `npx --yes @atharvdange/toolchain`, since the run uses `--pm npm`. Paste it, swapping that prefix for `node <repo>/bin/index.js`, with stdin closed (`< /dev/null`). It must exit 0.
- Rerun doctor `--json`. It must exit 0 with `needsAction: false` and `next: null`.
- Check each exit code on its own line. Report the Shikai SHA, the `next` command and the three exit codes. Leave `$SCRATCH` in place, and delete it after the report once you've checked its path.

Commander wiring needs no extra harness. In the same scratch copy, `node <repo>/bin/index.js update --keep` (no value) must exit non-zero with Commander's missing-argument error. The pasted `next` command with two `--keep` values already proves that repeated flags reach update.

- [ ] **Step 5: Review the diff.** Commit only on Atharv's explicit request after full lint, typecheck and tests pass. Suggested commands for that later request:

```bash
git add src/commands/doctor.ts src/commands/doctor.test.ts src/index.ts README.md AGENTS.md CHANGELOG.md
git commit -m "feat(doctor): add --json output for scripts and agents"
```
