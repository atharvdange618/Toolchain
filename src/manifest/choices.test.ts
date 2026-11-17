import { describe, expect, it } from 'vitest';

import {
  assertPattern,
  flagChoices,
  matchesEntry,
  shellQuote,
  unusedFlags,
  updateCommand,
} from './choices.js';
import type { Comparison, State } from './classify.js';
import { isHookPath } from './manifest.js';

function row(path: string, state: State): Comparison {
  return { path, state, base: undefined, disk: 'd', want: 'w' };
}

describe('assertPattern', () => {
  it.each(['.prettierrc', '.oxlintrc.json#rules.*', '.oxlintrc.json#*'])(
    'accepts %s',
    (pattern) => {
      expect(() => assertPattern(pattern)).not.toThrow();
    },
  );

  it.each(['*', '.*', '*#rules.x', '.prettier*', '**'])('rejects %s', (pattern) => {
    expect(() => assertPattern(pattern)).toThrow(/file name before # must be literal/);
  });
});

describe('matchesEntry', () => {
  it.each<[string, string, boolean]>([
    ['.prettierrc', '.prettierrc', true],
    ['.prettierrc', '.prettierrc.bak', false],
    ['.oxlintrc.json#rules.*', '.oxlintrc.json#rules.react/purity', true],
    ['.oxlintrc.json#rules.*', '.oxlintrc.json#overrides', false],
    ['a.b', 'axb', false],
  ])('matchesEntry(%s, %s) is %s', (pattern, entryPath, expected) => {
    expect(matchesEntry(pattern, entryPath)).toBe(expected);
  });
});

describe('flagChoices', () => {
  it('chooses only conflict and unknown-origin rows and records used flags', () => {
    const used = new Set<string>();
    const choices = flagChoices(
      [
        row('.prettierrc', 'unknown-origin'),
        row('.oxlintrc.json#rules.x', 'conflict'),
        row('.oxlintrc.json#rules.y', 'in-sync'),
      ],
      { keep: ['.oxlintrc.json#rules.*'], overwrite: ['.prettierrc'] },
      used,
    );

    expect(choices).toEqual(
      new Map([
        ['.prettierrc', 'overwrite'],
        ['.oxlintrc.json#rules.x', 'keep'],
      ]),
    );
    expect(choices.has('.oxlintrc.json#rules.y')).toBe(false);
    expect(used).toEqual(new Set(['--keep .oxlintrc.json#rules.*', '--overwrite .prettierrc']));
  });

  it('does not count a pattern that matches only rows the prompts never cover', () => {
    const used = new Set<string>();
    flagChoices(
      [row('.oxlintrc.json#rules.y', 'stale')],
      { keep: ['.oxlintrc.json#rules.*'], overwrite: [] },
      used,
    );
    expect(used.size).toBe(0);
  });

  it('throws when one row matches both --keep and --overwrite', () => {
    expect(() =>
      flagChoices(
        [row('.oxlintrc.json#rules.x', 'conflict')],
        { keep: ['.oxlintrc.json#*'], overwrite: ['.oxlintrc.json#rules.x'] },
        new Set(),
      ),
    ).toThrow(/\.oxlintrc\.json#rules\.x matches both --keep and --overwrite/);
  });
});

describe('unusedFlags', () => {
  it('returns labels never marked used', () => {
    expect(unusedFlags({ keep: ['a', 'b'], overwrite: ['c'] }, new Set(['--keep a']))).toEqual([
      '--keep b',
      '--overwrite c',
    ]);
  });

  it('limits the check to the patterns the filter includes', () => {
    expect(
      unusedFlags(
        { keep: ['.husky/pre-commit', '.nope'], overwrite: [] },
        new Set(),
        (p) => !isHookPath(p),
      ),
    ).toEqual(['--keep .nope']);
  });
});

describe('shellQuote', () => {
  it('quotes for a POSIX shell, escaping single quotes', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe('updateCommand', () => {
  it('uses the project manager runner and sorts keep values', () => {
    expect(updateCommand('npm', ['b', 'a'])).toBe(
      "npx --yes @atharvdange/toolchain update --pm npm --keep 'a' --keep 'b'",
    );
    expect(updateCommand('pnpm', [])).toBe('pnpm dlx @atharvdange/toolchain update --pm pnpm');
    expect(updateCommand('bun', [])).toBe('bunx @atharvdange/toolchain update --pm bun');
    expect(updateCommand('yarn', [])).toBe('yarn dlx @atharvdange/toolchain update --pm yarn');
  });

  it('sorts and deduplicates keeps then overwrites without mutating inputs', () => {
    const keep = ['b', 'a', 'a'];
    const overwrite = ['z', 'c', 'c'];
    expect(updateCommand('npm', keep, overwrite)).toBe(
      "npx --yes @atharvdange/toolchain update --pm npm --keep 'a' --keep 'b' --overwrite 'c' --overwrite 'z'",
    );
    expect(keep).toEqual(['b', 'a', 'a']);
    expect(overwrite).toEqual(['z', 'c', 'c']);
  });
});
