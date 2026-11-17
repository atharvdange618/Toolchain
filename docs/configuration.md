# Configuration reference

What `init` writes, and why each piece looks the way it does.

## Files

`init` keeps an existing `.gitattributes` or `tsconfig.json`. It renames ESLint configs, an existing `.oxlintrc.json` and other commitlint variants to `.bak`, then writes the generated configs. An existing `commitlint.config.mjs` is replaced. Use [`update`](doctor-and-update.md) to preserve local edits to generated entries.

## Scripts

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

`lint-staged` runs `oxlint --fix`, then a plain `oxlint`, then Prettier, so a fix that leaves an error fails the commit with the linter's message. Expo projects match `*.{js,jsx,cjs,mjs,ts,tsx}`; every other project matches `*.{ts,tsx}`. Both oxlint steps pass `--no-error-on-unmatched-pattern`, so a commit that stages only files `.oxlintrc.json` ignores, such as `vite.config.ts` or `components/ui`, still passes.

## TypeScript

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

This runs `cz`, powered by `commitizen` and `@commitlint/cz-commitlint`. It reads the same `commitlint.config.mjs` this tool generates, so the prompt's types and rules always match what the `commit-msg` hook actually enforces. There's no separate config to keep in sync.

## Unsupported stacks

`init` refuses Vue, Nuxt, Svelte, SvelteKit, Astro and Angular instead of writing configs, and says why. Their type checkers (`vue-tsc`, `svelte-check`, `astro check`, `ngc`) embed the TypeScript compiler API. TypeScript 7 ships no such API: `typescript@7` exports its version string and nothing else, so those tools cannot load it, and `tsc --noEmit` alone would exit 0 while checking no component files. Keep those projects on TypeScript 6:

```bash
npm i -D typescript@npm:@typescript/typescript6
```

TypeScript 7.1 restores an API through new entry points and a content-mapper plugin, and Vue's language tools are already porting to it. Support here follows once the frameworks ship it.

A JavaScript-only project still gets the configs, with a warning. `.oxlintrc.json` ignores `.js` files and `lint-staged` matches only `*.{ts,tsx}`, so oxlint would check nothing. Expo is the exception: it keeps `.js` in the lint run.

## Detection logic

- **Package manager**: `init` checks `npm_config_user_agent` first (set by the package manager that invoked the CLI), then lockfiles (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb` → bun, `package-lock.json` → npm), then `devEngines` in package.json, else npm. `doctor` and `update` skip the user agent and fall back to the manager recorded in `.toolchain.json`
- **Unsupported stacks**: checks for `@angular/core`, `vue`, `nuxt`, `svelte`, `@sveltejs/kit` and `astro`, and refuses to write anything
- **TypeScript files**: scans up to six levels deep for `.ts`, `.tsx`, `.mts` or `.cts`, skipping `node_modules`, build output and `.git`
- **Monorepo**: checks for `workspaces` in package.json or a `packages:` list in `pnpm-workspace.yaml`
- **Framework**: checks `dependencies` / `devDependencies` for `expo`, `next`, `express`, then `react`
