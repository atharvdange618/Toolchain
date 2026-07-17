import { existsSync } from 'node:fs';
import path from 'node:path';

import { readJson } from '../utils/fs.js';

export type Framework = 'express' | 'next' | 'plain' | 'react';
export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

export const VALID_PACKAGE_MANAGERS: readonly PackageManager[] = ['bun', 'npm', 'pnpm', 'yarn'];

export interface ProjectInfo {
  framework: Framework;
  hasReact: boolean;
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
    hasReact: !!(allDeps.react || allDeps['react-dom']),
    isMonorepo: detectMonorepo(pkg),
    packageManager: detectPackageManager(dir, pkg),
  };
}

export function pmExec(pm: PackageManager): string {
  return pm === 'bun' ? 'bun run' : `${pm} exec`;
}

function detectFramework(allDeps: Record<string, string>): Framework {
  if (allDeps.next) return 'next';
  if (allDeps.express) return 'express';
  if (allDeps.react || allDeps['react-dom']) return 'react';
  return 'plain';
}

function detectMonorepo(pkg: Record<string, unknown>): boolean {
  if ('workspaces' in pkg) return true;
  const pnpmConfig = pkg.pnpm as Record<string, unknown> | undefined;
  if (pnpmConfig && 'workspaces' in pnpmConfig) return true;
  return false;
}

function detectPackageManager(dir: string, pkg: Record<string, unknown>): PackageManager {
  const userAgent = process.env.npm_config_user_agent ?? '';
  if (userAgent.startsWith('pnpm')) return 'pnpm';
  if (userAgent.startsWith('yarn')) return 'yarn';
  if (userAgent.startsWith('bun')) return 'bun';

  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(dir, 'bun.lockb'))) return 'bun';

  const devEngines = pkg.devEngines as Record<string, unknown> | undefined;
  const pmConfig = devEngines?.packageManager as Record<string, unknown> | undefined;
  if (pmConfig?.name === 'pnpm') return 'pnpm';
  if (pmConfig?.name === 'yarn') return 'yarn';
  if (pmConfig?.name === 'bun') return 'bun';

  return 'npm';
}

function getAllDeps(pkg: Record<string, unknown>): Record<string, string> {
  return {
    ...(pkg.dependencies as Record<string, string>),
    ...(pkg.devDependencies as Record<string, string>),
  };
}
