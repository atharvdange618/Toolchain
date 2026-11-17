import { createHash } from 'node:crypto';

import { type PackageManager, VALID_PACKAGE_MANAGERS } from '../detectors/project.js';
import { isObject } from '../utils/fs.js';

export type Manifest = Record<string, string>;

// The committed base for later `doctor` and `update` runs. `packageManager` is
// absent in manifests written before it was recorded, so readers fall back to
// detection. It is not a standalone setting: the project tree still wins.
export interface ManifestDocument {
  packageManager?: PackageManager;
  entries: Manifest;
}

export const MANIFEST_FILE = '.toolchain.json';

// The two tracked hooks. Doctor and update re-want these from the scripts they
// keep, and a deleted one needs action because commits would go unchecked.
export const HOOK_FILES = ['.husky/pre-commit', '.husky/commit-msg'] as const;

export function isHookPath(entryPath: string): boolean {
  return (HOOK_FILES as readonly string[]).includes(entryPath);
}

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
      // No generator writes config.commitizen since #10, but 2.x manifests
      // still track it, and update needs to read them to remove it.
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

function isPackageManager(value: unknown): value is PackageManager {
  return typeof value === 'string' && (VALID_PACKAGE_MANAGERS as readonly string[]).includes(value);
}

export function parseManifest(text: string | undefined): ManifestDocument | undefined {
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

  const packageManager = parsed['packageManager'];
  if (packageManager === undefined) return { entries };
  if (!isPackageManager(packageManager)) {
    throw new Error(`${MANIFEST_FILE}: invalid packageManager ${JSON.stringify(packageManager)}`);
  }
  return { packageManager, entries };
}

export function serializeManifest(document: ManifestDocument): string {
  const entries = Object.fromEntries(
    Object.keys(document.entries)
      .sort()
      .map((key) => [key, document.entries[key]]),
  );
  const ordered: Record<string, unknown> = {};
  if (document.packageManager !== undefined) ordered['packageManager'] = document.packageManager;
  ordered['entries'] = entries;
  const text = `${JSON.stringify(ordered, null, 2)}\n`;
  // Round-trip so paths, hashes and the manager are validated before anything reaches disk.
  parseManifest(text);
  return text;
}
