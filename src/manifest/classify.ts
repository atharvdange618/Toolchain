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

export function classify(
  base: string | undefined,
  disk: string | undefined,
  want: string | undefined,
): State {
  if (want !== undefined && disk === want) return 'in-sync';
  if (want === undefined) {
    if (base === undefined)
      throw new Error('Cannot classify a path with no base or generated value');
    return disk === undefined || disk === base ? 'obsolete' : 'local-edit';
  }
  if (disk === undefined) return base === undefined ? 'missing' : 'removed-locally';
  if (base === undefined) return 'unknown-origin';
  if (disk === base) return 'stale';
  return want === base ? 'local-edit' : 'conflict';
}

export function needsAction(row: Comparison): boolean {
  if (['stale', 'conflict', 'unknown-origin', 'missing'].includes(row.state)) return true;
  return (
    row.want !== undefined &&
    row.disk === undefined &&
    (isHookPath(row.path) || row.path.startsWith('package.json#devDependencies.'))
  );
}
