# `doctor` and `update` commands

Status: draft, awaiting approval. Date: 2026-11-15. Revised the same day after a grilling pass on the decision table and `--yes` (Q1 to Q7, all accepted).

## Why

`init` is the only way to apply a fix to a project that already uses the toolchain. The 2.1.1, 2.1.2 and 2.2.0 changelog entries each end with "re-run `init`", and nothing tells a project it is behind. `init` also overwrites every generated file, including edits the project made on purpose (Shikai downgrades 261 rules to `warn`; yt-prototype turns off `jsx-a11y/prefer-tag-over-role`).

So two things are missing: a way to see what is out of date, and a way to apply updates without losing local edits.

## Goals

- `doctor`: read-only. Shows, per file and per `package.json` entry, whether it is in sync, stale, locally edited, or in conflict. Exits 1 when something needs action, so CI can run it.
- `update`: applies stale entries, keeps local edits, asks about conflicts.
- Every project initialized from now on carries a base to compare against.
- `init` output stays byte-for-byte what it is today.

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

### Step 1: generators return content

Today `updatePackageJson` and `writeHuskyHooks` write to disk themselves, and `init` writes the other files inline. Change them to return what they would write; one writer applies it.

```ts
type Entry = { path: string; want: string | null }; // null = remove
type Plan = Entry[];
```

- `buildPlan(targetDir, info, pm)` collects entries from the generators. It reads the project, never writes.
- `init` builds the plan, treats every entry as "overwrite" (today's behavior), writes it, and records the manifest.
- The hook content needs the final `scripts`. The hook generator takes the effective scripts as an argument: the scripts on disk, with each script entry that will change replaced by its new value. It no longer reads `package.json` itself.
- `generateOxlintConfig` splits into an object builder and a serializer. The serializer keeps the inline `plugins` array step, so a merged config still passes `prettier --check`.

Done when: the existing tests pass unchanged, `pnpm run smoke` passes for all templates, and this repo's `.oxlintrc.json` and hooks still match generator output.

### Step 2: manifest, `doctor`, `update`

**Manifest**: `.toolchain.json` at the project root, committed, so teammates and CI share one base.

```json
{
  "entries": {
    ".oxlintrc.json#rules.no-debugger": "sha256-hex",
    "package.json#scripts.lint": "sha256-hex"
  }
}
```

`init` writes it. `scaffold` gets it through `init`. Hashes only, no content; a conflict shows disk against new, not a full three-way diff. Text is hashed with CRLF normalized to LF, so a Windows `autocrlf` checkout matches.

**Entries** (what the tool tracks):

- Whole files: `.editorconfig`, `.prettierrc`, `.prettierignore`, `commitlint.config.mjs`, `.husky/pre-commit`, `.husky/commit-msg`.
- `.oxlintrc.json`: one entry per top-level key, except `rules`, which gets one entry per rule. A project that changed one rule keeps it and still receives rules added later.
  - Each item of a string array (`plugins`, `ignorePatterns`) is its own entry, for example `.oxlintrc.json#plugins.import`, and goes through the same decision table. An item you added is untracked and stays. A new generated item is missing, so it is created. A dropped one follows the removal rule. A whole-array entry would conflict every time the generator adds an item to a project that appended one.
  - `overrides` is one whole-key entry.
- `package.json`: `scripts.<name>` for each generated script, `lint-staged`, `config.commitizen`, and the presence of each toolchain devDependency. Version ranges are not tracked.
- Create-only, never diffed once they exist: `.gitattributes`, `tsconfig.json`.

**Per-entry decision.** `base` is the manifest hash, `disk` is the current value, `want` is what the current version generates.

| base | disk vs want | disk vs base                       | state           | `update` does                                                 |
| ---- | ------------ | ---------------------------------- | --------------- | ------------------------------------------------------------- |
| any  | equal        |                                    | in sync         | stamps the manifest                                           |
| set  | differ       | equal                              | stale           | overwrites                                                    |
| set  | differ       | differ, and want equals base       | local edit      | keeps, lists                                                  |
| set  | differ       | differ, and want differs from base | conflict        | shows the diff, asks: overwrite (writes `.bak` first) or keep |
| none | differ       |                                    | unknown origin  | shows the diff, asks, same as conflict                        |
| set  | disk missing |                                    | removed locally | keeps, lists                                                  |
| none | disk missing |                                    | missing         | creates                                                       |
| set  | want absent  | equal                              | obsolete        | removes the entry                                             |
| set  | want absent  | differ                             | local edit      | keeps, lists                                                  |

**Removals.** When a version stops generating an entry (a rule, a script, a file), the entry is obsolete. It is removed only when disk still equals base. An edited entry stays as a local edit. devDependencies are never removed, whatever the generator wants.

**What "keep" records.**

- An interactive "keep" on a conflict or unknown-origin entry sets base to want. The entry then reads as a local edit (exit 0 in `doctor`), and conflicts again only when the generator changes it a second time. Without this, a decision you already made would exit 1 on every run.
- `--yes` keeps the same entries but records nothing, because nobody decided. They stay conflicts or unknown-origin.

**Prompts.** Prompts group by file, not by entry. Each differing file offers "overwrite all differing", "keep all (recorded as local edits)" and "review one by one", with keep all as the default. A legacy project with 261 downgraded rules gets one prompt for `.oxlintrc.json`, not 261.

**`--yes` on a legacy project** (no manifest): the table applies as written, so in-sync entries are stamped and differing ones get no base. `doctor` exits 1 on those until an interactive `update` runs.

**`doctor`**: prints the table above for the project, with the disk and want values (`- disk`, `+ want`) for stale, conflict and unknown-origin entries. Exit 1 if any entry is stale, conflicting, unknown-origin or missing, if a toolchain devDependency is absent, or if a `.husky/*` file is missing ("hooks missing": commits would go unchecked with no warning). Local edits and other removed-locally entries (a script, a rule) exit 0. It needs no network, since versions are not compared.

**`update`**: refuses unsupported stacks like `init` does. Applies the decisions, adds missing devDependencies (resolving their versions from the registry then), removes no devDependency, runs `<pm> install` only if dependencies changed, then writes the manifest. Prints the same workspace warnings as `init`. It exits 0 when it kept conflicts under `--yes` and prints what it kept; `doctor` is the only command that gates CI.

**Release**: ships as a minor version after 2.2.0. The version number is Atharv's call.

## Checks

- `classify(base, disk, want)` is a pure function with a table-driven test covering every row above, including the two removal rows.
- `--yes` tests: conflicts are kept and base is unchanged; on a legacy project only matching entries are stamped; `update` exits 0 with kept conflicts and `doctor` still exits 1.
- A deleted `.husky/pre-commit` makes `doctor` exit 1; a deleted script entry does not.
- Integration test on a temp project: `init`, then `doctor` reports in sync; edit a rule, `doctor` reports a local edit and exits 0; change what the generator wants, `doctor` reports stale and exits 1; `update` applies it and keeps the edit.
- This repo runs `doctor` and reports in sync, and `.toolchain.json` is committed here.
- `pnpm run smoke` runs `doctor` on each scaffolded template and expects exit 0.

## Left to the builder

- Hash algorithm and normalization details beyond CRLF.
- How the JSON-key entries are written back so the file's formatting stays stable.
- Prompt wording.
