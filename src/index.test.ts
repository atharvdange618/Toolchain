import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let dir: string | undefined;
const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  if (dir) rmSync(dir, { force: true, recursive: true });
  dir = undefined;
});

describe('CLI entry point', () => {
  it('prints a thrown command error to stderr and exits 1 instead of rejecting', async () => {
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
