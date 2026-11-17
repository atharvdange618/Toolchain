import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CAPTURE_LIMIT_BYTES,
  CommandCancelledError,
  CommandFailedError,
  isCommandCancelled,
  runCommand,
} from './process.js';

const isWindows = process.platform === 'win32';
const processModule = fileURLToPath(new URL('./process.ts', import.meta.url));

// The directory name has spaces on purpose: every command runs with it as cwd
// and every fixture path sits inside it.
let dir = '';

const FIXTURES: Record<string, string> = {
  'big.cjs': `process.stdout.write('x'.repeat(${CAPTURE_LIMIT_BYTES} + 10));`,
  'delayed.cjs': `setTimeout(() => process.stdout.write('done'), 400);`,
  'exit.cjs': `process.exit(Number(process.argv[2]));`,
  'hang.cjs': `process.stdout.write('ready\\n'); setInterval(() => {}, 1000);`,
  'ignore-term.cjs': `process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000);`,
  // The parent exits at once; its child still holds stderr and writes later.
  // A runner that settles on 'exit' instead of 'close' misses "late".
  'late-stderr.cjs': `
    const { spawn } = require('node:child_process');
    spawn(process.execPath, ['-e', "setTimeout(() => process.stderr.write('late\\\\n'), 300)"], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });`,
  'pgid.cjs': `
    const { execFileSync } = require('node:child_process');
    const group = execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' });
    require('node:fs').writeFileSync(process.argv[2], group.trim());`,
  'pid.cjs': `require('node:fs').writeFileSync(process.argv[2], String(process.pid));`,
  'sigint-cli.mjs': `
    import { pathToFileURL } from 'node:url';
    const [, , modulePath, command] = process.argv;
    const { isCommandCancelled, runCommand } = await import(pathToFileURL(modulePath).href);
    try {
      await runCommand(command, {
        cwd: process.cwd(),
        mode: 'stream',
        onOutput: (text) => { if (text.includes('ready')) process.stdout.write('ready\\n'); },
      });
      process.stdout.write('finished\\n');
    } catch (error) {
      process.stdout.write(isCommandCancelled(error) ? 'cancelled\\n' : 'other\\n');
    }`,
  'streams.cjs': `process.stdout.write('out\\n'); process.stderr.write('err\\n');`,
  // Starts a descendant that writes a marker after 1.5 s, then waits forever.
  'tree.cjs': `
    const { spawn } = require('node:child_process');
    const marker = JSON.stringify(process.argv[2]);
    spawn(process.execPath, ['-e', 'setTimeout(() => require("node:fs").writeFileSync(' + marker + ', "x"), 1500)'], {
      stdio: 'ignore',
    });
    process.stdout.write('ready\\n');
    setInterval(() => {}, 1000);`,
  'utf8.cjs': `
    const euro = Buffer.from('€');
    process.stdout.write(euro.subarray(0, 1));
    setTimeout(() => process.stdout.write(euro.subarray(1)), 100);`,
};

function node(script: string, ...args: string[]): string {
  const quoted = args.map((arg) => `"${arg}"`).join(' ');
  return `"${process.execPath}" "${path.join(dir, script)}" ${quoted}`.trim();
}

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for condition'));
      }
    }, 20);
  });
}

function pgid(pid: number): string {
  return execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim();
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain process '));
  for (const [name, content] of Object.entries(FIXTURES)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  if (isWindows) fs.writeFileSync(path.join(dir, 'shim.cmd'), '@echo shim %1\r\n');
});

afterAll(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});

