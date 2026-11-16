import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import type { Comparison, State } from '../manifest/classify.js';
import { hashEntry, parseManifest, serializeManifest } from '../manifest/manifest.js';
import { compareProject, loadProject, trackedEntries } from '../manifest/project.js';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('../utils/versions.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/versions.js')>();
  return {
    ...original,
    getToolchainDeps: vi.fn(() =>
      Object.fromEntries(original.TOOLCHAIN_DEP_NAMES.map((name) => [name, '^7.0.2'])),
    ),
  };
});

const { execSync } = await import('node:child_process');
const { getToolchainDeps } = await import('../utils/versions.js');
const { init } = await import('./init.js');
const { doctor, reportComparisons } = await import('./doctor.js');

let dir: string;
let stdout: MockInstance<typeof console.log>;
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
  const manifest = parseManifest(readFileSync(path.join(dir, '.toolchain.json'), 'utf8')) ?? {};
  const hash = hashEntry(entryPath, value);
  if (hash === undefined) throw new Error('Expected hash');
  manifest[entryPath] = hash;
  writeFileSync(path.join(dir, '.toolchain.json'), serializeManifest(manifest));
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
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
  stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  await init({ pm: 'pnpm', targetDir: dir, yes: true });
  vi.mocked(execSync).mockClear();
  vi.mocked(getToolchainDeps).mockClear();
  stdout.mockClear();
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
        const manifest =
          parseManifest(readFileSync(path.join(dir, '.toolchain.json'), 'utf8')) ?? {};
        delete manifest['.prettierrc'];
        writeFileSync(path.join(dir, '.toolchain.json'), serializeManifest(manifest));
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
    expect(output()).toContain('interactive update');
    expect(output()).toContain('adopt');
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

describe('reportComparisons', () => {
  function row(state: State, entryPath = `${state}-entry`): Comparison {
    return { path: entryPath, state, base: undefined, disk: undefined, want: undefined };
  }

  it('prints nonempty groups in the required order with sorted paths and totals', () => {
    const states: State[] = [
      'stale',
      'conflict',
      'unknown-origin',
      'missing',
      'removed-locally',
      'obsolete',
      'local-edit',
    ];
    reportComparisons([
      row('in-sync'),
      ...[...states]
        .reverse()
        .flatMap((state) => [row(state, `${state}-z`), row(state, `${state}-a`)]),
    ]);
    const text = output();
    let previous = -1;
    for (const state of states) {
      const position = text.indexOf(`${state}:`);
      expect(position).toBeGreaterThan(previous);
      expect(text.indexOf(`${state}-a`)).toBeLessThan(text.indexOf(`${state}-z`));
      previous = position;
    }
    expect(text).toContain('1 in sync');
    expect(text).toContain('8 need action');
  });

  it('prefixes every diff line, including blank lines, and distinguishes absent from null', () => {
    reportComparisons([
      { ...row('stale', 'multi'), disk: 'one\r\n\ntwo\n', want: 'three\nfour\n' },
      { ...row('conflict', 'absent'), disk: undefined, want: 'null' },
      { ...row('unknown-origin', 'removed'), disk: 'value', want: undefined },
    ]);
    expect(output()).toContain('- one\n- \n- two\n- \n+ three\n+ four\n+ \n');
    expect(output()).toContain('- (absent)\n+ null\n');
    expect(output()).toContain('- value\n+ (absent)\n');
  });

  it('omits empty groups and reports zero totals', () => {
    reportComparisons([]);
    expect(output()).toBe('0 in sync; 0 need action\n');
  });
});
