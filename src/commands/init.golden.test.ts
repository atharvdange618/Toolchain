import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('../utils/versions.js', () => ({
  getToolchainDeps: vi.fn(() => ({ husky: '^9.0.0', oxlint: '^1.0.0', typescript: '^7.0.2' })),
}));

const { init } = await import('./init.js');

// Every file init leaves behind, so a refactor that changes one byte of
// generated output fails here.
const FIXTURES: [string, Record<string, string>][] = [
  ['plain-bare', { 'package.json': JSON.stringify({ name: 'demo' }) }],
  [
    'next-15.5',
    {
      'package.json': JSON.stringify({
        dependencies: { next: '^15.5.0', react: '^19.0.0' },
        name: 'demo',
      }),
    },
  ],
  [
    'expo',
    {
      'package.json': JSON.stringify({
        dependencies: { expo: '~54.0.0', react: '^19.0.0' },
        name: 'demo',
      }),
    },
  ],
  [
    'express',
    { 'package.json': JSON.stringify({ dependencies: { express: '^5.0.0' }, name: 'demo' }) },
  ],
  [
    'v1-upgrade',
    {
      '.eslintrc.json': '{}\n',
      'commitlint.config.js': 'module.exports = {};\n',
      'package.json': JSON.stringify({
        devDependencies: {
          eslint: '^9.0.0',
          'eslint-config-next': '^15.0.0',
          typescript: '^5.8.0',
        },
        name: 'demo',
        scripts: { lint: 'eslint .', test: 'vitest run' },
      }),
    },
  ],
  [
    'monorepo-no-root-tsconfig',
    {
      'package.json': JSON.stringify({
        name: 'monorepo',
        scripts: { typecheck: 'turbo run check' },
        workspaces: ['packages/*'],
      }),
      'packages/a/package.json': JSON.stringify({ name: 'a' }),
    },
  ],
];

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'toolchain-golden-'));
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { force: true, recursive: true });
});

function readTree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    files[path.relative(root, full).replaceAll('\\', '/')] = readFileSync(full, 'utf8');
  }
  // The snapshot serializer sorts keys, so read order doesn't matter.
  return files;
}

describe('init output', () => {
  it.each(FIXTURES)('%s', async (_name, fixture) => {
    for (const [rel, content] of Object.entries(fixture)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), content);
    }

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(readTree(dir)).toMatchSnapshot();
  });
});
