import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { readJson } from '../utils/fs.js';

export type Framework = 'expo' | 'express' | 'next' | 'plain' | 'react';
export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

export const VALID_PACKAGE_MANAGERS: readonly PackageManager[] = ['bun', 'npm', 'pnpm', 'yarn'];

// A stack whose type checker embeds the TypeScript compiler API. TypeScript 7
// exports only its version string, so these checkers cannot load it.
export interface UnsupportedStack {
  // The checker the project has to run instead of tsc.
  checker: string;
  name: string;
  // The dependency that gives the stack away.
  package: string;
}

export function unsupportedMessage(stack: UnsupportedStack): string {
  return [
    `Unsupported project: ${stack.name} (found "${stack.package}" in package.json).`,
    `  ${stack.name} checks its components with ${stack.checker}, which needs TypeScript's compiler API,`,
    '  and TypeScript 7 no longer ships one, so "tsc --noEmit" would check none of them.',
    '  Keep this project on TypeScript 6: npm i -D typescript@npm:@typescript/typescript6',
  ].join('\n');
}

export interface ProjectInfo {
  framework: Framework;
  hasProjectReferences: boolean;
  hasReact: boolean;
  // Read before init writes anything, so it says what the user had.
  hasRootTsconfig: boolean;
  // A JS-only project lints nothing once init is done, so init says so.
  hasTypeScriptFiles: boolean;
  isMonorepo: boolean;
  packageManager: PackageManager;
  // Workspace imports, as "package -> dependency", whose types type-aware
  // lint cannot resolve. Empty for a single-package project.
  unresolvedWorkspaceTypes: string[];
  unsupported?: UnsupportedStack | undefined;
}

export interface DetectionFiles {
  exists(file: string): boolean;
  read(file: string): string;
  json(file: string): Record<string, unknown>;
}

const DISK_FILES: DetectionFiles = {
  exists: existsSync,
  read: (file) => readFileSync(file, 'utf8'),
  json: readJson,
};

export function detect(
  dir: string = process.cwd(),
  files: DetectionFiles = DISK_FILES,
): ProjectInfo {
  const pkgPath = path.join(dir, 'package.json');
  if (!files.exists(pkgPath)) {
    throw new Error(
      'No package.json found in current directory. Run this command from the root of your project.',
    );
  }
  const pkg = files.json(pkgPath);
  const allDeps = getAllDeps(pkg);
  return {
    framework: detectFramework(allDeps),
    hasProjectReferences: detectProjectReferences(dir, files),
    hasReact: !!allDeps['react'] || !!allDeps['react-dom'],
    hasRootTsconfig: files.exists(path.join(dir, 'tsconfig.json')),
    hasTypeScriptFiles: detectTypeScriptFiles(dir),
    isMonorepo: detectMonorepo(dir, pkg, files),
    packageManager: detectPackageManager(dir, pkg, files),
    unresolvedWorkspaceTypes: unresolvedWorkspaceTypes(dir, files),
    unsupported: detectUnsupported(allDeps),
  };
}

export function pmExec(pm: PackageManager): string {
  if (pm === 'bun') return 'bun run';
  // Without -- npm reads the command's flags as its own (e.g. --edit).
  return pm === 'npm' ? 'npm exec --' : `${pm} exec`;
}

