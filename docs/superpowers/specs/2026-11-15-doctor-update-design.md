# `doctor` and `update` commands

Status: Step 2 implemented locally and independently reviewed. Created 2026-11-15; completed 2026-11-16 against the merged Step 1 code. The earlier decision-table and `--yes` choices (Q1 to Q7) stand. Latest checks: strict lint, typecheck, 524 passing tests (2 platform/sandbox skips), build, seven smoke cases and repository adoption checks passed. Both issues from the final whole-change review are fixed and passed scoped re-review, and the manifest now records the package manager so hooks survive being checked through a different one. No commit or release has been made.

## Why

`init` is the only way to apply a fix to a project that already uses the toolchain. The 2.1.2 and Unreleased changelog notes tell users to re-run `init`, and nothing tells a project it is behind. `init` also overwrites every generated file, including edits the project made on purpose (Shikai downgrades 261 rules to `warn`; yt-prototype turns off `jsx-a11y/prefer-tag-over-role`).

So two things are missing: a way to see what is out of date, and a way to apply updates without losing local edits.

## Goals

- `doctor`: read-only. Shows, per file and per `package.json` entry, whether it is in sync, stale, locally edited, or in conflict. Exits 1 when something needs action, so CI can run it.
- `update`: applies stale entries, keeps local edits, asks about conflicts.
- Every project initialized from now on carries a base to compare against.
- Every existing file `init` generates stays byte-for-byte what it is today. `.toolchain.json` is the only new generated file.

## Non-goals

- Bumping dependency versions of packages already installed. That is Renovate's job, and it would make `doctor` fail every day.
- Rewriting workspace packages in a monorepo. `init` only touches the root, so these commands do too.
- Line-level merging of text files. Granularity is one file, or one JSON key (see below).
- `--json` output, a CI action, or auto-running `doctor` in hooks.

## Anti-goal

Overwriting an edit the project made on purpose without showing it first. A run that loses a local rule is worse than a run that never updates.

## Approaches considered

- **A. Report only.** Cheap, but it reports every local edit as drift forever, so people learn to ignore it.
- **B. Manifest and three-way update.** Chosen. The manifest gives the tool a base, so it can tell stale from edited.
- **C. Version stamp with hand-written migrations.** Never looks at the files, and needs a new migration for every fix.

## Design

### Step 1: generators return content (merged)

Merged in PR #4 as `7da27bf`. Generators return content; `buildPlan` collects entries and messages, and `applyEntries` writes them.

```ts
interface Entry {
  path: string;
  want: string | null; // null = remove; a JSON null value is the string 'null'
}
interface PlanMessage {
  level: 'info' | 'warn';
  text: string;
}
interface Plan {
  entries: Entry[];
  messages: PlanMessage[];
}
```

- `buildPlan(targetDir, info, pm)` collects entries from the generators. It reads the project, never writes.
- `init` builds the plan and applies every entry. Recording the manifest belongs to Step 2 below; this work remains unreleased.
- The hook content needs the final `scripts`. The hook generator takes the effective scripts as an argument: the scripts on disk, with each script entry that will change replaced by its new value. It no longer reads `package.json` itself.
- `generateOxlintConfig` splits into an object builder and a serializer. The serializer keeps the inline `plugins` array step, so a merged config still passes `prettier --check`.

Keep Step 1's six-fixture golden snapshot as the byte-for-byte check. Step 2 must also fix `serializeOxlintConfig` when `plugins` is absent or there are several overrides, and stop treating an array-valued `package.json.config` as an object.

### Step 2: manifest, `doctor`, `update` (implemented locally)

**Manifest**: `.toolchain.json` at the project root, committed, so teammates and CI share one base.

```json
{
  "packageManager": "pnpm",
  "entries": {
    ".oxlintrc.json#rules.no-debugger": "<64 lowercase hexadecimal characters>",
    "package.json#scripts.lint": "<64 lowercase hexadecimal characters>"
  }
}
```

This example shows the shape; the angle-bracket values stand for actual hashes. `init` writes it after applying the plan, before install. `scaffold` gets it through `init`. Hashes only, no content; a conflict shows disk against new, not a full three-way diff. A manifest records the generator base, not proof that install or Husky setup succeeded.

