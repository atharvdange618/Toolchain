import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandCancelledError } from '../utils/process.js';

vi.mock('../utils/progress.js', () => ({ runTask: vi.fn(), withProgress: vi.fn() }));
vi.mock('./init.js', () => ({ init: vi.fn() }));
vi.mock('../generators/templates/express.js', () => ({ generateExpress: vi.fn() }));

const { runTask, withProgress } = await import('../utils/progress.js');
const { generateExpress } = await import('../generators/templates/express.js');
const { init } = await import('./init.js');
const { scaffold } = await import('./scaffold.js');

let parent: string;
let output: string[];

function commands(): string[] {
  return vi.mocked(runTask).mock.calls.map(([command]) => command);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  parent = mkdtempSync(path.join(tmpdir(), 'toolchain-scaffold-'));
  output = [];
  vi.spyOn(process, 'cwd').mockReturnValue(parent);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  vi.spyOn(console, 'log').mockImplementation((line) => output.push(String(line)));
  vi.mocked(runTask).mockReset().mockResolvedValue(undefined);
  vi.mocked(init).mockReset().mockResolvedValue(undefined);
  vi.mocked(withProgress)
    .mockReset()
    .mockImplementation((_title, _done, work) => work(new AbortController().signal));
  vi.mocked(generateExpress).mockReset().mockResolvedValue({
    files: [],
    framework: 'express',
    hasReact: false,
    isMonorepo: false,
    packageJson: {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(parent, { force: true, recursive: true });
});

describe('scaffold git setup', () => {
  // create-vite doesn't create a repo, and husky can't install hooks without one.
  it('runs git init when the scaffolding tool leaves no repo', async () => {
    await scaffold('demo', { pm: 'npm', template: 'react', yes: true });

    expect(commands()).toContain('git init');
  });

  it('skips git init when the scaffolding tool already made a repo', async () => {
    vi.mocked(runTask).mockImplementation((command) => {
      if (command.includes('create-next-app')) {
        mkdirSync(path.join(parent, 'demo', '.git'), { recursive: true });
      }
      return Promise.resolve();
    });

    await scaffold('demo', { pm: 'npm', template: 'nextjs', yes: true });

    expect(commands()).not.toContain('git init');
  });

  it('warns and continues when git init fails', async () => {
    vi.mocked(runTask).mockImplementation((command) =>
      command === 'git init' ? Promise.reject(new Error('exit 1')) : Promise.resolve(),
    );

    await scaffold('demo', { pm: 'npm', template: 'react', yes: true });

    expect(init).toHaveBeenCalled();
    expect(output.join('')).toContain('is ready!');
  });
});

describe('scaffold template versions', () => {
  it('shows progress and passes its signal while a template resolves versions', async () => {
    await scaffold('demo', { pm: 'npm', template: 'express', yes: true });

    expect(withProgress).toHaveBeenCalledWith(
      'Resolving template versions',
      'Template versions resolved',
      expect.any(Function),
    );
    const signal = vi.mocked(generateExpress).mock.calls[0]?.[0].signal;
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('shows no version progress for a template that resolves nothing', async () => {
    await scaffold('demo', { pm: 'npm', template: 'react', yes: true });

    expect(withProgress).not.toHaveBeenCalled();
  });

  it('stops before writing files when the version lookup is cancelled', async () => {
    const failure = new CommandCancelledError('Resolve dependency versions');
    vi.mocked(generateExpress).mockRejectedValue(failure);

    await expect(scaffold('demo', { pm: 'npm', template: 'express', yes: true })).rejects.toBe(
      failure,
    );

    expect(runTask).not.toHaveBeenCalled();
    expect(init).not.toHaveBeenCalled();
  });
});

describe('scaffold ordering', () => {
  it('waits for the external scaffolder before git, init and cleanup', async () => {
    const vite = deferred();
    vi.mocked(runTask).mockImplementation((command) =>
      command.includes('create-vite') ? vite.promise : Promise.resolve(),
    );

    const running = scaffold('demo', { pm: 'npm', template: 'react', yes: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(commands()).toHaveLength(1);
    expect(init).not.toHaveBeenCalled();

    vite.resolve();
    await running;
    expect(commands().slice(1)).toEqual(['git init', 'npm run lint:fix', 'npm run format']);
  });

  it.each([
    ['cancelled', new CommandCancelledError('create-vite')],
    ['failed', new Error('exit 1')],
  ])('stops every later phase when the scaffolder is %s', async (_label, failure) => {
    vi.mocked(runTask).mockImplementation((command) =>
      command.includes('create-vite') ? Promise.reject(failure) : Promise.resolve(),
    );

    await expect(scaffold('demo', { pm: 'npm', template: 'react', yes: true })).rejects.toBe(
      failure,
    );

    expect(commands()).toHaveLength(1);
    expect(init).not.toHaveBeenCalled();
    expect(output.join('')).not.toContain('is ready!');
  });
});

describe('scaffold cleanup', () => {
  it('fixes lint and formats after the toolchain is set up', async () => {
    const order: string[] = [];
    vi.mocked(init).mockImplementation(() => {
      order.push('init');
      return Promise.resolve();
    });
    vi.mocked(runTask).mockImplementation((command) => {
      order.push(command);
      return Promise.resolve();
    });

    await scaffold('demo', { pm: 'npm', template: 'react', yes: true });

    expect(order.slice(-3)).toEqual(['init', 'npm run lint:fix', 'npm run format']);
  });

  it('still formats and finishes when lint:fix leaves errors behind', async () => {
    vi.mocked(runTask).mockImplementation((command) =>
      command.endsWith('lint:fix') ? Promise.reject(new Error('exit 1')) : Promise.resolve(),
    );

    await expect(
      scaffold('demo', { pm: 'npm', template: 'react', yes: true }),
    ).resolves.toBeUndefined();
    expect(commands()).toContain('npm run format');
  });

  it.each(['git init', 'npm run lint:fix', 'npm run format'])(
    'stops without a ready message when %s is cancelled',
    async (cancelled) => {
      const failure = new CommandCancelledError(cancelled);
      vi.mocked(runTask).mockImplementation((command) =>
        command === cancelled ? Promise.reject(failure) : Promise.resolve(),
      );

      await expect(scaffold('demo', { pm: 'npm', template: 'react', yes: true })).rejects.toBe(
        failure,
      );

      expect(commands().at(-1)).toBe(cancelled);
      expect(output.join('')).not.toContain('is ready!');
    },
  );

  // After init the project works; only the cleanup of generated files is left.
  it.each([
    ['npm run lint:fix', 'Run "npm run lint:fix" and "npm run format" manually to finish setup.'],
    ['npm run format', 'Run "npm run format" manually to finish setup.'],
  ])('names the remaining steps when %s is cancelled', async (cancelled, retry) => {
    vi.mocked(runTask).mockImplementation((command) =>
      command === cancelled
        ? Promise.reject(new CommandCancelledError(cancelled))
        : Promise.resolve(),
    );

    await expect(
      scaffold('demo', { pm: 'npm', template: 'react', yes: true }),
    ).rejects.toBeInstanceOf(CommandCancelledError);

    expect(output.join('')).toContain(retry);
  });

  it('stops when init is cancelled', async () => {
    const failure = new CommandCancelledError('npm install');
    vi.mocked(init).mockRejectedValue(failure);

    await expect(scaffold('demo', { pm: 'npm', template: 'react', yes: true })).rejects.toBe(
      failure,
    );

    expect(commands()).not.toContain('npm run lint:fix');
  });
});
