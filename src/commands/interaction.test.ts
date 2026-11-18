import * as clack from '@clack/prompts';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { CommandCancelledError } from '../utils/process.js';
import { init } from './init.js';
import { scaffold } from './scaffold.js';

vi.mock('../utils/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/progress.js')>()),
  runTask: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@clack/prompts', async (importOriginal) => ({
  ...(await importOriginal<typeof clack>()),
  confirm: vi.fn(),
  select: vi.fn(),
}));
vi.mock('../utils/versions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/versions.js')>()),
  getToolchainDeps: vi.fn().mockResolvedValue({ husky: '^9.0.0', typescript: '^7.0.2' }),
}));

const { runTask } = await import('../utils/progress.js');
const { getToolchainDeps } = await import('../utils/versions.js');
let dir: string;
let stdout: MockInstance<typeof process.stdout.write>;
const originalTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const originalOutputTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'toolchain-interaction-'));
  writeFileSync(path.join(dir, 'package.json'), '{"name":"demo"}\n');
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
  vi.mocked(clack.confirm).mockReset().mockResolvedValue(true);
  vi.mocked(clack.select).mockReset().mockResolvedValue('plain');
  vi.mocked(runTask).mockClear();
  vi.mocked(getToolchainDeps).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalTTY) Object.defineProperty(process.stdin, 'isTTY', originalTTY);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  if (originalOutputTTY) Object.defineProperty(process.stdout, 'isTTY', originalOutputTTY);
  else Reflect.deleteProperty(process.stdout, 'isTTY');
  rmSync(dir, { recursive: true, force: true });
});

describe('init interaction', () => {
  it('summarizes written files while keeping warnings visible', async () => {
    await init({ pm: 'pnpm', yes: true });
    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('\n');
    expect(output).toContain(
      'Wrote 9 config files, updated package.json and recorded .toolchain.json',
    );
    expect(output).not.toMatch(/^[^\n]*\s\.editorconfig\s*$/m);
    expect(output).toContain('No TypeScript files found');
    expect(existsSync(path.join(dir, '.editorconfig'))).toBe(true);
    expect(existsSync(path.join(dir, '.husky', 'pre-commit'))).toBe(true);
  });

  it('allows declining setup without an error or any writes', async () => {
    vi.mocked(clack.confirm).mockResolvedValue(false);
    await expect(init({ pm: 'pnpm' })).resolves.toBeUndefined();
    expect(readdirSync(dir)).toEqual(['package.json']);
    expect(getToolchainDeps).not.toHaveBeenCalled();
    expect(runTask).not.toHaveBeenCalled();
  });

  it('reports prompt cancellation before writes or registry lookups', async () => {
    vi.mocked(clack.confirm).mockResolvedValue(clack.CANCEL_SYMBOL);
    await expect(init({ pm: 'pnpm' })).rejects.toBeInstanceOf(CommandCancelledError);
    expect(readdirSync(dir)).toEqual(['package.json']);
    expect(getToolchainDeps).not.toHaveBeenCalled();
    expect(runTask).not.toHaveBeenCalled();
  });

  it('accepts confirmation and generates the setup', async () => {
    await init({ pm: 'pnpm' });
    expect(clack.confirm).toHaveBeenCalledWith(expect.objectContaining({ initialValue: true }));
    expect(existsSync(path.join(dir, '.toolchain.json'))).toBe(true);
  });

  it('requires --yes without a terminal before writes or registry lookups', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    await expect(init({ pm: 'pnpm' })).rejects.toThrow(/no terminal.*--yes/);
    expect(clack.confirm).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual(['package.json']);
    expect(getToolchainDeps).not.toHaveBeenCalled();
  });

  it('bypasses confirmation with --yes', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    await init({ pm: 'pnpm', yes: true });
    expect(clack.confirm).not.toHaveBeenCalled();
    expect(existsSync(path.join(dir, '.toolchain.json'))).toBe(true);
  });

  it('refuses a hidden confirmation when stdout is redirected', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    await expect(init({ pm: 'pnpm' })).rejects.toThrow(/no terminal.*--yes/);
    expect(clack.confirm).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual(['package.json']);
    expect(getToolchainDeps).not.toHaveBeenCalled();
    expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).not.toContain('[?25');
  });
});

describe('scaffold interaction', () => {
  it('cancels template selection without creating a directory', async () => {
    vi.mocked(clack.select).mockResolvedValue(clack.CANCEL_SYMBOL);
    await expect(scaffold('demo', { pm: 'pnpm' })).rejects.toBeInstanceOf(CommandCancelledError);
    expect(existsSync(path.join(dir, 'demo'))).toBe(false);
    expect(runTask).not.toHaveBeenCalled();
  });

  it('requires a template without a terminal', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    await expect(scaffold('demo', { pm: 'pnpm' })).rejects.toThrow(/no terminal.*--template/);
    expect(clack.select).not.toHaveBeenCalled();
    expect(existsSync(path.join(dir, 'demo'))).toBe(false);
  });

  it('refuses hidden template selection when stdout is redirected', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    await expect(scaffold('demo', { pm: 'pnpm' })).rejects.toThrow(/no terminal.*--template/);
    expect(clack.select).not.toHaveBeenCalled();
    expect(existsSync(path.join(dir, 'demo'))).toBe(false);
  });

  it('offers template hints and prints only one completion and next-step summary', async () => {
    await scaffold('demo', { pm: 'pnpm' });
    const option = vi
      .mocked(clack.select)
      .mock.calls[0]?.[0].options.find((item) => item.value === 'plain');
    expect(option?.hint).toEqual(expect.any(String));
    expect(option?.label).toBe('plain');
    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('\n');
    expect(output).toContain('Created 4 project files');
    expect(output).toContain(
      'Wrote 8 config files, updated package.json and recorded .toolchain.json',
    );
    expect(output).not.toContain('Creating project directory...');
    expect(output).not.toContain('Writing package.json...');
    expect(output).not.toContain('Setting up toolchain...');
    expect(output).not.toMatch(/^[^\n]*\ssrc\/index\.ts\s*$/m);
    expect(existsSync(path.join(dir, 'demo', 'src', 'index.ts'))).toBe(true);
    expect(output).toContain('Project "demo" is ready!');
    expect(output).not.toContain('Toolchain is ready!');
    expect(output.match(/Next steps/g)).toHaveLength(1);
    expect(readFileSync(path.join(dir, 'demo', '.toolchain.json'), 'utf8')).toContain('entries');
  });
});
