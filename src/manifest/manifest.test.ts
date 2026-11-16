import { describe, expect, it } from 'vitest';

import {
  assertEntryPath,
  hashEntry,
  MANIFEST_FILE,
  parseManifest,
  serializeManifest,
} from './manifest.js';

const textHash = '87428fc522803d31065e7bce3cf03fe475096631e5e07bbd7a0fde60c4cf25c7';
const presenceHash = 'b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b';

describe('hashEntry', () => {
  it('normalizes CRLF but preserves the final newline in whole files', () => {
    expect(hashEntry('.husky/pre-commit', 'a\r\n')).toBe(textHash);
    expect(hashEntry('.husky/pre-commit', 'a\n')).toBe(textHash);
    expect(hashEntry('.husky/pre-commit', 'a')).not.toBe(textHash);
    expect(hashEntry('.husky/pre-commit', 'a\n ')).not.toBe(textHash);
  });

  it('sorts nested object keys without changing array order', () => {
    expect(hashEntry('package.json#lint-staged', '{"z":{"b":1,"a":2},"a":[{"d":1,"c":2}]}')).toBe(
      hashEntry('package.json#lint-staged', '{"a":[{"c":2,"d":1}],"z":{"a":2,"b":1}}'),
    );
    expect(hashEntry('.oxlintrc.json#overrides', '[{"a":1},{"b":2}]')).not.toBe(
      hashEntry('.oxlintrc.json#overrides', '[{"b":2},{"a":1}]'),
    );
  });

  it('keeps missing, literal null and an empty JSON string distinct', () => {
    expect(hashEntry('package.json#lint-staged', undefined)).toBeUndefined();
    expect(hashEntry('package.json#lint-staged', 'null')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashEntry('package.json#lint-staged', 'null')).not.toBe(
      hashEntry('package.json#lint-staged', '""'),
    );
  });

  it('hashes dependency presence as the stable JSON literal true', () => {
    expect(hashEntry('package.json#devDependencies.oxlint', 'true')).toBe(presenceHash);
  });

  it('keeps literal prototype keys when sorting JSON values', () => {
    expect(hashEntry('package.json#lint-staged', '{"__proto__":{"a":1}}')).not.toBe(
      hashEntry('package.json#lint-staged', '{}'),
    );
  });

  it('rejects invalid entry JSON with the entry path in the error', () => {
    expect(() => hashEntry('package.json#lint-staged', '{')).toThrow('package.json#lint-staged');
  });
});

describe('assertEntryPath', () => {
  it.each([
    '.editorconfig',
    '.prettierrc',
    '.prettierignore',
    'commitlint.config.mjs',
    '.husky/pre-commit',
    '.husky/commit-msg',
    '.oxlintrc.json#$schema',
    '.oxlintrc.json#categories',
    '.oxlintrc.json#options',
    '.oxlintrc.json#overrides',
    '.oxlintrc.json#rules.import/no-cycle',
    '.oxlintrc.json#rules.custom.name',
    '.oxlintrc.json#plugins.import',
    '.oxlintrc.json#ignorePatterns.**/*.{js,mjs,cjs}',
    '.oxlintrc.json#ignorePatterns.../generated/**',
    'package.json#scripts.lint:fix',
    'package.json#scripts.custom.name',
    'package.json#lint-staged',
    'package.json#config.commitizen',
    'package.json#devDependencies.@scope/package.name',
    'package.json#devDependencies.package.name',
  ])('accepts %s', (entryPath) => {
    expect(() => assertEntryPath(entryPath)).not.toThrow();
  });

  it.each([
    '/.editorconfig',
    'C:/project/.editorconfig',
    '../.editorconfig',
    '.husky/../package.json',
    '.husky\\pre-commit',
    'unknown.json',
    '.gitattributes',
    'tsconfig.json',
    'package.json',
    '.oxlintrc.json',
    '',
    'package.json#name',
    'package.json#dependencies.oxlint',
    'package.json#config',
    'package.json#config.commitizen.path',
    'package.json#scripts',
    'package.json#scripts.',
    'package.json#devDependencies.',
    'package.json#__proto__.x',
    'package.json#scripts.__proto__',
    'package.json#devDependencies.constructor',
    '.oxlintrc.json#prototype',
    '.oxlintrc.json#rules.constructor',
    '.oxlintrc.json#rules.',
    '.oxlintrc.json#plugins.',
    '.oxlintrc.json#ignorePatterns.',
    '.oxlintrc.json#options.typeAware',
    '.oxlintrc.json#rules',
    '.oxlintrc.json#plugins',
    '.oxlintrc.json#ignorePatterns',
  ])('rejects %s', (entryPath) => {
    expect(() => assertEntryPath(entryPath)).toThrow(MANIFEST_FILE);
  });
});

describe('manifest format', () => {
  it('treats absent text as an absent manifest', () => {
    expect(parseManifest(undefined)).toBeUndefined();
  });

  it('sorts paths with two-space indentation and a final LF, then round-trips real hashes', () => {
    const entries = {
      'package.json#devDependencies.oxlint': presenceHash,
      '.husky/pre-commit': textHash,
    };
    const text = serializeManifest({ entries });
    expect(text).toBe(
      `{\n  "entries": {\n    ".husky/pre-commit": "${textHash}",\n    "package.json#devDependencies.oxlint": "${presenceHash}"\n  }\n}\n`,
    );
    expect(parseManifest(text)).toEqual({ entries });
  });

  it('records the package manager beside the entries and omits it when unknown', () => {
    const text = serializeManifest({
      packageManager: 'pnpm',
      entries: { '.prettierrc': textHash },
    });
    expect(text).toBe(
      `{\n  "packageManager": "pnpm",\n  "entries": {\n    ".prettierrc": "${textHash}"\n  }\n}\n`,
    );
    expect(parseManifest(text)).toEqual({
      packageManager: 'pnpm',
      entries: { '.prettierrc': textHash },
    });
    expect(parseManifest(serializeManifest({ entries: {} }))).toEqual({ entries: {} });
  });

  it.each(['volta', 'pnpm@9', '', 1, null])(
    'rejects an invalid recorded packageManager %s',
    (packageManager) => {
      expect(() => parseManifest(JSON.stringify({ packageManager, entries: {} }))).toThrow(
        MANIFEST_FILE,
      );
    },
  );

  it('accepts an empty entries object', () => {
    expect(parseManifest('{"entries":{}}')).toEqual({ entries: {} });
  });

  it.each([
    '{',
    '[]',
    'null',
    'true',
    '{}',
    '{"entries":null}',
    '{"entries":[]}',
    '{"entries":"x"}',
  ])('rejects malformed roots and entries: %s', (text) => {
    expect(() => parseManifest(text)).toThrow(MANIFEST_FILE);
  });

  it.each([textHash.toUpperCase(), 'a'.repeat(63), 'g'.repeat(64), '', null, 1])(
    'rejects a non-hash entry value %s',
    (hash) => {
      expect(() => parseManifest(JSON.stringify({ entries: { '.prettierrc': hash } }))).toThrow(
        MANIFEST_FILE,
      );
    },
  );

  it('validates paths while parsing and serializing', () => {
    expect(() => parseManifest(JSON.stringify({ entries: { '../escape': textHash } }))).toThrow(
      MANIFEST_FILE,
    );
    expect(() => serializeManifest({ entries: { '../escape': textHash } })).toThrow(MANIFEST_FILE);
    expect(() => serializeManifest({ entries: { '.prettierrc': 'invalid' } })).toThrow(
      MANIFEST_FILE,
    );
  });
});
