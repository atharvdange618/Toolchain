import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeFile } from '../../utils/fs.js';

vi.mock('../../utils/versions.js', () => ({
  getExpressVersion: vi.fn(() => '^5.0.0'),
  getTypescriptVersion: vi.fn(() => '~6.0.3'),
  getTypesExpressVersion: vi.fn(() => '^5.0.0'),
  getTypesNodeVersion: vi.fn(() => '^22.0.0'),
}));

const { generateExpress } = await import('./express.js');
const { generatePlain } = await import('./plain.js');

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
