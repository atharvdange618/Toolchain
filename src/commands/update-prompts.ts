import prompts from 'prompts';

import type { Comparison } from '../manifest/classify.js';
import type { Choice } from '../manifest/decide.js';
import { reportComparisons } from './doctor.js';

function onCancel(): never {
  throw new Error('Update cancelled. No files were changed.');
}

export async function chooseConflicts(
  rows: Comparison[],
  options: { yes: boolean; isTTY: boolean },
): Promise<Map<string, Choice>> {
  const choices = new Map<string, Choice>();
  if (options.yes) return choices;

  const files = new Map<string, Comparison[]>();
  for (const row of rows) {
    if (row.state !== 'conflict' && row.state !== 'unknown-origin') continue;
    const file = row.path.split('#')[0] ?? row.path;
    const group = files.get(file) ?? [];
    group.push(row);
    files.set(file, group);
  }
  if (files.size > 0 && !options.isTTY) {
    throw new Error(
      'Update needs a TTY to choose conflicts. Run with --yes to keep them without recording a choice.',
    );
  }

  for (const [file, group] of files) {
    reportComparisons(group);
    const response = await prompts(
      {
        type: 'select',
        name: 'choice',
        message: `${file}: how should these differing entries change?`,
        choices: [
          { title: 'Keep all (recorded as local edits)', value: 'keep' },
          { title: 'Overwrite all differing', value: 'overwrite' },
          { title: 'Review one by one', value: 'review' },
        ],
        initial: 0,
      },
      { onCancel },
    );
    const choice: unknown = response['choice'];
    if (choice === 'keep' || choice === 'overwrite') {
      for (const row of group) choices.set(row.path, choice);
    } else if (choice === 'review') {
      for (const row of group) {
        const answer = await prompts(
          {
            type: 'select',
            name: 'choice',
            message: row.path,
            choices: [
              { title: 'Keep (recorded as a local edit)', value: 'keep' },
              { title: 'Overwrite', value: 'overwrite' },
            ],
            initial: 0,
          },
          { onCancel },
        );
        const entryChoice: unknown = answer['choice'];
        if (entryChoice !== 'keep' && entryChoice !== 'overwrite') onCancel();
        choices.set(row.path, entryChoice);
      }
    } else onCancel();
  }
  return choices;
}
