import { isCancel, select } from '@clack/prompts';

import type { PackageManager } from '../detectors/project.js';
import {
  type ChoiceFlags,
  flagChoices,
  shellQuote,
  unusedFlags,
  updateCommand,
} from '../manifest/choices.js';
import type { Comparison } from '../manifest/classify.js';
import type { Choice } from '../manifest/decide.js';
import { reportComparisons } from '../manifest/report.js';
import { warn } from '../utils/logger.js';
import { CommandCancelledError } from '../utils/process.js';

function onCancel(): never {
  warn('Update cancelled. No files were changed.');
  throw new CommandCancelledError('Choose update changes');
}

// `flags` holds the whole invocation, including choices for the other pass,
// so a printed retry never drops a choice the caller already made.
// `include` names this pass's patterns: a pattern unused here fails before
// any prompt or retry, so a typo never ends up in a command to paste.
export async function chooseConflicts(
  rows: Comparison[],
  options: {
    yes: boolean;
    isTTY: boolean;
    pm: PackageManager;
    flags: ChoiceFlags;
    used: Set<string>;
    include?: (pattern: string) => boolean;
  },
): Promise<Map<string, Choice>> {
  const choices = flagChoices(rows, options.flags, options.used);
  const unused = unusedFlags(options.flags, options.used, options.include);
  if (unused.length > 0) {
    const labels = unused.map((label) => {
      const space = label.indexOf(' ');
      return `${label.slice(0, space)} ${shellQuote(label.slice(space + 1))}`;
    });
    throw new Error(
      `No differing entry matches ${labels.join(', ')}. Run doctor to see entry paths.`,
    );
  }
  if (options.yes) return choices;

  const files = new Map<string, Comparison[]>();
  for (const row of rows) {
    if (row.state !== 'conflict' && row.state !== 'unknown-origin') continue;
    if (choices.has(row.path)) continue;
    const file = row.path.split('#')[0] ?? row.path;
    const group = files.get(file) ?? [];
    group.push(row);
    files.set(file, group);
  }
  if (files.size > 0 && !options.isTTY) {
    const open = [...files.values()].flat().map((row) => row.path);
    const command = updateCommand(
      options.pm,
      [...options.flags.keep, ...open],
      options.flags.overwrite,
    );
    throw new Error(
      `Update needs a choice for ${open.length} ${open.length === 1 ? 'entry' : 'entries'} and has no terminal to ask. Rerun with a choice for each:\n  ${command}\nSwap --keep for --overwrite '<path>' to take the generated value, or add --yes to keep them without recording a choice.`,
    );
  }

  for (const [file, group] of files) {
    reportComparisons(group, { footer: false });
    const choice = await select<Choice | 'review'>({
      message: `${file}: how should these differing entries change?`,
      options: [
        { label: 'Keep all (recorded as local edits)', value: 'keep' },
        { label: 'Overwrite all differing', value: 'overwrite' },
        { label: 'Review one by one', value: 'review' },
      ],
      initialValue: 'keep',
    });
    if (isCancel(choice)) onCancel();
    if (choice === 'keep' || choice === 'overwrite') {
      for (const row of group) choices.set(row.path, choice);
    } else if (choice === 'review') {
      for (const row of group) {
        const entryChoice = await select<Choice>({
          message: row.path,
          options: [
            { label: 'Keep (recorded as a local edit)', value: 'keep' },
            { label: 'Overwrite', value: 'overwrite' },
          ],
          initialValue: 'keep',
        });
        if (isCancel(entryChoice)) onCancel();
        choices.set(row.path, entryChoice);
      }
    } else onCancel();
  }
  return choices;
}
