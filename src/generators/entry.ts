import path from 'node:path';

import { assertEntryPath } from '../manifest/manifest.js';
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

function splitKey(entryPath: string, prefix = PKG_PREFIX): [string, string | undefined] {
  const rest = entryPath.slice(prefix.length);
  const dot = rest.indexOf('.');
  return dot === -1 ? [rest, undefined] : [rest.slice(0, dot), rest.slice(dot + 1)];
}

export function applyKeyEntries(
  target: Record<string, unknown>,
  prefix: string,
  entries: Entry[],
): void {
  const draft = structuredClone(target);
  const changed = new Set<string>();
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue;
    assertEntryPath(entry.path);
    const [top, key] = splitKey(entry.path, prefix);
    const value: unknown = entry.want === null ? undefined : JSON.parse(entry.want);
    const current = Object.hasOwn(draft, top) ? draft[top] : undefined;
    changed.add(top);
    if (key === undefined) {
      if (value === undefined) delete draft[top];
      else draft[top] = value;
    } else if (prefix === '.oxlintrc.json#' && (top === 'plugins' || top === 'ignorePatterns')) {
      if (
        current !== undefined &&
        (!Array.isArray(current) || !current.every((item: unknown) => typeof item === 'string'))
      )
        throw new Error(`${prefix}${top} must be an array of strings`);
      if (value !== undefined && value !== key)
        throw new Error(`${entry.path}: membership value must match its selector`);
      if (current === undefined && value === undefined) continue;
      const items = current === undefined ? [] : current;
      if (value === undefined) draft[top] = items.filter((item) => item !== key);
      else if (!items.includes(key)) draft[top] = [...items, key];
      else draft[top] = items;
    } else {
      if (
        current !== undefined &&
        (typeof current !== 'object' || current === null || Array.isArray(current))
      )
        throw new Error(`${prefix}${top} must be an object`);
      if (current === undefined && value === undefined) continue;
      const object = (current ?? {}) as Record<string, unknown>;
      if (
        prefix === PKG_PREFIX &&
        (top === 'scripts' || top === 'devDependencies') &&
        value !== undefined &&
        typeof value !== 'string'
      )
        throw new Error(`${entry.path} must be a string`);
      if (value === undefined) delete object[key];
      else object[key] = value;
      draft[top] = object;
    }
  }
  // Validate every selected entry before changing the caller's object.
  for (const top of changed) {
    if (Object.hasOwn(draft, top)) target[top] = draft[top];
    else delete target[top];
  }
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
  applyKeyEntries(pkg, PKG_PREFIX, keyEntries);
  writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

// The scripts package.json will hold once the entries apply, so the hooks can
// follow the plan instead of the disk.
export function effectiveScripts(entries: Entry[], onDisk: unknown): Record<string, string> {
  // package.json is user data, so keep only string scripts from a plain object.
  const scripts: Record<string, string> = {};
  if (typeof onDisk === 'object' && onDisk !== null && !Array.isArray(onDisk)) {
    for (const [name, cmd] of Object.entries(onDisk)) {
      if (typeof cmd === 'string') scripts[name] = cmd;
    }
  }
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
