import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectInfo } from '../detectors/project.js';

vi.mock('../utils/versions.js', () => ({
  getNextDeps: vi.fn(() => ({ '@next/eslint-plugin-next': '^15.0.0' })),
  getReactDeps: vi.fn(() => ({
    'eslint-plugin-react': '^7.0.0',
    'eslint-plugin-react-hooks': '^5.0.0',
  })),
  getToolchainDeps: vi.fn(() => ({ eslint: '^9.0.0', prettier: '^3.0.0' })),
}));

vi.mock('../utils/logger.js', () => ({
  warn: vi.fn(),
}));

const { updatePackageJson } = await import('./package-json.js');
const { warn } = await import('../utils/logger.js');

const BASE_INFO: ProjectInfo = {
  framework: 'plain',
  hasReact: false,
  isMonorepo: false,
  packageManager: 'pnpm',
};

let dir: string;

function readPkg(): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'toolchain-pkgjson-'));
  vi.mocked(warn).mockClear();
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('updatePackageJson', () => {
  it('adds toolchain scripts and lint-staged config to a bare package.json', () => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'my-app' }));

    updatePackageJson(dir, BASE_INFO);
    const pkg = readPkg();

    expect(pkg['scripts']).toMatchObject({
      commit: 'cz',
      lint: 'eslint .',
      typecheck: 'tsc --noEmit',
    });
    expect(pkg['lint-staged']).toBeDefined();
    expect(pkg['devDependencies']).toMatchObject({ eslint: '^9.0.0', prettier: '^3.0.0' });
  });

  it('wires up commitizen to read prompts from the generated commitlint config', () => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'my-app' }));

    updatePackageJson(dir, BASE_INFO);
    const pkg = readPkg();

    expect(pkg['config']).toEqual({ commitizen: { path: '@commitlint/cz-commitlint' } });
  });

  it('preserves other config.* keys when adding commitizen', () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ config: { 'some-other-tool': { setting: true } }, name: 'my-app' }),
    );

    updatePackageJson(dir, BASE_INFO);
    const pkg = readPkg();

    expect(pkg['config']).toEqual({
      commitizen: { path: '@commitlint/cz-commitlint' },
      'some-other-tool': { setting: true },
    });
  });

  it('preserves existing scripts that do not conflict', () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'my-app', scripts: { start: 'node index.js' } }),
    );

    updatePackageJson(dir, BASE_INFO);
    const pkg = readPkg() as { scripts: Record<string, string> };

    expect(pkg.scripts['start']).toBe('node index.js');
    expect(pkg.scripts['lint']).toBe('eslint .');
  });

  it('warns and overwrites when a toolchain script name already exists', () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'my-app', scripts: { lint: 'custom-lint-command' } }),
    );

    updatePackageJson(dir, BASE_INFO);
    const pkg = readPkg() as { scripts: Record<string, string> };

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lint'));
    expect(pkg.scripts['lint']).toBe('eslint .');
  });

  it('does not warn when there are no script conflicts', () => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'my-app' }));

    updatePackageJson(dir, BASE_INFO);

    expect(warn).not.toHaveBeenCalled();
  });

  it('adds react eslint deps when hasReact is true', () => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'my-app' }));

    updatePackageJson(dir, { ...BASE_INFO, hasReact: true });
    const pkg = readPkg();

    expect(pkg['devDependencies']).toMatchObject({
      'eslint-plugin-react': '^7.0.0',
      'eslint-plugin-react-hooks': '^5.0.0',
    });
  });

  it('adds next eslint deps when framework is next', () => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'my-app' }));

    updatePackageJson(dir, { ...BASE_INFO, framework: 'next', hasReact: true });
    const pkg = readPkg();

    expect(pkg['devDependencies']).toMatchObject({ '@next/eslint-plugin-next': '^15.0.0' });
  });

  it('warns and overwrites when an existing devDependency version differs from the generated one', () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { eslint: '^8.0.0-pinned' }, name: 'my-app' }),
    );

    updatePackageJson(dir, BASE_INFO);
    const pkg = readPkg() as { devDependencies: Record<string, string> };

    expect(pkg.devDependencies['eslint']).toBe('^9.0.0');
    expect(pkg.devDependencies['prettier']).toBe('^3.0.0');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('eslint'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('^8.0.0-pinned'));
  });

  it('does not warn when an existing devDependency version already matches the generated one', () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { eslint: '^9.0.0' }, name: 'my-app' }),
    );

    updatePackageJson(dir, BASE_INFO);

    expect(warn).not.toHaveBeenCalled();
  });
});
