import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as logger from '../utils/logger.js';
import { loadProject } from './project.js';
import { applyWrites, assertUnchanged, prepareWrites, writeManifest } from './write.js';

vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }));

let dir: string;
function put(file: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}
function read(file: string): string {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}
beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(tmpdir(), 'toolchain-write-'));
  put('package.json', '{"name":"demo"}');
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('prepareWrites', () => {
  it('keeps no-op JSON bytes and does not replace the files', () => {
    put('package.json', '{ "scripts": { "lint": "oxlint ." } }\r\n');
    put('.oxlintrc.json', '{ "plugins": ["import"], "rules": {"custom":"warn"} }\r\n');
    const project = loadProject(dir);
    const writes = prepareWrites(project, [
      { path: 'package.json#scripts.lint', want: '"oxlint ."' },
      { path: '.oxlintrc.json#plugins.import', want: '"import"' },
    ]);
    expect(writes).toEqual([]);
    expect(applyWrites(dir, writes, project.snapshot, [])).toEqual([]);
    expect(read('package.json')).toBe('{ "scripts": { "lint": "oxlint ." } }\r\n');
    expect(read('.oxlintrc.json')).toBe(
      '{ "plugins": ["import"], "rules": {"custom":"warn"} }\r\n',
    );
  });

  it('clones snapshots and preserves untracked options and order in changed JSON', () => {
    put(
      '.oxlintrc.json',
      '{"rules":{"custom":["warn",{"option":true}],"import/no-cycle":"off"},"plugins":["react"]}',
    );
    const project = loadProject(dir);
    const writes = prepareWrites(project, [
      { path: '.oxlintrc.json#rules.import/no-cycle', want: '"warn"' },
      { path: '.oxlintrc.json#plugins.import', want: '"import"' },
      { path: 'package.json#scripts.lint', want: '"oxlint ."' },
    ]);
    expect(writes.map((entry) => entry.path)).toEqual(['.oxlintrc.json', 'package.json']);
    applyWrites(dir, writes, project.snapshot, []);
    expect(JSON.parse(read('.oxlintrc.json'))).toEqual({
      rules: { custom: ['warn', { option: true }], 'import/no-cycle': 'warn' },
      plugins: ['react', 'import'],
    });
    expect(read('package.json')).toBe(
      '{\n  "name": "demo",\n  "scripts": {\n    "lint": "oxlint ."\n  }\n}\n',
    );
    expect(project.pkg).toEqual({ name: 'demo' });
    expect(
      prepareWrites(project, [{ path: '.oxlintrc.json#plugins.import', want: '"import"' }]),
    ).toHaveLength(1);
  });

  it('distinguishes JSON null from removal and skips existing create-only files', () => {
    put('tsconfig.json', '{"compilerOptions":{}}');
    const project = loadProject(dir);
    expect(
      prepareWrites(project, [
        { path: '.oxlintrc.json#custom', want: 'null' },
        { path: 'package.json#scripts.lint', want: null },
        { path: 'tsconfig.json', want: 'changed' },
        { path: '.gitattributes', want: '* text=auto\n' },
        { path: '.prettierrc', want: null },
      ]),
    ).toEqual([
      { path: '.oxlintrc.json', want: '{\n  "custom": null\n}\n' },
      { path: '.gitattributes', want: '* text=auto\n' },
    ]);
  });

  it.each(['../outside', 'package.json', '.toolchain.json'])(
    'rejects unsupported logical writes: %s',
    (file) => {
      expect(() => prepareWrites(loadProject(dir), [{ path: file, want: 'x' }])).toThrow();
    },
  );
});

