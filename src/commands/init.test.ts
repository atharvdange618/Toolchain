import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('../utils/versions.js', () => ({
  getEslintDeps: vi.fn(() => ({ eslint: '^9.0.0' })),
  getToolchainDeps: vi.fn(() => ({ husky: '^9.0.0' })),
}));

const { execSync } = await import('node:child_process');
const { init } = await import('./init.js');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'toolchain-init-'));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.mocked(execSync).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { force: true, recursive: true });
});

describe('init package manager', () => {
  it('writes hooks for the --pm it installs with, not the detected one', async () => {
    // Detection alone would say npm here.
    vi.stubEnv('npm_config_user_agent', 'npm/10.0.0');

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    const preCommit = readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf8');
    const commitMsg = readFileSync(path.join(dir, '.husky', 'commit-msg'), 'utf8');
    expect(preCommit).toBe('pnpm exec lint-staged\npnpm run typecheck\n');
    expect(commitMsg).toBe('pnpm exec commitlint --edit $1\n');
    expect(execSync).toHaveBeenCalledWith('pnpm install', expect.anything());
  });

  it('falls back to the detected package manager without --pm', async () => {
    vi.stubEnv('npm_config_user_agent', 'yarn/4.0.0');

    await init({ targetDir: dir, yes: true });

    const preCommit = readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf8');
    expect(preCommit).toBe('yarn exec lint-staged\nyarn run typecheck\n');
    expect(execSync).toHaveBeenCalledWith('yarn install', expect.anything());
  });
});
