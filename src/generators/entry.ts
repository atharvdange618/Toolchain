import path from 'node:path';

import { readJson, writeFile } from '../utils/fs.js';

// One thing init wants on disk. A plain path is a whole file and `want` its
// content. `package.json#<top>` or `package.json#<top>.<key>` is one JSON key,
// `want` is its JSON.stringify'd value and null deletes it. The key part
// splits at the first dot only, so `<key>` may hold dots (eslint-plugin-a.b).
export interface Entry {
  path: string;
  want: string | null;
}

export interface PlanMessage {
  level: 'info' | 'warn';
  text: string;
}

export interface Plan {
  entries: Entry[];
  messages: PlanMessage[];
}

const PKG_PREFIX = 'package.json#';

function splitKey(entryPath: string): [string, string | undefined] {
  const rest = entryPath.slice(PKG_PREFIX.length);
  const dot = rest.indexOf('.');
  return dot === -1 ? [rest, undefined] : [rest.slice(0, dot), rest.slice(dot + 1)];
}

export function applyEntries(targetDir: string, entries: Entry[]): void {
  const keyEntries = entries.filter((entry) => entry.path.startsWith(PKG_PREFIX));

  for (const entry of entries) {
    if (entry.path.startsWith(PKG_PREFIX)) continue;
    if (entry.want === null) throw new Error(`File removal is not supported: ${entry.path}`);
    writeFile(path.join(targetDir, entry.path), entry.want);
  }

  if (keyEntries.length === 0) return;
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = readJson(pkgPath);
  for (const entry of keyEntries) {
    const [top, key] = splitKey(entry.path);
    const value: unknown = entry.want === null ? undefined : JSON.parse(entry.want);
    if (key === undefined) {
      if (value === undefined) delete pkg[top];
      else pkg[top] = value;
      continue;
    }
    const current = pkg[top];
    const object: Record<string, unknown> =
      typeof current === 'object' && current !== null ? (current as Record<string, unknown>) : {};
    if (value === undefined) delete object[key];
    else object[key] = value;
    pkg[top] = object;
  }
  writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

// The scripts package.json will hold once the entries apply, so the hooks can
// follow the plan instead of the disk.
export function effectiveScripts(
  entries: Entry[],
  onDisk: Record<string, string> | undefined,
): Record<string, string> {
  const scripts = { ...onDisk };
  for (const entry of entries) {
    if (!entry.path.startsWith(`${PKG_PREFIX}scripts.`)) continue;
    const [, name] = splitKey(entry.path);
    if (name === undefined) continue;
    const value: unknown = entry.want === null ? undefined : JSON.parse(entry.want);
    if (typeof value === 'string') scripts[name] = value;
    else delete scripts[name];
  }
  return scripts;
}
