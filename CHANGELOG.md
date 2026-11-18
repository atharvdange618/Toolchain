# Changelog

Notable changes to `@atharvdange/toolchain`. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [SemVer](https://semver.org/).

## [Unreleased]

### Changed

- The CLI requires Node.js 20.12.0 or later. Clack handles interactive prompts and groups setup output. Install, registry lookup, and scaffold steps show progress in a terminal and stream plain output when redirected.
- Cancelling an interactive prompt or running task exits 130. `init` requires `--yes` without a terminal, and `scaffold` requires `--template` there. The Next.js scaffold runs the create-next-app prompts when you omit `--yes`.

### Removed

- The interactive commit prompt: the `commit` script, `config.commitizen`, and the `commitizen` and `@commitlint/cz-commitlint` devDependencies. Every `commitizen` release pins `glob@7.2.3`, so each npm install printed deprecation warnings for `glob` and `inflight` (#10). The `commit-msg` hook still enforces the format. `update` removes the script and config when unedited; see [Upgrading](docs/upgrading.md#from-22) to remove the packages.

### Fixed

- `init` no longer prints `ERESOLVE overriding peer dependency` on npm for the ESLint packages it removes. With a `package-lock.json`, it runs `npm uninstall` on them before moving TypeScript to 7, so npm prunes the old typescript-eslint tree before it checks peers. A fresh `create-next-app` project went from 8 warnings to none. ([#11](https://github.com/atharvdange618/toolchain/issues/11))
- `init` and `scaffold` failed on npm 12 with "Could not resolve the latest version ... Check your network connection", although the registry answered. npm 12 wraps `npm view --json` output in a one-element array, and the version lookup rejected arrays. It now reads the object inside, and the error names the underlying reason, so a parse failure no longer reads as a network problem. ([#15](https://github.com/atharvdange618/toolchain/issues/15))

## [2.2.0] - 2026-11-17

### Added

- `.toolchain.json` records generated-entry hashes and the package manager used for the hooks on `init` and `scaffold`, giving later updates a shared base without changing the existing generated files. `doctor` and `update` use a lockfile or `devEngines` before that record, and ignore the package manager that invoked them, so checking an npm project through `pnpm dlx` reports no drift.
- `doctor` reports tracked config drift without writes or network access and exits 1 when entries need action, for use in CI. It checks root dependency declarations and hook sources, not installed tools or Git hook activation.
- `update` applies safe changes, preserves local edits and deletions, and asks about conflicts. `--yes` keeps unresolved conflicts without recording a choice. It restores missing required devDependencies and installs only when adding them; failed installs need the printed manual retry.
- `update --keep <path>` and `--overwrite <path>` choose for conflicting and unknown-origin entries without a prompt, so an agent or script can adopt a project with no terminal. Both repeat, and `*` is allowed after the `#` (`'.oxlintrc.json#rules.*'`) but not in the file name, so one pattern covers at most one file. A keep is recorded like an interactive one. A path that matches nothing, or an entry matched by both flags, fails before any write. Without a terminal, `update` prints the full command to rerun, using the project's own runner (`npx --yes`, `bunx`, `pnpm dlx` or `yarn dlx`), and `update --yes` ends with the command that records what it kept.
- `doctor` ends with a `Next:` line holding the `update` command that resolves its findings, run through the project's own package manager, with a `--keep` for each conflicting or unknown-origin entry. It prints none when nothing needs action and the manifest exists.
- `doctor --json` prints one JSON document instead of the report, with the manifest flag, whether anything needs action, the `Next:` command and every compared entry's state and content. Errors leave stdout empty, so a script can parse whatever it gets.
- `doctor` and `update` treat an `.oxlintrc.json` rule set stricter than the generated one, such as `error` where the generator writes `warn`, as a local edit. `doctor` passes it and notes that keeping it is safe, and `update` keeps it without asking. A rule still at an older generated value updates as before, and a rule with options (`["error", {...}]`) is still compared as a whole.
- Monorepos get the type-aware rules too. `oxlint-tsgolint` follows a package's tsconfig `references` entry to the other package's source, so nothing has to be built first. Before this, `init` turned type-aware lint off for every monorepo.

### Changed

- `init` resolves dependency versions before writing, so a failed lookup leaves the project untouched. Before this, the config files were already written when the lookup ran.
- `init` prints its warnings and notes together before writing, and reports 4 steps instead of 8. The files it writes are unchanged.
- `init` names the workspace imports that type-aware lint can't resolve, meaning those with neither a tsconfig `references` entry in the importing package nor a built `.d.ts`. They report under the `no-unsafe-*` rules until fixed, which is also what `typecheck` reports on that tree, so the config no longer changes to avoid them.

### Fixed

- A commit that staged only files `.oxlintrc.json` ignores, such as `vite.config.ts`, `next.config.ts` or a `components/ui` file, failed the pre-commit hook: oxlint found nothing to lint and exited 1. Both oxlint steps in `lint-staged` now pass `--no-error-on-unmatched-pattern`, and real lint errors still fail the commit. `update` applies it to an unedited `lint-staged` with no prompt. ([#7](https://github.com/atharvdange618/toolchain/issues/7))

### Notes

- Run `doctor`, then interactive `update` to adopt a project without a manifest and review the new `.oxlintrc.json`. A monorepo whose packages neither reference each other nor get built before lint will report those imports; a `references` entry fixes it with no build step.

## [2.1.2] - 2026-11-13

### Fixed

- Next.js 15.5 and later get `next typegen &&` in front of `lint`, `lint:fix` and `lint:strict`, as `typecheck` already had. Type-aware oxlint reads `RouteContext` from files only `next typegen` writes, so on a fresh checkout or in CI every `context.params` failed as an error-typed value (`no-unsafe-assignment`, `no-unsafe-member-access`).
- The pre-commit hook runs `next typegen` before `lint-staged` in those projects. `lint-staged` calls oxlint directly, so the typegen in the `lint` script never ran there.

### Notes

- Re-run `init` in a Next.js project set up with 2.1.1 or earlier to pick up the new scripts and hook.
- 2.1.1 was tagged in git but never reached the registry, so npm goes from 2.1.0 to 2.1.2. Its fix is in this release.

## [2.1.1] - 2026-11-12

### Fixed

- Next.js 15.5 and later get `typecheck: "next typegen && tsc --noEmit"`. Plain `tsc --noEmit` failed with TS2304 on `RouteContext`, `LayoutProps` and `PageProps`, which only `next typegen` or a dev or build run writes. Older Next keeps plain `tsc`, since it has no `typegen` command.

## [2.1.0] - 2026-11-10

### Added

- Expo and React Native are detected as their own framework. Their config keeps `.js` in the lint run, turns `typescript/no-require-imports` off for Metro's assets, sets the React Compiler rules to warn, drops `react/rules-of-hooks` to warn inside `*.test.{ts,tsx}`, and makes `lint-staged` match `*.{js,jsx,cjs,mjs,ts,tsx}`.
- `.gitattributes` with `* text=auto eol=lf` and `*.sh text eol=lf`, so `format:check` passes on a Windows checkout with `core.autocrlf=true`. An existing file stays, since it may carry LFS filters.
- `init` warns when the project has no `.ts`, `.tsx`, `.mts` or `.cts` file, naming the ignore pattern and `lint-staged` glob that would make a green run check nothing.
- Every run ends with the stacks it supports, and the README has a support matrix.

### Changed

- `init` refuses Vue, Nuxt, Svelte, SvelteKit, Astro and Angular projects before writing anything. Their checkers (`vue-tsc`, `svelte-check`, `astro check`, `ngc`) embed the TypeScript compiler API, which TypeScript 7 does not ship, so the generated `typecheck` would exit 0 while checking no component files.
- `lint-staged` runs `oxlint --fix`, then a plain `oxlint`, then Prettier. A fix that leaves an error, such as a binding orphaned by an import merge, fails the commit with oxlint's message.

### Notes

- No changes to the generated `tsconfig.json`, scripts or dependency set. Re-run `init` in a 2.0 project to pick up the new files.

## [2.0.1] - 2026-11-10

### Fixed

- `build` clears `dist/` before compiling, so files from deleted modules cannot ship in the tarball.

## [2.0.0] - 2026-11-10

### Changed

- ESLint is replaced by oxlint and oxlint-tsgolint. One linter, one config (`.oxlintrc.json`), no ESLint fallback. Reason: typescript-eslint peers on TypeScript below 6.1, which kept every generated project a major version behind.
- TypeScript moves to `^7.0.2`. The generated config emits nothing TypeScript 7 dropped (`baseUrl`, `moduleResolution: node`, `target: es5`).
- The pre-commit hook runs tests when the project has a `test` script (skipping npm's "no test specified" placeholder).
- An interactive commit prompt (`pnpm run commit`, commitizen via `@commitlint/cz-commitlint`) comes with every project.
- `init` moves existing ESLint, commitlint and oxlint configs to `.bak` instead of deleting them, removes ESLint devDependencies, and in a monorepo lists workspace packages still on ESLint or on TypeScript below 7.

### Removed

- `eslint-plugin-perfectionist`, `eslint-plugin-react-you-might-not-need-an-effect` and `import-x/no-useless-path-segments`. oxlint has no port of them.

### Upgrade notes

See [docs/upgrading.md](docs/upgrading.md#from-v1) for the TS 7 `tsconfig` fixes and the full list of what `init` changes.

## Earlier versions

1.x shipped ESLint and is no longer maintained. The 1.x tags in this repository have that history.
