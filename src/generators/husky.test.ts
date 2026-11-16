import { describe, expect, it } from 'vitest';

import { generateHuskyHooks, withHookWants } from './husky.js';

function hooksFor(pkg: Record<string, unknown>): { commitMsg: string; preCommit: string } {
  return generateHuskyHooks(pkg['scripts'] as Record<string, string> | undefined, 'pnpm');
}

function preCommitFor(pkg: Record<string, unknown>): string {
  return hooksFor(pkg).preCommit;
}

describe('generateHuskyHooks pre-commit', () => {
  it('runs tests when the target has a test script', () => {
    expect(preCommitFor({ scripts: { test: 'vitest', typecheck: 'tsc --noEmit' } })).toBe(
      'pnpm exec lint-staged\npnpm run typecheck\npnpm run test\n',
    );
  });

  it('skips tests without a test script', () => {
    expect(preCommitFor({ scripts: { build: 'tsc', typecheck: 'tsc --noEmit' } })).toBe(
      'pnpm exec lint-staged\npnpm run typecheck\n',
    );
  });

  it("skips npm init's placeholder test script, which always fails", () => {
    expect(
      preCommitFor({
        scripts: { test: 'echo "Error: no test specified" && exit 1', typecheck: 'tsc --noEmit' },
      }),
    ).toBe('pnpm exec lint-staged\npnpm run typecheck\n');
  });

  // A monorepo with no root tsconfig and no typecheck script of its own.
  it('skips typecheck without a typecheck script', () => {
    expect(preCommitFor({ name: 'no-scripts' })).toBe('pnpm exec lint-staged\n');
  });

  // lint-staged calls oxlint directly, so the typegen in the lint script never
  // runs and type-aware rules see no RouteContext on a fresh clone.
  it('generates Next route types first when the lint script does', () => {
    expect(
      preCommitFor({
        scripts: { lint: 'next typegen && oxlint .', typecheck: 'next typegen && tsc --noEmit' },
      }),
    ).toBe('pnpm exec next typegen\npnpm exec lint-staged\npnpm run typecheck\n');
  });

  it('skips typegen when the lint script has none', () => {
    expect(preCommitFor({ scripts: { lint: 'oxlint .', typecheck: 'tsc --noEmit' } })).toBe(
      'pnpm exec lint-staged\npnpm run typecheck\n',
    );
  });
});

describe('generateHuskyHooks commit-msg', () => {
  it('quotes the message file path so a path with spaces stays one argument', () => {
    expect(hooksFor({ name: 'demo' }).commitMsg).toBe('pnpm exec commitlint --edit "$1"\n');
  });
});

describe('withHookWants', () => {
  it('re-wants only the hooks and leaves every other entry untouched', () => {
    const entries = [
      { path: '.prettierrc', want: 'generated' },
      { path: '.husky/pre-commit', want: 'old hook' },
      { path: '.husky/commit-msg', want: 'old msg' },
    ];
    const hooks = generateHuskyHooks({ test: 'vitest' }, 'npm');

    expect(withHookWants(entries, { test: 'vitest' }, 'npm')).toEqual([
      { path: '.prettierrc', want: 'generated' },
      { path: '.husky/pre-commit', want: hooks.preCommit },
      { path: '.husky/commit-msg', want: hooks.commitMsg },
    ]);
  });
});
