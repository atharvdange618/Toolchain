import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import type { Comparison, State } from '../manifest/classify.js';
import * as writer from '../manifest/write.js';
import { chooseConflicts } from './update-prompts.js';

let select: MockInstance<typeof prompts.prompts.select>;
let output: MockInstance<typeof console.log>;

function row(path: string, state: State = 'conflict'): Comparison {
  return { path, state, base: 'a'.repeat(64), disk: '"local"', want: '"new"' };
}

beforeEach(() => {
  // Keep the installed prompts engine, including its cancellation handling.
  select = vi.spyOn(prompts.prompts, 'select').mockImplementation(() => 'keep');
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  Reflect.deleteProperty(prompts, '_injected');
  vi.restoreAllMocks();
});

describe('chooseConflicts', () => {
  it('groups 261 edited rules into one default-keep file prompt after displaying all diffs', async () => {
    const rows = Array.from({ length: 261 }, (_, index) =>
      row(`.oxlintrc.json#rules.rule-${index}`, 'unknown-origin'),
    );
    select.mockImplementation((question) => {
      expect(question.initial).toBe(0);
      expect(Array.isArray(question.choices) ? question.choices[0] : undefined).toMatchObject({
        value: 'keep',
      });
      expect(question.message).toContain('.oxlintrc.json');
      const text = output.mock.calls.flat().join('\n');
      for (const comparison of rows) expect(text).toContain(comparison.path);
      expect(text).toContain('- "local"');
      expect(text).toContain('+ "new"');
      return 'keep';
    });
    const choices = await chooseConflicts(rows, { yes: false, isTTY: true });
    expect(select).toHaveBeenCalledTimes(1);
    expect(choices).toEqual(new Map(rows.map((comparison) => [comparison.path, 'keep'])));
  });

  it.each(['keep', 'overwrite'])(
    'applies %s-all only to conflict and unknown-origin rows',
    async (choice) => {
      select.mockImplementation(() => choice);
      const eligible = [
        row('package.json#scripts.lint'),
        row('package.json#scripts.format', 'unknown-origin'),
      ];
      const excluded: State[] = [
        'stale',
        'local-edit',
        'missing',
        'removed-locally',
        'obsolete',
        'in-sync',
      ];
      const rows = [
        ...eligible,
        ...excluded.map((state) => row(`package.json#scripts.${state}`, state)),
      ];
      expect(await chooseConflicts(rows, { yes: false, isTTY: true })).toEqual(
        new Map(eligible.map((comparison) => [comparison.path, choice])),
      );
      expect(select).toHaveBeenCalledTimes(1);
      const text = output.mock.calls.flat().join('\n');
      for (const state of excluded) expect(text).not.toContain(`package.json#scripts.${state}`);
    },
  );

  it('reviews eligible paths individually with mixed choices and keep as each default', async () => {
    const rows = [
      row('package.json#scripts.lint'),
      row('package.json#scripts.format', 'unknown-origin'),
    ];
    select
      .mockImplementationOnce(() => 'review')
      .mockImplementationOnce((question) => {
        expect(question.message).toContain(rows[0]?.path);
        expect(question.initial).toBe(0);
        expect(Array.isArray(question.choices) ? question.choices[0] : undefined).toMatchObject({
          value: 'keep',
        });
        return 'overwrite';
      })
      .mockImplementationOnce((question) => {
        expect(question.message).toContain(rows[1]?.path);
        expect(question.initial).toBe(0);
        expect(Array.isArray(question.choices) ? question.choices[0] : undefined).toMatchObject({
          value: 'keep',
        });
        return 'keep';
      });
    expect(await chooseConflicts(rows, { yes: false, isTTY: true })).toEqual(
      new Map([
        ['package.json#scripts.lint', 'overwrite'],
        ['package.json#scripts.format', 'keep'],
      ]),
    );
    expect(select).toHaveBeenCalledTimes(3);
  });

  it.each([true, false])('--yes returns no explicit choices with TTY=%s', async (isTTY) => {
    expect(await chooseConflicts([row('.prettierrc')], { yes: true, isTTY })).toEqual(new Map());
    expect(select).not.toHaveBeenCalled();
  });

  it('requires a TTY only when a choice is needed', async () => {
    await expect(
      chooseConflicts([row('.prettierrc')], { yes: false, isTTY: false }),
    ).rejects.toThrow(/TTY.*--yes|--yes.*TTY/);
    expect(
      await chooseConflicts([row('.prettierrc', 'stale')], { yes: false, isTTY: false }),
    ).toEqual(new Map());
    expect(await chooseConflicts([], { yes: false, isTTY: false })).toEqual(new Map());
    expect(select).not.toHaveBeenCalled();
  });

  it('rejects late cancellation through the installed injected-answer API without writing or recording a manifest', async () => {
    const apply = vi.spyOn(writer, 'applyWrites');
    const manifest = vi.spyOn(writer, 'writeManifest');
    prompts.inject(['overwrite', new Error('cancelled')]);
    const result = chooseConflicts([row('.prettierrc'), row('package.json#scripts.lint')], {
      yes: false,
      isTTY: true,
    });
    await expect(result).rejects.toThrow(/abort|cancel/i);
    expect(apply).not.toHaveBeenCalled();
    expect(manifest).not.toHaveBeenCalled();
    expect(output.mock.calls.flat().join('\n')).toContain('package.json#scripts.lint');
  });

  it('rejects cancellation while reviewing a path', async () => {
    prompts.inject(['review', new Error('cancelled')]);
    await expect(
      chooseConflicts([row('.prettierrc')], { yes: false, isTTY: true }),
    ).rejects.toThrow(/abort|cancel/i);
  });
});
