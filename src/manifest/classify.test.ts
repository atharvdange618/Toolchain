import { describe, expect, it } from 'vitest';

import type { Comparison, State } from './classify.js';
import { classify, needsAction } from './classify.js';

describe('classify', () => {
  it.each<[string | undefined, string | undefined, string | undefined, State]>([
    [undefined, 'w', 'w', 'in-sync'],
    ['b', 'w', 'w', 'in-sync'],
    ['b', undefined, undefined, 'obsolete'],
    ['b', 'b', undefined, 'obsolete'],
    ['b', 'd', undefined, 'local-edit'],
    ['b', undefined, 'w', 'removed-locally'],
    [undefined, undefined, 'w', 'missing'],
    [undefined, 'd', 'w', 'unknown-origin'],
    ['b', 'b', 'w', 'stale'],
    ['w', 'd', 'w', 'local-edit'],
    ['b', 'd', 'w', 'conflict'],
  ])('classifies base=%s disk=%s want=%s as %s', (base, disk, want, expected) => {
    expect(classify(base, disk, want)).toBe(expected);
  });

  it('rejects a path outside the generated and manifest union', () => {
    expect(() => classify(undefined, undefined, undefined)).toThrow();
  });
});

describe('needsAction', () => {
  it.each<[State, boolean]>([
    ['in-sync', false],
    ['stale', true],
    ['local-edit', false],
    ['conflict', true],
    ['unknown-origin', true],
    ['removed-locally', false],
    ['missing', true],
    ['obsolete', false],
  ])('reports %s action requirements for a script', (state, expected) => {
    const row: Comparison = {
      path: 'package.json#scripts.format',
      state,
      base: 'b',
      disk: undefined,
      want: '"prettier --write ."',
    };
    expect(needsAction(row)).toBe(expected);
  });

  it.each(['.husky/pre-commit', '.husky/commit-msg', 'package.json#devDependencies.oxlint'])(
    'requires action for deleted required %s only while still generated',
    (path) => {
      const row: Comparison = {
        path,
        state: 'removed-locally',
        base: 'b',
        disk: undefined,
        want: 'true',
      };
      expect(needsAction(row)).toBe(true);
      expect(needsAction({ ...row, want: undefined, state: 'obsolete' })).toBe(false);
    },
  );

  it('does not flag an edited hook or an installed dependency', () => {
    expect(
      needsAction({
        path: '.husky/pre-commit',
        state: 'local-edit',
        base: 'b',
        disk: 'edit',
        want: 'new',
      }),
    ).toBe(false);
    expect(
      needsAction({
        path: 'package.json#devDependencies.oxlint',
        state: 'in-sync',
        base: 'b',
        disk: 'true',
        want: 'true',
      }),
    ).toBe(false);
  });
});
