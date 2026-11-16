# Manifest, `doctor` and `update` Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if Atharv chooses delegation. Track progress with the checkboxes below.

**Goal:** Record a shared generator base in `.toolchain.json`, report drift without network access, and update projects without losing local edits.

**Architecture:** Keep the existing `Plan` and whole-file init output. Expand it into comparison entries, compare those against validated disk values and manifest hashes, then turn comparisons into decisions. Prepare all output before writing; decide scripts before regenerating hooks, and save the manifest after applying content and attempting any required install.

**Tech Stack:** Strict TypeScript 7, ESM with `.js` imports, Vitest 4, Commander 13, prompts 2, Node filesystem and crypto APIs. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-doctor-update-design.md`, completed 2026-11-16. This revision replaces the earlier plan and its five open questions.

**Status:** Implemented and independently reviewed. All eight tasks passed review. The final whole-change review found two Important issues; both fixes passed scoped re-review. Latest checks: strict lint, typecheck, 495 passing tests with 3 platform/sandbox skips, build, all seven smoke cases and repo adoption checks passed. The final fixes preserve the smoke-tested default output and success paths. No commit, push, version bump or release has occurred.

## Global Constraints

- Every existing file `init` generates stays byte-for-byte what it is today. `.toolchain.json` is the only new generated file.
- The manifest is `{ "entries": { "<entry path>": "<64 lowercase hex SHA-256 characters>" } }`, with sorted paths, two-space indentation and a final LF.
- Whole-file hashes normalize CRLF to LF, preserving all other whitespace. JSON hashes use compact JSON with recursively sorted object keys and preserved array order. Missing is separate from literal JSON null. Dependency presence hashes `true`, never its version.
- Track the six whole files, oxlint top-level keys/rules/string-array items, generated package scripts, `lint-staged`, `config.commitizen` and required devDependency presence. Exclude create-only `.gitattributes`/`tsconfig.json` and init's ESLint dependency removals.
- Compare generated paths plus manifest paths; untracked disk content stays. Use the spec's ordered decision table without inferring a base from a version number.
- Restore absent required devDependencies, even after local deletion; resolve only absent packages before writes. Keep installed ranges unchanged. Never remove a dependency; forget dropped dependencies in the manifest.
- Keep intentional script and hook deletions. Missing required hooks fail `doctor` and print the documented repair. Obsolete entries exit 0.
- `--yes` keeps conflicts/unknown-origin entries without recording a decision. Interactive keep stamps want. Prompts group only conflicting/unknown-origin rows by file, default to keep, and finish before writes.
- Abort on cancellation or a needed prompt without a TTY and without `--yes`. Invalid input, unsupported stacks, bad package managers and I/O failures exit 1 with readable errors.
- Validate paths, hashes and JSON containers before use. Refuse symlinks in write targets/parents, path escapes and unsafe property selectors. Preserve valid untracked data and existing key/item order.
- Back up whole files before conflict/unknown-origin overwrites, once per file. Never replace an existing backup. Finish all backups before content writes; replace files atomically and retain existing modes.
- Content-write failure leaves the old manifest intact and reports completed writes. Install failure still saves the applied-content manifest, exits 1 and supplies a manual install command. No cross-file rollback or concurrent-writer guarantee.
- `doctor` performs no writes, install, Husky setup or registry lookup. `update` runs install only after adding dependencies, never `moveAside` or Husky setup, and touches only the root package.
- No commits unless Atharv asks. Before each requested commit, run `pnpm run lint:strict`, `pnpm run typecheck` and `pnpm test`. A version bump and release require a separate request.

## File Map and Execution Rules

| File                                               | Responsibility                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/manifest/manifest.ts`                         | Entry-path validation, normalized hashing, manifest parsing/serialization                      |
| `src/manifest/classify.ts`                         | Pure ordered classifier and doctor action predicate                                            |
| `src/manifest/project.ts`                          | Validated project snapshot, offline planning, tracked expansion and disk comparison            |
| `src/manifest/write.ts`                            | Prepare JSON/file mutations, recheck inputs, backups and atomic writes                         |
| `src/manifest/decide.ts`                           | Pure actions and next-manifest calculation                                                     |
| `src/commands/update-prompts.ts`                   | File-grouped prompts, TTY checks and cancellation                                              |
| `src/commands/doctor.ts`, `src/commands/update.ts` | Command orchestration and output                                                               |
| Existing generators, init and versions             | Reuse generators; add offline dependency injection, selected resolution and manifest recording |

