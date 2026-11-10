import semver from 'semver';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const { execSync } = await import('node:child_process');
const mockedExecSync = vi.mocked(execSync);

// versions.ts caches results in a module-level Map, so each test uses a
// unique fake package name to avoid bleeding state across tests.
let counter = 0;
function uniquePkg(): string {
  counter += 1;
  return `fake-pkg-${counter}`;
}

const LONG_AGO = '2020-01-01T00:00:00.000Z';

// What `npm view <pkg> time dist-tags --json` prints for a package whose
// only release is old enough to install.
function npmView(latest: string): string {
  return JSON.stringify({ 'dist-tags': { latest }, time: { [latest]: LONG_AGO } });
}

beforeEach(() => {
  mockedExecSync.mockReset();
  // getToolchainDeps always queries the same real package names, so without
  // a fresh module instance per test their results would be cached by
  // whichever test runs first, hiding the failure path later.
  vi.resetModules();
});

describe('getVersions', () => {
  it('resolves each package to a caret-prefixed version', async () => {
    const { getVersions } = await import('./versions.js');
    const pkg = uniquePkg();
    mockedExecSync.mockReturnValue(npmView('2.5.0'));

    const result = getVersions([pkg]);

    expect(result).toEqual({ [pkg]: '^2.5.0' });
    expect(mockedExecSync).toHaveBeenCalledWith(`npm view ${pkg} time dist-tags --json`, {
      encoding: 'utf8',
    });
  });

  it('throws instead of degrading to an unconstrained or invalid range when the npm lookup fails', async () => {
    const { getVersions } = await import('./versions.js');
    const pkg = uniquePkg();
    mockedExecSync.mockImplementation(() => {
      throw new Error('network error');
    });

    // A failed lookup aborts the whole init/scaffold run rather than
    // silently writing a looser dependency range (or the invalid range
    // "^*" a naive `^${fallback}` wrap used to produce).
    expect(() => getVersions([pkg])).toThrow(pkg);
  });

  it('caches a resolved version instead of calling npm view again', async () => {
    const { getVersions } = await import('./versions.js');
    const pkg = uniquePkg();
    mockedExecSync.mockReturnValue(npmView('1.0.0'));

    getVersions([pkg]);
    getVersions([pkg]);

    expect(mockedExecSync).toHaveBeenCalledTimes(1);
  });
});

describe('pickSettledVersion', () => {
  const cutoff = Date.parse('2026-11-09T00:00:00.000Z');
  const time = {
    '1.91.0': '2026-11-03T14:03:34.451Z',
    '1.92.0': '2026-11-06T12:29:01.579Z',
    '1.93.0': '2026-11-09T11:47:31.291Z',
    '2.0.0-beta.1': '2026-11-01T00:00:00.000Z',
    created: '2023-06-27T14:47:07.176Z',
    modified: '2026-11-09T11:47:31.667Z',
  };

  // pnpm 11 would otherwise add a minimumReleaseAgeExclude line per package.
  it('steps back to the newest stable release older than the cutoff', async () => {
    const { pickSettledVersion } = await import('./versions.js');

    expect(pickSettledVersion(time, '1.93.0', cutoff)).toBe('1.92.0');
  });

  it('keeps latest once it is old enough', async () => {
    const { pickSettledVersion } = await import('./versions.js');

    expect(pickSettledVersion(time, '1.93.0', Date.parse('2026-11-10T12:00:00.000Z'))).toBe(
      '1.93.0',
    );
  });

  it('falls back to latest when no older release qualifies', async () => {
    const { pickSettledVersion } = await import('./versions.js');

    expect(pickSettledVersion({ '1.0.0': '2026-11-09T11:00:00.000Z' }, '1.0.0', cutoff)).toBe(
      '1.0.0',
    );
  });

  it('compares versions numerically, not as strings', async () => {
    const { pickSettledVersion } = await import('./versions.js');
    const many = { '1.10.0': LONG_AGO, '1.11.0': '2026-11-09T11:00:00.000Z', '1.9.0': LONG_AGO };

    expect(pickSettledVersion(many, '1.11.0', cutoff)).toBe('1.10.0');
  });
});

describe('getTypescriptVersion', () => {
  it('allows any TypeScript 7 release but nothing older, since oxlint-tsgolint needs 7', async () => {
    const { getTypescriptVersion } = await import('./versions.js');

    const range = getTypescriptVersion();

    expect(semver.satisfies('7.4.0', range)).toBe(true);
    expect(semver.satisfies('6.0.3', range)).toBe(false);
    expect(mockedExecSync).not.toHaveBeenCalled();
  });
});

describe('getToolchainDeps', () => {
  it('returns caret versions for the toolchain packages', async () => {
    const { getToolchainDeps } = await import('./versions.js');
    mockedExecSync.mockReturnValue(npmView('9.9.9'));

    const deps = getToolchainDeps();

    expect(Object.keys(deps)).toEqual(
      expect.arrayContaining([
        'prettier',
        'husky',
        'lint-staged',
        'oxlint',
        'oxlint-tsgolint',
        'commitizen',
        '@commitlint/cz-commitlint',
      ]),
    );
    expect(deps).not.toHaveProperty('eslint');
    expect(deps).not.toHaveProperty('eslint-import-resolver-typescript');
    const { typescript, ...rest } = deps;
    for (const version of Object.values(rest)) {
      expect(version).toBe('^9.9.9');
    }
    // Without it, a JS project gets a typecheck script and pre-commit hook
    // that fail with "tsc not found".
    expect(typescript).toBe('^7.0.2');
  });

  it('throws on the first package that fails to resolve', async () => {
    const { getToolchainDeps } = await import('./versions.js');
    mockedExecSync.mockImplementation(() => {
      throw new Error('network error');
    });

    expect(() => getToolchainDeps()).toThrow();
  });
});
