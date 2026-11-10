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
    expect(preCommitFor({ scripts: { test: 'vitest' } })).toBe(
      'pnpm exec lint-staged\npnpm run typecheck\npnpm run test\n',
    );
  });

  it('skips tests without a test script', () => {
    expect(preCommitFor({ scripts: { build: 'tsc' } })).toBe(
      'pnpm exec lint-staged\npnpm run typecheck\n',
    );
    expect(preCommitFor({ name: 'no-scripts' })).toBe(
      'pnpm exec lint-staged\npnpm run typecheck\n',
    );
  });

  it("skips npm init's placeholder test script, which always fails", () => {
    expect(preCommitFor({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })).toBe(
      'pnpm exec lint-staged\npnpm run typecheck\n',
    );
  });
});
