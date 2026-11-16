import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  detect,
  type DetectionFiles,
  type PackageManager,
  type ProjectInfo,
  unsupportedMessage,
  VALID_PACKAGE_MANAGERS,
} from '../detectors/project.js';
import type { Entry, Plan } from '../generators/entry.js';
import { buildPlan } from '../generators/plan.js';
import { TOOLCHAIN_DEP_NAMES } from '../utils/versions.js';
import { classify, type Comparison } from './classify.js';
import {
  assertEntryPath,
  hashEntry,
  MANIFEST_FILE,
  type Manifest,
  parseManifest,
} from './manifest.js';

export type Snapshot = Map<string, string | undefined>;

export interface Project {
  targetDir: string;
  info: ProjectInfo;
  pm: PackageManager;
  pkg: Record<string, unknown>;
  manifest: Manifest | undefined;
  snapshot: Snapshot;
  plan: Plan;
}

const parsedSnapshots = new WeakMap<Snapshot, Map<string, Record<string, unknown>>>();

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(
  value: unknown,
  file: string,
  field: string,
): asserts value is Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${file}: ${field} must be an object`);
}

export function validatePackageJson(value: unknown): asserts value is Record<string, unknown> {
  object(value, 'package.json', 'root');
  for (const field of [
    'scripts',
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const container = value[field];
    if (container === undefined) continue;
    object(container, 'package.json', field);
    for (const [key, item] of Object.entries(container)) {
      if (typeof item !== 'string')
        throw new Error(`package.json: ${field}.${key} must be a string`);
    }
  }
  if (value['config'] !== undefined) object(value['config'], 'package.json', 'config');
}

function validateOxlint(value: unknown, prefix = ''): asserts value is Record<string, unknown> {
  object(value, '.oxlintrc.json', prefix || 'root');
  if (value['rules'] !== undefined) object(value['rules'], '.oxlintrc.json', `${prefix}rules`);
  for (const key of ['plugins', 'ignorePatterns']) {
    const items = value[key];
    if (
      items !== undefined &&
      (!Array.isArray(items) || !items.every((item: unknown) => typeof item === 'string'))
    ) {
      throw new Error(`.oxlintrc.json: ${prefix}${key} must be an array of strings`);
    }
  }
  const overrides = value['overrides'];
  if (overrides !== undefined) {
    if (!Array.isArray(overrides))
      throw new Error(`.oxlintrc.json: ${prefix}overrides must be an array of objects`);
    overrides.forEach((override: unknown, index) =>
      validateOxlint(override, `${prefix}overrides[${index}].`),
    );
  }
}

function parseObject(text: string, file: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${file}: invalid JSON`);
  }
  object(value, file, 'root');
  return value;
}

export function loadProject(targetDir: string, requestedPm?: string): Project {
  if (
    requestedPm !== undefined &&
    !VALID_PACKAGE_MANAGERS.includes(requestedPm as PackageManager)
  ) {
    throw new Error(
      `Invalid package manager "${requestedPm}". Available: ${VALID_PACKAGE_MANAGERS.join(', ')}`,
    );
  }
  targetDir = path.resolve(targetDir);
  const snapshot: Snapshot = new Map();
  const parsed = new Map<string, Record<string, unknown>>();
  const read = (file: string): string | undefined => {
    const relative = path.relative(targetDir, path.resolve(file)).split(path.sep).join('/');
    if (!snapshot.has(relative)) {
      let text: string | undefined;
      try {
        text = readFileSync(file, 'utf8');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          throw new Error(`${relative}: could not read file`, { cause: error });
        }
      }
      snapshot.set(relative, text);
    }
    return snapshot.get(relative);
  };
  const files: DetectionFiles = {
    exists: (file) => read(file) !== undefined,
    read: (file) => {
      const text = read(file);
      if (text === undefined) throw new Error(`${path.relative(targetDir, file)}: file is missing`);
      return text;
    },
    json: (file) => {
      const relative = path.relative(targetDir, file).split(path.sep).join('/');
      let value = parsed.get(relative);
      if (value === undefined) {
        value = parseObject(files.read(file), relative);
        if (path.basename(file) === 'package.json') validatePackageJson(value);
        parsed.set(relative, value);
      }
      return value;
    },
  };
  const pkg = files.json(path.join(targetDir, 'package.json'));
  // Capture absent inputs too, so a new lockfile or config invalidates prepared writes.
  for (const file of [
    'tsconfig.json',
    '.gitattributes',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lockb',
    'package-lock.json',
  ]) {
    read(path.join(targetDir, file));
  }
  const info = detect(targetDir, files);
  if (info.unsupported) throw new Error(unsupportedMessage(info.unsupported));
  const pm = (requestedPm as PackageManager | undefined) ?? info.packageManager;
  const oxlintPath = path.join(targetDir, '.oxlintrc.json');
  if (read(oxlintPath) !== undefined) validateOxlint(files.json(oxlintPath));
  const manifest = parseManifest(read(path.join(targetDir, MANIFEST_FILE)));
  const devDependencies = pkg['devDependencies'];
  const deps = Object.fromEntries(
    TOOLCHAIN_DEP_NAMES.map((name) => {
      const installed = isObject(devDependencies) ? devDependencies[name] : undefined;
      // Offline plans use a sentinel; update resolves missing versions before applying content.
      return [
        name,
        typeof installed === 'string' && installed.length > 0 ? installed : 'toolchain:unresolved',
      ];
    }),
  );
  const plan = buildPlan(targetDir, info, pm, deps, pkg);
  for (const entry of [
    ...plan.entries,
    ...Object.keys(manifest ?? {}).map((entryPath) => ({ path: entryPath })),
  ]) {
    read(path.join(targetDir, entry.path.split('#')[0] ?? entry.path));
  }
  parsedSnapshots.set(snapshot, parsed);
  return { targetDir, info, pm, pkg, manifest, snapshot, plan };
}

