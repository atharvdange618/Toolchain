import { execSync } from 'node:child_process';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PackageManager } from '../../detectors/project.js';

import { generateNextjs } from './nextjs.js';
import { generateReact } from './react.js';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));

const targetDir = path.resolve('parent', 'demo');

function run(
  generate: typeof generateReact,
  packageManager: PackageManager,
  yes: boolean,
): string {
  const ctx = { packageManager, projectName: 'demo', targetDir, yes };
  generate(ctx).scaffold?.(ctx);
  const [command, options] = vi.mocked(execSync).mock.calls[0] ?? [];
  expect(options).toMatchObject({ cwd: path.dirname(targetDir) });
  return String(command);
}

afterEach(() => {
  vi.mocked(execSync).mockReset();
});

describe('react scaffolder', () => {
  it('runs create-vite without prompts under --yes', () => {
    expect(run(generateReact, 'pnpm', true)).toBe(
      'pnpm dlx create-vite@latest demo --template react-ts --no-immediate --no-interactive',
    );
  });

  it('leaves prompts on without --yes but never starts a dev server', () => {
    expect(run(generateReact, 'npm', false)).toBe(
      'npx --yes create-vite@latest demo --template react-ts --no-immediate',
    );
  });
});

describe('nextjs scaffolder', () => {
  it('runs create-next-app without prompts under --yes', () => {
    expect(run(generateNextjs, 'bun', true)).toBe(
      'bunx create-next-app@latest demo --use-bun --ts --app --yes',
    );
  });

  it('leaves prompts on without --yes', () => {
    expect(run(generateNextjs, 'yarn', false)).toBe(
      'yarn dlx create-next-app@latest demo --use-yarn',
    );
  });
});