Each task lists its tests beside the owning source file. Run `pnpm test` once before implementation, then each targeted red/green cycle. Run the full gate at task boundaries where existing callers change. Keep all tasks typecheckable independently; move a caller in the same task as a signature change. Extend existing version mocks with partial mocks when they must retain newly exported constants/functions.

Implement on an `allmight/manifest-doctor-update` branch, preserving the current spec and plan edits. Do not reset or replace unrelated work. Commands below assume the pinned pnpm is available. If its launcher tries to download pnpm and fails, report the network issue; do not change package-manager versions to bypass it. The installed Prettier can also run directly with `node node_modules/prettier/bin/prettier.cjs`.

## Review Focus

1. A missing oxlint array container must be created as an array; a malformed one must abort rather than lose data. Tasks 2 and 3 test both.
2. Backup collisions, stale prompt inputs and partial writes must leave a recoverable project and the correct base. Tasks 3 and 7 inject each failure.
3. A kept script deletion changes the generated hook; comparing hooks too early can write a broken command. Tasks 5 and 7 cover disk versus decided scripts.
4. Legacy `--yes` adoption must stamp safe creations and matching values while preserving unknown origins. Tasks 6 and 7 test the next manifest and subsequent doctor exit code.
5. Invalid data and malicious manifest selectors must fail before detector/generator casts or filesystem mutations. Tasks 1, 2 and 4 cover validation at each entry point.

---

### Task 1: Manifest format and ordered classification

**Files:** Create `src/manifest/manifest.ts`, `src/manifest/classify.ts` and their adjacent `.test.ts` files.

**Interfaces:**

- `type Manifest = Record<string, string>`; `MANIFEST_FILE = '.toolchain.json'`.
- `assertEntryPath(entryPath: string): void` rejects selectors/files outside the spec grammar. Split only the first `#` and first container dot. Literal rule names, scoped package names and glob tails retain their remaining characters.
- `hashEntry(entryPath: string, value: string | undefined): string | undefined`: absent stays absent; a whole-file string hashes normalized text; a JSON-entry string is parsed and recursively key-sorted before hashing. This consumes the existing `Entry.want` representation, not raw JavaScript values.
- `parseManifest(text: string | undefined): Manifest | undefined` validates root, entries, paths and actual lowercase hashes; `serializeManifest(manifest: Manifest): string` writes the deterministic format. Parsing errors name `.toolchain.json`. Filesystem reads/writes belong to Tasks 2/3.
- `type State = 'in-sync' | 'stale' | 'local-edit' | 'conflict' | 'unknown-origin' | 'removed-locally' | 'missing' | 'obsolete'`.
- `classify(base: string | undefined, disk: string | undefined, want: string | undefined): State` consumes hashes; `needsAction(row: Comparison): boolean` consumes Task 2's comparison shape. Define that shape in `classify.ts` now: `interface Comparison { path: string; state: State; base: string | undefined; disk: string | undefined; want: string | undefined }`, where disk/want hold entry text, base holds a hash. Use explicit undefined fields for strict optional-property checks.

- [x] **1. Write classifier and format tests.** Use this table (letters stand for hashes), then assert the outcomes of hashing and parsing below.

  | base   | disk   | want   | expected        |
  | ------ | ------ | ------ | --------------- |
  | absent | w      | w      | in-sync         |
  | b      | w      | w      | in-sync         |
  | b      | absent | absent | obsolete        |
  | b      | b      | absent | obsolete        |
  | b      | d      | absent | local-edit      |
  | b      | absent | w      | removed-locally |
  | absent | absent | w      | missing         |
  | absent | d      | w      | unknown-origin  |
  | b      | b      | w      | stale           |
  | w      | d      | w      | local-edit      |
  | b      | d      | w      | conflict        |

  `needsAction` is true for stale/conflict/unknown-origin/missing and for missing still-required hook/dependency rows (`want !== undefined`), false for other local deletions and obsolete rows. Dependency policy itself is tested in Task 6.

  Hash assertions: `hashEntry('.husky/pre-commit', 'a\r\n') === hashEntry('.husky/pre-commit', 'a\n')`; omitting the final newline changes the hash. Reordered nested JSON objects hash equally; reordered whole-key arrays do not. `'null'`, `'""'` and undefined stay distinct. Presence `'true'` has one stable hash. Manifest serialization sorts valid entry paths and round-trips using real generated hashes, not fake `a: '1'` fixtures.

  Reject uppercase/short/non-hex hashes, array/null roots, missing or non-object `entries`, absolute/traversal/unknown file targets, unsafe selected properties and unsupported nested package selectors. Accept `rules.import/no-cycle`, dotted package names and `ignorePatterns.**/*.{js,mjs,cjs}`. Do not mistake slashes/dots inside a literal selector for a filesystem path escape.

