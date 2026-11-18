import semver from 'semver';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => {
    throw new Error('Synchronous registry access');
  }),
}));

vi.mock('./process.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./process.js')>()),
  runCommand: vi.fn(),
}));

const { runCommand, CommandCancelledError } = await import('./process.js');
const mockedRunCommand = vi.mocked(runCommand);

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
  mockedRunCommand.mockReset();
  // getToolchainDeps always queries the same real package names, so without
  // a fresh module instance per test their results would be cached by
  // whichever test runs first, hiding the failure path later.
  vi.resetModules();
});

describe('getVersions', () => {
  it.each([
    'invalid JSON',
    'null',
    '[]',
    '{}',
    '{"dist-tags":{"latest":"*"},"time":{}}',
    '{"dist-tags":{"latest":"1.0.0"},"time":[]}',
    '{"dist-tags":{"latest":"1.0.0"},"time":{"1.0.0":7}}',
    '{"dist-tags":{"latest":"1.0.0"},"time":{"1.0.0":"bad date"}}',
  ])('rejects malformed registry metadata: %s', async (stdout) => {
    const { getVersions } = await import('./versions.js');
    mockedRunCommand.mockResolvedValue({ stdout });
    await expect(getVersions(['husky'])).rejects.toThrow('Could not resolve');
  });

  it('starts all lookups before awaiting any result and retries a failed lookup', async () => {
    const { getVersions } = await import('./versions.js');
    let resolveFirst: (value: { stdout: string }) => void = () => {};
    let resolveSecond: (value: { stdout: string }) => void = () => {};
    const first = new Promise<{ stdout: string }>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<{ stdout: string }>((resolve) => {
      resolveSecond = resolve;
    });
    mockedRunCommand.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const result = getVersions(['one', 'two']);
    expect(mockedRunCommand).toHaveBeenCalledTimes(2);
    resolveFirst({ stdout: npmView('1.0.0') });
    resolveSecond({ stdout: npmView('2.0.0') });
    await expect(result).resolves.toEqual({ one: '^1.0.0', two: '^2.0.0' });
    mockedRunCommand.mockRejectedValueOnce(new Error('offline'));
    await expect(getVersions(['retry'])).rejects.toThrow('retry');
    mockedRunCommand.mockResolvedValueOnce({ stdout: npmView('3.0.0') });
    await expect(getVersions(['retry'])).resolves.toEqual({ retry: '^3.0.0' });
  });

  it('preserves cancellation and does not cache it', async () => {
    const { getVersions } = await import('./versions.js');
    const cancelled = new CommandCancelledError('npm view husky');
    mockedRunCommand.mockRejectedValueOnce(cancelled);
    await expect(getVersions(['husky'])).rejects.toBe(cancelled);
    mockedRunCommand.mockResolvedValueOnce({ stdout: npmView('1.0.0') });
    await expect(getVersions(['husky'])).resolves.toEqual({ husky: '^1.0.0' });
  });

  it('aborts and waits for sibling lookups when a batch fails', async () => {
    const { getVersions } = await import('./versions.js');
    let stopped = false;
    mockedRunCommand.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(
      (_command, { signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            stopped = true;
            reject(new CommandCancelledError('sibling'));
          });
        }),
    );
    await expect(getVersions(['one', 'two'])).rejects.toThrow('one');
    expect(stopped).toBe(true);
  });

  it('passes a caller abort signal to every lookup', async () => {
    const { getToolchainDeps } = await import('./versions.js');
    const controller = new AbortController();
    mockedRunCommand.mockImplementation(
      (_command, { signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new CommandCancelledError('lookup')));
        }),
    );
    const result = getToolchainDeps(['husky', 'prettier'], controller.signal);
    controller.abort();
    await expect(result).rejects.toBeInstanceOf(CommandCancelledError);
  });

  it('applies the stable-release age policy to npm metadata', async () => {
    const { getVersions } = await import('./versions.js');
    mockedRunCommand.mockResolvedValue({
      stdout: JSON.stringify({
        'dist-tags': { latest: '2.0.0' },
        time: { '1.0.0': LONG_AGO, '2.0.0': new Date().toISOString() },
      }),
    });
    await expect(getVersions(['husky'])).resolves.toEqual({ husky: '^1.0.0' });
  });
  it('resolves each package to a caret-prefixed version', async () => {
    const { getVersions } = await import('./versions.js');
    const pkg = uniquePkg();
    mockedRunCommand.mockResolvedValue({ stdout: npmView('2.5.0') });

    const result = await getVersions([pkg]);

    expect(result).toEqual({ [pkg]: '^2.5.0' });
    const [command, options] = mockedRunCommand.mock.calls[0] ?? [];
    expect(command).toBe(`npm view ${pkg} time dist-tags --json`);
    expect(options).toMatchObject({ cwd: process.cwd(), mode: 'capture' });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws instead of degrading to an unconstrained or invalid range when the npm lookup fails', async () => {
    const { getVersions } = await import('./versions.js');
    const pkg = uniquePkg();
    mockedRunCommand.mockImplementation(() => {
      throw new Error('network error');
    });

    // A failed lookup aborts the whole init/scaffold run rather than
    // silently writing a looser dependency range (or the invalid range
    // "^*" a naive `^${fallback}` wrap used to produce).
    await expect(getVersions([pkg])).rejects.toThrow(pkg);
  });

  it('caches a resolved version instead of calling npm view again', async () => {
    const { getVersions } = await import('./versions.js');
    const pkg = uniquePkg();
    mockedRunCommand.mockResolvedValue({ stdout: npmView('1.0.0') });

    await getVersions([pkg]);
    await getVersions([pkg]);

    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
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
    expect(mockedRunCommand).not.toHaveBeenCalled();
  });
});

