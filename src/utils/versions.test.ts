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
  // getTypescriptVersion always resolves the same hardcoded pinned spec, and
  // getEslintDeps always queries the same real package names, so without a
  // fresh module instance per test their results would be cached by
  // whichever test runs first, hiding the failure/conflict paths later.
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
  it('returns caret versions for the non-ESLint toolchain packages', async () => {
    const { getToolchainDeps } = await import('./versions.js');
    mockedExecSync.mockReturnValue('9.9.9\n');

    const deps = getToolchainDeps();

    expect(Object.keys(deps)).toEqual(
      expect.arrayContaining([
        'prettier',
        'husky',
        'lint-staged',
        'eslint-import-resolver-typescript',
        'commitizen',
        '@commitlint/cz-commitlint',
      ]),
    );
    // eslint and the ESLint plugins it must stay peer-compatible with are
    // resolved together by getEslintDeps, not fetched independently here.
    expect(deps).not.toHaveProperty('eslint');
    expect(deps).not.toHaveProperty('typescript-eslint');
    expect(deps).not.toHaveProperty('eslint-plugin-import-x');
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

describe('getEslintDeps', () => {
  // Mocks the three query shapes versions.ts issues against the real
  // package names getEslintDeps resolves internally (its plugin lists
  // aren't parameterized, so tests can't substitute fake names the way
  // getVersions' tests do).
  function mockRegistry(
    packages: Record<
      string,
      { latest: string; peerByVersion: Record<string, string | undefined>; versions?: string[] }
    >,
    eslintVersions: string[],
  ): void {
    mockedExecSync.mockImplementation((command: unknown) => {
      const cmd = String(command);
      if (cmd === 'npm view eslint versions --json') {
        return JSON.stringify(eslintVersions);
      }
      const versionsMatch = /^npm view (.+) versions --json$/.exec(cmd);
      if (versionsMatch?.[1]) {
        return JSON.stringify(packages[versionsMatch[1]]?.versions ?? []);
      }
      const peerMatch = /^npm view (.+)@([^@]+) peerDependencies\.eslint$/.exec(cmd);
      if (peerMatch?.[1] && peerMatch[2]) {
        const range = packages[peerMatch[1]]?.peerByVersion[peerMatch[2]];
        return range ?? '';
      }
      const versionMatch = /^npm view (.+) version$/.exec(cmd);
      if (versionMatch?.[1]) {
        return packages[versionMatch[1]]?.latest ?? '';
      }
      throw new Error(`Unmocked command: ${cmd}`);
    });
  }

  it('resolves eslint and every base plugin to their latest version when nothing conflicts', async () => {
    const { getEslintDeps } = await import('./versions.js');
    mockRegistry(
      {
        '@eslint/js': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'eslint-plugin-import-x': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'eslint-plugin-perfectionist': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'eslint-plugin-unicorn': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'typescript-eslint': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
      },
      ['9.5.0', '10.8.0'],
    );

    const deps = getEslintDeps({ framework: 'plain', hasReact: false });

    expect(deps).toEqual({
      '@eslint/js': '^1.0.0',
      eslint: '^10.8.0',
      'eslint-plugin-import-x': '^1.0.0',
      'eslint-plugin-perfectionist': '^1.0.0',
      'eslint-plugin-unicorn': '^1.0.0',
      'typescript-eslint': '^1.0.0',
    });
  });

  it('caps eslint at the most restrictive plugin and downgrades the plugin that has moved past it', async () => {
    const { getEslintDeps } = await import('./versions.js');
    // Mirrors the real conflict this was built to fix: eslint-plugin-unicorn
    // raised its floor ahead of eslint-plugin-react/jsx-a11y catching up to
    // eslint's newest major.
    mockRegistry(
      {
        '@eslint/js': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'eslint-plugin-import-x': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'eslint-plugin-jsx-a11y': { latest: '6.10.2', peerByVersion: { '6.10.2': '^9' } },
        'eslint-plugin-perfectionist': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'eslint-plugin-react': { latest: '7.37.5', peerByVersion: { '7.37.5': '^9' } },
        'eslint-plugin-react-hooks': { latest: '7.1.1', peerByVersion: { '7.1.1': '>=8.0.0' } },
        'eslint-plugin-react-you-might-not-need-an-effect': {
          latest: '1.0.1',
          peerByVersion: { '1.0.1': '>=8.0.0' },
        },
        'eslint-plugin-unicorn': {
          latest: '3.0.0',
          peerByVersion: { '1.0.0': '>=9.0.0', '2.0.0': '>=9.0.0', '3.0.0': '>=10.4.0' },
          versions: ['1.0.0', '2.0.0', '3.0.0'],
        },
        'typescript-eslint': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
      },
      ['9.5.0', '9.8.0', '10.0.0', '10.4.0', '10.8.0'],
    );

    const deps = getEslintDeps({ framework: 'react', hasReact: true });

    // Ceiling lands on the highest 9.x release, since that's the newest
    // version both jsx-a11y and react's latest still support.
    expect(deps['eslint']).toBe('^9.8.0');
    // unicorn's latest (3.0.0) doesn't support 9.8.0, so it falls back to
    // 2.0.0, the newest release that does - not just "any older version".
    expect(deps['eslint-plugin-unicorn']).toBe('^2.0.0');
    // Everything else stays at latest, since nothing else conflicted.
    expect(deps['eslint-plugin-jsx-a11y']).toBe('^6.10.2');
    expect(deps['eslint-plugin-react']).toBe('^7.37.5');
    expect(deps['eslint-plugin-react-hooks']).toBe('^7.1.1');
    expect(deps['eslint-plugin-react-you-might-not-need-an-effect']).toBe('^1.0.1');
    expect(deps['@eslint/js']).toBe('^1.0.0');
  });

  it('adds the next plugin only for next projects', async () => {
    const { getEslintDeps } = await import('./versions.js');
    mockRegistry(
      {
        '@eslint/js': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        '@next/eslint-plugin-next': { latest: '15.0.0', peerByVersion: { '15.0.0': '>=8.0.0' } },
        'eslint-plugin-import-x': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'eslint-plugin-jsx-a11y': { latest: '6.10.2', peerByVersion: { '6.10.2': '>=8.0.0' } },
        'eslint-plugin-perfectionist': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'eslint-plugin-react': { latest: '7.37.5', peerByVersion: { '7.37.5': '>=8.0.0' } },
        'eslint-plugin-react-hooks': { latest: '7.1.1', peerByVersion: { '7.1.1': '>=8.0.0' } },
        'eslint-plugin-react-you-might-not-need-an-effect': {
          latest: '1.0.1',
          peerByVersion: { '1.0.1': '>=8.0.0' },
        },
        'eslint-plugin-unicorn': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'typescript-eslint': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
      },
      ['10.8.0'],
    );

    const deps = getEslintDeps({ framework: 'next', hasReact: true });

    expect(deps['@next/eslint-plugin-next']).toBe('^15.0.0');
  });

  it('does not trust an undeclared peer at the same major as a failing declared one', async () => {
    const { getEslintDeps } = await import('./versions.js');
    // Real bug this reproduces: @eslint/js@10.0.1 declared peer "^10.0.0",
    // but @eslint/js@10.0.0 (one patch older, same major) had no peer
    // declared at all - shipped before the constraint was added back onto
    // that same release line. A naive "no declared peer means compatible"
    // check would grab 10.0.0 and still be wrong. The correct fallback is
    // an undeclared release from an older major (2.x here), which predates
    // the plugin declaring peers at all.
    mockRegistry(
      {
        '@eslint/js': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'eslint-plugin-import-x': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'eslint-plugin-jsx-a11y': { latest: '6.10.2', peerByVersion: { '6.10.2': '^9' } },
        'eslint-plugin-perfectionist': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'eslint-plugin-react': { latest: '7.37.5', peerByVersion: { '7.37.5': '^9' } },
        'eslint-plugin-react-hooks': { latest: '7.1.1', peerByVersion: { '7.1.1': '>=8.0.0' } },
        'eslint-plugin-react-you-might-not-need-an-effect': {
          latest: '1.0.1',
          peerByVersion: { '1.0.1': '>=8.0.0' },
        },
        'eslint-plugin-unicorn': {
          latest: '3.0.1',
          peerByVersion: {
            '2.5.0': undefined,
            '3.0.0': undefined,
            '3.0.1': '^10.0.0',
          },
          versions: ['2.5.0', '3.0.0', '3.0.1'],
        },
        'typescript-eslint': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
      },
      ['9.5.0', '9.8.0', '10.0.0', '10.0.1'],
    );

    const deps = getEslintDeps({ framework: 'react', hasReact: true });

    expect(deps['eslint']).toBe('^9.8.0');
    expect(deps['eslint-plugin-unicorn']).toBe('^2.5.0');
  });

  it('throws when a plugin has no published eslint version compatible at all', async () => {
    const { getEslintDeps } = await import('./versions.js');
    mockRegistry(
      {
        '@eslint/js': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'eslint-plugin-import-x': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        'eslint-plugin-perfectionist': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
        // Impossible range - no published eslint version is >=99.
        'eslint-plugin-unicorn': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=99.0.0' } },
        'typescript-eslint': { latest: '1.0.0', peerByVersion: { '1.0.0': '>=8.0.0' } },
      },
      ['9.5.0', '10.8.0'],
    );

    expect(() => getEslintDeps({ framework: 'plain', hasReact: false })).toThrow(
      'eslint-plugin-unicorn',
    );
  });
});
