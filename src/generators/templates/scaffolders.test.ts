import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PackageManager } from '../../detectors/project.js';

import { runTask, type TaskOptions } from '../../utils/progress.js';
import { generateNextjs } from './nextjs.js';
import { generateReact } from './react.js';

vi.mock('../../utils/progress.js', () => ({ runTask: vi.fn().mockResolvedValue(undefined) }));

const targetDir = path.resolve('parent dir', 'demo');

async function run(
  generate: typeof generateReact,
  packageManager: PackageManager,
  yes: boolean,
): Promise<{ command: string; options: TaskOptions | undefined }> {
  const ctx = { packageManager, projectName: 'demo', targetDir, yes };
  await generate(ctx).scaffold?.(ctx);
  const [command, options] = vi.mocked(runTask).mock.calls[0] ?? [];
  expect(options).toMatchObject({ cwd: path.dirname(targetDir) });
  return { command: String(command), options };
}

afterEach(() => {
  vi.mocked(runTask).mockClear();
});

describe('react scaffolder', () => {
  it('runs create-vite without prompts under --yes', async () => {
    const { command, options } = await run(generateReact, 'pnpm', true);
    expect(command).toBe(
      'pnpm dlx create-vite@latest demo --template react-ts --no-immediate --no-interactive',
    );
    expect(options?.interactive).toBeFalsy();
  });

  // The template is already chosen, so create-vite has nothing left to ask.
  it('never prompts or starts a dev server without --yes', async () => {
    const { command, options } = await run(generateReact, 'npm', false);
    expect(command).toBe(
      'npx --yes create-vite@latest demo --template react-ts --no-immediate --no-interactive',
    );
    expect(options?.interactive).toBeFalsy();
  });

  it('waits for create-vite and passes its failure on', async () => {
    vi.mocked(runTask).mockRejectedValueOnce(new Error('exit 1'));
    const ctx = { packageManager: 'npm' as const, projectName: 'demo', targetDir, yes: true };
    await expect(generateReact(ctx).scaffold?.(ctx)).rejects.toThrow('exit 1');
  });
});

describe('nextjs scaffolder', () => {
  it('runs create-next-app without prompts under --yes', async () => {
    const { command, options } = await run(generateNextjs, 'bun', true);
    expect(command).toBe('bunx create-next-app@latest demo --use-bun --ts --app --yes');
    expect(options?.interactive).toBeFalsy();
  });

  // create-next-app 16 skips every question when any -- flag is present, and
  // already picks the package manager from the runner (yarn dlx -> yarn).
  it('hands the terminal to create-next-app without --yes or any flag', async () => {
    const { command, options } = await run(generateNextjs, 'yarn', false);
    expect(command).toBe('yarn dlx create-next-app@latest demo');
    expect(options?.interactive).toBe(true);
  });
});
