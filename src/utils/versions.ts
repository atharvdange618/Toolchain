import { isObject } from './fs.js';
import { CommandCancelledError, isCommandCancelled, runCommand } from './process.js';

const VERSION_CACHE = new Map<string, string>();

export const TOOLCHAIN_DEP_NAMES: readonly string[] = [
  '@commitlint/cli',
  '@commitlint/config-conventional',
  'husky',
  'lint-staged',
  'oxlint',
  'oxlint-tsgolint',
  'prettier',
  'typescript',
];

export async function getToolchainDeps(
  names: readonly string[] = TOOLCHAIN_DEP_NAMES,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  for (const name of names) {
    if (!TOOLCHAIN_DEP_NAMES.includes(name))
      throw new Error(`Unknown toolchain dependency: ${name}`);
  }
  const versions = await getVersions(
    names.filter((name) => name !== 'typescript'),
    signal,
  );
  if (names.includes('typescript')) versions['typescript'] = getTypescriptVersion();
  return versions;
}

export function getTypescriptVersion(): string {
  // oxlint-tsgolint runs on TypeScript 7, so v1's 6.0.x pin is gone.
  return '^7.0.2';
}

export async function getVersions(
  packages: readonly string[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  if (signal?.aborted) throw new CommandCancelledError('Resolve dependency versions');
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const lookups = packages.map(async (pkg) => [pkg, await toRange(pkg, combined)] as const);
  try {
    return Object.fromEntries(await Promise.all(lookups));
  } catch (failure) {
    controller.abort();
    await Promise.allSettled(lookups);
    throw failure;
  }
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

async function toRange(pkg: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new CommandCancelledError(`npm view ${pkg}`);
  const cached = VERSION_CACHE.get(pkg);
  if (cached !== undefined) return `^${cached}`;
  try {
    const { stdout } = await runCommand(`npm view ${pkg} time dist-tags --json`, {
      cwd: process.cwd(),
      mode: 'capture',
      ...(signal ? { signal } : {}),
    });
    const view: unknown = JSON.parse(stdout);
    if (!isObject(view) || !isObject(view['dist-tags']) || !isObject(view['time'])) {
      throw new Error('Invalid npm metadata');
    }
    const latest = view['dist-tags']['latest'];
    if (typeof latest !== 'string' || !/^\d+\.\d+\.\d+$/.test(latest)) {
      throw new Error('Invalid npm latest version');
    }
    const time: Record<string, string> = {};
    for (const [version, published] of Object.entries(view['time'])) {
      if (typeof published !== 'string' || !Number.isFinite(Date.parse(published))) {
        throw new Error('Invalid npm publication date');
      }
      time[version] = published;
    }
    if (time[latest] === undefined) throw new Error('Missing npm publication date');
    const version = pickSettledVersion(time, latest, Date.now() - MIN_RELEASE_AGE_MS);
    VERSION_CACHE.set(pkg, version);
    return `^${version}`;
  } catch (failure) {
    if (isCommandCancelled(failure)) throw failure;
    throw new Error(
      `Could not resolve the latest version of "${pkg}" from npm. Check your network connection and try again.`,
      { cause: failure },
    );
  }
}
