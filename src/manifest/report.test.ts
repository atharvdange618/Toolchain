import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import type { Comparison, State } from './classify.js';
import { reportComparisons } from './report.js';

let stdout: MockInstance<typeof console.log>;

function output(): string {
  return stdout.mock.calls.map((args) => `${args.map(String).join(' ')}\n`).join('');
}

function row(state: State, entryPath = `${state}-entry`): Comparison {
  return { path: entryPath, state, base: undefined, disk: undefined, want: undefined };
}

beforeEach(() => {
  stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('reportComparisons', () => {
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

  // update prompts per file, so a project-wide total mid-run would read wrong.
  it('can print only the rows, without the project footer', () => {
    reportComparisons([row('conflict', 'package.json#scripts.lint')], { footer: false });
    expect(output()).toContain('conflict:');
    expect(output()).not.toContain('need action');
  });

  it('names a repair the project can perform when it has no manifest', () => {
    reportComparisons([{ ...row('missing', '.husky/pre-commit'), want: 'hook\n' }], {
      hasManifest: false,
    });
    expect(output()).toContain('restore it from Git, or run update to recreate it.');
    expect(output()).not.toContain('remove its manifest entry');
  });

  it('offers the manifest-entry repair when a manifest exists', () => {
    reportComparisons([{ ...row('missing', '.husky/pre-commit'), want: 'hook\n' }], {
      hasManifest: true,
    });
    expect(output()).toContain('remove its manifest entry and run update');
  });
});
