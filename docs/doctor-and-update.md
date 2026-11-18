# `doctor` and `update`

`init` writes `.toolchain.json`, which records hashes of the generated entries and the package manager the hooks were generated for. Commit it with the configs. `doctor` and `update` compare against it, so a project already on the toolchain can pick up generator changes without losing local edits.

## `doctor`

```bash
pnpm dlx @atharvdange/toolchain doctor
pnpm dlx @atharvdange/toolchain doctor --pm pnpm
pnpm dlx @atharvdange/toolchain doctor --json
```

`doctor` compares the current generators, disk and `.toolchain.json` without writes, registry lookups, installs or Husky setup. It shows changes by file and entry, with `- disk` and `+ want` lines. When something needs action or the project has no manifest, it ends with a `Next:` line holding the `update` command to run, with a `--keep` for every conflicting or unknown-origin entry; swap any of them for `--overwrite` to take the generated value.

`--json` prints one JSON document to stdout instead of the report, for scripts and agents: `manifest`, `needsAction`, `next` (the same command, or `null`) and `rows`. Each row has `path`, `state`, `disk` and `want` (the entry's content, or `null` when absent), `needsAction`, and `stricter` (a rule set stricter than generated). The exit codes stay the same. Errors go to stderr and leave stdout empty.

Both commands resolve the package manager from `--pm`, then the project itself (a lockfile or `devEngines`), then the value recorded in `.toolchain.json`, then npm. The package manager that ran the CLI does not count, so `pnpm dlx @atharvdange/toolchain doctor` checks an npm project against its own hooks instead of reporting them stale.

### Exit codes

In CI, exit 0 means no tracked entry needs action. Local edits, intentional deletions other than required dependencies/hooks, and obsolete entries pass. Stale, conflicting, unknown-origin or missing entries exit 1, as do missing required devDependencies or hook source files. Invalid input, unsupported stacks and I/O failures also exit 1. A missing manifest alone does not fail if every generated entry matches.

### What it checks

The check covers root `devDependencies` declarations, not installed packages, working tools or registry versions. It checks `.husky/pre-commit` and `.husky/commit-msg`, not `.husky/_` or Git hook activation. Create-only `.gitattributes` and `tsconfig.json` stay outside the manifest and doctor checks. In a monorepo, both commands only change or compare the root toolchain; workspace warnings do not migrate packages.

## `update`

```bash
# Review conflicts interactively
pnpm dlx @atharvdange/toolchain update

# Apply safe changes and keep unresolved conflicts
pnpm dlx @atharvdange/toolchain update --yes --pm pnpm
```

`update` applies stale or missing entries, preserves local edits and deletions, and prompts for conflicting or unknown-origin entries by file. Choices are keep all, overwrite all differing or review one by one; keep is the default. An interactive keep records the current generator as the base. `--yes` keeps those entries without recording a choice, so `update` can exit 0 while `doctor` still exits 1. Without `--yes`, a required prompt needs a terminal; cancellation aborts before writes.

### Choosing without a prompt

Pass `--keep <path>` or `--overwrite <path>` for each conflicting or unknown-origin entry, using the paths `doctor` prints. Both flags repeat. A `*` matches any text after the `#`, so `'.oxlintrc.json#rules.*'` covers every rule in that file, but the file name must be written out: `--keep '*'` is rejected, so you can't keep every entry without naming them. A flag keep is recorded like an interactive one. A path that matches no differing entry, or an entry matched by both flags, fails before any write.

```bash
pnpm dlx @atharvdange/toolchain update --pm pnpm --keep '.prettierrc' --overwrite '.oxlintrc.json#rules.*'
```

With no terminal and no `--yes`, `update` stops before writing and prints the command to rerun, with a `--keep` for each open entry plus every flag you already passed. The command uses your project's runner (`npx --yes`, `bunx`, `pnpm dlx` or `yarn dlx`) and quotes paths for a POSIX shell such as Git Bash. After `update --yes` keeps entries without a choice, it prints the same kind of command as `Next:`.

### Projects without a manifest

Run `doctor` first, then interactive `update` or the command on its `Next:` line. Matching entries get a base automatically; differing entries need your choice because there is no earlier base. Review the diff and commit the manifest with the resulting configs. Re-running `init` would replace generated configs and scripts, so use it only when you want that reset.

### Deletions

Deleted scripts and hooks stay deleted. A deleted required hook still fails `doctor`: restore it from Git, or remove just its path from `.toolchain.json`'s `entries` object and run `update` to recreate it. Hooks follow the scripts you keep, including deleted `typecheck` scripts. Missing required devDependencies are the exception: `update` restores them even after a local deletion, keeps existing version ranges, and never removes a dependency.

### Installs, backups and failures

`update` resolves only missing required packages before writes and runs `<pm> install` only after adding their declarations. It does not move configs aside or run a separate Husky setup command. That install can run an existing `prepare` lifecycle script, including `husky`. Conflict overwrites get a full-file backup (`.bak`, then `.bak.1`, and so on); existing backups survive. There is no cross-file rollback or support for concurrent writers.

If install fails or you cancel it, `update` still saves the manifest for the applied content and prints the manual retry command, such as `pnpm install`. Run that command to finish installing. A rerun of `update` sees the declarations and skips install. A green `doctor` checks the declarations and hook sources.

If a content write fails, `update` retains the old manifest and runs no install. When new dependency declarations were already written, it prints the selected manager's manual install command. Run that command yourself too: rerunning `update` will not install those declared dependencies.

### Exit codes

- **0** when update completes, including when `--yes` keeps conflicts without recording a choice.
- **1** when update fails, including an install failure.
- **130** when you cancel an update prompt, registry lookup, or install.

Both commands accept `--pm bun|npm|pnpm|yarn`; otherwise they use the [detection order](configuration.md#detection-logic).