describe('getToolchainDeps', () => {
  it('resolves TypeScript alone without spawning npm', async () => {
    const { getToolchainDeps } = await import('./versions.js');
    await expect(getToolchainDeps(['typescript'])).resolves.toEqual({ typescript: '^7.0.2' });
    expect(mockedRunCommand).not.toHaveBeenCalled();
  });
  it('resolves only selected required names, keeping TypeScript offline', async () => {
    const { getToolchainDeps } = await import('./versions.js');
    mockedRunCommand.mockResolvedValue({ stdout: npmView('9.9.9') });
    expect(await getToolchainDeps(['husky', 'typescript'])).toEqual({
      husky: '^9.9.9',
      typescript: '^7.0.2',
    });
    expect(mockedRunCommand.mock.calls.map(([command]) => command)).toEqual([
      'npm view husky time dist-tags --json',
    ]);
  });

  it('rejects unknown names before doing any lookups', async () => {
    const { getToolchainDeps } = await import('./versions.js');
    await expect(getToolchainDeps(['husky', 'not-a-toolchain-dep'])).rejects.toThrow(
      'not-a-toolchain-dep',
    );
    expect(mockedRunCommand).not.toHaveBeenCalled();
    expect(await getToolchainDeps([])).toEqual({});
  });
  it('returns caret versions for the toolchain packages', async () => {
    const { getToolchainDeps } = await import('./versions.js');
    mockedRunCommand.mockResolvedValue({ stdout: npmView('9.9.9') });

    const deps = await getToolchainDeps();

    expect(Object.keys(deps)).toEqual(
      expect.arrayContaining(['prettier', 'husky', 'lint-staged', 'oxlint', 'oxlint-tsgolint']),
    );
    expect(deps).not.toHaveProperty('eslint');
    // commitizen pins glob@7.2.3, which pulls in the deprecated inflight (#10).
    expect(deps).not.toHaveProperty('commitizen');
    expect(deps).not.toHaveProperty('@commitlint/cz-commitlint');
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
    mockedRunCommand.mockImplementation(() => {
      throw new Error('network error');
    });

    await expect(getToolchainDeps()).rejects.toThrow();
  });
});
