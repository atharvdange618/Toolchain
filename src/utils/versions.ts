import { execSync } from 'node:child_process';

const VERSION_CACHE = new Map<string, string>();

function getLatestVersion(pkg: string): string {
  if (VERSION_CACHE.has(pkg)) return VERSION_CACHE.get(pkg)!;
  try {
    const version = execSync(`npm view ${pkg} version`, { encoding: 'utf8' }).trim();
    VERSION_CACHE.set(pkg, version);
    return version;
  } catch {
    return '*';
  }
}

export function getVersions(packages: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pkg of packages) {
    result[pkg] = `^${getLatestVersion(pkg)}`;
  }
  return result;
}

export function getToolchainDeps(): Record<string, string> {
  return getVersions([
    '@commitlint/cli',
    '@commitlint/config-conventional',
    '@eslint/js',
    'eslint',
    'eslint-plugin-perfectionist',
    'eslint-plugin-unicorn',
    'husky',
    'lint-staged',
    'prettier',
    'typescript-eslint',
  ]);
}

export function getReactDeps(): Record<string, string> {
  return getVersions(['eslint-plugin-react', 'eslint-plugin-react-hooks']);
}

export function getNextDeps(): Record<string, string> {
  return getVersions(['@next/eslint-plugin-next']);
}

export function getTypescriptVersion(): string {
  // typescript-eslint requires <6.1.0, so pin to latest 6.0.x
  return getLatestVersion('typescript@6.0.3');
}

export function getTypesNodeVersion(): string {
  return getLatestVersion('@types/node');
}

export function getExpressVersion(): string {
  return getLatestVersion('express');
}

export function getTypesExpressVersion(): string {
  return getLatestVersion('@types/express');
}

export function getTurboVersion(): string {
  return getLatestVersion('turbo');
}