`packageManager` records the manager the hooks were generated for. It is absent in manifests written before it was recorded, and readers fall back to detection. Doctor and update resolve the manager as `--pm`, then whatever the project tree names (a lockfile or `devEngines`), then the recorded value, then npm. The tree outranks the record so a manager migration shows the hooks as stale instead of passing. Both commands ignore `npm_config_user_agent`, because the shell that invoked the CLI must not rewrite hooks generated for the project's own manager; `init` still reads it, since a fresh project has no lockfile yet. Update records the manager it resolved.

Write manifest entry paths in sorted order with two-space indentation and a final LF. Emit `packageManager` only when known, and accept only `bun`, `npm`, `pnpm` or `yarn`. The hash rules and path grammar are the file format contract; a later change needs an explicit migration.

Hash with SHA-256, encoded as lowercase hex. Whole-file text normalizes CRLF to LF, with all other whitespace, including the final newline, significant. JSON values use compact JSON with object keys sorted recursively; array order stays significant. This makes formatting and object-key order irrelevant inside a JSON entry. Array-item entries hash the JSON string for that item. Dependency-presence entries hash the JSON literal `true`. Missing is a separate value, never the text `null` or an empty string.

Write manifest entry paths in sorted order with two-space indentation and a final LF. The hash rules and path grammar are the file format contract; a later change needs an explicit migration.

**Entries** (what the tool tracks):

- Whole files: `.editorconfig`, `.prettierrc`, `.prettierignore`, `commitlint.config.mjs`, `.husky/pre-commit`, `.husky/commit-msg`.
- `.oxlintrc.json`: one entry per top-level key, except `rules`, which gets one entry per rule. A project that changed one rule keeps it and still receives rules added later.
  - Each item of a string array (`plugins`, `ignorePatterns`) is its own entry, for example `.oxlintrc.json#plugins.import`, and goes through the same decision table. An item you added is untracked and stays. A new generated item is missing, so it is created. A dropped one follows the removal rule. A whole-array entry would conflict every time the generator adds an item to a project that appended one.
  - `overrides` is one whole-key entry.
- `package.json`: `scripts.<name>` for each generated script, `lint-staged`, `config.commitizen`, and the presence of each toolchain devDependency. Version ranges are not tracked.
- Create-only, never diffed once they exist: `.gitattributes`, `tsconfig.json`.

Compare the union of current generated paths and manifest paths. Untracked disk values stay untouched. Exclude `init`'s ESLint dependency-removal entries: `update` neither removes dependencies nor moves other configs aside. A dependency is present only when its own key in root `devDependencies` has a non-empty string value. A package under `dependencies` alone does not meet this rule. This checks declarations, not `node_modules` or registry versions.

Entry paths use the first `#` to separate file from JSON selector, then the first dot to separate container from literal key or item. Keep the rest intact: `.oxlintrc.json#rules.import/no-cycle` and `.oxlintrc.json#ignorePatterns.**/*.{js,mjs,cjs}` must round-trip. The allowed whole files are the six listed above. JSON selectors are the listed package selectors and oxlint top-level keys, `rules.<name>`, `plugins.<item>` and `ignorePatterns.<item>`. Do not infer arbitrary nested paths.

Read `.toolchain.json`, `package.json` and an existing `.oxlintrc.json` as untrusted input. Require plain JSON objects at their roots; require `entries` to map allowed paths to valid hashes. Reject absolute paths, traversal, unknown file targets and unsafe property names (`__proto__`, `constructor`, `prototype`) wherever they would select a property. Validate containers before reading or changing them: scripts and dependencies contain string values; `config` and oxlint `rules` are objects; `plugins` and `ignorePatterns` are arrays of strings; `overrides` is an array of objects. Missing optional containers are allowed. A malformed file or container aborts before writes with a message naming the file and field; do not replace it with an empty object. Existing symlinks in a write target or its parent path are refused rather than followed. Manifest paths never grant permission to write outside the root.

**Per-entry decision.** `base` is the manifest hash, `disk` is the current value, `want` is what the current version generates.

