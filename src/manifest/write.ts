import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { applyKeyEntries, type Entry } from '../generators/entry.js';
import { serializeOxlintConfig } from '../generators/oxlint.js';
import * as logger from '../utils/logger.js';
import { assertEntryPath, MANIFEST_FILE, type Manifest, serializeManifest } from './manifest.js';
import { type Project, type Snapshot, snapshotJson } from './project.js';

const CREATE_ONLY = new Set(['.gitattributes', 'tsconfig.json']);
const JSON_FILES = new Set(['package.json', '.oxlintrc.json']);

function assertWholeFile(file: string, manifest = false): void {
  if (JSON_FILES.has(file) || CREATE_ONLY.has(file) || (manifest && file === MANIFEST_FILE)) return;
  if (file.includes('#')) throw new Error(`Expected a whole-file path: ${file}`);
  assertEntryPath(file);
}

export function prepareWrites(project: Project, entries: Entry[]): Entry[] {
  const grouped = new Map<string, Entry[]>();
  for (const entry of entries) {
    const file = entry.path.split('#')[0] ?? entry.path;
    if (CREATE_ONLY.has(entry.path)) {
      if (project.snapshot.get(file) !== undefined || entry.want === null) continue;
    } else assertEntryPath(entry.path);
    if (entry.path.startsWith('package.json#devDependencies.')) {
      if (entry.want === null)
        throw new Error(`Dependency removal is not supported: ${entry.path}`);
      if (entry.want === '"toolchain:unresolved"')
        throw new Error(`Resolve dependency before writing: ${entry.path}`);
    }
    const group = grouped.get(file) ?? [];
    group.push(entry);
    grouped.set(file, group);
  }
  const writes: Entry[] = [];
  for (const [file, selected] of grouped) {
    const original = project.snapshot.get(file);
    let want: string | null;
    if (file === 'package.json' || file === '.oxlintrc.json') {
      const before = snapshotJson(project, file) ?? {};
      const after = structuredClone(before);
      applyKeyEntries(after, `${file}#`, selected);
      if (isDeepStrictEqual(before, after)) continue;
      want =
        file === 'package.json'
          ? `${JSON.stringify(after, null, 2)}\n`
          : serializeOxlintConfig(after);
    } else {
      want = selected.at(-1)?.want ?? null;
      if (
        want === null
          ? original === undefined
          : original?.replaceAll('\r\n', '\n') === want.replaceAll('\r\n', '\n')
      )
        continue;
    }
    writes.push({ path: file, want });
  }
  return writes;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function readOptional(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  }
}

function resolveInside(targetDir: string, file: string): string {
  const root = path.resolve(targetDir);
  const resolved = path.resolve(root, file);
  const relative = path.relative(root, resolved);
  if (
    path.isAbsolute(file) ||
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`Path is outside the project: ${file}`);
  return resolved;
}

function assertSafePath(targetDir: string, file: string): void {
  const resolved = resolveInside(targetDir, file);
  const root = path.parse(resolved).root;
  const parts = resolved.slice(root.length).split(path.sep);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in write path: ${current}`);
      if (current !== resolved && !stat.isDirectory())
        throw new Error(`Write parent is not a directory: ${current}`);
      if (current === resolved && !stat.isFile())
        throw new Error(`Write target is not a file: ${current}`);
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
  }
}

// update uses this before prompts/lookups as well as at the final write boundary.
export function assertSafeTargets(targetDir: string, files: readonly string[]): void {
  for (const file of new Set([...files, MANIFEST_FILE])) {
    assertWholeFile(file, true);
    assertSafePath(targetDir, file);
  }
}

export function assertUnchanged(targetDir: string, snapshot: Snapshot): void {
  for (const [file, original] of snapshot) {
    if (readOptional(resolveInside(targetDir, file)) !== original)
      throw new Error(`${file} changed during update; rerun update`);
  }
}

function atomicReplace(targetDir: string, file: string, content: string): void {
  assertSafePath(targetDir, file);
  const target = resolveInside(targetDir, file);
  const temporary = path.join(path.dirname(target), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let mode: number | undefined;
  try {
    mode = lstatSync(target).mode;
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  try {
    writeFileSync(temporary, content, { flag: 'wx', ...(mode === undefined ? {} : { mode }) });
    if (mode !== undefined) chmodSync(temporary, mode);
    renameSync(temporary, target);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // A successful rename already removed it; cleanup must not mask the write error.
    }
  }
}

function backup(targetDir: string, file: string): void {
  const source = resolveInside(targetDir, file);
  for (let suffix = 0; ; suffix++) {
    const name = `${file}.bak${suffix === 0 ? '' : `.${suffix}`}`;
    const destination = resolveInside(targetDir, name);
    try {
      copyFileSync(source, destination, constants.COPYFILE_EXCL);
      logger.info(`Backup: ${name}`);
      return;
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
  }
}

export class ContentWriteError extends Error {
  readonly completed: readonly string[];

  constructor(completed: readonly string[], cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Completed writes: ${completed.join(', ') || 'none'}. ${message}`, { cause });
    this.completed = [...completed];
  }
}

export function applyWrites(
  targetDir: string,
  writes: Entry[],
  snapshot: Snapshot,
  backupFiles: readonly string[],
): string[] {
  const completed: string[] = [];
  try {
    for (const entry of writes) assertWholeFile(entry.path);
    assertSafeTargets(
      targetDir,
      writes.map((entry) => entry.path),
    );
    assertUnchanged(targetDir, snapshot);
    for (const file of new Set(backupFiles)) {
      if (!writes.some((entry) => entry.path === file) || snapshot.get(file) === undefined)
        continue;
      backup(targetDir, file);
    }
    for (const entry of writes) {
      if (entry.want === null) {
        if (readOptional(resolveInside(targetDir, entry.path)) === undefined) continue;
        unlinkSync(resolveInside(targetDir, entry.path));
      } else {
        if (readOptional(resolveInside(targetDir, entry.path)) === entry.want) continue;
        atomicReplace(targetDir, entry.path, entry.want);
      }
      completed.push(entry.path);
    }
    return completed;
  } catch (error) {
    throw new ContentWriteError(completed, error);
  }
}

export function writeManifest(targetDir: string, manifest: Manifest): void {
  const content = serializeManifest(manifest);
  assertSafeTargets(targetDir, [MANIFEST_FILE]);
  if (readOptional(resolveInside(targetDir, MANIFEST_FILE)) === content) return;
  atomicReplace(targetDir, MANIFEST_FILE, content);
}