// Returns the workspace package folders, relative to dir, that hold a
// package.json.
// ponytail: handles exact paths and one-level "dir/*" patterns, which is
// what pnpm, npm and turbo templates use; "**" and "!" patterns are skipped.
// Use a glob library if a real repo needs them.
export function workspacePackageDirs(dir: string, files: DetectionFiles = DISK_FILES): string[] {
  const dirs: string[] = [];
  for (const pattern of workspacePatterns(dir, files)) {
    if (pattern.includes('**') || pattern.startsWith('!')) continue;
    const clean = pattern.replace(/^\.\//, '').replace(/\/$/, '');
    const candidates = clean.endsWith('/*')
      ? listDirs(path.join(dir, clean.slice(0, -2))).map((name) => `${clean.slice(0, -2)}/${name}`)
      : [clean];
    dirs.push(...candidates.filter((rel) => files.exists(path.join(dir, rel, 'package.json'))));
  }
  return dirs;
}

// Type-aware lint resolves a workspace import one of two ways: a tsconfig
// reference in the importing package, which tsgolint follows to the other
// package's source with no build, or the dependency's built .d.ts. With
// neither, the import is an error type and every no-unsafe-* rule fires on it,
// so init keeps type-aware linting off for a monorepo in that state.
// ponytail: package.json fields only. A package that exposes types through an
// "exports" map alone counts as resolvable; check the map if a real repo shows
// up with false positives.
export function unresolvedWorkspaceTypes(
  dir: string,
  files: DetectionFiles = DISK_FILES,
): string[] {
  const packages = new Map<string, { dir: string; pkg: Record<string, unknown> }>();
  for (const rel of workspacePackageDirs(dir, files)) {
    const pkg = files.json(path.join(dir, rel, 'package.json'));
    const name = pkg['name'];
    if (typeof name === 'string' && name !== '') packages.set(name, { dir: rel, pkg });
  }

  const unresolved: string[] = [];
  for (const [name, entry] of packages) {
    const tsconfigPath = path.join(dir, entry.dir, 'tsconfig.json');
    // No tsconfig of its own means the root config (or none) covers it, so
    // init can't tell which references apply.
    if (!files.exists(tsconfigPath)) continue;
    const referenced = new Set(
      tsconfigReferences(tsconfigPath, files).map((rel) =>
        pathKey(path.resolve(dir, entry.dir, rel)),
      ),
    );
    const deps = {
      ...(entry.pkg['dependencies'] as Record<string, string> | undefined),
      ...(entry.pkg['devDependencies'] as Record<string, string> | undefined),
    };
    for (const depName of Object.keys(deps)) {
      const dep = packages.get(depName);
      if (!dep) continue;
      if (referenced.has(pathKey(path.join(dir, dep.dir)))) continue;
      if (hasBuiltTypes(path.join(dir, dep.dir), dep.pkg, files)) continue;
      unresolved.push(`${name} -> ${depName}`);
    }
  }
  return unresolved.sort();
}

// Runs a package that isn't installed yet. npx needs --yes to skip its
// "Ok to proceed?" install prompt; the others don't ask. yarn dlx is Yarn 2+.
const DLX: Record<PackageManager, string> = {
  bun: 'bunx',
  npm: 'npx --yes',
  pnpm: 'pnpm dlx',
  yarn: 'yarn dlx',
};

export function pmDlx(pm: PackageManager): string {
  return DLX[pm];
}

function detectFramework(allDeps: Record<string, string>): Framework {
  // An Expo app depends on react and react-dom too, so it goes first.
  if (allDeps['expo']) return 'expo';
  if (allDeps['next']) return 'next';
  if (allDeps['express']) return 'express';
  if (allDeps['react'] || allDeps['react-dom']) return 'react';
  return 'plain';
}

// TypeScript 7 ships no compiler API: its main export is lib/version.cjs,
// which holds the version string and nothing else. vue-tsc, svelte-check,
// astro check and ngc build virtual TypeScript files through that API, so
// they cannot run on 7, and tsc --noEmit alone checks none of their
// components. First match wins, so Angular is reported before the Vue and
// Svelte packages it might drag in.
// ponytail: a dependency list, not a project structure scan. A monorepo whose
// packages use Vue but whose root does not is missed; sniff the workspace
// packages too if that shows up.
const UNSUPPORTED_STACKS: readonly UnsupportedStack[] = [
  { checker: 'ngc', name: 'Angular', package: '@angular/core' },
  { checker: 'vue-tsc', name: 'Vue', package: 'vue' },
  { checker: 'vue-tsc', name: 'Nuxt', package: 'nuxt' },
  { checker: 'svelte-check', name: 'Svelte', package: 'svelte' },
  { checker: 'svelte-check', name: 'SvelteKit', package: '@sveltejs/kit' },
  { checker: 'astro check', name: 'Astro', package: 'astro' },
];

function detectUnsupported(allDeps: Record<string, string>): UnsupportedStack | undefined {
  return UNSUPPORTED_STACKS.find((stack) => allDeps[stack.package] !== undefined);
}

const TS_FILE = /\.(?:cts|mts|ts|tsx)$/;

// Directories whose contents never decide how the root should be linted.
// vendor covers Go and PHP trees that occasionally sit next to a package.json.
const SKIP_DIRS = new Set([
  '.expo',
  '.git',
  '.next',
  '.pnpm-store',
  '.turbo',
  '.vercel',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'vendor',
]);

// ponytail: bounded depth and entry count instead of a full walk, because this
// only answers "is there one .ts file". A project that keeps every source
// deeper than six levels is told it has no TypeScript; none exist yet.
const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_ENTRIES = 5000;

function detectTypeScriptFiles(dir: string): boolean {
  let seen = 0;
  const walk = (current: string, depth: number): boolean => {
    if (depth > MAX_SCAN_DEPTH || seen > MAX_SCAN_ENTRIES) return false;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      // Unreadable directory: treat it as empty rather than failing detect().
      return false;
    }
    for (const entry of entries) {
      seen++;
      if (seen > MAX_SCAN_ENTRIES) return false;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && walk(path.join(current, entry.name), depth + 1)) {
          return true;
        }
      } else if (TS_FILE.test(entry.name)) {
        return true;
      }
    }
    return false;
  };
  return walk(dir, 0);
}