- [x] **2. Run `pnpm exec vitest run src/manifest/manifest.test.ts src/manifest/classify.test.ts`.** Expect missing-module failures first.
- [x] **3. Implement the interfaces.** Follow table precedence exactly; dependency exceptions stay out of `classify`. Do not enumerate untracked disk keys.
- [x] **4. Repeat the targeted tests, then `pnpm run typecheck`.** Expect all pass. Checkpoint complete; commit only if requested.

### Task 2: Validated snapshot and offline comparisons

**Files:** Create `src/manifest/project.ts` and `project.test.ts`. Modify `src/generators/plan.ts`, `src/utils/versions.ts`, `src/generators/plan.test.ts`, `src/utils/versions.test.ts`.

**Interfaces:** Consume Task 1's manifest, path, hash and classifier APIs; existing `Plan`, `Entry`, detector and hook generator.

- Export `TOOLCHAIN_DEP_NAMES: readonly string[]` from versions: the existing nine registry-resolved packages plus `typescript`. Change `getToolchainDeps(names: readonly string[] = TOOLCHAIN_DEP_NAMES): Record<string, string>` to resolve only named required packages; TypeScript uses the existing fixed range and no registry lookup. Reject non-toolchain names. Default calls preserve init behavior and output.
- Extend `buildPlan(targetDir: string, info: ProjectInfo, pm: PackageManager, deps?: Record<string, string>): Plan`; use the supplied map instead of looking up versions, including when empty. Existing callers need no change.
- `type Snapshot = Map<string, string | undefined>` stores relative file paths and original UTF-8 bytes, including missing files. Parse each JSON file once in the loaded project.
- `interface Project { targetDir: string; info: ProjectInfo; pm: PackageManager; pkg: Record<string, unknown>; manifest: Manifest | undefined; snapshot: Snapshot; plan: Plan }`.
- `validatePackageJson(value: unknown): asserts value is Record<string, unknown>` validates the root and script/dependency/config containers; all failures name `package.json` and field.
- `loadProject(targetDir: string, requestedPm?: string): Project` validates root data before detection/planning; validates oxlint and manifest before comparisons; resolves the manager with the existing order; refuses unsupported stacks with the same message as init. Build offline with each required name mapped to its installed range or a nonempty internal placeholder, never persist placeholders. Record bytes used for decisions, including manifest, tracked whole files, create-only files and detector inputs such as root tsconfig, workspace metadata and manager lockfiles.
- `trackedEntries(plan: Plan): Entry[]` expands generated oxlint JSON by top-level key, rule and plugins/ignorePatterns item; dependency entries become `'true'`. Exclude null dependency removals and create-only files.
- `compareProject(project: Project, entries: Entry[]): Comparison[]` reads values from the validated snapshot, compares generated-plus-manifest paths in path order and hashes with `hashEntry`. It can run twice on the same snapshot. An absent desired value uses undefined, not a null JSON string.

- [x] **1. Write tests.** Applying a plan to a temp project then comparing its tracked entries gives only in-sync rows; CRLF whole files and reordered JSON options still match. Changed versions do not drift. A missing/nonempty/empty dependency declaration has the specified presence behavior; an entry only under dependencies does not satisfy devDependencies. No network function is called when loading/comparing; selected resolution of husky must not query prettier or TypeScript. Default resolution keeps prior results.

  Assert exact expansion paths for a plain project and Expo; overrides is one key. Keep dotted glob/package tails intact. Existing untracked rules/items never appear in comparisons. A manifest-only rule already absent is obsolete; an edited obsolete rule is local-edit. Missing optional containers are allowed; array-valued scripts/config, non-string dependency values, non-object rules, non-string plugins/items and invalid overrides/root JSON fail with file/field context. A missing package.json and bad manager fail before version calls.

