/* eslint-disable no-control-regex -- These checks distinguish cursor control from ANSI colors. */
import type { WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandCancelledError, runCommand } from './process.js';
import { runTask, withProgress } from './progress.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, createWriteStream: vi.fn(actual.createWriteStream) };
});

const { createWriteStream } = await import('node:fs');

let dir: string;
let output: string;
let errors: string;
const tty = [process.stdin, process.stdout].map((stream) =>
  Object.getOwnPropertyDescriptor(stream, 'isTTY'),
);
const retainedLogs: string[] = [];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'progress test '));
  output = '';
  errors = '';
  vi.stubEnv('CI', '');
  for (const stream of [process.stdin, process.stdout]) {
    Object.defineProperty(stream, 'isTTY', { configurable: true, value: true });
  }
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    errors += String(chunk);
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  [process.stdin, process.stdout].forEach((stream, index) => {
    const descriptor = tty[index];
    if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor);
    else Reflect.deleteProperty(stream, 'isTTY');
  });
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  for (const file of retainedLogs.splice(0)) await fs.rm(path.dirname(file), { recursive: true });
});

async function task(source: string, signal?: AbortSignal): Promise<void> {
  await fs.writeFile(path.join(dir, 'child.cjs'), source);
  await runTask(`"${process.execPath}" child.cjs`, {
    cwd: dir,
    title: 'Working',
    successMessage: 'Task complete',
    ...(signal ? { signal } : {}),
  });
}

function logPath(): string {
  const file = stripVTControlCharacters(output + errors).match(/Full log: (.+)/)?.[1];
  expect(file).toBeDefined();
  if (!file) throw new Error('Missing log path');
  retainedLogs.push(file);
  return file;
}

describe('withProgress', () => {
  it('animates a real wait, returns the result and removes signal listeners', async () => {
    const count = process.listenerCount('SIGINT');
    const result = await withProgress('Resolving', 'Resolving done', async () => {
      await delay(250);
      return 42;
    });
    expect(result).toBe(42);
    expect(output).toContain('\u001b[');
    expect(process.listenerCount('SIGINT')).toBe(count);
  });

  // Clack's spinner sets raw mode and, on Windows, never unsets it. In raw mode
  // Ctrl+C is a keypress: no SIGINT, or Clack's own handler exits 0.
  it('keeps stdin out of raw mode during and after the spinner', async () => {
    const setRawMode = vi.fn();
    Object.defineProperty(process.stdin, 'setRawMode', { configurable: true, value: setRawMode });
    try {
      let during: unknown;
      await withProgress('Resolving', 'Resolved', () => {
        during = setRawMode.mock.calls.at(-1)?.[0];
        return Promise.resolve();
      });
      expect(during).toBe(false);
      expect(setRawMode.mock.calls.at(-1)?.[0]).toBe(false);
    } finally {
      Reflect.deleteProperty(process.stdin, 'setRawMode');
    }
  });

  it.each(['throw', 'reject'])('cleans up a %s without a completion line', async (kind) => {
    const failure = new Error('lookup failed');
    const count = process.listenerCount('SIGINT');
    await expect(
      withProgress('Resolving', 'Resolving done', () => {
        if (kind === 'throw') throw failure;
        return Promise.reject(failure);
      }),
    ).rejects.toBe(failure);
    expect(process.listenerCount('SIGINT')).toBe(count);
    expect(stripVTControlCharacters(output)).toContain('failed');
  });

  it('passes cancellation to work and rejects without a later success', async () => {
    const count = process.listenerCount('SIGINT');
    await expect(
      withProgress('Resolving', 'Resolving done', (signal) => {
        process.emit('SIGINT');
        expect(signal.aborted).toBe(true);
        return Promise.resolve('ignored cancellation');
      }),
    ).rejects.toBeInstanceOf(CommandCancelledError);
    expect(process.listenerCount('SIGINT')).toBe(count);
    expect(stripVTControlCharacters(output).match(/cancel/gi)).toHaveLength(1);
  });

  it('lets work pass cancellation to the real subprocess runner', async () => {
    await fs.writeFile(path.join(dir, 'wait.cjs'), 'setInterval(()=>{},1000);');
    const timer = setTimeout(() => process.emit('SIGTERM'), 250);
    try {
      await expect(
        withProgress('Waiting', 'Waiting done', (signal) =>
          runCommand(`"${process.execPath}" wait.cjs`, {
            cwd: dir,
            mode: 'stream',
            signal,
          }),
        ),
      ).rejects.toBeInstanceOf(CommandCancelledError);
    } finally {
      clearTimeout(timer);
    }
    expect(stripVTControlCharacters(output).match(/cancel/gi)).toHaveLength(1);
  });
});

