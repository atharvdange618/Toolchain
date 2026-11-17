import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeFile } from '../../utils/fs.js';

vi.mock('../../utils/versions.js', () => ({
  getExpressVersion: vi.fn().mockResolvedValue('^5.0.0'),
  getTurboVersion: vi.fn().mockResolvedValue('^2.0.0'),
  getTypescriptVersion: vi.fn(() => '^7.0.2'),
  getTypesExpressVersion: vi.fn().mockResolvedValue('^5.0.0'),
  getTypesNodeVersion: vi.fn().mockResolvedValue('^22.0.0'),
  getVersions: vi.fn((names: readonly string[]) =>
    Promise.resolve(
      Object.fromEntries(
        names.map((name) => [
          name,
          name === '@types/node' ? '^22.0.0' : name === 'turbo' ? '^2.0.0' : '^5.0.0',
        ]),
      ),
    ),
  ),
}));

const { getTypesNodeVersion, getVersions } = await import('../../utils/versions.js');
beforeEach(() => vi.clearAllMocks());

const { generateExpress } = await import('./express.js');
const { generatePlain } = await import('./plain.js');
const { generatePnpmMonorepo } = await import('./pnpm-monorepo.js');
const { generateTurbo } = await import('./turbo.js');

const ctx = { packageManager: 'pnpm' as const, projectName: 'demo', targetDir: '', yes: true };
// TypeScript 7's exports map hides bin/, so resolve the bin from package.json.
const tsc = path.join(
  path.dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
  'bin/tsc',
);

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { force: true, recursive: true });
  dir = undefined;
});

describe('node app templates', () => {
  it('plain: tsc emits the dist/index.js that the start script runs', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'toolchain-plain-'));
    const result = generatePlain(ctx);
    for (const file of result.files) writeFile(path.join(dir, file.path), file.content);
    writeFile(path.join(dir, 'package.json'), JSON.stringify(result.packageJson));

    execFileSync(process.execPath, [tsc, '-p', dir]);

    const scripts = result.packageJson['scripts'] as Record<string, string>;
    expect(scripts['start']).toBe('node dist/index.js');
    expect(existsSync(path.join(dir, 'dist', 'index.js'))).toBe(true);
    expect(existsSync(path.join(dir, 'src', 'index.js'))).toBe(false);
  }, 30_000);

  it('express: ships a tsconfig that builds src/ into dist/', async () => {
    const result = await generateExpress(ctx);
    expect(result.packageJson['dependencies']).toEqual({ express: '^5.0.0' });
    expect(getVersions).toHaveBeenCalledExactlyOnceWith([
      'express',
      '@types/express',
      '@types/node',
    ]);
    expect(result.packageJson['devDependencies']).toEqual({
      '@types/express': '^5.0.0',
      '@types/node': '^22.0.0',
      typescript: '^7.0.2',
    });
    const tsconfig = result.files.find((file) => file.path === 'tsconfig.json');
    expect(tsconfig).toBeDefined();

    const parsed = JSON.parse(tsconfig?.content ?? '{}') as {
      compilerOptions: Record<string, unknown>;
    };
    expect(parsed.compilerOptions['outDir']).toBe('dist');
    expect(parsed.compilerOptions['moduleResolution']).toBe('NodeNext');
    expect(result.packageJson['main']).toBe('dist/index.js');
  });
});

describe('monorepo templates', () => {
  // Without a solution-style root, init's typecheck runs plain tsc over every
  // package with root options and can't resolve @repo/* imports.
  it.each([
    ['pnpm-monorepo', generatePnpmMonorepo],
    ['turbo', generateTurbo],
  ])(
    '%s: root tsconfig references every package so typecheck uses tsc -b',
    async (_name, generate) => {
      const { files } = await generate(ctx);
      const root = files.find((file) => file.path === 'tsconfig.json');
      expect(root).toBeDefined();

      const parsed = JSON.parse(root?.content ?? '{}') as {
        files?: unknown[];
        references?: Array<{ path: string }>;
      };
      const packageDirs = files
        .filter((file) => file.path.endsWith('/tsconfig.json'))
        .map((file) => path.posix.dirname(file.path))
        .sort();
      expect(parsed.files).toEqual([]);
      expect(parsed.references?.map((ref) => ref.path).sort()).toEqual(packageDirs);
    },
  );

  // init sets the root lint to `oxlint .` with type-aware off for monorepos,
  // so nothing needs built .d.ts files and no lint has to wait on a build.
  // A per-package or turbo lint would be a second, slower path.
  it.each([
    ['pnpm-monorepo', generatePnpmMonorepo],
    ['turbo', generateTurbo],
  ])('%s: leaves lint to the root oxlint script that init writes', async (_name, generate) => {
    const { files, packageJson } = await generate(ctx);

    expect(packageJson['scripts']).not.toHaveProperty('lint');
    if (_name === 'turbo') {
      expect(getVersions).toHaveBeenCalledExactlyOnceWith(['turbo', '@types/node']);
      expect(packageJson['devDependencies']).toEqual({ turbo: '^2.0.0' });
    } else expect(getTypesNodeVersion).toHaveBeenCalledTimes(1);
    for (const file of files.filter((f) => f.path.endsWith('/package.json'))) {
      expect(JSON.parse(file.content)).toHaveProperty('devDependencies.@types/node', '^22.0.0');
      const pkg = JSON.parse(file.content) as { scripts: Record<string, string> };
      expect(pkg.scripts, file.path).not.toHaveProperty('lint');
    }
    const turbo = files.find((file) => file.path === 'turbo.json');
    if (turbo) {
      const { tasks } = JSON.parse(turbo.content) as { tasks: Record<string, unknown> };
      expect(tasks).not.toHaveProperty('lint');
    }
  });
});

describe('monorepo gitignore', () => {
  // tsc -b writes tsconfig.tsbuildinfo beside each package's tsconfig.
  it.each([
    ['pnpm-monorepo', generatePnpmMonorepo],
    ['turbo', generateTurbo],
  ])('%s: ignores build output and tsbuildinfo files', async (_name, generate) => {
    const gitignore = (await generate(ctx)).files.find((file) => file.path === '.gitignore');

    expect(gitignore?.content).toContain('dist/');
    expect(gitignore?.content).toContain('*.tsbuildinfo');
  });
});
