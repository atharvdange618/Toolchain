# Contributing to Toolchain

You can contribute by testing an open issue, reporting a bug, improving the docs, or opening a pull request. For a verification issue, post your results in a comment. You only need a pull request when you change files.

## Set up a local checkout

Use Git, Node.js 22.13 or later, and the pnpm version pinned in `package.json` (currently 11.20.0). The CLI built from `main` supports Node.js 20.12.0 and later. The development setup needs a newer Node version to run pnpm.

Clone the repository to test `main`. Fork it first if you plan to push a change.

```sh
git clone https://github.com/atharvdange618/Toolchain.git
cd Toolchain
pnpm install --frozen-lockfile
pnpm run build
node bin/index.js doctor --pm pnpm
```

Use `node bin/index.js` to run the code you built. Rebuild after changing `src/`. For `init` and `scaffold` tests, run the built CLI by absolute path from a scratch directory so generated files stay outside the checkout.

## Report a result or bug

Check the [open issues](https://github.com/atharvdange618/Toolchain/issues) for an existing report. Include the command you ran, the expected and actual results, and the exit code. Add your OS, Node version, package manager version, and the release version or commit you tested. For prompt or cancellation issues, also include your shell and terminal emulator. Remove secrets and private paths from any logs before posting.

## Open a pull request

Start from current `main` and link the issue, if there is one. Keep the diff focused and use a Conventional Commit subject such as `fix(cli): report the install retry command`. Add or update a Vitest test when behavior changes. The [project guide](AGENTS.md) maps the CLI modules and explains how to regenerate this repo's own configs when you change their generators.

For code changes, run these checks before opening the pull request.

```sh
pnpm run lint:strict
pnpm run format:check
pnpm run typecheck
pnpm test
pnpm run build
```

If the change affects scaffolding or generated output, also run the packed CLI smoke tests. They need network access and Bash, including Git Bash on Windows. Run one case with `pnpm run smoke plain:npm` or the full matrix with `pnpm run smoke`.

In the pull request, explain what changed, why, and how you verified it. Include any checks that still need another platform or a real terminal.
