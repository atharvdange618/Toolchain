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
    mockedExecSync.mockReturnValue('2.5.0\n');

    const result = getVersions([pkg]);

    expect(result).toEqual({ [pkg]: '^2.5.0' });
    expect(mockedExecSync).toHaveBeenCalledWith(`npm view ${pkg} version`, {
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
    mockedExecSync.mockReturnValue('1.0.0\n');

    getVersions([pkg]);
    getVersions([pkg]);

    expect(mockedExecSync).toHaveBeenCalledTimes(1);
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
    mockedExecSync.mockReturnValue('9.9.9\n');

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
