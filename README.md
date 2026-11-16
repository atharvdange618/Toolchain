# `@atharvdange/toolchain`

A CLI that sets up oxlint, Prettier, Husky, commitlint and strict TypeScript 7 in Next.js, React, Expo, Express and plain TS projects with one command.

```bash
pnpm dlx @atharvdange/toolchain init
```

Release notes live in [CHANGELOG.md](CHANGELOG.md).

## Features

- **Framework-aware** - detects Next.js, Expo, Express, React, or plain TS and picks the oxlint plugins and rules to match
- **Refuses stacks it cannot check** - Vue, Nuxt, Svelte, SvelteKit, Astro and Angular get a clear refusal instead of a `typecheck` that passes while checking no component files
- **Monorepo-ready** - detects `workspaces` / `pnpm-workspace.yaml`, keeps type-aware lint on for workspace imports that resolve through tsconfig `references`, and lists workspace packages still on ESLint or TypeScript below 7
- **Zero-config** - interactive prompts guide you through, or use `--yes` to skip
- **All in one** - linter, formatter, hooks, commit linting, and type checking
- **Project scaffolding** - create new projects from scratch with `scaffold` command
- **Windows-safe** - writes `.gitattributes` so `format:check` passes on a CRLF checkout, and leaves the large-commit chunking to `lint-staged`, which splits the staged files before Windows' 8191-character command line runs out
- **Opinionated defaults** - strict TypeScript config, type-aware lint rules, proper monorepo structure

## What it supports

| Project                                      | Status    |
| -------------------------------------------- | --------- |
| Next.js                                      | Runs      |
| Vite + React                                 | Runs      |
| Expo / React Native                          | Runs      |
| Express                                      | Runs      |
| Plain TypeScript library or Node app         | Runs      |
| pnpm or Turborepo monorepo                   | Runs      |
| Vue, Nuxt, Svelte, SvelteKit, Astro, Angular | Refused   |
| Flutter, native Kotlin or Swift              | Unrelated |

`init` refuses the refused row instead of writing configs, and says why. Their type checkers (`vue-tsc`, `svelte-check`, `astro check`, `ngc`) embed the TypeScript compiler API. TypeScript 7 ships no such API: `typescript@7` exports its version string and nothing else, so those tools cannot load it, and `tsc --noEmit` alone would exit 0 while checking no component files. Keep those projects on TypeScript 6:

```bash
npm i -D typescript@npm:@typescript/typescript6
```

TypeScript 7.1 restores an API through new entry points and a content-mapper plugin, and Vue's language tools are already porting to it. Support here follows once the frameworks ship it.

A JavaScript-only project still gets the configs, with a warning. `.oxlintrc.json` ignores `.js` files and `lint-staged` matches only `*.{ts,tsx}`, so oxlint would check nothing. Expo is the exception: it keeps `.js` in the lint run.

## Commands

### `init` - Add toolchain to existing project

```bash
# Interactive
pnpm dlx @atharvdange/toolchain init

# Non-interactive (defaults)
pnpm dlx @atharvdange/toolchain init --yes

# Pick the package manager for installs
pnpm dlx @atharvdange/toolchain init --pm bun
```

`init` refuses a project built on Vue, Nuxt, Svelte, SvelteKit, Astro or Angular, and exits 1 without writing anything. It also warns, but still writes the configs, when the project has no TypeScript file yet.

`init` also writes `.toolchain.json`, which records hashes of the generated entries for later comparison. Commit it with the configs. For a project already using the toolchain, use `update` to keep local changes.

### `doctor` - Check the current toolchain

```bash
pnpm dlx @atharvdange/toolchain doctor
pnpm dlx @atharvdange/toolchain doctor --pm pnpm
```

`doctor` compares the current generators, disk and `.toolchain.json` without writes, registry lookups, installs or Husky setup. It shows changes by file and entry, with `- disk` and `+ want` lines.

In CI, exit 0 means no tracked entry needs action. Local edits, intentional deletions other than required dependencies/hooks, and obsolete entries pass. Stale, conflicting, unknown-origin or missing entries exit 1, as do missing required devDependencies or hook source files. Invalid input, unsupported stacks and I/O failures also exit 1. A missing manifest alone does not fail if every generated entry matches.

