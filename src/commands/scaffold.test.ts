import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('./init.js', () => ({ init: vi.fn() }));

const { execSync } = await import('node:child_process');
const { init } = await import('./init.js');
const { scaffold } = await import('./scaffold.js');

let parent: string;

function commands(): string[] {
  return vi.mocked(execSync).mock.calls.map(([command]) => String(command));
}

beforeEach(() => {
  parent = mkdtempSync(path.join(tmpdir(), 'toolchain-scaffold-'));
  vi.spyOn(process, 'cwd').mockReturnValue(parent);
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(console, 'log').mockReturnValue();
  vi.mocked(execSync).mockReset();
  vi.mocked(init).mockReset();
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
    vi.mocked(execSync).mockImplementation((command) => {
      if (String(command).includes('create-next-app')) {
        mkdirSync(path.join(parent, 'demo', '.git'), { recursive: true });
      }
      return Buffer.from('');
    });

    await scaffold('demo', { pm: 'npm', template: 'nextjs', yes: true });

    expect(commands()).not.toContain('git init');
  });
});

describe('scaffold cleanup', () => {
  it('fixes lint and formats after the toolchain is set up', async () => {
    const order: string[] = [];
    vi.mocked(init).mockImplementation(() => {
      order.push('init');
      return Promise.resolve();
    });
    vi.mocked(execSync).mockImplementation((command) => {
      order.push(String(command));
      return Buffer.from('');
    });

    await scaffold('demo', { pm: 'npm', template: 'react', yes: true });

    expect(order.slice(-3)).toEqual(['init', 'npm run lint:fix', 'npm run format']);
  });

  it('still formats and finishes when lint:fix leaves errors behind', async () => {
    vi.mocked(execSync).mockImplementation((command) => {
      if (String(command).endsWith('lint:fix')) throw new Error('exit 1');
      return Buffer.from('');
    });

    await expect(
      scaffold('demo', { pm: 'npm', template: 'react', yes: true }),
    ).resolves.toBeUndefined();
    expect(commands()).toContain('npm run format');
  });
});