describe('runCommand', () => {
  it('keeps stdout and stderr apart and returns stdout in capture mode', async () => {
    const seen: Array<[string, string]> = [];
    const result = await runCommand(node('streams.cjs'), {
      cwd: dir,
      mode: 'capture',
      onOutput: (text, stream) => seen.push([stream, text]),
    });

    expect(result.stdout).toBe('out\n');
    expect(
      seen
        .filter(([s]) => s === 'stdout')
        .map(([, t]) => t)
        .join(''),
    ).toBe('out\n');
    expect(
      seen
        .filter(([s]) => s === 'stderr')
        .map(([, t]) => t)
        .join(''),
    ).toBe('err\n');
  });

  it('does not accumulate stdout in stream mode', async () => {
    const result = await runCommand(node('streams.cjs'), { cwd: dir, mode: 'stream' });

    expect(result.stdout).toBe('');
  });

  it('waits for close, so stderr written after the shell exits still arrives', async () => {
    let stderr = '';
    await runCommand(node('late-stderr.cjs'), {
      cwd: dir,
      mode: 'stream',
      onOutput: (text, stream) => {
        if (stream === 'stderr') stderr += text;
      },
    });

    expect(stderr).toContain('late');
  });

  it('rejects with the exit code on a nonzero status', async () => {
    const error: unknown = await runCommand(node('exit.cjs', '3'), {
      cwd: dir,
      mode: 'capture',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CommandFailedError);
    expect((error as CommandFailedError).exitCode).toBe(3);
    expect(isCommandCancelled(error)).toBe(false);
  });

  it('rejects when the process cannot start', async () => {
    const error: unknown = await runCommand(node('exit.cjs', '0'), {
      cwd: path.join(dir, 'missing'),
      mode: 'capture',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(isCommandCancelled(error)).toBe(false);
  });

  it('never starts the command when the signal is already aborted', async () => {
    const pidFile = path.join(dir, 'pre-aborted.pid');
    const run = runCommand(node('pid.cjs', pidFile), {
      cwd: dir,
      mode: 'capture',
      signal: AbortSignal.abort(),
    });

    await expect(run).rejects.toBeInstanceOf(CommandCancelledError);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it('leaves the event loop free while the child runs', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 20);
    try {
      const result = await runCommand(node('delayed.cjs'), { cwd: dir, mode: 'capture' });
      expect(result.stdout).toBe('done');
    } finally {
      clearInterval(timer);
    }

    expect(ticks).toBeGreaterThan(5);
  });

  it('decodes a UTF-8 character split across chunks', async () => {
    const chunks: string[] = [];
    const result = await runCommand(node('utf8.cjs'), {
      cwd: dir,
      mode: 'capture',
      onOutput: (text) => chunks.push(text),
    });

    expect(result.stdout).toBe('€');
    expect(chunks.join('')).not.toContain('�');
  });

  it('rejects instead of truncating when captured stdout passes the limit', async () => {
    await expect(runCommand(node('big.cjs'), { cwd: dir, mode: 'capture' })).rejects.toThrow(
      /1 MiB/,
    );
  });

  it('runs commands from inherit mode and resolves with empty stdout', async () => {
    const result = await runCommand(node('exit.cjs', '0'), { cwd: dir, mode: 'inherit' });

    expect(result.stdout).toBe('');
  });

  // npm.cmd and pnpm.cmd resolve from PATH, so the shim does too. cmd.exe may
  // skip the current directory (NoDefaultCurrentDirectoryInExePath).
  it.skipIf(!isWindows)('runs a .cmd shim on PATH from a directory with spaces', async () => {
    const originalPath = process.env['PATH'];
    process.env['PATH'] = `${dir}${path.delimiter}${originalPath ?? ''}`;
    try {
      const result = await runCommand('shim world', { cwd: dir, mode: 'capture' });
      expect(result.stdout).toContain('shim world');
    } finally {
      process.env['PATH'] = originalPath;
    }
  });
});

describe('runCommand cancellation', () => {
  it('stops the whole process tree when aborted', async () => {
    const marker = path.join(dir, 'tree-marker');
    const controller = new AbortController();
    let output = '';
    const run = runCommand(node('tree.cjs', marker), {
      cwd: dir,
      mode: 'stream',
      onOutput: (text) => (output += text),
      signal: controller.signal,
    });

    await waitFor(() => output.includes('ready'));
    controller.abort();

    await expect(run).rejects.toBeInstanceOf(CommandCancelledError);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(fs.existsSync(marker)).toBe(false);
  }, 15_000);

  it('force-stops a child that ignores SIGTERM after the grace period', async () => {
    const controller = new AbortController();
    let output = '';
    const run = runCommand(node('ignore-term.cjs'), {
      cwd: dir,
      mode: 'stream',
      onOutput: (text) => (output += text),
      signal: controller.signal,
    });

    await waitFor(() => output.includes('ready'));
    controller.abort();

    await expect(run).rejects.toBeInstanceOf(CommandCancelledError);
  }, 15_000);

  it('turns SIGINT into cancellation while a command runs, then removes its listener', async () => {
    // Detach the test runner's own listeners so emitting SIGINT reaches only ours.
    const others = process.listeners('SIGINT');
    process.removeAllListeners('SIGINT');
    try {
      let output = '';
      const run = runCommand(node('hang.cjs'), {
        cwd: dir,
        mode: 'stream',
        onOutput: (text) => (output += text),
      });

      await waitFor(() => output.includes('ready'));
      expect(process.listenerCount('SIGINT')).toBe(1);
      process.emit('SIGINT');

      await expect(run).rejects.toBeInstanceOf(CommandCancelledError);
      expect(process.listenerCount('SIGINT')).toBe(0);
    } finally {
      for (const listener of others) process.on('SIGINT', listener);
    }
  }, 15_000);

  it('removes its signal listeners after a normal finish', async () => {
    const before = process.listenerCount('SIGTERM');
    await runCommand(node('exit.cjs', '0'), { cwd: dir, mode: 'capture' });

    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  // Windows cannot deliver SIGINT to another process, and Node 20 cannot run
  // the fixture's TypeScript import, so this runs on POSIX with Node 22.18+.
  it.skipIf(isWindows || !process.features.typescript)(
    'cancels when a real SIGINT reaches the CLI process',
    async () => {
      const cli = spawn(
        process.execPath,
        [path.join(dir, 'sigint-cli.mjs'), processModule, node('hang.cjs')],
        { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] },
      );
      let output = '';
      cli.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));

      await waitFor(() => output.includes('ready'));
      cli.kill('SIGINT');
      await new Promise((resolve) => cli.on('close', resolve));

      expect(output).toContain('cancelled');
    },
    15_000,
  );

  // A detached (background) group that reads the TTY gets SIGTTIN, which would
  // freeze an interactive scaffolder, so only stream/capture children detach.
  it.skipIf(isWindows)('keeps inherit children in the caller process group', async () => {
    const inheritFile = path.join(dir, 'inherit.pgid');
    const streamFile = path.join(dir, 'stream.pgid');
    await runCommand(node('pgid.cjs', inheritFile), { cwd: dir, mode: 'inherit' });
    await runCommand(node('pgid.cjs', streamFile), { cwd: dir, mode: 'stream' });

    const own = pgid(process.pid);
    expect(fs.readFileSync(inheritFile, 'utf8')).toBe(own);
    expect(fs.readFileSync(streamFile, 'utf8')).not.toBe(own);
  });
});
