# Agents Guide for `@atharvdange/toolchain`

The global CLAUDE.md covers how to work with Atharv. This file covers the codebase.

## Project Overview

A CLI that sets up a dev toolchain (oxlint, Prettier, Husky, lint-staged, commitlint, strict TypeScript 7) in a JS/TS project, or scaffolds a new project with it.

- Published as `@atharvdange/toolchain` on npm (v2.0.0)
- `pnpm dlx @atharvdange/toolchain init` sets up an existing project
- `pnpm dlx @atharvdange/toolchain scaffold <name> --template <type>` creates a new one

v2 replaced ESLint with oxlint, because typescript-eslint pinned TypeScript below 7. The plan and its findings live in `docs/plans/v2.0.0-oxlint.md`.

## Architecture

```
src/
├── index.ts                    # CLI entry point (Commander): init, scaffold
├── commands/
│   ├── init.ts                 # Sets up the toolchain in an existing project
│   └── scaffold.ts             # Creates a project from a template, then runs init
├── detectors/
│   └── project.ts              # Framework, package manager, monorepo, tsconfig detection
├── generators/
│   ├── oxlint.ts               # .oxlintrc.json per framework
│   ├── husky.ts                # .husky/pre-commit and .husky/commit-msg
│   ├── package-json.ts         # Scripts, lint-staged, devDependencies
│   ├── static-configs.ts       # .editorconfig, .prettierrc, .prettierignore, commitlint
│   ├── tsconfig.ts             # Strict tsconfig: flat, Node app or monorepo
│   └── templates/              # One file per scaffold template
└── utils/
    ├── fs.ts                   # readJson, writeFile (creates parent dirs)
    ├── logger.ts               # Colored output with picocolors
    └── versions.ts             # Resolves dependency versions from the npm registry
scripts/
└── smoke.sh                    # Packs the CLI and scaffolds every template from the tarball
```

## Module Responsibilities

### `src/index.ts`

Registers `init` (`--yes`, `--pm`) and `scaffold <project-name>` (`--template`, `--pm`, `--yes`). Reads the version from `package.json` at runtime. Uses `parseAsync`, so a rejected action prints one line instead of a stack trace.

### `src/commands/init.ts`

Flow: detect, prompt, static configs, oxlint config, tsconfig, package.json, Husky hooks, install, `husky`.

- Moves other configs aside (renames to `.bak`) instead of deleting them, so the user keeps custom rules: every ESLint config, an existing `.oxlintrc.json`, and every commitlint config other than `commitlint.config.mjs`.
- Keeps an existing `tsconfig.json`. A monorepo with no root tsconfig gets none, because an empty root config makes tsc check every package with the wrong options.
- Writes the hooks after `package.json`, so the hooks see the final scripts.
- In a monorepo, warns about workspace packages still on ESLint or on TypeScript below 7. It warns rather than rewrites, since package scripts and deps belong to the user.

### `src/commands/scaffold.ts`

Validates the name and template, picks the package manager (`pnpm-monorepo` and `turbo` require pnpm), and runs the template's generator. `react` and `nextjs` call `create-vite` and `create-next-app` through `pmDlx()`; the rest write files directly. Then it runs `git init` if needed, calls `init({ yes: true })`, and runs `lint:fix` and `format` so the new project passes its own checks.

### `src/detectors/project.ts`

