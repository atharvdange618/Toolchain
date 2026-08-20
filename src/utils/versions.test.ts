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
  // getTypescriptVersion always resolves the same hardcoded pinned spec, so
  // without a fresh module instance per test its result would be cached
  // by whichever test runs first, hiding the failure path in later tests.
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
  it('pins to the typescript@6.0.3 spec for typescript-eslint compatibility', async () => {
    const { getTypescriptVersion } = await import('./versions.js');
    mockedExecSync.mockReturnValue('6.0.3\n');

    const version = getTypescriptVersion();

    expect(mockedExecSync).toHaveBeenCalledWith('npm view typescript@6.0.3 version', {
      encoding: 'utf8',
    });
    expect(version).toBe('^6.0.3');
  });

  it('throws when the pinned lookup fails', async () => {
    const { getTypescriptVersion } = await import('./versions.js');
    mockedExecSync.mockImplementation(() => {
      throw new Error('network error');
    });

    expect(() => getTypescriptVersion()).toThrow('typescript@6.0.3');
  });
});

describe('getToolchainDeps', () => {
  it('returns caret versions for every core toolchain package', async () => {
    const { getToolchainDeps } = await import('./versions.js');
    mockedExecSync.mockReturnValue('9.9.9\n');

    const deps = getToolchainDeps();

    expect(Object.keys(deps)).toEqual(
      expect.arrayContaining([
        'eslint',
        'prettier',
        'husky',
        'lint-staged',
        'typescript-eslint',
        'eslint-plugin-import-x',
        'eslint-import-resolver-typescript',
        'commitizen',
        '@commitlint/cz-commitlint',
      ]),
    );
    for (const version of Object.values(deps)) {
      expect(version).toBe('^9.9.9');
    }
  });

  it('throws on the first package that fails to resolve', async () => {
    const { getToolchainDeps } = await import('./versions.js');
    mockedExecSync.mockImplementation(() => {
      throw new Error('network error');
    });

    expect(() => getToolchainDeps()).toThrow();
  });
});

describe('getReactDeps', () => {
  it('includes eslint-plugin-react, react-hooks, jsx-a11y, and the you-might-not-need-an-effect plugin', async () => {
    const { getReactDeps } = await import('./versions.js');
    mockedExecSync.mockReturnValue('1.2.3\n');

    const deps = getReactDeps();

    expect(deps).toEqual({
      'eslint-plugin-jsx-a11y': '^1.2.3',
      'eslint-plugin-react': '^1.2.3',
      'eslint-plugin-react-hooks': '^1.2.3',
      'eslint-plugin-react-you-might-not-need-an-effect': '^1.2.3',
    });
  });
});
