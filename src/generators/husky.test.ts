import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeHuskyHooks } from './husky.js';

let dir: string;

function preCommitFor(pkg: Record<string, unknown>): string {
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  writeHuskyHooks(dir, 'pnpm');
  return readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf8');
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'toolchain-husky-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('writeHuskyHooks pre-commit', () => {
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

describe('writeHuskyHooks commit-msg', () => {
  it('quotes the message file path so a path with spaces stays one argument', () => {
    preCommitFor({ name: 'demo' });

    expect(readFileSync(path.join(dir, '.husky', 'commit-msg'), 'utf8')).toBe(
      'pnpm exec commitlint --edit "$1"\n',
    );
  });
});
