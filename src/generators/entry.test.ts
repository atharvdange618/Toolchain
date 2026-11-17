import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyEntries, applyKeyEntries, effectiveScripts } from './entry.js';

let dir: string;

function writePkg(pkg: Record<string, unknown>): void {
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
}

function readPkgText(): string {
  return readFileSync(path.join(dir, 'package.json'), 'utf8');
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'toolchain-entry-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('applyEntries', () => {
  it('writes a file entry, creating its parent directory', () => {
    applyEntries(dir, [{ path: '.husky/pre-commit', want: 'pnpm exec lint-staged\n' }]);

    expect(readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf8')).toBe(
      'pnpm exec lint-staged\n',
    );
  });

  it('creates missing top-level objects in entry order', () => {
    writePkg({ name: 'demo' });

    applyEntries(dir, [
      { path: 'package.json#scripts.lint', want: '"oxlint ."' },
      { path: 'package.json#lint-staged', want: '{"*.ts":["oxlint"]}' },
      { path: 'package.json#devDependencies.oxlint', want: '"^1.0.0"' },
    ]);

    expect(readPkgText()).toBe(
      '{\n  "name": "demo",\n  "scripts": {\n    "lint": "oxlint ."\n  },\n  "lint-staged": {\n    "*.ts": [\n      "oxlint"\n    ]\n  },\n  "devDependencies": {\n    "oxlint": "^1.0.0"\n  }\n}\n',
    );
  });

  it('keeps an existing key in place and appends new ones after', () => {
    writePkg({ name: 'demo', scripts: { lint: 'eslint .', build: 'tsc' } });

    applyEntries(dir, [
      { path: 'package.json#scripts.format', want: '"prettier --write ."' },
      { path: 'package.json#scripts.lint', want: '"oxlint ."' },
    ]);

    const pkg = JSON.parse(readPkgText()) as { scripts: Record<string, string> };
    expect(Object.entries(pkg.scripts)).toEqual([
      ['lint', 'oxlint .'],
      ['build', 'tsc'],
      ['format', 'prettier --write .'],
    ]);
  });

  it('deletes a key whose name contains a dot', () => {
    writePkg({ devDependencies: { 'eslint-plugin-foo.bar': '^1.0.0', husky: '^9.0.0' } });

    applyEntries(dir, [{ path: 'package.json#devDependencies.eslint-plugin-foo.bar', want: null }]);

    expect(JSON.parse(readPkgText())).toEqual({ devDependencies: { husky: '^9.0.0' } });
  });

  it('leaves package.json untouched when no entry targets it', () => {
    writePkg({ name: 'demo' });

    applyEntries(dir, [{ path: '.editorconfig', want: 'root = true\n' }]);

    expect(readPkgText()).toBe('{"name":"demo"}');
  });

  it('deletes a top-level key and keeps the others in place', () => {
    writePkg({ name: 'demo', 'lint-staged': { '*.ts': ['eslint'] }, version: '1.0.0' });

    applyEntries(dir, [{ path: 'package.json#lint-staged', want: null }]);

    expect(Object.keys(JSON.parse(readPkgText()) as object)).toEqual(['name', 'version']);
  });

  it('refuses a file deletion, which this step never plans', () => {
    expect(() => applyEntries(dir, [{ path: '.prettierrc', want: null }])).toThrow('.prettierrc');
    expect(existsSync(path.join(dir, '.prettierrc'))).toBe(false);
  });
});

describe('effectiveScripts', () => {
  it('overlays planned scripts onto the ones on disk', () => {
    expect(
      effectiveScripts(
        [
          { path: 'package.json#scripts.lint', want: '"oxlint ."' },
          { path: 'package.json#scripts.test', want: null },
          { path: 'package.json#scripts.odd', want: '42' },
          { path: 'package.json#devDependencies.oxlint', want: '"^1.0.0"' },
          { path: '.husky/pre-commit', want: 'x' },
        ],
        { lint: 'eslint .', test: 'vitest', typecheck: 'turbo run check' },
      ),
    ).toEqual({ lint: 'oxlint .', typecheck: 'turbo run check' });
  });

  it('returns an empty object with no scripts and no entries', () => {
    expect(effectiveScripts([], undefined)).toEqual({});
  });

  it.each([
    ['a string', 'oxlint .'],
    ['an array', ['oxlint .']],
  ])('ignores scripts on disk when they are %s', (_name, onDisk) => {
    expect(effectiveScripts([], onDisk)).toEqual({});
  });

  it('drops non-string script values on disk', () => {
    expect(effectiveScripts([], { lint: 'oxlint .', odd: 42 })).toEqual({ lint: 'oxlint .' });
  });
});

describe('applyKeyEntries', () => {
  it('creates missing membership arrays and preserves existing item order', () => {
    const config = { rules: { custom: ['warn', { option: true }] } };
    applyKeyEntries(config, '.oxlintrc.json#', [
      { path: '.oxlintrc.json#plugins.import', want: '"import"' },
      { path: '.oxlintrc.json#plugins.import', want: '"import"' },
      { path: '.oxlintrc.json#ignorePatterns.**/*.config.*', want: '"**/*.config.*"' },
    ]);
    expect(config).toEqual({
      rules: { custom: ['warn', { option: true }] },
      plugins: ['import'],
      ignorePatterns: ['**/*.config.*'],
    });
  });

  it('removes every selected copy without changing other items', () => {
    const config = { plugins: ['react', 'import', 'unicorn', 'import'] };
    applyKeyEntries(config, '.oxlintrc.json#', [
      { path: '.oxlintrc.json#plugins.import', want: null },
    ]);
    expect(config.plugins).toEqual(['react', 'unicorn']);
  });

  it('does not create missing containers for removals', () => {
    const pkg = { name: 'demo' };
    applyKeyEntries(pkg, 'package.json#', [
      { path: 'package.json#devDependencies.eslint', want: null },
    ]);
    expect(pkg).toEqual({ name: 'demo' });
  });

  it('drops config when removing its last key, and keeps other config keys', () => {
    const only = { config: { commitizen: { path: 'x' } }, name: 'demo' };
    applyKeyEntries(only, 'package.json#', [
      { path: 'package.json#config.commitizen', want: null },
    ]);
    expect(only).toEqual({ name: 'demo' });

    const shared = { config: { commitizen: { path: 'x' }, other: true } };
    applyKeyEntries(shared, 'package.json#', [
      { path: 'package.json#config.commitizen', want: null },
    ]);
    expect(shared).toEqual({ config: { other: true } });
  });

  it.each([
    { path: 'package.json#config.commitizen', want: '{}' },
    { path: 'package.json#scripts.__proto__', want: '"unsafe"' },
    { path: 'package.json#constructor.prototype', want: '"unsafe"' },
  ])('validates all selected properties before mutation: $path', (bad) => {
    const pkg = { config: [] };
    expect(() =>
      applyKeyEntries(pkg, 'package.json#', [
        { path: 'package.json#scripts.lint', want: '"oxlint ."' },
        bad,
      ]),
    ).toThrow();
    expect(pkg).toEqual({ config: [] });
  });

  it('rejects malformed membership arrays rather than discarding them', () => {
    const config = { plugins: { custom: true } };
    expect(() =>
      applyKeyEntries(config, '.oxlintrc.json#', [
        { path: '.oxlintrc.json#plugins.import', want: '"import"' },
      ]),
    ).toThrow('plugins');
    expect(config).toEqual({ plugins: { custom: true } });
  });
});
