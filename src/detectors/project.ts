import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { readJson } from '../utils/fs.js';

export type Framework = 'express' | 'next' | 'plain' | 'react';
export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

export const VALID_PACKAGE_MANAGERS: readonly PackageManager[] = ['bun', 'npm', 'pnpm', 'yarn'];

export interface ProjectInfo {
  framework: Framework;
  hasProjectReferences: boolean;
  hasReact: boolean;
  // Read before init writes anything, so it says what the user had.
  hasRootTsconfig: boolean;
  isMonorepo: boolean;
  packageManager: PackageManager;
}

export function detect(dir: string = process.cwd()): ProjectInfo {
  const pkgPath = path.join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(
      'No package.json found in current directory. Run this command from the root of your project.',
    );
  }
  const pkg = readJson(pkgPath);
  const allDeps = getAllDeps(pkg);
  return {
    framework: detectFramework(allDeps),
    hasProjectReferences: detectProjectReferences(dir),
    hasReact: !!allDeps['react'] || !!allDeps['react-dom'],
    hasRootTsconfig: existsSync(path.join(dir, 'tsconfig.json')),
    isMonorepo: detectMonorepo(dir, pkg),
    packageManager: detectPackageManager(dir, pkg),
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
export function workspacePackageDirs(dir: string): string[] {
  const dirs: string[] = [];
  for (const pattern of workspacePatterns(dir)) {
    if (pattern.includes('**') || pattern.startsWith('!')) continue;
    const clean = pattern.replace(/^\.\//, '').replace(/\/$/, '');
    const candidates = clean.endsWith('/*')
      ? listDirs(path.join(dir, clean.slice(0, -2))).map((name) => `${clean.slice(0, -2)}/${name}`)
      : [clean];
    dirs.push(...candidates.filter((rel) => existsSync(path.join(dir, rel, 'package.json'))));
  }
  return dirs;
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
  if (allDeps['next']) return 'next';
  if (allDeps['express']) return 'express';
  if (allDeps['react'] || allDeps['react-dom']) return 'react';
  return 'plain';
}

function detectMonorepo(dir: string, pkg: Record<string, unknown>): boolean {
  // Check for workspaces key in package.json (npm/yarn)
  if ('workspaces' in pkg) return true;
  // Check pnpm-workspace.yaml for a packages list. The file alone isn't
  // enough: it can hold only settings, like the allowBuilds v1 of this tool wrote.
  const workspaceFile = path.join(dir, 'pnpm-workspace.yaml');
  return existsSync(workspaceFile) && /^packages:/m.test(readFileSync(workspaceFile, 'utf8'));
}

function detectPackageManager(dir: string, pkg: Record<string, unknown>): PackageManager {
  const userAgent = process.env['npm_config_user_agent'] ?? '';
  if (userAgent.startsWith('pnpm')) return 'pnpm';
  if (userAgent.startsWith('yarn')) return 'yarn';
  if (userAgent.startsWith('bun')) return 'bun';

  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(dir, 'bun.lockb'))) return 'bun';

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
function detectProjectReferences(dir: string): boolean {
  const tsconfigPath = path.join(dir, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return false;
  return /"references"\s*:\s*\[\s*\{/.test(readFileSync(tsconfigPath, 'utf8'));
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
function workspacePatterns(dir: string): string[] {
  const pkg = readJson(path.join(dir, 'package.json'));
  const workspaces = pkg['workspaces'];
  if (Array.isArray(workspaces))
    return workspaces.filter((w): w is string => typeof w === 'string');
  if (workspaces && typeof workspaces === 'object' && 'packages' in workspaces) {
    const list = workspaces.packages;
    if (Array.isArray(list)) return list.filter((w): w is string => typeof w === 'string');
  }
  const workspaceFile = path.join(dir, 'pnpm-workspace.yaml');
  if (!existsSync(workspaceFile)) return [];
  const lines = readFileSync(workspaceFile, 'utf8').split(/\r?\n/);
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
