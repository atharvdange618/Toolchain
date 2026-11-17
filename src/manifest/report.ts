import { type Comparison, isStricterRule, needsAction, type State } from './classify.js';
import { isHookPath } from './manifest.js';

const STATES: State[] = [
  'stale',
  'conflict',
  'unknown-origin',
  'missing',
  'removed-locally',
  'obsolete',
  'local-edit',
];

// Shared by doctor's full report and update's per-file prompts. `footer` is off
// for prompts, where a project-wide total would read as that file's total.
// `hasManifest` picks a repair a legacy project can actually perform.
export function reportComparisons(
  rows: Comparison[],
  options: { footer?: boolean; hasManifest?: boolean } = {},
): void {
  const { footer = true, hasManifest = false } = options;
  for (const state of STATES) {
    const group = rows
      .filter((row) => row.state === state)
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    if (group.length === 0) continue;
    console.log(`${state}:`);
    for (const row of group) {
      console.log(`  ${row.path}${row.disk === undefined ? ' (absent)' : ''}`);
      if (state === 'local-edit' && isStricterRule(row.path, row.disk, row.want)) {
        console.log(
          `    stricter than generated (${row.disk} vs ${row.want}); keeping it is safe.`,
        );
      }
      if (state === 'stale' || state === 'conflict' || state === 'unknown-origin') {
        for (const [prefix, value] of [
          ['-', row.disk],
          ['+', row.want],
        ] as const) {
          for (const line of (value ?? '(absent)').replaceAll('\r\n', '\n').split('\n')) {
            console.log(`${prefix} ${line}`);
          }
        }
      }
      if (row.disk === undefined && row.want !== undefined && isHookPath(row.path)) {
        // A legacy project has no manifest entry to remove, so point at the
        // repair it can actually perform.
        console.log(
          `  ${row.path} is missing: ${
            hasManifest
              ? 'restore it from Git or remove its manifest entry and run update to recreate it.'
              : 'restore it from Git, or run update to recreate it.'
          }`,
        );
      }
    }
  }
  if (!footer) return;
  console.log(
    `${rows.filter((row) => row.state === 'in-sync').length} in sync; ${rows.filter(needsAction).length} need action`,
  );
}
