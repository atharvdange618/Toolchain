import { describe, expect, it } from 'vitest';

import { classify, type Comparison, type State } from './classify.js';
import { type Action, type Choice, decide, nextManifest } from './decide.js';
import { hashEntry } from './manifest.js';

const script = 'package.json#scripts.lint';

function row(
  baseText: string | undefined,
  disk: string | undefined,
  want: string | undefined,
  path = script,
): Comparison {
  const base = hashEntry(path, baseText);
  return {
    path,
    base,
    disk,
    want,
    state: classify(base, hashEntry(path, disk), hashEntry(path, want)),
  };
}

describe('decide and nextManifest', () => {
  it.each<[string | undefined, string | undefined, string | undefined, Action]>([
    [undefined, '"new"', '"new"', 'stamp'],
    ['"old"', '"new"', '"new"', 'stamp'],
    ['"old"', '"old"', '"new"', 'write'],
    [undefined, undefined, '"new"', 'write'],
    ['"old"', '"edit"', '"old"', 'keep'],
    ['"old"', undefined, '"new"', 'keep'],
    ['"old"', '"edit"', '"new"', 'keep'],
    [undefined, '"edit"', '"new"', 'keep'],
    ['"old"', '"old"', undefined, 'remove'],
    ['"old"', undefined, undefined, 'remove'],
    ['"old"', '"edit"', undefined, 'keep'],
  ])('decides base=%s disk=%s want=%s as %s', (base, disk, want, action) => {
    const comparison = row(base, disk, want);
    const before = structuredClone(comparison);
    const decisions = decide([comparison], new Map());
    expect(decisions).toEqual([{ row: comparison, action }]);
    const expectedBase =
      action === 'stamp' || action === 'write'
        ? hashEntry(script, want)
        : action === 'keep'
          ? comparison.base
          : undefined;
    expect(nextManifest(decisions)).toEqual(
      expectedBase === undefined ? {} : { [script]: expectedBase },
    );
    expect(comparison).toEqual(before);
  });

  it.each<Choice>(['keep', 'overwrite'])(
    'honors explicit %s only for conflict and unknown origin',
    (choice) => {
      const rows = [
        row('"old"', '"edit"', '"new"'),
        row(undefined, '"edit"', '"new"', 'package.json#scripts.format'),
        row('"old"', '"old"', '"new"', 'package.json#scripts.typecheck'),
        row('"old"', '"edit"', '"old"', 'package.json#scripts.prepare'),
        row('"old"', undefined, '"new"', '.oxlintrc.json#rules.example'),
      ];
      const choices = new Map(rows.map((comparison) => [comparison.path, choice]));
      expect(decide(rows, choices).map(({ action }) => action)).toEqual([
        choice === 'keep' ? 'keep-recorded' : 'write',
        choice === 'keep' ? 'keep-recorded' : 'write',
        'write',
        'keep',
        'keep',
      ]);
    },
  );

  it.each([true, false])('records explicit keep as want, with existing base=%s', (tracked) => {
    const first = row(tracked ? '"old"' : undefined, '"edit"', '"new"');
    const manifest = nextManifest(decide([first], new Map([[script, 'keep']])));
    expect(manifest).toEqual({ [script]: hashEntry(script, '"new"') });
    expect(
      classify(manifest[script], hashEntry(script, first.disk), hashEntry(script, first.want)),
    ).toBe('local-edit');
    expect(
      classify(manifest[script], hashEntry(script, first.disk), hashEntry(script, '"newer"')),
    ).toBe('conflict');
  });

  it('adopts safe legacy creations and matches but leaves differing entries untracked', () => {
    const rows = [
      row(undefined, undefined, '"new"'),
      row(undefined, '"new"', '"new"', 'package.json#scripts.format'),
      row(undefined, '"edit"', '"new"', 'package.json#scripts.typecheck'),
    ];
    expect(nextManifest(decide(rows, new Map()))).toEqual({
      [script]: hashEntry(script, '"new"'),
      'package.json#scripts.format': hashEntry('package.json#scripts.format', '"new"'),
    });
  });

  it('retains an edited obsolete base until disk is absent or matches it', () => {
    const edited = row('"old"', '"edit"', undefined);
    expect(nextManifest(decide([edited], new Map()))).toEqual({ [script]: edited.base });
    for (const disk of [undefined, '"old"']) {
      expect(nextManifest(decide([row('"old"', disk, undefined)], new Map()))).toEqual({});
    }
  });

  it('hashes entry text by selector, including whole files and literal JSON null', () => {
    const rows = [
      row('old\n', 'old\n', 'new\r\n', '.husky/pre-commit'),
      row(undefined, undefined, '{"b":2,"a":1}', '.oxlintrc.json#settings'),
      row(undefined, 'null', 'null', '.oxlintrc.json#overrides'),
    ];
    expect(nextManifest(decide(rows, new Map()))).toEqual({
      '.husky/pre-commit': hashEntry('.husky/pre-commit', 'new\n'),
      '.oxlintrc.json#settings': hashEntry('.oxlintrc.json#settings', '{"a":1,"b":2}'),
      '.oxlintrc.json#overrides': hashEntry('.oxlintrc.json#overrides', 'null'),
    });
  });

  const states: State[] = [
    'in-sync',
    'stale',
    'local-edit',
    'conflict',
    'unknown-origin',
    'removed-locally',
    'missing',
    'obsolete',
  ];
  it.each(states)(
    'forgets dropped devDependencies regardless of %s and explicit overwrite',
    (state) => {
      const comparison: Comparison = {
        path: 'package.json#devDependencies.@scope/dropped.pkg',
        state,
        base: hashEntry(script, 'true'),
        disk: 'true',
        want: undefined,
      };
      const decisions = decide([comparison], new Map([[comparison.path, 'overwrite']]));
      expect(decisions).toEqual([{ row: comparison, action: 'forget' }]);
      expect(nextManifest(decisions)).toEqual({});
    },
  );

  it.each([undefined, 'true'])(
    'restores required absent devDependencies with base=%s despite explicit keep',
    (base) => {
      const comparison = row(base, undefined, 'true', 'package.json#devDependencies.oxlint');
      const decisions = decide([comparison], new Map([[comparison.path, 'keep']]));
      expect(decisions).toEqual([{ row: comparison, action: 'write' }]);
      expect(nextManifest(decisions)).toEqual({
        [comparison.path]: hashEntry(comparison.path, 'true'),
      });
    },
  );
});
