import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

describe('init with an existing project setup', () => {
  it('moves a shadowing eslint.config.js and legacy .eslintrc aside, keeping their contents', async () => {
    writeFileSync(path.join(dir, 'eslint.config.js'), 'export default [];\n');
    writeFileSync(path.join(dir, '.eslintrc.json'), '{}\n');
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(existsSync(path.join(dir, 'eslint.config.js'))).toBe(false);
    expect(existsSync(path.join(dir, '.eslintrc.json'))).toBe(false);
    expect(readFileSync(path.join(dir, 'eslint.config.js.bak'), 'utf8')).toBe('export default [];\n');
    expect(readFileSync(path.join(dir, '.eslintrc.json.bak'), 'utf8')).toBe('{}\n');
    expect(existsSync(path.join(dir, 'eslint.config.mjs'))).toBe(true);
    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('Moved eslint.config.js to eslint.config.js.bak'),
    );
  });

  it('writes a tsc -b typecheck script for a tsconfig with references', async () => {
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
    );

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['typecheck']).toBe('tsc -b --noEmit');
  });
});

describe('init git hooks and commitlint', () => {
  it('separates npm exec flags so commitlint receives --edit', async () => {
    await init({ pm: 'npm', targetDir: dir, yes: true });

    const commitMsg = readFileSync(path.join(dir, '.husky', 'commit-msg'), 'utf8');
    expect(commitMsg).toBe('npm exec -- commitlint --edit $1\n');
  });

  // A CommonJS commitlint.config.js crashes in "type": "module" projects.
  it('writes an ESM commitlint config that loads in any package type', async () => {
    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(existsSync(path.join(dir, 'commitlint.config.js'))).toBe(false);
    const config = readFileSync(path.join(dir, 'commitlint.config.mjs'), 'utf8');
    expect(config).toContain('export default');
    expect(config).not.toContain('module.exports');
  });
});