describe('safe writes', () => {
  it('backs up complete originals once with the first free suffix', () => {
    const original = '{ "rules": { "custom": "warn", "import/no-cycle": "off" } }';
    put('.oxlintrc.json', original);
    put('.oxlintrc.json.bak', 'first');
    put('.oxlintrc.json.bak.1', 'second');
    const project = loadProject(dir);
    const writes = prepareWrites(project, [
      { path: '.oxlintrc.json#rules.import/no-cycle', want: '"warn"' },
    ]);
    expect(
      applyWrites(dir, writes, project.snapshot, ['.oxlintrc.json', '.oxlintrc.json']),
    ).toEqual(['.oxlintrc.json']);
    expect(read('.oxlintrc.json.bak.2')).toBe(original);
    expect(fs.existsSync(path.join(dir, '.oxlintrc.json.bak.3'))).toBe(false);
    expect(read('.oxlintrc.json.bak')).toBe('first');
    expect(read('.oxlintrc.json.bak.1')).toBe('second');
  });

  it('finishes all backups before writing any content', () => {
    put('.prettierrc', 'old');
    put('.editorconfig', 'old editor');
    const project = loadProject(dir);
    const originalCopy = fs.copyFileSync;
    vi.spyOn(fs, 'copyFileSync').mockImplementation((source, destination, mode) => {
      if (source.toString().endsWith('.editorconfig')) throw new Error('backup failure');
      originalCopy(source, destination, mode);
    });
    expect(() =>
      applyWrites(
        dir,
        [
          { path: '.prettierrc', want: 'new' },
          { path: '.editorconfig', want: 'new editor' },
        ],
        project.snapshot,
        ['.prettierrc', '.editorconfig'],
      ),
    ).toThrow('backup failure');
    expect(read('.prettierrc')).toBe('old');
    expect(read('.editorconfig')).toBe('old editor');
  });

  it.each(['package.json', 'pnpm-lock.yaml'])(
    'aborts changed or newly created inputs before backups: %s',
    (file) => {
      put('.prettierrc', 'old');
      const project = loadProject(dir);
      put(file, 'changed while prompting');
      expect(() => assertUnchanged(dir, project.snapshot)).toThrow(file);
      expect(() =>
        applyWrites(dir, [{ path: '.prettierrc', want: 'new' }], project.snapshot, ['.prettierrc']),
      ).toThrow(file);
      expect(fs.existsSync(path.join(dir, '.prettierrc.bak'))).toBe(false);
      expect(read('.prettierrc')).toBe('old');
    },
  );

  it.each(['../outside', '/outside', '.toolchain.json', '.husky/../outside'])(
    'refuses unsafe content targets: %s',
    (file) => {
      expect(() =>
        applyWrites(dir, [{ path: file, want: 'new' }], loadProject(dir).snapshot, []),
      ).toThrow();
    },
  );

  it('refuses directory junction parents before creating backups', (context) => {
    const outside = fs.mkdtempSync(path.join(tmpdir(), 'toolchain-outside-'));
    try {
      try {
        fs.symlinkSync(outside, path.join(dir, '.husky'), 'junction');
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          (error.code === 'EPERM' || error.code === 'EACCES')
        ) {
          context.skip();
          return;
        }
        throw error;
      }
      expect(() =>
        applyWrites(
          dir,
          [{ path: '.husky/pre-commit', want: 'new' }],
          loadProject(dir).snapshot,
          [],
        ),
      ).toThrow(/symlink/i);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(path.join(dir, '.husky'), { force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each(['.prettierrc', '.husky', '.toolchain.json'])(
    'refuses symlinks reported by the filesystem: %s',
    (file) => {
      put('.prettierrc', 'old');
      put('.toolchain.json', '{"entries":{}}');
      fs.mkdirSync(path.join(dir, '.husky'));
      const project = loadProject(dir);
      const lstat = fs.lstatSync;
      vi.spyOn(fs, 'lstatSync').mockImplementation((target, options) => {
        const stat = lstat(target, options);
        if (path.resolve(target.toString()) === path.join(dir, file)) {
          Object.defineProperty(stat, 'isSymbolicLink', { value: () => true });
        }
        return stat;
      });
      expect(() =>
        applyWrites(
          dir,
          [
            { path: '.husky/pre-commit', want: 'new' },
            { path: '.prettierrc', want: 'new' },
          ],
          project.snapshot,
          ['.prettierrc'],
        ),
      ).toThrow(/symlink/i);
      expect(read('.prettierrc')).toBe('old');
      expect(fs.existsSync(path.join(dir, '.prettierrc.bak'))).toBe(false);
      if (file === '.toolchain.json') expect(() => writeManifest(dir, {})).toThrow(/symlink/i);
    },
  );

  it.skipIf(process.platform === 'win32')('refuses file symlinks, including the manifest', () => {
    put('outside', 'original');
    const project = loadProject(dir);
    fs.symlinkSync(path.join(dir, 'outside'), path.join(dir, '.toolchain.json'));
    expect(() =>
      applyWrites(dir, [{ path: '.prettierrc', want: 'new' }], project.snapshot, []),
    ).toThrow(/symlink/i);
    expect(() => writeManifest(dir, {})).toThrow(/symlink/i);
    expect(read('outside')).toBe('original');
    fs.unlinkSync(path.join(dir, '.toolchain.json'));
    fs.symlinkSync(path.join(dir, 'outside'), path.join(dir, '.prettierrc'));
    expect(() =>
      applyWrites(dir, [{ path: '.prettierrc', want: 'new' }], project.snapshot, []),
    ).toThrow(/symlink/i);
  });

  it.skipIf(process.platform === 'win32')('retains executable hook permission bits', () => {
    put('.husky/pre-commit', 'old');
    fs.chmodSync(path.join(dir, '.husky/pre-commit'), 0o751);
    const project = loadProject(dir);
    applyWrites(dir, [{ path: '.husky/pre-commit', want: 'new' }], project.snapshot, []);
    expect(fs.statSync(path.join(dir, '.husky/pre-commit')).mode & 0o777).toBe(0o751);
  });

  it('preserves old files and cleans temporary siblings on rename failure', () => {
    put('.prettierrc', 'old');
    const project = loadProject(dir);
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('rename failed');
    });
    expect(() =>
      applyWrites(dir, [{ path: '.prettierrc', want: 'new' }], project.snapshot, []),
    ).toThrow(/completed.*none.*rename failed/i);
    expect(read('.prettierrc')).toBe('old');
    expect(fs.readdirSync(dir).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('reports partial writes and leaves the old manifest untouched', () => {
    put('.prettierrc', 'old');
    put('.editorconfig', 'old editor');
    put('.toolchain.json', '{"entries":{}}');
    const project = loadProject(dir);
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (destination.toString().endsWith('.editorconfig')) throw new Error('second failed');
      rename(source, destination);
    });
    expect(() =>
      applyWrites(
        dir,
        [
          { path: '.prettierrc', want: 'new' },
          { path: '.editorconfig', want: 'new editor' },
        ],
        project.snapshot,
        [],
      ),
    ).toThrow(/completed.*\.prettierrc.*second failed/i);
    expect(read('.prettierrc')).toBe('new');
    expect(read('.editorconfig')).toBe('old editor');
    expect(read('.toolchain.json')).toBe('{"entries":{}}');
  });

  it('removes files without backups and reports removal I/O failures', () => {
    put('.prettierrc', 'old');
    const project = loadProject(dir);
    const unlink = fs.unlinkSync;
    vi.spyOn(fs, 'unlinkSync').mockImplementation((file) => {
      if (file.toString().endsWith('.prettierrc')) throw new Error('remove failed');
      unlink(file);
    });
    expect(() =>
      applyWrites(dir, [{ path: '.prettierrc', want: null }], project.snapshot, []),
    ).toThrow('remove failed');
    vi.restoreAllMocks();
    expect(applyWrites(dir, [{ path: '.prettierrc', want: null }], project.snapshot, [])).toEqual([
      '.prettierrc',
    ]);
    expect(fs.existsSync(path.join(dir, '.prettierrc'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.prettierrc.bak'))).toBe(false);
  });
});

describe('writeManifest', () => {
  it('writes deterministic manifest bytes and leaves matching bytes untouched', () => {
    const manifest = { '.prettierrc': 'a'.repeat(64), '.editorconfig': 'b'.repeat(64) };
    writeManifest(dir, manifest);
    expect(read('.toolchain.json')).toBe(
      `{\n  "entries": {\n    ".editorconfig": "${'b'.repeat(64)}",\n    ".prettierrc": "${'a'.repeat(64)}"\n  }\n}\n`,
    );
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('must remain untouched');
    });
    expect(() => writeManifest(dir, manifest)).not.toThrow();
  });

  it('keeps the old manifest if atomic replacement fails', () => {
    put('.toolchain.json', '{"entries":{}}');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('rename failed');
    });
    expect(() => writeManifest(dir, {})).toThrow('rename failed');
    expect(read('.toolchain.json')).toBe('{"entries":{}}');
    expect(fs.readdirSync(dir).filter((name) => name.includes('.tmp'))).toEqual([]);
  });
});
