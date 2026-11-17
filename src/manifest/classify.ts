import { isHookPath } from './manifest.js';

export type State =
  | 'in-sync'
  | 'stale'
  | 'local-edit'
  | 'conflict'
  | 'unknown-origin'
  | 'removed-locally'
  | 'missing'
  | 'obsolete';

export interface Comparison {
  path: string;
  state: State;
  base: string | undefined;
  disk: string | undefined;
  want: string | undefined;
}

// `stricterLocally` turns an unknown-origin or conflict into a local-edit: a
// rule the user raised above the generated severity loses nothing by staying.
// A stale entry still updates, since the user never chose that value.
export function classify(
  base: string | undefined,
  disk: string | undefined,
  want: string | undefined,
  stricterLocally = false,
): State {
  if (want !== undefined && disk === want) return 'in-sync';
  if (want === undefined) {
    if (base === undefined)
      throw new Error('Cannot classify a path with no base or generated value');
    return disk === undefined || disk === base ? 'obsolete' : 'local-edit';
  }
  if (disk === undefined) return base === undefined ? 'missing' : 'removed-locally';
  if (base === undefined) return stricterLocally ? 'local-edit' : 'unknown-origin';
  if (disk === base) return 'stale';
  return want === base || stricterLocally ? 'local-edit' : 'conflict';
}

const SEVERITY: ReadonlyMap<unknown, number> = new Map<unknown, number>([
  ['off', 0],
  ['allow', 0],
  [0, 0],
  ['warn', 1],
  [1, 1],
  ['error', 2],
  ['deny', 2],
  [2, 2],
]);

function severity(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  try {
    return SEVERITY.get(JSON.parse(value));
  } catch {
    return undefined;
  }
}

// Plain severities only: an array form carries options, and stricter options
// are not something this can judge.
export function isStricterRule(
  entryPath: string,
  disk: string | undefined,
  want: string | undefined,
): boolean {
  if (!entryPath.startsWith('.oxlintrc.json#rules.')) return false;
  const local = severity(disk);
  const generated = severity(want);
  return local !== undefined && generated !== undefined && local > generated;
}

export function needsAction(row: Comparison): boolean {
  if (['stale', 'conflict', 'unknown-origin', 'missing'].includes(row.state)) return true;
  return (
    row.want !== undefined &&
    row.disk === undefined &&
    (isHookPath(row.path) || row.path.startsWith('package.json#devDependencies.'))
  );
}
