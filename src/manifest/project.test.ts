import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyEntries } from '../generators/entry.js';
import { TOOLCHAIN_DEP_NAMES } from '../utils/versions.js';
import { hashEntry, serializeManifest } from './manifest.js';
import {
  compareProject,
  loadProject,
  snapshotJson,
  trackedEntries,
  validatePackageJson,
} from './project.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => {
    throw new Error('Unexpected registry call');
  }),
}));

let dir: string;
function write(file: string, value: unknown): void {
  const full = path.join(dir, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value));
}
function install(framework = 'plain'): void {
  write('package.json', {
    name: 'demo',
    dependencies: framework === 'expo' ? { expo: '^55.0.0' } : {},
  });
  const project = loadProject(dir, 'pnpm');
  applyEntries(dir, project.plan.entries);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'toolchain-project-'));
  write('package.json', { name: 'demo' });
  vi.stubEnv('npm_config_user_agent', '');
});
afterEach(() => {
  expect(execSync).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('offline project snapshot', () => {
  it('parses each input JSON once and shares the validated values with writers', () => {
    const pkgText = '{"name":"parse-once-fixture","devDependencies":{"husky":"^8"}}';
    const oxText = '{"rules":{"untracked.rule":"warn"},"options":{"second":2,"first":1}}';
    const manifestText = '{"entries":{}}';
    write('package.json', pkgText);
    write('.oxlintrc.json', oxText);
    write('.toolchain.json', manifestText);
    const parse = vi.spyOn(JSON, 'parse');
    const project = loadProject(dir);
    const entries = trackedEntries(project.plan);
    compareProject(project, entries);
    compareProject(project, entries);
    expect(snapshotJson(project, 'package.json')).toBe(project.pkg);
    expect(snapshotJson(project, '.oxlintrc.json')).toEqual({
      rules: { 'untracked.rule': 'warn' },
      options: { second: 2, first: 1 },
    });
    for (const text of [pkgText, oxText, manifestText])
      expect(parse.mock.calls.filter(([input]) => input === text)).toHaveLength(1);
  });

  it('keeps literal null distinct from an absent JSON value', () => {
    const entryPath = '.oxlintrc.json#options';
    write('.oxlintrc.json', { options: null });
    const project = loadProject(dir);
    expect(compareProject(project, [{ path: entryPath, want: 'null' }])[0]).toMatchObject({
      state: 'in-sync',
      disk: 'null',
      want: 'null',
    });
  });

  it('returns original entry text while classifying normalized hashes', () => {
    const base = hashEntry('.editorconfig', 'root = true\n');
    if (base === undefined) throw new Error('Fixture has no base hash');
    write('.editorconfig', 'root = true\r\n');
    write('package.json', { devDependencies: { husky: '^8' } });
    write('.oxlintrc.json', { options: { second: 2, first: 1 } });
    write('.toolchain.json', serializeManifest({ entries: { '.editorconfig': base } }));
    const project = loadProject(dir);
    const rows = compareProject(project, [
      { path: '.editorconfig', want: 'root = true\n' },
      { path: '.oxlintrc.json#options', want: '{"first":1,"second":2}' },
      { path: 'package.json#devDependencies.husky', want: 'true' },
      { path: '.husky/commit-msg', want: 'commitlint\n' },
    ]);
    expect(rows).toEqual([
      {
        path: '.editorconfig',
        state: 'in-sync',
        base,
        disk: 'root = true\r\n',
        want: 'root = true\n',
      },
      {
        path: '.husky/commit-msg',
        state: 'missing',
        base: undefined,
        disk: undefined,
        want: 'commitlint\n',
      },
      {
        path: '.oxlintrc.json#options',
        state: 'in-sync',
        base: undefined,
        disk: '{"second":2,"first":1}',
        want: '{"first":1,"second":2}',
      },
      {
        path: 'package.json#devDependencies.husky',
        state: 'in-sync',
        base: undefined,
        disk: 'true',
        want: 'true',
      },
    ]);
  });
  it.each(['plain', 'expo'])(
    'compares a freshly applied %s plan in sync, twice from the same bytes',
    (framework) => {
      install(framework);
      const project = loadProject(dir, 'pnpm');
      const entries = trackedEntries(project.plan);
      const rows = compareProject(project, entries);
      expect(rows.length).toBeGreaterThan(30);
      expect(rows.every((row) => row.state === 'in-sync')).toBe(true);
      write('.editorconfig', 'edited after snapshot');
      expect(compareProject(project, entries)).toEqual(rows);
      expect(project.snapshot.has('.toolchain.json')).toBe(true);
      expect(project.snapshot.get('.toolchain.json')).toBeUndefined();
      expect(project.snapshot.has('.gitattributes')).toBe(true);
      expect(project.snapshot.has('tsconfig.json')).toBe(true);
      expect(project.snapshot.has('pnpm-lock.yaml')).toBe(true);
    },
  );

  it('normalizes CRLF and JSON object order, preserves installed ranges, ignores untracked values', () => {
    install();
    write(
      '.editorconfig',
      readFileSync(path.join(dir, '.editorconfig'), 'utf8').replaceAll('\n', '\r\n'),
    );
    const installed = loadProject(dir, 'pnpm');
    const pkg = installed.pkg;
    pkg['devDependencies'] = Object.fromEntries(
      TOOLCHAIN_DEP_NAMES.map((name) => [name, 'custom:range']),
    );
    write('package.json', pkg);
    const ox = snapshotJson(installed, '.oxlintrc.json');
    if (ox === undefined) throw new Error('Fixture has no oxlint config');
    const rules = ox['rules'] as Record<string, unknown>;
    const unused = rules['eslint/no-unused-vars'] as [string, Record<string, unknown>];
    unused[1] = Object.fromEntries(Object.entries(unused[1]).reverse());
    rules['my.rule'] = 'off';
    ox['plugins'] = [...(ox['plugins'] as string[]), 'my.plugin'];
    write('.oxlintrc.json', Object.fromEntries(Object.entries(ox).reverse()));
    const project = loadProject(dir, 'pnpm');
    const rows = compareProject(project, trackedEntries(project.plan));
    expect(rows.every((row) => row.state === 'in-sync')).toBe(true);
    expect(rows.some((row) => row.path.includes('my.rule') || row.path.includes('my.plugin'))).toBe(
      false,
    );
    expect(
      project.plan.entries.find((entry) => entry.path === 'package.json#devDependencies.husky')
        ?.want,
    ).toBe('"custom:range"');
  });

  it.each([
    [{ devDependencies: { husky: '^8' } }, 'in-sync'],
    [{ devDependencies: { husky: '' } }, 'missing'],
    [{ dependencies: { husky: '^8' } }, 'missing'],
    [{}, 'missing'],
  ])('uses nonempty devDependency declarations for presence: %j', (pkg, state) => {
    write('package.json', pkg);
    const project = loadProject(dir);
    expect(
      compareProject(project, trackedEntries(project.plan)).find(
        (row) => row.path === 'package.json#devDependencies.husky',
      )?.state,
    ).toBe(state);
  });

  it('compares manifest-only absent and edited rules as obsolete and local-edit', () => {
    const old = '.oxlintrc.json#rules.old.rule';
    const edited = '.oxlintrc.json#rules.edited.rule';
    write(
      '.toolchain.json',
      serializeManifest({
        entries: {
          [old]: hashEntry(old, '"warn"')!,
          [edited]: hashEntry(edited, '"warn"')!,
        },
      }),
    );
    write('.oxlintrc.json', { rules: { 'edited.rule': 'error' } });
    const project = loadProject(dir);
    const rows = compareProject(project, trackedEntries(project.plan));
    expect(rows.find((row) => row.path === old)).toMatchObject({
      state: 'obsolete',
      want: undefined,
      disk: undefined,
    });
    expect(rows.find((row) => row.path === edited)?.state).toBe('local-edit');
    expect(rows.map((row) => row.path)).toEqual(rows.map((row) => row.path).sort());
  });

  it('records workspace metadata used for unresolved-type warnings', () => {
    write('package.json', { workspaces: ['packages/*'] });
    write('packages/a/package.json', { name: 'a', dependencies: { b: '*' } });
    write('packages/a/tsconfig.json', { compilerOptions: {} });
    write('packages/b/package.json', { name: 'b', types: 'dist/index.d.ts' });
    write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    const project = loadProject(dir);
    expect(project.info.unresolvedWorkspaceTypes).toEqual(['a -> b']);
    for (const file of [
      'packages/a/package.json',
      'packages/a/tsconfig.json',
      'packages/b/package.json',
      'packages/b/dist/index.d.ts',
      'pnpm-workspace.yaml',
    ])
      expect(project.snapshot.has(file)).toBe(true);
    expect(project.plan.entries.some((entry) => entry.path.startsWith('packages/'))).toBe(false);
  });

  it('rejects missing package.json, bad managers and unsupported stacks offline', () => {
    rmSync(path.join(dir, 'package.json'));
    expect(() => loadProject(dir)).toThrow('package.json');
    write('package.json', {});
    expect(() => loadProject(dir, 'invalid')).toThrow('Invalid package manager "invalid"');
    write('package.json', { dependencies: { vue: '^3' } });
    expect(() => loadProject(dir)).toThrow(
      'Unsupported project: Vue (found "vue" in package.json).',
    );
  });
});

describe('trackedEntries', () => {
  it('expands exact selectors, preserves dotted tails, and excludes create-only files and dependency removals', () => {
    expect(
      trackedEntries({
        messages: [],
        entries: [
          { path: '.gitattributes', want: 'x' },
          { path: 'tsconfig.json', want: '{}' },
          { path: '.editorconfig', want: 'x' },
          {
            path: '.oxlintrc.json',
            want: JSON.stringify({
              plugins: ['import'],
              ignorePatterns: ['**/*.{js,mjs,cjs}'],
              rules: { 'import/no-cycle': 'warn' },
              options: { typeAware: true },
              overrides: [{ files: ['**/*.test.ts'] }],
            }),
          },
          { path: 'package.json#devDependencies.old', want: null },
          { path: 'package.json#devDependencies.a.b', want: '"^1"' },
          { path: 'package.json#scripts.lint', want: '"oxlint ."' },
        ],
      }),
    ).toEqual([
      { path: '.editorconfig', want: 'x' },
      { path: '.oxlintrc.json#plugins.import', want: '"import"' },
      { path: '.oxlintrc.json#ignorePatterns.**/*.{js,mjs,cjs}', want: '"**/*.{js,mjs,cjs}"' },
      { path: '.oxlintrc.json#rules.import/no-cycle', want: '"warn"' },
      { path: '.oxlintrc.json#options', want: '{"typeAware":true}' },
      { path: '.oxlintrc.json#overrides', want: '[{"files":["**/*.test.ts"]}]' },
      { path: 'package.json#devDependencies.a.b', want: 'true' },
      { path: 'package.json#scripts.lint', want: '"oxlint ."' },
    ]);
  });

  it.each(['plain', 'expo'])(
    'expands the exact %s generator paths without whole oxlint containers',
    (framework) => {
      install(framework);
      const project = loadProject(dir);
      const paths = trackedEntries(project.plan).map((entry) => entry.path);
      expect(paths).toMatchSnapshot();
      expect(paths).toContain('.oxlintrc.json#rules.import/no-cycle');
      expect(paths).toContain('.oxlintrc.json#plugins.import');
      expect(paths.includes('.oxlintrc.json#ignorePatterns.**/*.{js,mjs,cjs}')).toBe(
        framework === 'plain',
      );
      expect(paths.includes('.oxlintrc.json#overrides')).toBe(framework === 'expo');
      expect(paths).not.toContain('.oxlintrc.json');
      expect(paths).not.toContain('.oxlintrc.json#rules');
    },
  );
});

describe('project validation', () => {
  it.each([null, [], 1, 'bad'])('rejects package root %j', (value) => {
    expect(() => validatePackageJson(value)).toThrow(/package.json.*root/);
  });
  it.each([
    'scripts',
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
    'config',
  ])('rejects array-valued %s', (field) => {
    write('package.json', { [field]: [] });
    expect(() => loadProject(dir)).toThrow(`package.json: ${field}`);
  });
  it.each(['scripts', 'dependencies', 'devDependencies'])(
    'rejects non-string %s values',
    (field) => {
      write('package.json', { [field]: { bad: 1 } });
      expect(() => loadProject(dir)).toThrow(`package.json: ${field}.bad`);
    },
  );
  it.each([
    [[], 'root'],
    [{ rules: [] }, 'rules'],
    [{ plugins: [1] }, 'plugins'],
    [{ ignorePatterns: ['ok', false] }, 'ignorePatterns'],
    [{ overrides: {} }, 'overrides'],
    [{ overrides: [null] }, 'overrides'],
    [{ overrides: [{ rules: [] }] }, 'overrides[0].rules'],
  ])('rejects malformed oxlint %j', (value, field) => {
    write('.oxlintrc.json', value);
    expect(() => loadProject(dir)).toThrow(`.oxlintrc.json: ${field}`);
  });
  it.each(['package.json', '.oxlintrc.json', '.toolchain.json'])('names %s on bad JSON', (file) => {
    write(file, '{');
    expect(() => loadProject(dir)).toThrow(file);
  });
});

describe('package manager resolution', () => {
  function record(packageManager: 'bun' | 'npm' | 'pnpm' | 'yarn'): void {
    write('.toolchain.json', serializeManifest({ packageManager, entries: {} }));
  }

  it('uses the recorded manager when nothing in the tree names one', () => {
    record('pnpm');

    expect(loadProject(dir).pm).toBe('pnpm');
  });

  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
  ] as const)('lets %s outrank the recorded manager', (lockfile, expected) => {
    record('yarn');
    write(lockfile, '');

    expect(loadProject(dir).pm).toBe(expected);
  });

  it('lets devEngines outrank the recorded manager', () => {
    record('pnpm');
    write('package.json', { name: 'demo', devEngines: { packageManager: { name: 'npm' } } });

    expect(loadProject(dir).pm).toBe('npm');
  });

  it('lets --pm outrank both the tree and the record', () => {
    record('pnpm');
    write('package-lock.json', '{}');

    expect(loadProject(dir, 'bun').pm).toBe('bun');
  });

  it('ignores the invoking user agent so hooks are compared against the project', () => {
    record('pnpm');
    vi.stubEnv('npm_config_user_agent', 'yarn/4.0.0 node/v20.0.0');

    expect(loadProject(dir).pm).toBe('pnpm');
  });
});
