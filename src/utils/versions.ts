import { execSync } from 'node:child_process';

const VERSION_CACHE = new Map<string, string>();

export function getExpressVersion(): string {
  return toRange('express');
}

export function getNextDeps(): Record<string, string> {
  return getVersions(['@next/eslint-plugin-next']);
}

export function getReactDeps(): Record<string, string> {
  return getVersions([
    'eslint-plugin-react',
    'eslint-plugin-react-hooks',
    'eslint-plugin-react-you-might-not-need-an-effect',
  ]);
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

export function getTurboVersion(): string {
  return toRange('turbo');
}

export function getTypescriptVersion(): string {
  // typescript-eslint requires <6.1.0, so pin to latest 6.0.x
  return toRange('typescript@6.0.3');
}

export function getTypesExpressVersion(): string {
  return toRange('@types/express');
}

export function getTypesNodeVersion(): string {
  return toRange('@types/node');
}

export function getVersions(packages: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pkg of packages) {
    result[pkg] = toRange(pkg);
  }
  return result;
}

function getLatestVersion(pkg: string): string | undefined {
  if (VERSION_CACHE.has(pkg)) return VERSION_CACHE.get(pkg);
  try {
    const version = execSync(`npm view ${pkg} version`, { encoding: 'utf8' }).trim();
    VERSION_CACHE.set(pkg, version);
    return version;
  } catch {
    return undefined;
  }
}

// Resolves a package to a caret range. A failed lookup throws rather than
// degrading to an unconstrained "*" (or worse, the invalid range "^*") -
// the caller aborts the whole init/scaffold run instead of writing a
// looser dependency range than the rest of the toolchain promises.
function toRange(pkg: string): string {
  const version = getLatestVersion(pkg);
  if (version === undefined) {
    throw new Error(
      `Could not resolve the latest version of "${pkg}" from npm. Check your network connection and try again.`,
    );
  }
  return `^${version}`;
}