- [x] **2. Run `pnpm exec vitest run src/manifest/project.test.ts src/generators/plan.test.ts src/utils/versions.test.ts`.** Expect new cases fail before changes.
- [x] **3. Implement loading, expansion and offline dependency injection.** Share unsupported-stack message construction with init if needed; do not call its process-exiting helper from functions returning codes. Read workspace metadata for detection/warnings only; never generate workspace package writes.
- [x] **4. Repeat tests and run `pnpm test` and `pnpm run typecheck`.** Existing golden snapshots must remain unchanged. Update partial module mocks where exports changed, rather than weakening assertions.

### Task 3: Prepare changes and write safely

**Files:** Create `src/manifest/write.ts`, `write.test.ts`. Modify `src/generators/entry.ts`, `entry.test.ts`, `src/generators/oxlint.ts`, `oxlint.test.ts`.

**Interfaces:** Consume `Snapshot` and Task 1 path validation.

- Export `applyKeyEntries(target: Record<string, unknown>, prefix: string, entries: Entry[]): void` from entry.ts; share package mutation with `applyEntries`. Dispatch oxlint array membership by selector name, even if the container is missing; create an array, not an object. Reject malformed existing containers and unsafe selected properties before mutation. Deleting an absent nested key must not create its parent. Init must continue accepting its existing ESLint-removal entries.
- `prepareWrites(project: Project, entries: Entry[]): Entry[]` converts selected logical writes/removals to changed whole-file entries only. Supports the six tracked files, two JSON files and eligible create-only files. Entry null means removal; string `'null'` is a JSON value. Clone parsed data rather than mutating the project snapshot. Preserve untracked values, key order and array membership order. No-op files retain their original bytes, even if their formatting differs from the serializer.
- `assertUnchanged(targetDir: string, snapshot: Snapshot): void` rechecks both content and absence before applying. `applyWrites(targetDir: string, writes: Entry[], snapshot: Snapshot, backupFiles: readonly string[]): string[]` rechecks inputs and safe target/parent paths, completes all backups, applies whole-file replacements/removals, returns completed paths. On failure throw an error naming completed paths; never write the manifest here.
- `writeManifest(targetDir: string, manifest: Manifest): void` combines deterministic serialization with a temporary sibling/rename. Share the private atomic replacement implementation with `applyWrites`; retain existing modes and clean temporary files on errors. Unchanged serialized manifest bytes need no rewrite.

- [x] **1. Add failing mutation/serializer tests.** Missing plugins plus an import item becomes `['import']`; adding an existing item does not duplicate it; removal deletes all copies of the selected item. Preserve other array order and rules, including glob tails. Package `config: []` throws rather than discards data. `serializeOxlintConfig({ rules: {} })` succeeds; several overrides with files arrays serialize validly without rewriting the wrong array. Generated fixture bytes remain unchanged.
- [x] **2. Add failing filesystem tests.** No-op JSON files are byte-identical and not replaced; changed JSON has two-space formatting/final LF; untracked rule options survive. Back up the full original JSON for a single rule overwrite; `.bak`/`.bak.1` already present yields `.bak.2` without clobbering. Inject backup failure and assert no content write. Changed or newly created prompt inputs abort before backups. Refuse target/parent symlinks and path escapes before mutations, including a symlink at `.toolchain.json`; test Windows directory junctions where supported. Verify existing hook mode bits on platforms that support them, atomic rename failure preserves the old file, and partial failure reports completed paths while the old manifest stays unchanged.
- [x] **3. Run `pnpm exec vitest run src/manifest/write.test.ts src/generators/entry.test.ts src/generators/oxlint.test.ts`.** Expect new cases fail.
- [x] **4. Implement preparation and safe writes.** Do not route update through init's direct writer: share key mutation while retaining update's preflight/backup/atomic guarantees. Use exclusive backup creation; stale writes and obsolete removals need no backups. Resolve target paths inside the selected root before writing. Preserve existing serializer output for generated configs while fixing absent plugins and all overrides.
- [x] **5. Repeat tests, then `pnpm test` and `pnpm run typecheck`.** All existing snapshots remain unchanged. Test failures by mocking filesystem calls, not broad real permission changes.

### Task 4: Init records the manifest

**Files:** Modify `src/commands/init.ts`, `src/commands/init.test.ts`, `src/commands/init.golden.test.ts`, `src/commands/__snapshots__/init.golden.test.ts.snap`.

**Interfaces:** Consume `validatePackageJson`, `trackedEntries`, `hashEntry`, `writeManifest`. Init keeps its existing all-overwrite semantics, script-based hooks, move-aside behavior and full dependency resolution.

