import { effectiveScripts } from '../generators/entry.js';
import { generateHuskyHooks } from '../generators/husky.js';
import { type Comparison, needsAction, type State } from '../manifest/classify.js';
import { compareProject, loadProject, trackedEntries } from '../manifest/project.js';
import { error } from '../utils/logger.js';

export function reportComparisons(rows: Comparison[]): void {
  const states: State[] = [
    'stale',
    'conflict',
    'unknown-origin',
    'missing',
    'removed-locally',
    'obsolete',
    'local-edit',
  ];
  for (const state of states) {
    const group = rows
      .filter((row) => row.state === state)
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    if (group.length === 0) continue;
    console.log(`${state}:`);
    for (const row of group) {
      console.log(`  ${row.path}${row.disk === undefined ? ' (absent)' : ''}`);
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
      if (
        row.disk === undefined &&
        row.want !== undefined &&
        (row.path === '.husky/pre-commit' || row.path === '.husky/commit-msg')
      ) {
        console.log(
          `  ${row.path} is missing: restore it from Git or remove its manifest entry and run update to recreate it.`,
        );
      }
    }
  }
  console.log(
    `${rows.filter((row) => row.state === 'in-sync').length} in sync; ${rows.filter(needsAction).length} need action`,
  );
}

export function doctor(options: { pm?: string; targetDir?: string }): number {
  try {
    const project = loadProject(options.targetDir ?? process.cwd(), options.pm);
    // Doctor checks the scripts hooks would run now, including intentional deletions.
    const hooks = generateHuskyHooks(effectiveScripts([], project.pkg['scripts']), project.pm);
    const plan = {
      ...project.plan,
      entries: project.plan.entries.map((entry) => {
        if (entry.path === '.husky/pre-commit') return { ...entry, want: hooks.preCommit };
        if (entry.path === '.husky/commit-msg') return { ...entry, want: hooks.commitMsg };
        return entry;
      }),
    };
    const rows = compareProject(project, trackedEntries(plan));
    reportComparisons(rows);
    if (project.manifest === undefined) {
      console.log('No .toolchain.json found. Run interactive update to adopt this project.');
    }
    return rows.some(needsAction) ? 1 : 0;
  } catch (error_) {
    error(error_ instanceof Error ? error_.message : String(error_));
    return 1;
  }
}