The classifier accepts hashes or absence for all three inputs. Apply rows in the order below; the rows for present values do not match missing ones. No row is needed for three absent inputs, since such a path is outside the comparison union.

| base | disk                           | want              | state           | `update` does                                                     |
| ---- | ------------------------------ | ----------------- | --------------- | ----------------------------------------------------------------- |
| any  | present, equals want           | present           | in sync         | stamps want                                                       |
| set  | missing                        | absent            | obsolete        | drops the manifest entry; no disk change                          |
| set  | equals base                    | absent            | obsolete        | removes disk entry and drops base                                 |
| set  | present, differs from base     | absent            | local edit      | keeps disk and base                                               |
| set  | missing                        | present           | removed locally | keeps missing and base, subject to the dependency exception below |
| none | missing                        | present           | missing         | creates and stamps want                                           |
| none | present, differs from want     | present           | unknown origin  | asks; overwrite backs up the file first                           |
| set  | equals base, differs from want | present           | stale           | overwrites and stamps want                                        |
| set  | differs from base and want     | equals base       | local edit      | keeps disk and base                                               |
| set  | differs from base and want     | differs from base | conflict        | asks; overwrite backs up the file first                           |

**Removals.** When a version stops generating an entry (a rule, a script, a file), the entry is obsolete. It is removed only when disk still equals base. An edited entry stays as a local edit. devDependencies are never removed, whatever the generator wants.

For a dependency the generator dropped, leave disk untouched and drop its manifest entry. For a still-required dependency missing from disk, restore it even when classified removed locally. This is the only repair exception to keeping a local deletion. Resolve only absent required packages, before any write, using the existing settled-version policy (and the fixed TypeScript range). Keep every installed range unchanged. A deleted tracked hook stays removed locally, but `doctor` exits 1 and names its path and the repair: restore it from Git or remove its manifest entry and run `update` to recreate it. `--yes` does not reverse an intentional hook deletion.

**What "keep" records.**

- An interactive "keep" on a conflict or unknown-origin entry sets base to want. The entry then reads as a local edit (exit 0 in `doctor`), and conflicts again only when the generator changes it a second time. Without this, a decision you already made would exit 1 on every run.
- `--yes` keeps the same entries but records nothing, because nobody decided. They stay conflicts or unknown-origin.

Applied writes and matching entries record want; removals drop base. Local edits, local deletions and `--yes` keeps retain their existing base. For an edited value the generator dropped, keep its old base until the user removes the disk entry or it matches that base. The next run can then forget it. A no-manifest run also records entries it safely creates; only differing existing entries stay without a base.

**Prompts.** Prompts group by file, not by entry. Each differing file offers "overwrite all differing", "keep all (recorded as local edits)" and "review one by one", with keep all as the default. A legacy project with 261 downgraded rules gets one prompt for `.oxlintrc.json`, not 261.

Here, "differing" means conflict and unknown-origin rows only. Stale, missing, local-edit, removed-locally and obsolete rows keep their table actions. Show each conflicted path and its disk/want values before the file choice. Review-one-by-one offers overwrite or keep per path, defaulting to keep. A cancelled prompt aborts the entire run before writes and exits 1. Without a TTY, require `--yes` if any prompt is needed; do not silently record a keep.

**`--yes` on a legacy project** (no manifest): the table applies as written, so in-sync entries are stamped and differing ones get no base. `doctor` exits 1 on those until an interactive `update` runs.

**`doctor`**: prints the table above for the project, with the disk and want values (`- disk`, `+ want`) for stale, conflict and unknown-origin entries. Exit 1 if any entry is stale, conflicting, unknown-origin or missing, if a toolchain devDependency is absent, or if a `.husky/*` file is missing ("hooks missing": commits would go unchecked with no warning). Local edits and other removed-locally entries (a script, a rule) exit 0. It needs no network, since versions are not compared.

Group output by state with paths sorted within each group; summarize in-sync rows as a count. Show missing/absent values as `(absent)` and prefix every line of a multiline value with `- ` or `+ `. Print totals for entries in sync and entries needing action. Obsolete entries exit 0, though `update` will clean them up. Only missing hooks the current generator still requires fail the hook check. With no manifest, explain that interactive `update` can adopt the project; a fully matching legacy project may exit 0 even without a manifest. Do not infer a base from a version number.

