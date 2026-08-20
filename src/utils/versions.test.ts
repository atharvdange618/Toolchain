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

  it('produces an invalid "^*" range when the npm lookup fails', async () => {
    const { getVersions } = await import('./versions.js');
    const pkg = uniquePkg();
    mockedExecSync.mockImplementation(() => {
      throw new Error('network error');
    });

    const result = getVersions([pkg]);

    // getLatestVersion falls back to the bare string '*' on failure, but
    // getVersions unconditionally wraps every result in `^${version}`,
    // producing the literal string "^*" -- not a valid semver range. This
    // means a network hiccup during `init`/`scaffold` writes a
    // devDependency version that will make `npm install` fail outright,
    // not one that silently installs "any version" as the raw '*' fallback
    // in versions.ts might suggest.
    expect(result).toEqual({ [pkg]: '^*' });
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
  it('pins to the typescript@6.0.3 spec for typescript-eslint compatibility', async () => {
    const { getTypescriptVersion } = await import('./versions.js');
    mockedExecSync.mockReturnValue('6.0.3\n');

    const version = getTypescriptVersion();

    expect(mockedExecSync).toHaveBeenCalledWith('npm view typescript@6.0.3 version', {
      encoding: 'utf8',
    });
    // Unlike getVersions/getToolchainDeps, getTypescriptVersion returns the
    // bare version string -- callers (express.ts, plain.ts, etc.) prepend
    // the "^" themselves.
    expect(version).toBe('6.0.3');
  });
});

describe('getToolchainDeps', () => {
  it('returns caret versions for every core toolchain package', async () => {
    const { getToolchainDeps } = await import('./versions.js');
    mockedExecSync.mockReturnValue('9.9.9\n');

    const deps = getToolchainDeps();

    expect(Object.keys(deps)).toEqual(
      expect.arrayContaining(['eslint', 'prettier', 'husky', 'lint-staged', 'typescript-eslint']),
    );
    for (const version of Object.values(deps)) {
      expect(version).toBe('^9.9.9');
    }
  });
});
