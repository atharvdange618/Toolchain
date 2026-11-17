# Troubleshooting

## Husky hooks not running after `git init`

If you delete `.git` and re-initialize with `git init`, husky hooks will stop working. Run:

```bash
pnpm run prepare
```

This reconfigures `core.hooksPath` to point to `.husky`.

## npx fails with `EBADDEVENGINES`

`npx @atharvdange/toolchain init` will **not** work when the package's `packageManager` is set to `pnpm` (if you initialized a blank project with `pnpm init`), causing npm to throw an `EBADDEVENGINES` error. Use `pnpm dlx`, `yarn dlx`, or `bunx` instead.

## `format:check` fails on a Windows checkout

With `core.autocrlf=true`, checkout files are CRLF and Prettier expects LF, so it reports files nobody edited. 2.1 writes `.gitattributes` with `* text=auto eol=lf` to prevent it. If the project predates that, add the file and re-check the files out:

```bash
git rm --cached -r . && git reset --hard
```

## `pnpm dlx ...@latest` runs an older version

pnpm 11 and later skip releases younger than a day (`minimumReleaseAge`), so `@latest` can resolve to the previous version for the first 24 hours after a release. Ask for the version by number, such as `pnpm dlx @atharvdange/toolchain@2.2.0 init`, or wait a day.
