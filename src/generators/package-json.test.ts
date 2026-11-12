import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectInfo } from '../detectors/project.js';

vi.mock('../utils/versions.js', () => ({
  getToolchainDeps: vi.fn(() => ({ oxlint: '^1.0.0', prettier: '^3.0.0' })),
}));

vi.mock('../utils/logger.js', () => ({
  warn: vi.fn(),
}));

const { updatePackageJson } = await import('./package-json.js');
const { warn } = await import('../utils/logger.js');

const BASE_INFO: ProjectInfo = {
  framework: 'plain',
  hasProjectReferences: false,
  hasReact: false,
  hasRootTsconfig: false,
  hasTypeScriptFiles: true,
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
      lint: 'oxlint .',
      'lint:fix': 'oxlint . --fix',
      'lint:strict': 'oxlint . --deny-warnings',
      typecheck: 'tsc --noEmit',
    });
    expect(pkg['lint-staged']).toEqual({
      '*.{json,md,css}': ['prettier --write'],
      '*.{ts,tsx}': ['oxlint --fix', 'oxlint', 'prettier --write'],
    });
    expect(pkg['devDependencies']).toMatchObject({ oxlint: '^1.0.0', prettier: '^3.0.0' });
  });

  it('matches plain .js sources for Expo so config plugins get linted', () => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'my-app' }));

    updatePackageJson(dir, { ...BASE_INFO, framework: 'expo', hasReact: true });
    const lintStaged = readPkg()['lint-staged'] as Record<string, string[]>;

    expect(Object.keys(lintStaged)).toEqual(['*.{json,md,css}', '*.{js,jsx,cjs,mjs,ts,tsx}']);
    expect(lintStaged['*.{js,jsx,cjs,mjs,ts,tsx}']).toEqual([
      'oxlint --fix',
      'oxlint',
      'prettier --write',
    ]);
  });

  it('uses tsc -b for typecheck when the tsconfig has project references', () => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'my-app' }));

    updatePackageJson(dir, { ...BASE_INFO, hasProjectReferences: true });

    expect(readPkg()['scripts']).toMatchObject({ typecheck: 'tsc -b' });
  });

  describe('Next.js typecheck', () => {
    function typecheckFor(next: string): unknown {
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'my-app', dependencies: { next } }),
      );
      updatePackageJson(dir, { ...BASE_INFO, framework: 'next', hasReact: true });
      return (readPkg()['scripts'] as Record<string, string>)['typecheck'];
    }

    it('runs next typegen first on Next 15.5 and later, so tsc sees the route types', () => {
      expect(typecheckFor('16.3.8')).toBe('next typegen && tsc --noEmit');
      expect(typecheckFor('^15.5.0')).toBe('next typegen && tsc --noEmit');
    });

    it('assumes a current Next for a tag like latest or canary', () => {
      expect(typecheckFor('latest')).toBe('next typegen && tsc --noEmit');
    });

    it('keeps plain tsc before Next 15.5, which has no typegen command', () => {
      expect(typecheckFor('^15.4.2')).toBe('tsc --noEmit');
      expect(typecheckFor('14.2.0')).toBe('tsc --noEmit');
    });

    it('leaves other frameworks alone', () => {
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'my-app', dependencies: { next: '16.0.0' } }),
      );
      updatePackageJson(dir, { ...BASE_INFO, framework: 'react', hasReact: true });
      expect(readPkg()['scripts']).toMatchObject({ typecheck: 'tsc --noEmit' });
    });
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
    expect(pkg.scripts['lint']).toBe('oxlint .');
  });

  it('warns and overwrites when a toolchain script name already exists', () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'my-app', scripts: { lint: 'custom-lint-command' } }),
    );

    updatePackageJson(dir, BASE_INFO);
    const pkg = readPkg() as { scripts: Record<string, string> };

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lint'));
    expect(pkg.scripts['lint']).toBe('oxlint .');
  });

  it('does not warn when there are no script conflicts', () => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'my-app' }));

    updatePackageJson(dir, BASE_INFO);

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and overwrites when an existing devDependency version differs from the generated one', () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { oxlint: '^0.9.0-pinned' }, name: 'my-app' }),
    );

    updatePackageJson(dir, BASE_INFO);
    const pkg = readPkg() as { devDependencies: Record<string, string> };

    expect(pkg.devDependencies['oxlint']).toBe('^1.0.0');
    expect(pkg.devDependencies['prettier']).toBe('^3.0.0');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('oxlint'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('^0.9.0-pinned'));
  });

  it('does not warn when an existing devDependency version already matches the generated one', () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { oxlint: '^1.0.0' }, name: 'my-app' }),
    );

    updatePackageJson(dir, BASE_INFO);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('updatePackageJson ESLint removal', () => {
  it('removes v1 and create-next-app ESLint devDependencies and lists them', () => {
    const eslintDeps = {
      '@eslint/js': '^9.0.0',
      '@next/eslint-plugin-next': '^16.0.0',
      '@typescript-eslint/parser': '^8.0.0',
      eslint: '^9.0.0',
      'eslint-config-next': '^16.0.0',
      'eslint-import-resolver-typescript': '^4.0.0',
      'eslint-plugin-react-hooks': '^7.0.0',
      'typescript-eslint': '^8.0.0',
    };
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { ...eslintDeps, vitest: '^4.0.0' }, name: 'my-app' }),
    );

    updatePackageJson(dir, BASE_INFO);
    const pkg = readPkg() as { devDependencies: Record<string, string> };

    expect(Object.keys(pkg.devDependencies).sort()).toEqual(['oxlint', 'prettier', 'vitest']);
    for (const name of Object.keys(eslintDeps)) {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(name));
    }
  });

  it('keeps packages that only mention eslint in passing', () => {
    const keep = { 'prettier-plugin-tailwindcss': '^0.6.0', 'vite-plugin-eslint-free': '^1.0.0' };
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ devDependencies: keep, name: 'my-app' }),
    );

    updatePackageJson(dir, BASE_INFO);

    expect(readPkg()['devDependencies']).toMatchObject(keep);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Removing ESLint'));
  });
});

describe('updatePackageJson TypeScript upgrade', () => {
  it.each(['~6.0.3', '^5.8.0'])(
    'warns about TS 7 tsconfig breakage when upgrading from %s',
    (range) => {
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { typescript: range }, name: 'my-app' }),
      );

      updatePackageJson(dir, BASE_INFO);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`Upgrading typescript from ${range} to 7`),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('baseUrl'));
    },
  );

  it.each(['^7.0.0', 'latest', 'catalog:'])('does not warn for %s', (range) => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { typescript: range }, name: 'my-app' }),
    );

    updatePackageJson(dir, BASE_INFO);

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Upgrading typescript'));
  });
});
