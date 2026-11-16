import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectInfo } from '../detectors/project.js';

vi.mock('../utils/versions.js', () => ({
  getToolchainDeps: vi.fn(() => ({ husky: '^9.0.0', typescript: '^7.0.2' })),
}));

const { buildPlan } = await import('./plan.js');
const { getToolchainDeps } = await import('../utils/versions.js');

const BASE_INFO: ProjectInfo = {
  framework: 'plain',
  hasProjectReferences: false,
  hasReact: false,
  hasRootTsconfig: false,
  hasTypeScriptFiles: true,
  isMonorepo: false,
  packageManager: 'pnpm',
  unresolvedWorkspaceTypes: [],
};

let dir: string;

function writePkg(pkg: Record<string, unknown>): void {
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
}

function want(plan: ReturnType<typeof buildPlan>, entryPath: string): string | null | undefined {
  return plan.entries.find((entry) => entry.path === entryPath)?.want;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'toolchain-plan-'));
  writePkg({ name: 'demo' });
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('buildPlan', () => {
  it.each([{ husky: '^8.0.0' }, {}])(
    'uses supplied dependencies without registry resolution: %j',
    (deps) => {
      const calls = vi.mocked(getToolchainDeps).mock.calls.length;
      const plan = buildPlan(dir, BASE_INFO, 'pnpm', deps);
      expect(vi.mocked(getToolchainDeps).mock.calls).toHaveLength(calls);
      expect(
        plan.entries.filter((entry) => entry.path.startsWith('package.json#devDependencies.')),
      ).toEqual(
        Object.entries(deps).map(([name, version]) => ({
          path: `package.json#devDependencies.${name}`,
          want: JSON.stringify(version),
        })),
      );
    },
  );
  it('plans every file for a bare project and writes none of them', () => {
    const paths = buildPlan(dir, BASE_INFO, 'pnpm').entries.map((entry) => entry.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        '.editorconfig',
        '.prettierrc',
        '.prettierignore',
        '.gitattributes',
        'commitlint.config.mjs',
        '.oxlintrc.json',
        'tsconfig.json',
        'package.json#scripts.lint',
        '.husky/pre-commit',
        '.husky/commit-msg',
      ]),
    );
    expect(readdirSync(dir)).toEqual(['package.json']);
  });

  it('leaves an existing .gitattributes out and says so', () => {
    writeFileSync(path.join(dir, '.gitattributes'), '*.png filter=lfs\n');

    const plan = buildPlan(dir, BASE_INFO, 'pnpm');

    expect(want(plan, '.gitattributes')).toBeUndefined();
    expect(plan.messages).toContainEqual({
      level: 'info',
      text: expect.stringContaining('.gitattributes already exists') as string,
    });
  });

  it.each([
    ['an existing root tsconfig', { hasRootTsconfig: true }, 'tsconfig.json already exists'],
    ['a monorepo with none', { isMonorepo: true }, 'No root tsconfig.json in this monorepo'],
  ])('plans no tsconfig.json for %s', (_name, overrides, text) => {
    const plan = buildPlan(dir, { ...BASE_INFO, ...overrides }, 'pnpm');

    expect(want(plan, 'tsconfig.json')).toBeUndefined();
    expect(plan.messages).toContainEqual({
      level: 'info',
      text: expect.stringContaining(text) as string,
    });
  });

  // The hook follows the planned lint script, which disk doesn't have yet.
  it('starts the Next 15.5 pre-commit hook with typegen when disk has no scripts', () => {
    writePkg({ dependencies: { next: '^15.5.0' }, name: 'demo' });

    const plan = buildPlan(dir, { ...BASE_INFO, framework: 'next', hasReact: true }, 'pnpm');

    expect(want(plan, '.husky/pre-commit')).toBe(
      'pnpm exec next typegen\npnpm exec lint-staged\npnpm run typecheck\n',
    );
  });

  it.each([
    ['keeps', { typecheck: 'turbo run check' }, 'pnpm exec lint-staged\npnpm run typecheck\n'],
    ['drops', { build: 'turbo run build' }, 'pnpm exec lint-staged\n'],
  ])(
    '%s the hook typecheck in a monorepo with no root tsconfig, following disk',
    (_name, scripts, preCommit) => {
      writePkg({ name: 'monorepo', scripts });

      const plan = buildPlan(dir, { ...BASE_INFO, isMonorepo: true }, 'pnpm');

      expect(want(plan, '.husky/pre-commit')).toBe(preCommit);
    },
  );

  it('throws the version lookup error before anything is written', () => {
    vi.mocked(getToolchainDeps).mockImplementationOnce(() => {
      throw new Error('npm registry unreachable');
    });

    expect(() => buildPlan(dir, BASE_INFO, 'pnpm')).toThrow('npm registry unreachable');
    expect(readdirSync(dir)).toEqual(['package.json']);
  });
});