- `detect()` returns `ProjectInfo`: `framework`, `hasReact`, `hasProjectReferences`, `hasRootTsconfig`, `isMonorepo`, `packageManager`.
- Package manager order: `npm_config_user_agent`, then lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`), then `devEngines.packageManager`, then npm.
- Framework: `next`, then `express`, then `react`/`react-dom`, else `plain`.
- Monorepo: a `workspaces` key, or a `packages:` list in `pnpm-workspace.yaml`.
- `pmExec()` gives `bun run`, `npm exec --` (so flags reach the command), or `<pm> exec`. `pmDlx()` gives `bunx`, `npx --yes`, `pnpm dlx` or `yarn dlx`.
- `workspacePackageDirs()` handles exact paths and one-level `dir/*` patterns only.

### `src/generators/oxlint.ts`

- Plugins: `typescript`, `unicorn`, `import`; React adds `react` and `jsx-a11y`; Next.js adds `nextjs`.
- `correctness` category on as `error`, plus the typescript-eslint recommended and type-checked rules oxlint doesn't turn on by default, so v2 enforces what v1 did.
- `import/no-cycle` and `import/no-duplicates` warn, `import/no-self-import` errors.
- Express relaxes four `no-unsafe-*` rules to `warn`.
- `options.typeAware` is on, except in monorepos, where type-aware rules would need every package built first. The lint scripts don't pass `--type-aware`, so this setting decides.

### `src/generators/husky.ts`

- `pre-commit`: `lint-staged`, then `typecheck` if the script exists, then `test` if the script exists and isn't npm's "no test specified" placeholder.
- `commit-msg`: `commitlint --edit "$1"`, quoted so paths with spaces work.

### `src/generators/package-json.ts`

- Scripts: `commit`, `format`, `format:check`, `lint`, `lint:fix`, `lint:strict`, `prepare`, `typecheck` (`tsc -b` when the root tsconfig has project references). A monorepo with no root tsconfig keeps its own `typecheck`.
- lint-staged: `*.{ts,tsx}` runs `oxlint --fix` and Prettier; `*.{json,md,css}` runs Prettier.
- Removes ESLint devDependencies (`ESLINT_DEP` regex) and warns when TypeScript moves up to 7.

### `src/generators/tsconfig.ts`

Strict, ES2022, bundler resolution, `verbatimModuleSyntax`. `nodeApp` switches to NodeNext with `src` to `dist` (plain and express templates). Monorepo mode adds `composite: true` and empty `references`. Emits nothing TypeScript 7 dropped (`baseUrl`, `moduleResolution: node`, `target: es5`).

### `src/utils/versions.ts`

Asks npm for the newest stable release at least a day old (`pickSettledVersion`), so pnpm 11's default `minimumReleaseAge` doesn't add exclude lines. TypeScript is fixed at `^7.0.2`.

## Key Design Decisions

1. ESM throughout (`"type": "module"`, `.js` import extensions).
2. One linter, no ESLint fallback. perfectionist, react-you-might-not-need-an-effect and `import/no-useless-path-segments` have no oxlint port, so v2 dropped them.
3. Move aside, never delete, any config the user already has.
4. Warn about workspace packages instead of rewriting them; `init` only touches the root.

## Build & Development

```bash
pnpm run build      # Compile TypeScript to dist/
pnpm run dev        # Watch mode
pnpm run lint       # oxlint
pnpm run typecheck  # tsc --noEmit
pnpm run format     # Prettier
pnpm test           # Vitest
pnpm run smoke      # Scaffold every template from the packed CLI and check it (slow, needs network)
```

This repo uses its own toolchain: the pre-commit hook runs lint-staged, typecheck and tests. Running `pnpm run format` reflows unrelated files; revert those before committing.

Entry point: `bin/index.js` imports `dist/index.js`, built from `src/index.ts`.

## Generated Output (by `init`)

| File                     | Source                                                   |
| ------------------------ | -------------------------------------------------------- |
| `.editorconfig`          | `static-configs.ts`                                      |
| `.prettierrc`            | `static-configs.ts`                                      |
| `.prettierignore`        | `static-configs.ts`                                      |
| `commitlint.config.mjs`  | `static-configs.ts`                                      |
| `.oxlintrc.json`         | `generators/oxlint.ts`, per framework                    |
| `tsconfig.json`          | `generators/tsconfig.ts`, only when none exists          |
| `.husky/pre-commit`      | `generators/husky.ts`                                    |
| `.husky/commit-msg`      | `generators/husky.ts`                                    |
| `package.json` (updated) | `generators/package-json.ts`: scripts, deps, lint-staged |