- [x] **1. Add failing tests.** Init writes a valid base after applying entries and before install; a lookup failure creates neither manifest nor config; an install failure leaves the applied-content manifest. Invalid package containers fail before moving configs or writing files. A manifest write failure must prevent install and print an error, never readiness.
- [x] **2. Run `pnpm exec vitest run src/commands/init.test.ts src/commands/init.golden.test.ts`.** Expect the new assertions fail before implementation.
- [x] **3. Validate package data before detection/planning and record hashes of generated tracked wants immediately after `applyEntries`.** Manifest errors use init's current error pattern. Do not stamp disk values in place of generator wants or turn create-only files into tracked entries.
- [x] **4. Inspect the six-fixture snapshot diff before accepting it.** Only `.toolchain.json` may be added; all existing files, including backups and hooks, must keep their bytes. Update with `pnpm exec vitest run src/commands/init.golden.test.ts -u` only after this check.
- [x] **5. Run `pnpm test`, `pnpm run typecheck` and `pnpm run lint:strict`.** Scaffold receives the manifest through its existing init call; no second scaffold-specific manifest writer.

### Task 5: Read-only doctor command

**Files:** Create `src/commands/doctor.ts`, `doctor.test.ts`; modify `src/index.ts`.

**Interfaces:** Consume validated `Project`, tracked expansion, comparison and `needsAction`. Export `doctor(options: { pm?: string; targetDir?: string }): number` and `reportComparisons(rows: Comparison[]): void` from doctor.ts so update can reuse diff formatting. Register `doctor --pm <manager>`; set `process.exitCode` from its result so output flushes. Catch errors once at the command boundary and return 1, with no stack trace.

- [x] **1. Add failing command tests.** Fresh init gives exit 0; a local rule edit gives 0; deleting format alone gives 0; deleting a required hook or dependency gives 1. Stale/conflict/unknown-origin/missing give 1; obsolete gives 0. A matching legacy project gives 0 with an adoption hint; a differing one gives 1. Snapshot the filesystem and mock registry/exec calls to prove doctor writes and executes nothing.

  Generate desired hooks from disk scripts by replacing the offline plan's hook entries before expansion; test a deleted typecheck script with its old hook yields a stale hook, while the script row itself needs no action. Test Next lint scripts with and without `next typegen`, and a kept custom hook. Invalid manager, unsupported stack, missing package, malformed JSON/manifest/containers yield readable errors and 1.

  Output assertions: nonempty groups in stale/conflict/unknown-origin/missing/removed-locally/obsolete/local-edit order, paths sorted per group; in-sync count plus need-action total; every line of stale/conflict/unknown-origin values prefixed `- ` or `+ `; absent values shown as `(absent)`. Missing hooks name their path and Git/manifest-entry repair instructions.

- [x] **2. Run `pnpm exec vitest run src/commands/doctor.test.ts`.** Expect failure before implementation.
- [x] **3. Implement reporting and register the command.** Ignore create-only files in doctor status and explain declaration/source-only scope in help/docs. Do not reuse init's overwrite warnings.
- [x] **4. Run `pnpm test`, `pnpm run typecheck` and `pnpm run build`; inspect `node bin/index.js doctor --help`.** Running doctor here before adoption may exit 0 if everything matches; absence of the manifest alone is not an error. Do not require this repo to fail merely because Task 8 has not run.

### Task 6: Pure decisions and file-grouped prompts

**Files:** Create `src/manifest/decide.ts`, `decide.test.ts`, `src/commands/update-prompts.ts`, `update-prompts.test.ts`.

**Interfaces:** Consume `Comparison`, `Manifest`, `hashEntry`, existing prompts dependency and Task 5's diff reporter.

- `type Choice = 'overwrite' | 'keep'`; `type Action = 'write' | 'keep' | 'keep-recorded' | 'remove' | 'stamp' | 'forget'`; `interface Decision { row: Comparison; action: Action }`.
- `decide(rows: Comparison[], choices: ReadonlyMap<string, Choice>): Decision[]` is pure. Stale/missing write; in-sync stamps; obsolete removes; local edit/deletion keeps. Conflict/unknown-origin use explicit choices or keep without recording when absent. Override any dropped dependency to forget, and any still-required absent dependency to write. Forget changes no disk value.
- `nextManifest(decisions: Decision[]): Manifest` records hashed want for write/stamp/keep-recorded, old base for keep (omit when absent), and nothing for remove/forget.
- `chooseConflicts(rows: Comparison[], options: { yes: boolean; isTTY: boolean }): Promise<Map<string, Choice>>` only prompts for conflict/unknown-origin rows. `--yes` returns an empty map. Otherwise group by file and show diffs before keep-all/default, overwrite-all or review-one-by-one/default-keep. Cancellation throws a readable abort error; no TTY throws only when a prompt is needed. Never write files here.