Both commands operate in the current directory, accept `--pm <bun|npm|pnpm|yarn>`, and otherwise use the detector's existing package-manager order. Invalid managers, unsupported stacks, a missing `package.json`, malformed input and I/O errors exit 1 with a readable error, without a stack trace. `doctor` performs no writes, install, Husky setup or registry lookups.

**`update`**: refuses unsupported stacks like `init` does. Applies the decisions, adds missing devDependencies (resolving their versions from the registry then), removes no devDependency, runs `<pm> install` only if dependencies changed, then writes the manifest. Prints the same workspace warnings as `init`. It exits 0 when it kept conflicts under `--yes` and prints what it kept; `doctor` is the only command that gates CI.

#### Scripts, hooks and create-only files

`buildPlan` currently generates hooks assuming every planned script will be applied. That is valid for `init`, but `update` can keep a script edit or deletion. Decide package entries first, form the resulting scripts, then generate and classify hooks against those scripts. Prompt for hooks after package decisions, and finish all prompts before writes. `doctor` generates desired hooks from disk scripts, since those are the scripts a hook would run now. A script update may therefore make a hook stale during `update` even if the earlier `doctor` did not list that hook. A kept hook remains a local edit; no automatic rewrite may bypass its own classification.

`update` creates `.gitattributes` and `tsconfig.json` only when absent and when `init` would create them for that project. Existing copies are never compared, changed or tracked. `doctor` does not gate on these create-only files. `update` runs neither `moveAside` nor `husky`; this step checks the two tracked hook source files, not `.husky/_`, Git configuration or whether hooks actually run.

#### Write-back and failure recovery

Read and validate all affected files, make decisions, resolve missing versions and prepare output before the first write. Recheck read contents before applying them; if a file changed while prompts or lookups ran, abort and ask the user to rerun. Concurrent writers are unsupported; do not claim a transaction across files.

For JSON files, change only selected keys or array items, retaining untracked values and the order of existing object keys and array items. Append new keys/items, deduplicate added items and remove all occurrences of a selected removed item. Compare array membership by string value, never index. Serialize `package.json` with the existing two-space format and a final LF; serialize oxlint with `serializeOxlintConfig`, preserving its generated formatting and supporting absent plugins and all overrides. A changed JSON file can lose custom whitespace, but a file with no applied content changes must not be rewritten. Never leave an empty array as an object or drop unrelated rule options.

Before any conflict or unknown-origin overwrite, copy the entire original file to `.bak` once, even for one JSON key. Never overwrite an existing backup: use the first free `.bak.1`, `.bak.2`, and so on, and report its path. All required backups must succeed before content writes start. Stale writes and obsolete removals do not need backups because disk still matches base.

Replace each written file, including the manifest, through a temporary sibling and rename, retaining an existing file's permission bits. If a write fails, exit 1, report which writes finished, and leave the old manifest intact. Already completed file writes are not rolled back; rerunning compares their actual content with the old base. Clean up temporary files where possible. A file removal must fail visibly on an I/O error.

After content writes, run `<pm> install` only if at least one required devDependency was added. If it fails, still save the manifest for the applied content, then exit 1 and print the exact manual install command. A rerun sees declared dependencies as present and will not retry install; say that in the error. If saving the manifest fails, exit 1 and tell the user to rerun `update`. Install success or failure is not part of `doctor`'s content check. This avoids claiming package installation succeeded just because a manifest exists.

On success, save the next manifest and print applied paths, kept edits/deletions, unresolved `--yes` conflicts and any workspace warnings that `init` also prints. Do not reuse `init` warnings claiming a kept script or version was overwritten. A second successful `update --yes` with unchanged inputs makes no content changes and runs no install.

**Release**: ships as a minor release. The checked-out `package.json` is still 2.1.2; the earlier reference to "after 2.2.0" was a planned order, not a published-version check. Atharv chooses the version and release timing separately.

## Checks

