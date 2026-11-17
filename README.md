# `@atharvdange/toolchain`

[![npm version](https://img.shields.io/npm/v/@atharvdange/toolchain?color=cb3837&logo=npm)](https://www.npmjs.com/package/@atharvdange/toolchain)
[![npm downloads](https://img.shields.io/npm/dm/@atharvdange/toolchain?color=cb3837)](https://www.npmjs.com/package/@atharvdange/toolchain)
[![CI](https://img.shields.io/github/actions/workflow/status/atharvdange618/toolchain/ci.yml?branch=main&label=CI&logo=github)](https://github.com/atharvdange618/toolchain/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/@atharvdange/toolchain?color=blue)](LICENSE)
[![Node](https://img.shields.io/node/v/@atharvdange/toolchain?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript 7](https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

One command sets up oxlint, Prettier, Husky, commitlint and strict TypeScript 7 in a Next.js, React, Expo, Express or plain TS project.

```bash
npx @atharvdange/toolchain init
```

Use `pnpm dlx`, `yarn dlx` (Yarn 2+) or `bunx` in place of `npx` to match your package manager. The examples below use `pnpm dlx`.

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

The refused stacks' type checkers need the TypeScript compiler API, which TypeScript 7 doesn't ship, so `typecheck` would pass while checking no component files. `init` exits 1 and writes nothing. [Why, and what to do instead](docs/configuration.md#unsupported-stacks).

## Commands

### `init`: add the toolchain to a project

```bash
pnpm dlx @atharvdange/toolchain init            # interactive
pnpm dlx @atharvdange/toolchain init --yes      # take the defaults
pnpm dlx @atharvdange/toolchain init --pm bun   # pick the package manager
```

Moves your existing ESLint and commitlint configs to `.bak` instead of deleting them. Writes `.toolchain.json`; commit it with the configs.

### `doctor`: check an existing setup

```bash
pnpm dlx @atharvdange/toolchain doctor
pnpm dlx @atharvdange/toolchain doctor --json
```

Read-only. Shows what differs from the current generators and exits 1 when something needs action, so it works as a CI check. Ends with the `update` command to run.

### `update`: pick up generator changes and keep your edits

```bash
pnpm dlx @atharvdange/toolchain update
pnpm dlx @atharvdange/toolchain update --keep '.prettierrc' --overwrite '.oxlintrc.json#rules.*'
```

Applies safe changes and asks about conflicts file by file. `--keep` and `--overwrite` answer without a prompt.

Exit codes, the JSON shape and failure recovery for both commands: [docs/doctor-and-update.md](docs/doctor-and-update.md).

### `scaffold`: start a new project

```bash
pnpm dlx @atharvdange/toolchain scaffold my-app --template nextjs --pm pnpm
```

| Template        | What you get                                 | Built by          |
| --------------- | -------------------------------------------- | ----------------- |
| `plain`         | Basic TypeScript project                     | toolchain         |
| `react`         | React 19 with Vite and TypeScript            | `create-vite`     |
| `nextjs`        | Next.js 15 with App Router                   | `create-next-app` |
| `express`       | Express 5 REST API with TypeScript           | toolchain         |
| `pnpm-monorepo` | pnpm workspaces with `apps/` and `packages/` | toolchain         |
| `turbo`         | Turborepo with `apps/` and `packages/`       | toolchain         |

Leave out `--template` to choose from a list. The monorepo templates require pnpm and override `--pm`. With `--yes`, `create-vite` and `create-next-app` run without prompts on their TypeScript defaults.

## What it sets up

| File                              | Contents                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `.oxlintrc.json`                  | Plugins and type-aware rules for your framework                                                                |
| `tsconfig.json`                   | Strict config, only when you have none                                                                         |
| `.prettierrc` / `.prettierignore` | Prettier settings                                                                                              |
| `.editorconfig`, `.gitattributes` | LF line endings, so `format:check` passes on Windows                                                           |
| `commitlint.config.mjs`           | Conventional commits, plus a `commit` prompt that reads the same rules                                         |
| `.husky/pre-commit`               | `lint-staged`, then `typecheck`, then `test` when you have one                                                 |
| `.husky/commit-msg`               | `commitlint`                                                                                                   |
| `package.json`                    | `lint`, `lint:fix`, `lint:strict`, `format`, `format:check`, `typecheck`, `commit` scripts and devDependencies |

Every script, tsconfig option and lint rule, and why each one is there: [docs/configuration.md](docs/configuration.md).

## Docs

- [Configuration reference](docs/configuration.md)
- [`doctor` and `update`](docs/doctor-and-update.md)
- [Upgrading from v1 or 2.x](docs/upgrading.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Changelog](CHANGELOG.md)

## Author

- X: [@atharvdangedev](https://x.com/atharvdangedev)
- GitHub: [atharvdange618](https://github.com/atharvdange618)
