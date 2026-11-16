import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let dir: string | undefined;
const originalArgv = process.argv;
const originalExitCode = process.exitCode;

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  if (dir) rmSync(dir, { force: true, recursive: true });
  dir = undefined;
});

describe('CLI entry point', () => {
  it('propagates async update failure through exitCode without exiting the process', async () => {
    vi.resetModules();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    process.argv = [process.execPath, 'toolchain', 'update', '--yes', '--pm', 'invalid'];

    await expect(import('./index.js')).resolves.toBeDefined();

    expect(process.exitCode).toBe(1);
    expect(exit).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Invalid package manager'));
  });

  it('propagates doctor failure through exitCode without exiting the process', async () => {
    vi.resetModules();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    process.argv = [process.execPath, 'toolchain', 'doctor', '--pm', 'invalid'];

    await expect(import('./index.js')).resolves.toBeDefined();

    expect(process.exitCode).toBe(1);
    expect(exit).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Invalid package manager'));
  });

  it('prints a thrown command error to stderr and exits 1 instead of rejecting', async () => {
    vi.resetModules();
    dir = mkdtempSync(path.join(tmpdir(), 'toolchain-cli-'));
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    process.argv = [process.execPath, 'toolchain', 'init', '--yes'];

    // Importing runs the CLI. The empty dir has no package.json, so detect() throws.
    await expect(import('./index.js')).resolves.toBeDefined();

    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('No package.json found'));
  });
});
