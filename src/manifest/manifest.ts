import { createHash } from 'node:crypto';

export type Manifest = Record<string, string>;

export const MANIFEST_FILE = '.toolchain.json';

const WHOLE_FILES = new Set([
  '.editorconfig',
  '.prettierrc',
  '.prettierignore',
  'commitlint.config.mjs',
  '.husky/pre-commit',
  '.husky/commit-msg',
]);
const UNSAFE_PROPERTIES = new Set(['__proto__', 'constructor', 'prototype']);
const OXLINT_CONTAINERS = new Set(['rules', 'plugins', 'ignorePatterns']);

export function assertEntryPath(entryPath: string): void {
  if (WHOLE_FILES.has(entryPath)) return;

  const hash = entryPath.indexOf('#');
  const file = entryPath.slice(0, hash);
  const selector = entryPath.slice(hash + 1);
  const dot = selector.indexOf('.');
  const container = dot === -1 ? selector : selector.slice(0, dot);
  const key = dot === -1 ? undefined : selector.slice(dot + 1);
  const safeContainer = container !== '' && !UNSAFE_PROPERTIES.has(container);
  const safeKey = key !== undefined && key !== '' && !UNSAFE_PROPERTIES.has(key);

  if (hash !== -1 && safeContainer) {
    if (file === 'package.json') {
      if (selector === 'lint-staged' || selector === 'config.commitizen') return;
      if ((container === 'scripts' || container === 'devDependencies') && safeKey) return;
    }
    if (file === '.oxlintrc.json') {
      if (dot === -1 && !OXLINT_CONTAINERS.has(container)) return;
      if (OXLINT_CONTAINERS.has(container) && key !== undefined && key !== '') {
        if (container !== 'rules' || safeKey) return;
      }
    }
  }

  throw new Error(`${MANIFEST_FILE}: invalid entry path ${JSON.stringify(entryPath)}`);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

export function hashEntry(entryPath: string, value: string | undefined): string | undefined {
  assertEntryPath(entryPath);
  if (value === undefined) return undefined;

  let normalized = value.replaceAll('\r\n', '\n');
  if (entryPath.includes('#')) {
    try {
      const parsed: unknown = JSON.parse(value);
      normalized = JSON.stringify(sortJson(parsed));
    } catch {
      throw new Error(`Invalid JSON for ${entryPath}`);
    }
  }
  return createHash('sha256').update(normalized).digest('hex');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseManifest(text: string | undefined): Manifest | undefined {
  if (text === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${MANIFEST_FILE}: invalid JSON`);
  }
  if (!isObject(parsed) || !isObject(parsed['entries'])) {
    throw new Error(`${MANIFEST_FILE}: entries must be an object`);
  }

  const entries: Manifest = {};
  for (const [entryPath, hash] of Object.entries(parsed['entries'])) {
    assertEntryPath(entryPath);
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error(`${MANIFEST_FILE}: invalid SHA-256 hash for ${entryPath}`);
    }
    entries[entryPath] = hash;
  }
  return entries;
}

export function serializeManifest(manifest: Manifest): string {
  parseManifest(JSON.stringify({ entries: manifest }));
  const entries = Object.fromEntries(
    Object.keys(manifest)
      .sort()
      .map((key) => [key, manifest[key]]),
  );
  return `${JSON.stringify({ entries }, null, 2)}\n`;
}
