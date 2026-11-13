# Changelog

Notable changes to `@atharvdange/toolchain`. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [SemVer](https://semver.org/).

## [2.1.2] - 2026-11-13

### Fixed

- Next.js 15.5 and later get `next typegen &&` in front of `lint`, `lint:fix` and `lint:strict`, as `typecheck` already had. Type-aware oxlint reads `RouteContext` from files only `next typegen` writes, so on a fresh checkout or in CI every `context.params` failed as an error-typed value (`no-unsafe-assignment`, `no-unsafe-member-access`).
- The pre-commit hook runs `next typegen` before `lint-staged` in those projects. `lint-staged` calls oxlint directly, so the typegen in the `lint` script never ran there.

### Notes

- Re-run `init` in a Next.js project set up with 2.1.1 or earlier to pick up the new scripts and hook.

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

See "Upgrading from v1" in the README for the TS 7 `tsconfig` fixes and the full list of what `init` changes.

## Earlier versions

1.x shipped ESLint and is no longer maintained. The 1.x tags in this repository have that history.