- [x] **1. Add action/manifest tests for every state and both dependency overrides.** Explicit keep changes base to want and becomes local-edit next time; a second generator change causes conflict again. `--yes` retains old base or leaves unknown origin untracked. Safe creations/matches stamp on legacy adoption. Obsolete edited values retain base until absent or matching it; dropped dependencies are forgotten regardless of disk edits.
- [x] **2. Add prompt tests using the installed prompts API.** 261 rule edits cause one file-level prompt; keep-all and overwrite-all affect only eligible rows, not stale/local-edit/missing rows. Review-one-by-one records mixed choices. `--yes` makes no prompt; non-TTY with choices fails; non-TTY without choices proceeds. Cancel a later file choice and assert rejection with no file-writing calls or recorded manifest.
- [x] **3. Run `pnpm exec vitest run src/manifest/decide.test.ts src/commands/update-prompts.test.ts`.** Expect failure before implementation.
- [x] **4. Implement the decision and prompt interfaces.** Keep prompts asynchronous and decisions synchronous rather than passing an async prompt callback to a supposedly pure function.
- [x] **5. Repeat the targeted tests and run `pnpm run typecheck`.** Expect all pass.

### Task 7: Two-phase update and failure recovery

**Files:** Create `src/commands/update.ts`, `update.test.ts`; modify `src/index.ts`, `src/commands/init.ts` only to share workspace-warning logic if needed.

**Interfaces:** Export `update(options: { pm?: string; targetDir?: string; yes?: boolean }): Promise<number>`. Consume Tasks 1–6 and `effectiveScripts`/`generateHuskyHooks`. Register `update --yes --pm <manager>` with exit-code propagation. Workspace warnings retain init behavior; helpers must not exit the process inside a code-returning command.

- [x] **1. Add a real stale-plus-edit integration fixture.** Init a temp project, edit one rule to off, set a hook's disk bytes and manifest base to the same old content (different from current generated want), then doctor must give 1. After update --yes, that hook is current, the rule remains off and doctor gives 0. Changing only the base while disk equals want would be in-sync, not stale; do not use the old plan's invalid stale fixture.
- [x] **2. Add adoption/prompt tests.** Legacy --yes stamps matches and newly created entries, leaves differing existing entries without base, returns 0 while doctor still returns 1. Interactive keep makes those edits accepted; overwrite creates whole-file backups. Confirm late cancellation leaves all content and manifest bytes unchanged, including package entries already decided in memory.
- [x] **3. Add ordering and scope tests.** Keep a deleted typecheck or edited Next lint script, then compare hooks against resulting scripts. Hook overwrite/keep must still use its own state and choice. Recreate a deleted hook only after explicitly removing its base entry; otherwise retain deletion and doctor's failure. Create eligible missing `.gitattributes`/`tsconfig.json`, preserve existing bytes, and skip root tsconfig for rootless monorepos. Assert no workspace writes, ESLint removal, move-aside or Husky execution.
- [x] **4. Add dependency and recovery tests.** Restore husky removed after init; resolve only husky, retain every other version, and run one selected-manager install. Repeat with TypeScript alone and assert no registry lookup. With nothing missing call neither resolver nor install. Lookup failure, changed input and backup failure leave content/base unchanged. Inject failure after one completed write: report that path, retain old base and converge on rerun. Install failure writes the new base, exits 1 and prints manual install/no-auto-retry instructions; a rerun does not install again. Manifest failure exits 1 with rerun instructions. A second unchanged successful run writes no content and runs no install. Kept --yes conflicts remain gate failures in doctor.
- [x] **5. Run `pnpm exec vitest run src/commands/update.test.ts`.** Expect new cases fail, then implement this order:

  1. Load/validate once and retain original snapshot; compare and decide all non-hook entries, with file-grouped prompts.
  2. Apply only selected script writes/removals in memory with `effectiveScripts`; generate desired hooks from those scripts. Replace the original plan hook entries, compare again against the same snapshot, then decide only hook rows. Exclude hooks from phase 1 so each path has exactly one final decision.
  3. Resolve names from write decisions for absent required devDependencies. Translate presence wants into actual version entry strings only for filesystem writes; leave comparison rows as `'true'` for manifest hashing. No placeholder can reach disk.
  4. Prepare selected writes/removals plus eligible create-only files. Compute the next manifest from all final decisions, including kept/forgotten rows. Collect backup file paths from conflict/unknown-origin overwrite decisions.
  5. Recheck inputs and safe paths, complete all backups, then apply prepared writes. On content failure return 1 without saving the new base or running install.
  6. If dependencies were added, attempt install. Save the applied-content manifest after that attempt, including after install failure. Report either/both failures clearly if install and manifest both fail. Emit readiness only on success; print kept conflicts/edits/deletions and init's workspace warnings without claiming kept values were overwritten.

