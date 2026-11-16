import type { Comparison } from './classify.js';
import { hashEntry, type Manifest } from './manifest.js';

export type Choice = 'overwrite' | 'keep';
export type Action = 'write' | 'keep' | 'keep-recorded' | 'remove' | 'stamp' | 'forget';

export interface Decision {
  row: Comparison;
  action: Action;
}

export function decide(rows: Comparison[], choices: ReadonlyMap<string, Choice>): Decision[] {
  return rows.map((row) => {
    if (row.path.startsWith('package.json#devDependencies.')) {
      if (row.want === undefined) return { row, action: 'forget' };
      if (row.disk === undefined) return { row, action: 'write' };
    }
    switch (row.state) {
      case 'stale':
      case 'missing':
        return { row, action: 'write' };
      case 'in-sync':
        return { row, action: 'stamp' };
      case 'obsolete':
        return { row, action: 'remove' };
      case 'conflict':
      case 'unknown-origin': {
        const choice = choices.get(row.path);
        return {
          row,
          action: choice === 'overwrite' ? 'write' : choice === 'keep' ? 'keep-recorded' : 'keep',
        };
      }
      case 'local-edit':
      case 'removed-locally':
        return { row, action: 'keep' };
    }
  });
}

export function nextManifest(decisions: Decision[]): Manifest {
  const manifest: Manifest = {};
  for (const { row, action } of decisions) {
    const base =
      action === 'keep'
        ? row.base
        : action === 'write' || action === 'stamp' || action === 'keep-recorded'
          ? hashEntry(row.path, row.want)
          : undefined;
    if (base !== undefined) manifest[row.path] = base;
  }
  return manifest;
}