function detectMonorepo(dir: string, pkg: Record<string, unknown>, files: DetectionFiles): boolean {
  // Check for workspaces key in package.json (npm/yarn)
  if ('workspaces' in pkg) return true;
  // Check pnpm-workspace.yaml for a packages list. The file alone isn't
  // enough: it can hold only settings, like the allowBuilds v1 of this tool wrote.
  const workspaceFile = path.join(dir, 'pnpm-workspace.yaml');
  return files.exists(workspaceFile) && /^packages:/m.test(files.read(workspaceFile));
}

function detectPackageManager(
  dir: string,
  pkg: Record<string, unknown>,
  files: DetectionFiles,
): PackageManager {
  const userAgent = process.env['npm_config_user_agent'] ?? '';
  if (userAgent.startsWith('pnpm')) return 'pnpm';
  if (userAgent.startsWith('yarn')) return 'yarn';
  if (userAgent.startsWith('bun')) return 'bun';

  if (files.exists(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (files.exists(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (files.exists(path.join(dir, 'bun.lockb'))) return 'bun';

  const devEngines = pkg['devEngines'] as Record<string, unknown> | undefined;
  const pmConfig = devEngines?.['packageManager'] as Record<string, unknown> | undefined;
  if (pmConfig?.['name'] === 'pnpm') return 'pnpm';
  if (pmConfig?.['name'] === 'yarn') return 'yarn';
  if (pmConfig?.['name'] === 'bun') return 'bun';

  return 'npm';
}

// A root tsconfig with references (create-vite's has "files": [] plus
// references) type-checks nothing under plain tsc --noEmit; only tsc -b
// follows the references. An empty array, as our monorepo tsconfig ships,
// doesn't count.
// ponytail: regex over the raw text because tsconfig is JSONC and
// JSON.parse rejects comments. A commented-out references entry gives a
// false positive; switch to typescript's parseConfigFileTextToJson if that
// ever matters.
function detectProjectReferences(dir: string, files: DetectionFiles): boolean {
  const tsconfigPath = path.join(dir, 'tsconfig.json');
  if (!files.exists(tsconfigPath)) return false;
  return /"references"\s*:\s*\[\s*\{/.test(files.read(tsconfigPath));
}

// ponytail: regex over the raw text, like detectProjectReferences, because
// tsconfig is JSONC. A commented-out entry is read as a real one.
function tsconfigReferences(tsconfigPath: string, files: DetectionFiles): string[] {
  const array = /"references"\s*:\s*\[([\s\S]*?)\]/.exec(files.read(tsconfigPath))?.[1];
  if (!array) return [];
  return [...array.matchAll(/"path"\s*:\s*"([^"]+)"/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

// The file TypeScript reads the package's types from. A package with neither
// field, or with source and no build, resolves without one.
function hasBuiltTypes(
  packageDir: string,
  pkg: Record<string, unknown>,
  files: DetectionFiles,
): boolean {
  const types = pkg['types'] ?? pkg['typings'];
  const main = pkg['main'];
  const entry =
    typeof types === 'string'
      ? types
      : typeof main === 'string'
        ? main.replace(/\.js$/, '.d.ts')
        : undefined;
  return entry === undefined || files.exists(path.join(packageDir, entry));
}

// Reference paths and package folders compare as resolved paths, and Windows
// path comparison is case-insensitive.
function pathKey(target: string): string {
  const resolved = path.resolve(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function getAllDeps(pkg: Record<string, unknown>): Record<string, string> {
  return {
    ...(pkg['dependencies'] as Record<string, string>),
    ...(pkg['devDependencies'] as Record<string, string>),
  };
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// ponytail: line-based read of pnpm-workspace.yaml's packages list, so a
// flow-style list ("packages: [a, b]") is missed. Parse YAML if one shows up.
function workspacePatterns(dir: string, files: DetectionFiles): string[] {
  const pkg = files.json(path.join(dir, 'package.json'));
  const workspaces = pkg['workspaces'];
  if (Array.isArray(workspaces))
    return workspaces.filter((w): w is string => typeof w === 'string');
  if (workspaces && typeof workspaces === 'object' && 'packages' in workspaces) {
    const list = workspaces.packages;
    if (Array.isArray(list)) return list.filter((w): w is string => typeof w === 'string');
  }
  const workspaceFile = path.join(dir, 'pnpm-workspace.yaml');
  if (!files.exists(workspaceFile)) return [];
  const lines = files.read(workspaceFile).split(/\r?\n/);
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  if (start === -1) return [];
  const patterns: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+-/.test(line)) break;
    patterns.push(
      line
        .replace(/^\s+-\s*/, '')
        .trim()
        .replaceAll(/^['"]|['"]$/g, ''),
    );
  }
  return patterns.filter(Boolean);
}