- `classify(base, disk, want)` is a pure function with a table-driven test covering every row above, including obsolete-and-already-missing. Test the dependency repair and removal exceptions separately from the classifier.
- `--yes` tests: conflicts are kept and base is unchanged; on a legacy project matching and safely created entries are stamped, while differing existing entries remain without a base; `update` exits 0 with kept conflicts and `doctor` still exits 1.
- A deleted `.husky/pre-commit` makes `doctor` exit 1; a deleted `format` script alone does not. A deleted `typecheck` script is not itself an error, but a hook still calling it can be stale and need action.
- Integration test on a temp project: `init`, then `doctor` reports in sync; edit a rule, `doctor` reports a local edit and exits 0; change what the generator wants, `doctor` reports stale and exits 1; `update` applies it and keeps the edit.
- This repo runs `doctor` and reports in sync, and `.toolchain.json` is committed here.
- `pnpm run smoke` runs `doctor` on each scaffolded template and expects exit 0.
- Hash tests cover CRLF/LF, JSON object-key order, significant array order, literal JSON null versus absence and dependency versions changing without drift.
- Round-trip rule names, scoped dependency names and glob items containing dots. Keep untracked rules/items, add new items, remove dropped unedited items and preserve edited obsolete values. Drop a no-longer-required dependency from the manifest without removing its declaration.
- With 261 unknown-origin rule edits, show one file prompt. Test keep-all, overwrite-all and review-one-by-one; cancel late in the prompts and assert that no content or manifest changed. Non-TTY without `--yes` must fail before writes when choices are needed.
- Restore a required dependency removed after init, resolve only missing packages, leave other ranges unchanged, and abort all writes when lookup fails. Deleted hooks still fail `doctor`; intentionally deleted scripts stay deleted after `update`.
- Keep a deleted typecheck script and assert the regenerated hook does not call it. Keep or change a Next lint script and test whether the resulting hook needs `next typegen`. Decide hooks after package decisions; a kept custom hook stays untouched.
- Preserve existing create-only files and create eligible missing ones, including skipping a rootless monorepo tsconfig. Confirm neither file enters the manifest.
- Reject bad manifest hashes, traversal/unsupported paths, unsafe selectors, malformed JSON containers and write-target symlinks before any write. A malformed `config` array must produce an error rather than silently lose data.
- Overwrite one conflicted rule and assert the backup contains the entire original file. Keep an existing `.bak`, choose a free suffix, and abort before writes on backup failure. Preserve mode bits on rewritten hooks.
- Simulate an input changing during a prompt, a content-write failure, an install failure and a manifest-write failure. Assert exit codes, recovery messages and manifest contents match the recovery rules. An install failure must never print success.
- Test missing `plugins` and multiple `overrides` in the serializer; only the manifest may change in init's golden snapshots. Run lint, typecheck, Vitest, build and smoke before calling implementation complete. Re-run update without changes and assert no content writes or install.

## Completion decisions to review

These settle the earlier plan's five open decisions and the gaps found against the code:

- Obsolete entries exit 0; an obsolete entry already absent is forgotten. A matching legacy project can exit 0 without a manifest.
- `doctor` refuses unsupported stacks like `init` and `update`. It checks declarations and tracked hook source files, not installed tools or Git hook activation.
- SHA-256 uses normalized text or recursively key-sorted JSON. JSON formatting and object-key order do not create drift; array order inside a whole-key value does.
- JSON write-back keeps key/item order and untracked content. Bad containers abort. New backup copies never replace old backups.
- Restore absent required dependencies, but preserve intentional script and hook deletions. Decide scripts before hooks. Save an applied-content manifest even when install fails, and require a manual retry of install.

## Implementation handoff

The revised `docs/superpowers/plans/2026-11-16-manifest-doctor-update.md` maps this design to eight implementation tasks, including hashing, classifier precedence, validation, script/hook ordering, dependency-only resolution and failure recovery. All eight tasks are implemented, locally validated and independently reviewed. Both final review findings are fixed and passed scoped re-review. Generated init entries remain separate from tracked comparison entries so Step 1's byte-for-byte guarantee holds. No commit or release is authorized by this status update.

## Left to the builder

- Internal module names and function boundaries, following the existing generator and command structure.
- Exact prompt wording and colors, preserving the choices, defaults and exit behavior above. No new dependency is needed.