describe('runTask', () => {
  // A full disk is not Ctrl+C: callers must not print "cancelled" or exit 130.
  it('reports a failed log write as a failure, not a cancellation', async () => {
    vi.mocked(createWriteStream).mockImplementationOnce(
      () =>
        new Writable({
          write(_chunk, _encoding, callback) {
            callback(new Error('ENOSPC: no space left on device'));
          },
        }) as unknown as WriteStream,
    );

    const run = task("console.log('ready'); setInterval(() => {}, 1000);");

    await expect(run).rejects.toThrow(/Could not write the task log/);
    await expect(run).rejects.not.toBeInstanceOf(CommandCancelledError);
    expect(stripVTControlCharacters(output + errors)).not.toMatch(/cancelled/i);
  }, 15_000);

  it('collapses ordinary output and removes a clean successful log', async () => {
    const before = await fs.readdir(os.tmpdir());
    await task("console.log('ordinary output');");
    const final = stripVTControlCharacters(output.slice(output.lastIndexOf('Task complete')));
    expect(final).toContain('Task complete');
    expect(final).not.toContain('ordinary output');
    expect(output).toMatch(/\u001b\[[\d;]*[KA]/);
    expect(
      (await fs.readdir(os.tmpdir())).filter(
        (name) => name.startsWith('toolchain-progress-') && !before.includes(name),
      ),
    ).toEqual([]);
  });

  it('keeps stderr and whole-word stdout warnings, strips ANSI, and counts omitted diagnostics', async () => {
    await task(
      "console.log('unwarned ordinary'); for(let i=1;i<=23;i++) console.log('\\x1b[33mWARN warning-'+i+'\\x1b[0m'); process.stderr.write('notice from stderr\\n');",
    );
    const file = logPath();
    const raw = await fs.readFile(file, 'utf8');
    const final = stripVTControlCharacters(output.slice(output.lastIndexOf('Task complete')));
    expect(final.match(/WARN warning-\d+|notice from stderr/g)).toHaveLength(20);
    expect(final).not.toContain('warning-21');
    expect(final).toContain('4 more diagnostic lines');
    expect(raw).toContain('\u001b[33mWARN warning-23');
    expect(raw).toContain('notice from stderr');
  });

  it('prints every short diagnostic on success without retaining a log', async () => {
    await task("console.log('DEPRECATED old API'); process.stderr.write('stderr notice');");
    const final = stripVTControlCharacters(output.slice(output.lastIndexOf('Task complete')));
    expect(final).toContain('DEPRECATED old API');
    expect(final).toContain('stderr notice');
    expect(final).not.toContain('Full log:');
  });

  it('retains the complete log when a successful diagnostic exceeds the display limit', async () => {
    await task("process.stderr.write('diagnostic '+ 'x'.repeat(100000));");
    expect(await fs.readFile(logPath(), 'utf8')).toHaveLength(100011);
  });

  it('recognizes stdout warnings beyond the display limit', async () => {
    await task("process.stdout.write('x'.repeat(100000)+' deprecated API');");
    expect(await fs.readFile(logPath(), 'utf8')).toContain('deprecated API');
    expect(stripVTControlCharacters(output.slice(output.lastIndexOf('Task complete')))).toContain(
      'diagnostic',
    );
  });

  it('keeps diagnostics that carriage-return progress replaces', async () => {
    await task(
      "process.stdout.write('WARN old API\\rprogress complete\\n'); process.stderr.write('stderr warning\\rdone\\n');",
    );
    const final = stripVTControlCharacters(output.slice(output.lastIndexOf('Task complete')));
    expect(final).toContain('WARN old API');
    expect(final).toContain('stderr warning');
  });

  it('retains diagnostics whose first nonblank text comes after the display limit', async () => {
    await task("process.stderr.write(' '.repeat(20000)+'diagnostic'+' '.repeat(200));");
    expect(await fs.readFile(logPath(), 'utf8')).toContain('diagnostic');
  });

  it('refuses a pre-aborted task without opening a log or printing success', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(task('process.exit(0);', controller.signal)).rejects.toBeInstanceOf(
      CommandCancelledError,
    );
    expect(output).toBe('');
  });

  it('retains the last 40 lines on failure and a complete readable raw log', async () => {
    await expect(
      task("for(let i=1;i<=45;i++) console.log('line-'+i); process.exitCode=1;"),
    ).rejects.toThrow();
    const final = stripVTControlCharacters(output.slice(output.lastIndexOf('Working failed')));
    expect(final).toContain('line-6');
    expect(final).not.toContain('line-5\n');
    expect(final.match(/line-\d+/g)).toHaveLength(40);
    expect(final).not.toContain('Task complete');
    const raw = await fs.readFile(logPath(), 'utf8');
    expect(raw).toContain('line-1\n');
    expect(raw).toContain('line-45\n');
  });

  it('bounds huge partial lines while preserving raw output and replaces carriage-return progress', async () => {
    await expect(
      task("process.stdout.write('old\\rnew\\n'+'x'.repeat(100000)+'\\n'); process.exitCode=1;"),
    ).rejects.toThrow();
    const final = stripVTControlCharacters(output.slice(output.lastIndexOf('Working failed')));
    expect(final).toContain('new');
    expect(final).not.toContain('old');
    expect(final.length).toBeLessThan(18000);
    expect(await fs.readFile(logPath(), 'utf8')).toContain('x'.repeat(100000));
  });

  it('aborts the child, retains its log, and never prints success', async () => {
    const controller = new AbortController();
    const pending = task("console.log('ready'); setInterval(()=>{},1000);", controller.signal);
    const timer = setTimeout(() => controller.abort(), 300);
    try {
      await expect(pending).rejects.toBeInstanceOf(CommandCancelledError);
    } finally {
      clearTimeout(timer);
    }
    expect(output).not.toContain('Task complete');
    await fs.access(logPath());
  });

  it('keeps the event loop responsive during a delayed child', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 20);
    try {
      await task('setTimeout(()=>{},250);');
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(3);
  });

  it('inherits interactive stdio without capture or cursor control', async () => {
    await fs.writeFile(
      path.join(dir, 'interactive.cjs'),
      "process.stdout.write('interactive child');",
    );
    await runTask(`"${process.execPath}" interactive.cjs`, {
      cwd: dir,
      title: 'Interactive',
      successMessage: 'Ready',
      interactive: true,
    });
    expect(output).not.toContain('interactive child');
    expect(output).not.toMatch(/\u001b\[[\d;?]*[ABCDEFGHJKSTfhl]/);
    expect(output).not.toContain('Full log:');
  });
});

describe('static progress', () => {
  it('prints the title once and a separate completion line off a terminal', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    await withProgress('Resolving versions', 'Versions resolved', () => Promise.resolve(1));
    const text = stripVTControlCharacters(output);
    expect(text.match(/Resolving versions/g)).toHaveLength(1);
    expect(text).toContain('Versions resolved');
  });

  it.each(['CI', 'stdout', 'stdin'])(
    'does not animate with %s and preserves stream destinations',
    async (mode) => {
      if (mode === 'CI') vi.stubEnv('CI', 'true');
      else
        Object.defineProperty(mode === 'stdout' ? process.stdout : process.stdin, 'isTTY', {
          configurable: true,
          value: false,
        });
      await withProgress('Lookup', 'Lookup done', () => Promise.resolve(1));
      await task("console.log('out'); console.error('err');");
      expect(output).toContain('out\n');
      expect(errors).toContain('err\n');
      expect(output + errors).not.toMatch(/\u001b\[[\d;?]*[ABCDEFGHJKSTfhl]/);
      expect(output).not.toContain('Full log:');
    },
  );
});
