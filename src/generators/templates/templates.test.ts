import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeFile } from '../../utils/fs.js';

vi.mock('../../utils/versions.js', () => ({
  getExpressVersion: vi.fn(() => '^5.0.0'),
  getTurboVersion: vi.fn(() => '^2.0.0'),
  getTypescriptVersion: vi.fn(() => '~6.0.3'),
  getTypesExpressVersion: vi.fn(() => '^5.0.0'),
  getTypesNodeVersion: vi.fn(() => '^22.0.0'),
}));

const { generateExpress } = await import('./express.js');
const { generatePlain } = await import('./plain.js');
const { generatePnpmMonorepo } = await import('./pnpm-monorepo.js');
const { generateTurbo } = await import('./turbo.js');

const ctx = { packageManager: 'pnpm' as const, projectName: 'demo', targetDir: '', yes: true };
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

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

  it('express: ships a tsconfig that builds src/ into dist/', () => {
    const result = generateExpress(ctx);
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
  ])('%s: root tsconfig references every package so typecheck uses tsc -b', (_name, generate) => {
    const { files } = generate(ctx);
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
  });
});

describe('monorepo gitignore', () => {
  // tsc -b writes tsconfig.tsbuildinfo beside each package's tsconfig.
  it.each([
    ['pnpm-monorepo', generatePnpmMonorepo],
    ['turbo', generateTurbo],
  ])('%s: ignores build output and tsbuildinfo files', (_name, generate) => {
    const gitignore = generate(ctx).files.find((file) => file.path === '.gitignore');

    expect(gitignore?.content).toContain('dist/');
    expect(gitignore?.content).toContain('*.tsbuildinfo');
  });
});
