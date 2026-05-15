# `@atharvdange/toolchain`

A reusable CLI that scaffolds a complete dev toolchain - ESLint, Prettier, Husky, commitlint, and strict TypeScript - into any JS/TS project with one command.

```bash
npx @atharvdange/toolchain init
```

## Features

- **Framework-aware** - detects Next.js, Express, React, or plain TS and tailors ESLint rules accordingly
- **Monorepo-ready** - detects `workspaces` / `pnpm.workspaces` and generates tsconfig project references with per-package eslint overrides
- **Zero-config** - interactive prompts guide you through, or use `--yes` to skip
- **All in one** - linter, formatter, hooks, commit linting, and type checking

## What it sets up

| Config                            | Generated variant                                 |
| --------------------------------- | ------------------------------------------------- |
| `.editorconfig`                   | Static                                            |
| `.prettierrc` / `.prettierignore` | Static                                            |
| `commitlint.config.js`            | Static                                            |
| `eslint.config.mjs`               | Plain TS / React / Next.js / Express rules        |
| `tsconfig.json`                   | Flat strict config or monorepo project references |
| `.husky/pre-commit`               | `lint-staged` + `typecheck`                       |
| `.husky/commit-msg`               | `commitlint`                                      |
| `package.json`                    | Scripts, `lint-staged` config, devDependencies    |

## Usage

```bash
# Interactive
pnpm dlx @atharvdange/toolchain init

# Non-interactive (defaults)
pnpm dlx @atharvdange/toolchain init --yes
```

> **Note:** `npx @atharvdange/toolchain init` will **not** work because the package's `packageManager` is set to `pnpm`, causing npm to throw an `EBADDEVENGINES` error. Use `pnpm dlx` (or `yarn dlx` / `bun x` if you prefer those).

## ESLint variants

The generated `eslint.config.mjs` adapts based on what's in your `package.json`:

| Detected | Plugins included                                           |
| -------- | ---------------------------------------------------------- |
| Plain TS | `typescript-eslint`, `unicorn`, `perfectionist`            |
| React    | Above + `eslint-plugin-react`, `eslint-plugin-react-hooks` |
| Next.js  | Above + `@next/eslint-plugin-next`                         |
| Express  | Same as Plain TS but `no-unsafe-*` rules relaxed to `warn` |

## Detection logic

- **Package manager**: looks for `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm
- **Monorepo**: checks for `workspaces` in package.json or `pnpm.workspaces`
- **Framework**: checks `dependencies` / `devDependencies` for `next`, `express`, `react`
