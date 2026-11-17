import type { PackageManager } from '../detectors/project.js';
import { pmDlx } from '../detectors/project.js';
import type { Comparison } from './classify.js';
import type { Choice } from './decide.js';

export interface ChoiceFlags {
  keep: string[];
  overwrite: string[];
}

// A `*` before the `#` could reach across files, up to `--keep '*'`, which
// keeps every entry unseen. Requiring a literal file name caps a pattern at
// one file's entries, the same reach as the prompt's per-file "Keep all".
export function assertPattern(pattern: string): void {
  const hash = pattern.indexOf('#');
  const fileName = hash === -1 ? pattern : pattern.slice(0, hash);
  if (fileName.includes('*')) {
    throw new Error(
      `Invalid pattern ${shellQuote(pattern)}: the file name before # must be literal; * is allowed only after #.`,
    );
  }
}

export function matchesEntry(pattern: string, entryPath: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(entryPath);
}

export function flagChoices(
  rows: Comparison[],
  flags: ChoiceFlags,
  used: Set<string>,
): Map<string, Choice> {
  const choices = new Map<string, Choice>();
  for (const row of rows) {
    if (row.state !== 'conflict' && row.state !== 'unknown-origin') continue;
    const keep = flags.keep.filter((pattern) => matchesEntry(pattern, row.path));
    const overwrite = flags.overwrite.filter((pattern) => matchesEntry(pattern, row.path));
    if (keep.length > 0 && overwrite.length > 0) {
      throw new Error(`${row.path} matches both --keep and --overwrite. Pick one choice for it.`);
    }
    for (const pattern of keep) used.add(`--keep ${pattern}`);
    for (const pattern of overwrite) used.add(`--overwrite ${pattern}`);
    if (keep.length > 0) choices.set(row.path, 'keep');
    else if (overwrite.length > 0) choices.set(row.path, 'overwrite');
  }
  return choices;
}

export function unusedFlags(
  flags: ChoiceFlags,
  used: Set<string>,
  include: (pattern: string) => boolean = () => true,
): string[] {
  return [
    ...flags.keep.filter(include).map((pattern) => `--keep ${pattern}`),
    ...flags.overwrite.filter(include).map((pattern) => `--overwrite ${pattern}`),
  ].filter((label) => !used.has(label));
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function updateCommand(
  pm: PackageManager,
  keep: string[],
  overwrite: string[] = [],
): string {
  const flag = (name: string, values: string[]): string[] =>
    [...new Set(values)].sort().map((value) => `--${name} ${shellQuote(value)}`);
  return [
    `${pmDlx(pm)} @atharvdange/toolchain update --pm ${pm}`,
    ...flag('keep', keep),
    ...flag('overwrite', overwrite),
  ].join(' ');
}
