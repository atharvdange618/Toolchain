# Upgrading

Full notes for every release are in [CHANGELOG.md](../CHANGELOG.md).

## From 2.2

Upgrade to Node.js 20.12.0 or later before running the new CLI.

`update` removes the `commit` script and `config.commitizen` if you never changed them. It leaves dependencies alone, so uninstall the prompt yourself:

```bash
npm uninstall commitizen @commitlint/cz-commitlint
```

Use your own manager's remove command if you're not on npm. Keep both packages instead if you use the prompt; nothing else depends on them.

## From 2.1 or 2.0

Adopt the manifest and review changes with:

```bash
pnpm dlx @atharvdange/toolchain@latest doctor
pnpm dlx @atharvdange/toolchain@latest update
```

Without a manifest, differing existing entries appear as unknown-origin. Review them before choosing overwrite or keep. `update --yes` preserves them but leaves them needing action in `doctor`. See [doctor and update](doctor-and-update.md) for the details.

From 2.0, the generated changes include the second `oxlint` pass in `lint-staged` and the Expo config and glob. From 2.1, a monorepo can pick up type-aware lint, which 2.1 left off. If workspace warnings name imports that don't resolve, add the dependency to the importing package's `tsconfig.json` `references`, as described under [Lint rules](configuration.md#lint-rules). Existing dependency ranges stay unchanged; handle version upgrades separately.

## From v1

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

### TypeScript 7 tsconfig fixes

TypeScript 7 drops these options, so remove or replace them if `typecheck` fails:

| Option                         | Fix                                               |
| ------------------------------ | ------------------------------------------------- |
| `baseUrl`                      | Remove it; write `paths` relative to the tsconfig |
| `moduleResolution: node`       | Use `bundler`, or `nodenext` for Node apps        |
| `target: es5`                  | Use `ES2015` or later                             |
| `outFile`                      | Use a bundler                                     |
| `module: amd`, `umd`, `system` | Use `esnext`, or `nodenext` for Node apps         |

### Dropped rules

oxlint has no port of these, so v2 lints without them:

- `eslint-plugin-perfectionist` (import and key sorting)
- `eslint-plugin-react-you-might-not-need-an-effect`
- `import-x/no-useless-path-segments`

### Monorepos

`init` only changes the root. It lists workspace packages that still use ESLint or pin TypeScript below 7, but leaves their scripts and dependencies alone. The root `oxlint .` lints those packages now, so you can remove their ESLint setups. A monorepo with no root `tsconfig.json` keeps its own `typecheck` script.
