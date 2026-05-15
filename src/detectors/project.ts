import { existsSync } from 'node:fs';
import path from 'node:path';

import { readJson } from '../utils/fs.js';

export type Framework = 'express' | 'next' | 'plain' | 'react';
export type PackageManager = 'npm' | 'pnpm' | 'yarn';

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
  return {
    framework: detectFramework(pkg),
    hasReact: hasReactDep(pkg),
    isMonorepo: detectMonorepo(pkg),
    packageManager: detectPackageManager(dir, pkg),
  };
}

function detectFramework(pkg: Record<string, unknown>): Framework {
  const allDeps = {
    ...(pkg.dependencies as Record<string, string>),
    ...(pkg.devDependencies as Record<string, string>),
  };
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

  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';

  const devEngines = pkg.devEngines as Record<string, unknown> | undefined;
  const pmConfig = devEngines?.packageManager as Record<string, unknown> | undefined;
  if (pmConfig?.name === 'pnpm') return 'pnpm';
  if (pmConfig?.name === 'yarn') return 'yarn';

  return 'npm';
}

function hasReactDep(pkg: Record<string, unknown>): boolean {
  const allDeps = {
    ...(pkg.dependencies as Record<string, string>),
    ...(pkg.devDependencies as Record<string, string>),
  };
  return !!(allDeps.react || allDeps['react-dom']);
}
