import { execSync } from 'node:child_process';

const VERSION_CACHE = new Map<string, string>();

export function getExpressVersion(): string {
  return toRange('express');
}

export function getToolchainDeps(): Record<string, string> {
  return {
    ...getVersions([
      '@commitlint/cli',
      '@commitlint/config-conventional',
      '@commitlint/cz-commitlint',
      'commitizen',
      'husky',
      'lint-staged',
      'oxlint',
      'oxlint-tsgolint',
      'prettier',
    ]),
    // The generated typecheck script and oxlint's type-aware rules both need it.
    typescript: getTypescriptVersion(),
  };
}

export function getTurboVersion(): string {
  return toRange('turbo');
}

export function getTypescriptVersion(): string {
  // oxlint-tsgolint runs on TypeScript 7, so v1's 6.0.x pin is gone.
  return '^7.0.2';
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

// pnpm 11 holds back anything published less than a day ago
// (minimumReleaseAge defaults to 1440 minutes) and writes an exclude line
// for it, and for each of oxlint's 19 platform bindings, into the user's
// pnpm-workspace.yaml. Resolving to a release at least a day old avoids that.
// ponytail: fixed at one day, so a repo with a longer minimumReleaseAge still
// gets excludes. Read it from pnpm-workspace.yaml if that comes up.
const MIN_RELEASE_AGE_MS = 24 * 60 * 60 * 1000;

// The newest stable release published before cutoff, or latest when it is
// old enough. Falls back to latest when nothing older qualifies.
export function pickSettledVersion(
  time: Record<string, string>,
  latest: string,
  cutoff: number,
): string {
  const isSettled = (version: string): boolean => {
    const published = time[version];
    return published !== undefined && Date.parse(published) <= cutoff;
  };
  if (isSettled(latest)) return latest;
  const older = Object.keys(time)
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v) && isSettled(v) && compareVersions(v, latest) < 0)
    .sort(compareVersions);
  return older.at(-1) ?? latest;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getLatestVersion(pkg: string): string | undefined {
  if (VERSION_CACHE.has(pkg)) return VERSION_CACHE.get(pkg);
  try {
    const view = JSON.parse(
      execSync(`npm view ${pkg} time dist-tags --json`, { encoding: 'utf8' }),
    ) as { 'dist-tags': { latest: string }; time: Record<string, string> };
    const version = pickSettledVersion(
      view.time,
      view['dist-tags'].latest,
      Date.now() - MIN_RELEASE_AGE_MS,
    );
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