The check covers root `devDependencies` declarations, not installed packages, working tools or registry versions. It checks `.husky/pre-commit` and `.husky/commit-msg`, not `.husky/_` or Git hook activation. Create-only `.gitattributes` and `tsconfig.json` stay outside the manifest and doctor checks. In a monorepo, both commands only change or compare the root toolchain; workspace warnings do not migrate packages.

### `update` - Apply changes and keep local edits

```bash
# Review conflicts interactively
pnpm dlx @atharvdange/toolchain update

# Apply safe changes and keep unresolved conflicts
pnpm dlx @atharvdange/toolchain update --yes --pm pnpm
```

`update` applies stale or missing entries, preserves local edits and deletions, and prompts for conflicting or unknown-origin entries by file. Choices are keep all, overwrite all differing or review one by one; keep is the default. An interactive keep records the current generator as the base. `--yes` keeps those entries without recording a choice, so `update` can exit 0 while `doctor` still exits 1. Without `--yes`, a required prompt needs a terminal; cancellation aborts before writes.

For a project without `.toolchain.json`, run `doctor` first, then interactive `update`. Matching entries get a base automatically; differing entries need your choice because there is no earlier base. Review the diff and commit the manifest with the resulting configs. Re-running `init` would replace generated configs and scripts, so use it only when you want that reset.

Deleted scripts and hooks stay deleted. A deleted required hook still fails `doctor`: restore it from Git, or remove just its path from `.toolchain.json`'s `entries` object and run `update` to recreate it. Hooks follow the scripts you keep, including deleted `typecheck` scripts. Missing required devDependencies are the exception: `update` restores them even after a local deletion, keeps existing version ranges, and never removes a dependency.

`update` resolves only missing required packages before writes and runs `<pm> install` only after adding their declarations. It does not move configs aside or run a separate Husky setup command. That install can run an existing `prepare` lifecycle script, including `husky`. Conflict overwrites get a full-file backup (`.bak`, then `.bak.1`, and so on); existing backups survive. There is no cross-file rollback or support for concurrent writers.

If install fails, `update` still saves the manifest for the applied content, exits 1 and prints the manual retry command, such as `pnpm install`. Run that command yourself: another `update` sees the declarations and will not retry install. A green `doctor` does not prove install succeeded.

If a content write fails, `update` retains the old manifest and runs no install. When new dependency declarations were already written, it prints the selected manager's manual install command. Run that command yourself too: rerunning `update` will not install those declared dependencies.