- [x] **6. Repeat targeted tests, then run `pnpm run lint:strict`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`.** Verify CLI help and actual exit codes using the built CLI in a temp fixture; do not apply init to this repo to test update.

### Task 8: Adopt this repo, smoke and document behavior

**Files:** Generate `.toolchain.json`; modify `scripts/smoke.sh`, `README.md`, `AGENTS.md`, `CHANGELOG.md`. Finalize the spec/plan status only after work and checks actually finish.

- [x] **1. Run the built `doctor` here before adoption and inspect every difference.** Existing generated oxlint and hooks must match generator output byte-for-byte. If any existing tracked file differs unexpectedly, stop and explain it before accepting or overwriting it. Do not hide a generator mismatch by stamping disk content.
- [x] **2. Run `node bin/index.js update --yes`, then `node bin/index.js doctor`.** Expect only the new manifest as a runtime-generated change and doctor exit 0, `0 need action`. A second update must change no content, create no backups and run no install. Keep `.toolchain.json` available for the later requested commit.
- [x] **3. Add doctor to each smoke case after scaffold and its existing lint/typecheck/format/build script loop.** Capture a per-case log and `doctor:ok`/`doctor:FAIL` like other checks. Run `pnpm run smoke`; all seven templates must report doctor:ok. This also checks scaffold's post-init formatter does not invalidate JSON hashes.
- [x] **4. Update docs.** README covers doctor/update options, CI exits, safe legacy adoption, kept local deletions, hook repair, declaration-only scope and manual install retry after failure. AGENTS adds manifest modules/commands, generated manifest output and script-before-hook ordering. CHANGELOG Unreleased lists the manifest and two commands. Leave the version number unchanged. Mark Step 2 implemented in the spec only after all checks pass; list any unrun checks as incomplete rather than marking them done.
- [x] **5. Format touched files only; run `pnpm run lint:strict`, `pnpm run typecheck`, `pnpm test`, `pnpm run build` and `git diff --check`.** Do not rerun smoke unless later changes affect its result. Review the complete diff and changed generated files. Report smoke results separately from unit tests; blocked network checks remain unverified.
- [x] **6. Stop with the validated diff ready for review.** No commit, push, merge, version bump or release unless Atharv requests it.

## Coverage and Handoff

| Spec requirement                                                           | Owning tasks |
| -------------------------------------------------------------------------- | ------------ |
| Hash/path contract, precedence, obsolete-and-gone, null vs absence         | 1            |
| Validation, no-network planning, expansion and dependency presence         | 1–2          |
| Stable JSON, backups, symlinks, modes, changed inputs, partial writes      | 3, 7         |
| Init manifest with unchanged existing bytes; scaffold inheritance          | 4, 8         |
| Doctor exits, grouped diffs, legacy hint, disk-based hooks                 | 5            |
| Recorded versus unattended keep; dependency exceptions; cancellation       | 6–7          |
| Script-before-hook ordering, create-only files, selected install, recovery | 7            |
| Repo adoption, seven-template smoke, docs and release boundary             | 8            |

Self-review: the old fake-hash fixtures, raw-JSON hashing, unconditional commits, premature hook comparison, all-dependency lookups and manifest-before-install flow have been replaced. No spec requirement is intentionally deferred. Proposed internal interfaces are defined above; tasks share the existing `Entry` representation instead of introducing a second value format.

Execution used delegated tasks with independent review after each of Tasks 1–7. Task 8 is ready for its review. The implementation remains uncommitted and unreleased.
