import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { hashEntry, parseManifest, serializeManifest } from '../manifest/manifest.js';
import { compareProject, loadProject, trackedEntries } from '../manifest/project.js';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('../utils/versions.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/versions.js')>();
  return {
    ...original,
    getToolchainDeps: vi.fn(() =>
      Promise.resolve(
        Object.fromEntries(original.TOOLCHAIN_DEP_NAMES.map((name) => [name, '^7.0.2'])),
      ),
    ),
  };
});

const { execSync } = await import('node:child_process');
const { getToolchainDeps } = await import('../utils/versions.js');
const { init } = await import('./init.js');
const { doctor } = await import('./doctor.js');

let dir: string;
let stdout: MockInstance<typeof console.log>;
let stdoutWrite: MockInstance<typeof process.stdout.write>;
let stderr: MockInstance<typeof process.stderr.write>;

function output(): string {
  return stdout.mock.calls.map((args) => `${args.map(String).join(' ')}\n`).join('');
}

function json(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as Record<string, unknown>;
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`);
}

function recordBase(entryPath: string, value: string): void {
  const document = parseManifest(readFileSync(path.join(dir, '.toolchain.json'), 'utf8')) ?? {
    entries: {},
  };
  const hash = hashEntry(entryPath, value);
  if (hash === undefined) throw new Error('Expected hash');
  document.entries[entryPath] = hash;
  writeFileSync(path.join(dir, '.toolchain.json'), serializeManifest(document));
}

function files(root = dir): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) Object.assign(result, files(file));
    else result[path.relative(dir, file)] = readFileSync(file).toString('base64');
  }
  return result;
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'toolchain-doctor-'));
  writeJson('package.json', { name: 'demo' });
  stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
  stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  await init({ pm: 'pnpm', targetDir: dir, yes: true });
  vi.mocked(execSync).mockClear();
  vi.mocked(getToolchainDeps).mockClear();
  stdout.mockClear();
  stdoutWrite.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('doctor', () => {
  it('accepts fresh init and reads without writes, registry lookup or execution', () => {
    const before = files();
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
    expect(files()).toEqual(before);
    expect(execSync).not.toHaveBeenCalled();
    expect(getToolchainDeps).not.toHaveBeenCalled();
    expect(output()).toContain('0 need action');
    expect(stderr).not.toHaveBeenCalled();
  });

  it('accepts a local rule edit', () => {
    const config = json('.oxlintrc.json');
    (config['rules'] as Record<string, unknown>)['typescript/no-explicit-any'] = 'off';
    writeJson('.oxlintrc.json', config);
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
    expect(output()).toContain('local-edit');
  });

  it('accepts an intentional format-script deletion alone', () => {
    const pkg = json('package.json');
    delete (pkg['scripts'] as Record<string, unknown>)['format'];
    writeJson('package.json', pkg);
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
    expect(output()).toContain('removed-locally');
  });

  it.each(['.husky/pre-commit', '.husky/commit-msg'])('reports repair for deleted %s', (file) => {
    rmSync(path.join(dir, file));
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(1);
    expect(output()).toContain(file);
    expect(output()).toContain(`${file} (absent)`);
    expect(output()).toContain('restore it from Git');
    expect(output()).toContain('remove its manifest entry and run update');
  });

  it('does not tell a legacy project to edit a manifest it does not have', () => {
    rmSync(path.join(dir, '.toolchain.json'));
    rmSync(path.join(dir, '.husky/pre-commit'));
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(1);
    expect(output()).toContain('restore it from Git, or run update to recreate it.');
    expect(output()).not.toContain('remove its manifest entry');
  });

  it('requires a missing devDependency even when another dependency section contains it', () => {
    const pkg = json('package.json');
    delete (pkg['devDependencies'] as Record<string, unknown>)['husky'];
    pkg['dependencies'] = { husky: '^9.0.0' };
    writeJson('package.json', pkg);
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(1);
    expect(output()).toContain('package.json#devDependencies.husky');
  });

  it.each(['stale', 'conflict', 'unknown-origin', 'missing'] as const)(
    'fails for %s and leaves every file unchanged',
    (state) => {
      if (state === 'stale' || state === 'conflict') recordBase('.prettierrc', 'old\n');
      if (state === 'stale') writeFileSync(path.join(dir, '.prettierrc'), 'old\n');
      if (state === 'conflict') writeFileSync(path.join(dir, '.prettierrc'), 'custom\n');
      if (state === 'unknown-origin' || state === 'missing') {
        const document = parseManifest(readFileSync(path.join(dir, '.toolchain.json'), 'utf8')) ?? {
          entries: {},
        };
        delete document.entries['.prettierrc'];
        writeFileSync(path.join(dir, '.toolchain.json'), serializeManifest(document));
        if (state === 'missing') rmSync(path.join(dir, '.prettierrc'));
        else writeFileSync(path.join(dir, '.prettierrc'), 'custom\n');
      }
      const before = files();
      expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(1);
      expect(output()).toContain(`${state}:`);
      expect(files()).toEqual(before);
      expect(execSync).not.toHaveBeenCalled();
      expect(getToolchainDeps).not.toHaveBeenCalled();
    },
  );

  it('accepts obsolete entries without requiring action', () => {
    recordBase('package.json#scripts.retired', JSON.stringify('old'));
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
    expect(output()).toContain('obsolete:');
    expect(output()).toContain('package.json#scripts.retired');
  });

  it.each([false, true])('explains legacy adoption with a differing entry: %s', (differing) => {
    rmSync(path.join(dir, '.toolchain.json'));
    if (differing) writeFileSync(path.join(dir, '.prettierrc'), 'custom\n');
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(differing ? 1 : 0);
    expect(output()).toContain('No .toolchain.json found.');
    expect(output()).not.toContain('interactive');
  });

  it.each([
    ['pnpm', 'pnpm dlx'],
    ['npm', 'npx --yes'],
  ])('prints the %s update command that adopts a legacy project', async (pm, dlx) => {
    // Hooks name the manager, so generate them with the one doctor checks.
    await init({ pm, targetDir: dir, yes: true });
    stdout.mockClear();
    rmSync(path.join(dir, '.toolchain.json'));
    writeFileSync(path.join(dir, '.prettierrc'), 'custom\n');
    expect(doctor({ targetDir: dir, pm })).toBe(1);
    const text = output();
    expect(text).toContain('No .toolchain.json found.');
    expect(text.trimEnd().split('\n').at(-1)).toBe(
      `Next: ${dlx} @atharvdange/toolchain update --pm ${pm} --keep '.prettierrc'`,
    );
    expect(text).not.toContain('interactive');
  });

  it('prints no next command after a fresh init', () => {
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
    expect(output()).not.toContain('Next:');
  });

  it('checks hooks against disk scripts after intentional typecheck deletion', () => {
    const pkg = json('package.json');
    delete (pkg['scripts'] as Record<string, unknown>)['typecheck'];
    writeJson('package.json', pkg);
    const project = loadProject(dir, 'pnpm');
    const rows = compareProject(project, trackedEntries(project.plan));
    expect(rows.find((row) => row.path === 'package.json#scripts.typecheck')?.state).toBe(
      'removed-locally',
    );
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(1);
    expect(output()).toContain('stale:\n  .husky/pre-commit');
    expect(output()).toContain('1 need action');
  });

  it.each([true, false])('uses Next disk lint typegen prefix: %s', async (typegen) => {
    writeJson('package.json', { name: 'next-app', dependencies: { next: '^16.0.0' } });
    await init({ pm: 'pnpm', targetDir: dir, yes: true });
    const pkg = json('package.json');
    if (!typegen) {
      (pkg['scripts'] as Record<string, unknown>)['lint'] = 'oxlint .';
      writeJson('package.json', pkg);
    }
    stdout.mockClear();
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(typegen ? 0 : 1);
    expect(output().includes('stale:\n  .husky/pre-commit')).toBe(!typegen);
  });

  it('accepts a kept custom hook as a local edit', () => {
    writeFileSync(path.join(dir, '.husky/pre-commit'), 'custom hook\n');
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
    expect(output()).toContain('local-edit:\n  .husky/pre-commit');
  });

  it('ignores absent create-only files', () => {
    rmSync(path.join(dir, '.gitattributes'));
    rmSync(path.join(dir, 'tsconfig.json'));
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
    expect(output()).not.toContain('.gitattributes');
    expect(output()).not.toContain('tsconfig.json');
  });

  it.each([
    ['package.json', '{', 'package.json: invalid JSON'],
    ['package.json', '[]', 'package.json: root must be an object'],
    ['package.json', '{"scripts":[]}', 'scripts must be an object'],
    ['package.json', '{"config":[]}', 'config must be an object'],
    ['package.json', '{"devDependencies":{"husky":false}}', 'husky must be a string'],
    ['.oxlintrc.json', '{', '.oxlintrc.json: invalid JSON'],
    ['.oxlintrc.json', '{"rules":[]}', 'rules must be an object'],
    ['.oxlintrc.json', '{"plugins":{}}', 'plugins must be an array of strings'],
    ['.toolchain.json', '{', '.toolchain.json: invalid JSON'],
    ['.toolchain.json', '{"entries":[]}', 'entries must be an object'],
    ['.toolchain.json', '{"entries":{"../escape":"bad"}}', 'invalid entry path'],
    ['.toolchain.json', '{"entries":{".prettierrc":"bad"}}', 'invalid SHA-256'],
  ])('reports invalid input %s: %s', (file, text, expected) => {
    writeFileSync(path.join(dir, file), text);
    const before = files();
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(expected));
    expect(files()).toEqual(before);
    expect(execSync).not.toHaveBeenCalled();
    expect(getToolchainDeps).not.toHaveBeenCalled();
  });

  it('returns readable errors for invalid managers, unsupported stacks and missing package', () => {
    expect(doctor({ targetDir: dir, pm: 'invalid' })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Invalid package manager'));
    writeJson('package.json', { dependencies: { vue: '^3.0.0' } });
    expect(doctor({ targetDir: dir })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Vue'));
    rmSync(path.join(dir, 'package.json'));
    expect(doctor({ targetDir: dir })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('package.json: file is missing'));
  });

  it('reports a tracked-file I/O error without exiting or showing a stack trace', () => {
    rmSync(path.join(dir, '.prettierrc'));
    mkdirSync(path.join(dir, '.prettierrc'));
    const exit = vi.spyOn(process, 'exit');
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(1);
    expect(stderr).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('.prettierrc: could not read file'),
    );
    expect(String(stderr.mock.calls[0]?.[0])).not.toContain(' at ');
    expect(exit).not.toHaveBeenCalled();
  });

  it('uses cwd when targetDir is omitted and never exits the process', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    const exit = vi.spyOn(process, 'exit');
    expect(doctor({ pm: 'pnpm' })).toBe(0);
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('doctor --json', () => {
  function written(): string {
    return stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join('');
  }

  function document(): Record<string, unknown> & { rows: Record<string, unknown>[] } {
    return JSON.parse(written()) as Record<string, unknown> & { rows: Record<string, unknown>[] };
  }

  it('prints one parseable document for a fresh init', () => {
    expect(doctor({ targetDir: dir, pm: 'pnpm', json: true })).toBe(0);
    const result = document();
    expect(Object.keys(result)).toEqual(['manifest', 'needsAction', 'next', 'rows']);
    expect(result).toMatchObject({ manifest: true, needsAction: false, next: null });
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(Object.keys(row)).toEqual([
        'path',
        'state',
        'disk',
        'want',
        'needsAction',
        'stricter',
      ]);
      expect(row['disk'] === null || typeof row['disk'] === 'string').toBe(true);
      expect(row['want'] === null || typeof row['want'] === 'string').toBe(true);
    }
    expect(written().endsWith('}\n')).toBe(true);
    expect(stdout).not.toHaveBeenCalled();
  });

  it('reports rows, the next command and the manifest flag without a text report', () => {
    rmSync(path.join(dir, '.toolchain.json'));
    const config = json('.oxlintrc.json');
    (config['rules'] as Record<string, unknown>)['import/no-cycle'] = 'error';
    writeJson('.oxlintrc.json', config);
    writeFileSync(path.join(dir, '.prettierrc'), 'custom\n');
    expect(doctor({ targetDir: dir, pm: 'pnpm', json: true })).toBe(1);
    const result = document();
    expect(result).toMatchObject({
      manifest: false,
      needsAction: true,
      next: "pnpm dlx @atharvdange/toolchain update --pm pnpm --keep '.prettierrc'",
    });
    const find = (entryPath: string) => result.rows.find((row) => row['path'] === entryPath);
    expect(find('.oxlintrc.json#rules.import/no-cycle')).toMatchObject({
      state: 'local-edit',
      stricter: true,
      needsAction: false,
    });
    expect(find('.prettierrc')).toMatchObject({
      state: 'unknown-origin',
      disk: 'custom\n',
      needsAction: true,
    });
    expect(stdout).not.toHaveBeenCalled();
  });

  it('writes nothing to stdout when input is invalid', () => {
    writeFileSync(path.join(dir, 'package.json'), '{');
    expect(doctor({ targetDir: dir, pm: 'pnpm', json: true })).toBe(1);
    expect(written()).toBe('');
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('package.json: invalid JSON'));
  });
});