export function trackedEntries(plan: Plan): Entry[] {
  const entries: Entry[] = [];
  for (const entry of plan.entries) {
    if (entry.path === '.gitattributes' || entry.path === 'tsconfig.json') continue;
    if (entry.path.startsWith('package.json#devDependencies.')) {
      if (entry.want !== null) entries.push({ path: entry.path, want: 'true' });
    } else if (entry.path === '.oxlintrc.json' && entry.want !== null) {
      const config = parseObject(entry.want, '.oxlintrc.json');
      validateOxlint(config);
      for (const [key, value] of Object.entries(config)) {
        if (key === 'rules' && isObject(value)) {
          for (const [rule, setting] of Object.entries(value))
            entries.push({ path: `.oxlintrc.json#rules.${rule}`, want: JSON.stringify(setting) });
        } else if ((key === 'plugins' || key === 'ignorePatterns') && Array.isArray(value)) {
          for (const item of value)
            entries.push({ path: `.oxlintrc.json#${key}.${item}`, want: JSON.stringify(item) });
        } else entries.push({ path: `.oxlintrc.json#${key}`, want: JSON.stringify(value) });
      }
    } else entries.push(entry);
  }
  for (const entry of entries) assertEntryPath(entry.path);
  return entries;
}

export function snapshotJson(
  project: Project,
  file: 'package.json' | '.oxlintrc.json',
): Record<string, unknown> | undefined {
  const text = project.snapshot.get(file);
  if (text === undefined) return undefined;
  let parsed = parsedSnapshots.get(project.snapshot);
  if (parsed === undefined) {
    parsed = new Map();
    parsedSnapshots.set(project.snapshot, parsed);
  }
  let config = parsed.get(file);
  if (config === undefined) {
    config = parseObject(text, file);
    if (file === 'package.json') validatePackageJson(config);
    else validateOxlint(config);
    parsed.set(file, config);
  }
  return config;
}

function diskValue(project: Project, entryPath: string): string | undefined {
  const hash = entryPath.indexOf('#');
  if (hash === -1) return project.snapshot.get(entryPath);
  const file = entryPath.slice(0, hash);
  if (file !== 'package.json' && file !== '.oxlintrc.json') return undefined;
  const config = snapshotJson(project, file);
  if (config === undefined) return undefined;
  const selector = entryPath.slice(hash + 1);
  const dot = selector.indexOf('.');
  const container = dot === -1 ? selector : selector.slice(0, dot);
  const key = dot === -1 ? undefined : selector.slice(dot + 1);
  const value = Object.hasOwn(config, container) ? config[container] : undefined;
  if (key === undefined) return JSON.stringify(value);
  if (file === '.oxlintrc.json' && (container === 'plugins' || container === 'ignorePatterns')) {
    return Array.isArray(value) && value.includes(key) ? JSON.stringify(key) : undefined;
  }
  const item = isObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;
  if (container === 'devDependencies')
    return typeof item === 'string' && item.length > 0 ? 'true' : undefined;
  return JSON.stringify(item);
}

export function compareProject(project: Project, entries: Entry[]): Comparison[] {
  const wanted = new Map(entries.map((entry) => [entry.path, entry.want]));
  return [...new Set([...wanted.keys(), ...Object.keys(project.manifest ?? {})])]
    .sort()
    .map((entryPath) => {
      assertEntryPath(entryPath);
      const base = project.manifest?.[entryPath];
      const disk = diskValue(project, entryPath);
      const want = wanted.get(entryPath) ?? undefined;
      const state = classify(base, hashEntry(entryPath, disk), hashEntry(entryPath, want));
      return { path: entryPath, state, base, disk, want };
    });
}