Both commands accept `--pm bun|npm|pnpm|yarn`; otherwise they use the [existing detection order](#detection-logic).

### `scaffold` - Create a new project

```bash
# Create a React project with npm
pnpm dlx @atharvdange/toolchain scaffold my-app --template react --pm npm

# Create a Next.js project with pnpm
pnpm dlx @atharvdange/toolchain scaffold my-app --template nextjs --pm pnpm

# Create a plain TypeScript project
pnpm dlx @atharvdange/toolchain scaffold my-app --template plain

# Create a monorepo with Turborepo
pnpm dlx @atharvdange/toolchain scaffold my-app --template turbo --pm pnpm

# Interactive template selection
pnpm dlx @atharvdange/toolchain scaffold my-app
```

#### Available templates

| Template        | Description                                     | Source                 |
| --------------- | ----------------------------------------------- | ---------------------- |
| `plain`         | Basic TypeScript project                        | Generated by toolchain |
| `react`         | React 19 with Vite and TypeScript               | `create-vite`          |
| `nextjs`        | Next.js 15 with App Router                      | `create-next-app`      |
| `express`       | Express 5 REST API with TypeScript              | Generated by toolchain |
| `pnpm-monorepo` | pnpm workspaces monorepo with apps and packages | Generated by toolchain |
| `turbo`         | Turborepo monorepo with apps and packages       | Generated by toolchain |

#### Package managers

Use `--pm` to specify the package manager: `npm`, `pnpm`, `yarn`, or `bun`.

> **Note:** React and Next.js projects use their official scaffolding tools (`create-vite` and `create-next-app`), then the toolchain is added on top. With `--yes`, those tools run without prompts: Vite gets the `react-ts` template, Next.js gets TypeScript and the App Router, and other choices fall back to the tool's defaults. These templates run the tool through `npx`, `pnpm dlx`, `yarn dlx` (Yarn 2+), or `bunx`.

> **Note:** `pnpm-monorepo` template requires `pnpm` and will override `--pm` if set to a different package manager.

#### Monorepo structure

Both `pnpm-monorepo` and `turbo` templates generate a standard monorepo structure:

```
my-app/
├── apps/
│   ├── web/          # Web application
│   ├── mobile/       # Mobile application
│   └── api/          # API server
├── packages/
│   ├── shared/       # Shared utilities (logger, formatDate)
│   ├── config/       # Environment configuration (typed)
│   └── db/           # Database client
├── pnpm-workspace.yaml
├── turbo.json        # (turbo only)
└── package.json
```

Each package has its own `package.json`, `tsconfig.json`, and source files with workspace dependencies wired up.

## What it sets up

| Config                            | Generated variant                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `.editorconfig`                   | Static                                                                                                    |
| `.prettierrc` / `.prettierignore` | Static                                                                                                    |
| `.gitattributes`                  | `* text=auto eol=lf`, so `format:check` passes on a Windows checkout                                      |
| `commitlint.config.mjs`           | Static                                                                                                    |
| `.oxlintrc.json`                  | Plain TS / React / Next.js / Expo / Express rules, ignores `.expo/`                                       |
| `tsconfig.json`                   | Strict config, only written when the project has none                                                     |
| `.husky/pre-commit`               | `lint-staged` + `typecheck` + `test` (when a test script exists); Next.js 15.5+ runs `next typegen` first |
| `.husky/commit-msg`               | `commitlint`                                                                                              |
| `package.json`                    | Scripts, `lint-staged` config, `config.commitizen`, devDependencies                                       |
| `.toolchain.json`                 | Hashes of generated entries for `doctor` and `update`                                                     |

`init` keeps an existing `.gitattributes` or `tsconfig.json`. It renames ESLint configs, an existing `.oxlintrc.json` and other commitlint variants to `.bak`, then writes the generated configs. An existing `commitlint.config.mjs` is replaced. Use `update` to preserve local edits to generated entries.

## Scripts it adds

| Script         | Command                    | Notes                                                                                                 |
| -------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `lint`         | `oxlint .`                 | Type-aware rules come from `.oxlintrc.json`, not the flag; Next.js 15.5+ runs `next typegen &&` first |
| `lint:fix`     | `oxlint . --fix`           |                                                                                                       |
| `lint:strict`  | `oxlint . --deny-warnings` | Turns warnings into errors, including the Expo compiler rules                                         |
| `format`       | `prettier --write .`       |                                                                                                       |
| `format:check` | `prettier --check .`       |                                                                                                       |
| `typecheck`    | `tsc --noEmit`             | `tsc -b` when the root tsconfig has project references; Next.js 15.5+ runs `next typegen &&` first    |
| `commit`       | `cz`                       | Interactive commit prompt                                                                             |
| `prepare`      | `husky`                    | Reinstalls the hooks                                                                                  |

On Next.js 15.5 and later, `lint`, `lint:fix` and `lint:strict` run `next typegen` first, like `typecheck`. Type-aware oxlint reads `RouteContext` from the files it writes, and on a fresh checkout every `context.params` would otherwise fail as an error-typed value. The pre-commit hook runs `next typegen` before `lint-staged` for the same reason.

`lint-staged` runs `oxlint --fix`, then a plain `oxlint`, then Prettier, so a fix that leaves an error fails the commit with the linter's message. Expo projects match `*.{js,jsx,cjs,mjs,ts,tsx}`; every other project matches `*.{ts,tsx}`.

## TypeScript configuration

The generated `tsconfig.json` includes strict options:

| Option                               | Description                                       |
| ------------------------------------ | ------------------------------------------------- |
| `strict`                             | Enable all strict type-checking options           |
| `noUnusedLocals`                     | Error on unused local variables                   |
| `noUnusedParameters`                 | Error on unused function parameters               |
| `noFallthroughCasesInSwitch`         | Error on fallthrough cases in switch statements   |
| `noUncheckedIndexedAccess`           | Add `undefined` to any untyped index access       |
| `noImplicitOverride`                 | Require `override` keyword in derived classes     |
| `exactOptionalPropertyTypes`         | Distinguish between `undefined` and missing props |
| `noPropertyAccessFromIndexSignature` | Force bracket notation for index signatures       |
| `verbatimModuleSyntax`               | Enforce `import type` for type-only imports       |
| `moduleResolution: bundler`          | Modern module resolution for bundlers             |

Node apps (the `plain` and `express` templates) get `NodeNext` resolution and compile `src` to `dist` instead of `bundler`. The monorepo templates write a solution-style root `tsconfig.json` (`files: []` plus a `references` entry per package), and each package has its own `composite: true` config. `init` leaves a monorepo's `tsconfig.json` alone when there is one and writes none when there isn't, because an empty root config makes tsc check every package with the wrong options.

## Lint rules

The generated `.oxlintrc.json` picks its plugins from what's in your `package.json`:

| Detected | Plugins                                      |
| -------- | -------------------------------------------- |
| Plain TS | `typescript`, `unicorn`, `import`            |
| React    | Above + `react`, `jsx-a11y`                  |
| Next.js  | Above + `nextjs`                             |
| Expo     | Same as React, plus the React Compiler rules |
| Express  | Same as Plain TS, `no-unsafe-*` set to warn  |

Every config turns on oxlint's `correctness` category plus the typescript-eslint recommended and type-checked rules that oxlint leaves off by default. Type-aware rules run through `oxlint-tsgolint`, which uses TypeScript 7. Monorepos included: `oxlint-tsgolint` follows a tsconfig `references` entry to the other package's source, so nothing has to be built first.

When `init` finds a workspace import that resolves to neither a reference nor a built `.d.ts`, it names the imports and leaves the config alone. Every use of such an import reports under the `no-unsafe-*` rules until it resolves, which is what `typecheck` reports on the same tree. To fix it, add the dependency to the importing package's `tsconfig.json`:

```json
{ "references": [{ "path": "../../packages/shared" }] }
```

A reference needs no build at any point. Building the packages works too, but the `.d.ts` has to exist whenever lint runs, so a fresh clone or CI needs that build as well.

From the import plugin, only `no-cycle`, `no-duplicates` and `no-self-import` are on. `tsc` already catches unresolved imports.

Expo configs also turn `typescript/no-require-imports` off (Metro resolves assets through `require()`) and drop `react/rules-of-hooks` to warn inside `*.test.{ts,tsx}`, where `renderHook` helpers call hooks from callbacks. The React Compiler rules set is on at warn; `lint:strict` turns warnings into errors.

**Ignored:** `node_modules`, `dist`, `.next`, `build`, `.expo`, `.pnpm-store`, `components/ui`, `*.config.*`, `.env*`, and plain JS files. Monorepos also ignore `packages/*/dist`. Expo projects keep `.js` files in the run.

## Commit messages

Every generated project gets an interactive commit prompt on top of commitlint's enforcement:

```bash
pnpm run commit
```

This runs `cz`, powered by `commitizen` and `@commitlint/cz-commitlint`. It reads the same `commitlint.config.mjs` this tool generates, so the prompt's types and rules always match what the `commit-msg` hook actually enforces - there's no separate config to keep in sync.

## Detection logic

- **Package manager**: checks `npm_config_user_agent` first (set by the package manager that invoked the CLI), then lockfiles (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb` → bun), then `devEngines` in package.json, else npm
- **Unsupported stacks**: checks for `@angular/core`, `vue`, `nuxt`, `svelte`, `@sveltejs/kit` and `astro`, and refuses to write anything
- **TypeScript files**: scans up to six levels deep for `.ts`, `.tsx`, `.mts` or `.cts`, skipping `node_modules`, build output and `.git`
- **Monorepo**: checks for `workspaces` in package.json or a `packages:` list in `pnpm-workspace.yaml`
- **Framework**: checks `dependencies` / `devDependencies` for `expo`, `next`, `express`, then `react`

## Upgrading from 2.1 or 2.0

Adopt the manifest and review changes with:

```bash
pnpm dlx @atharvdange/toolchain@latest doctor
pnpm dlx @atharvdange/toolchain@latest update
```

Without a manifest, differing existing entries appear as unknown-origin. Review them before choosing overwrite or keep. `update --yes` preserves them but leaves them needing action in `doctor`.

From 2.0, the generated changes include the second `oxlint` pass in `lint-staged` and the Expo config and glob. From 2.1, a monorepo can pick up type-aware lint, which 2.1 left off. If workspace warnings name imports that don't resolve, add the dependency to the importing package's `tsconfig.json` `references`, as described under [Lint rules](#lint-rules). Existing dependency ranges stay unchanged; handle version upgrades separately.

Full notes for both are in [CHANGELOG.md](CHANGELOG.md).

## Upgrading from v1

v2 replaces ESLint with oxlint and moves TypeScript to 7. typescript-eslint doesn't support TypeScript 7, which kept every v1 project a major version behind. To upgrade, run `init` again in the v1 project:

```bash
pnpm dlx @atharvdange/toolchain@2 init
```

`init` then:

- renames `eslint.config.*`, `.eslintrc.*` and an existing `.oxlintrc.json` to `.bak` and writes a new `.oxlintrc.json`
- removes ESLint packages from `devDependencies` (`eslint`, `@eslint/*`, `typescript-eslint`, `eslint-plugin-*` and the like)
- renames v1's `commitlint.config.js` to `.bak` and writes `commitlint.config.mjs`
- sets `typescript` to `^7.0.2`
- adds `test` to the pre-commit hook when the project has a test script

Delete the `.bak` files once you've moved over any custom rules you want to keep.

**TypeScript 7 tsconfig fixes.** TypeScript 7 drops these options, so remove or replace them if `typecheck` fails:

| Option                         | Fix                                               |
| ------------------------------ | ------------------------------------------------- |
| `baseUrl`                      | Remove it; write `paths` relative to the tsconfig |
| `moduleResolution: node`       | Use `bundler`, or `nodenext` for Node apps        |
| `target: es5`                  | Use `ES2015` or later                             |
| `outFile`                      | Use a bundler                                     |
| `module: amd`, `umd`, `system` | Use `esnext`, or `nodenext` for Node apps         |

**Dropped rules.** oxlint has no port of these, so v2 lints without them:

- `eslint-plugin-perfectionist` (import and key sorting)
- `eslint-plugin-react-you-might-not-need-an-effect`
- `import-x/no-useless-path-segments`

**Monorepos.** `init` only changes the root. It lists workspace packages that still use ESLint or pin TypeScript below 7, but leaves their scripts and dependencies alone. The root `oxlint .` lints those packages now, so you can remove their ESLint setups. A monorepo with no root `tsconfig.json` keeps its own `typecheck` script.

## Troubleshooting

### Husky hooks not running after `git init`

If you delete `.git` and re-initialize with `git init`, husky hooks will stop working. Run:

```bash
pnpm run prepare
```

This reconfigures `core.hooksPath` to point to `.husky`.

### npx fails with `EBADDEVENGINES`

`npx @atharvdange/toolchain init` will **not** work when the package's `packageManager` is set to `pnpm` (if you initialized a blank project with `pnpm init`), causing npm to throw an `EBADDEVENGINES` error. Use `pnpm dlx`, `yarn dlx`, or `bunx` instead.

### `format:check` fails on a Windows checkout

With `core.autocrlf=true`, checkout files are CRLF and Prettier expects LF, so it reports files nobody edited. 2.1 writes `.gitattributes` with `* text=auto eol=lf` to prevent it. If the project predates that, add the file and re-check the files out:

```bash
git rm --cached -r . && git reset --hard
```

## Author

- X: [@atharvdangedev](https://x.com/atharvdangedev)
- GitHub: [atharvdange618](https://github.com/atharvdange618)
