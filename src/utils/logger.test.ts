import * as clack from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import * as logger from './logger.js';

let stdout: MockInstance<typeof process.stdout.write>;
let stderr: MockInstance<typeof process.stderr.write>;
const streams = [process.stdin, process.stdout, process.stderr] as const;
const originalTTY = streams.map((stream) => Object.getOwnPropertyDescriptor(stream, 'isTTY'));

beforeEach(() => {
  stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.stubEnv('CI', '');
  for (const stream of streams) {
    Object.defineProperty(stream, 'isTTY', { configurable: true, value: true });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  streams.forEach((stream, index) => {
    const descriptor = originalTTY[index];
    if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor);
    else Reflect.deleteProperty(stream, 'isTTY');
  });
});

describe('CLI output', () => {
  it('keeps redirected output static and errors on stderr', () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    logger.intro('Toolchain setup');
    logger.step('Writing config files...');
    logger.note('pnpm run typecheck', 'Next steps');
    logger.outro('Ready');
    logger.error('Install failed');
    const text = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(text).toContain('Next steps:\npnpm run typecheck');
    expect(text).not.toContain('Install failed');
    expect(text).not.toContain('[?25');
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Install failed'));
  });

  it('uses Clack for terminal messages while keeping errors off stdout', () => {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    const step = vi.spyOn(clack.log, 'step');
    const error = vi.spyOn(clack.log, 'error');
    logger.step('Writing config files...');
    logger.error('Install failed');
    expect(step).toHaveBeenCalledWith('Writing config files...');
    expect(error).toHaveBeenCalledWith('Install failed', { output: process.stderr });
    expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).not.toContain(
      'Install failed',
    );
  });

  it('writes plain errors when only stderr is redirected', () => {
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: false });
    const error = vi.spyOn(clack.log, 'error');
    logger.error('Install failed');
    expect(error).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledExactlyOnceWith('✖ Install failed\n');
  });

  it.each(['piped stdin', 'CI'])('writes static progress with %s', (environment) => {
    if (environment === 'CI') vi.stubEnv('CI', 'true');
    else Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    const step = vi.spyOn(clack.log, 'step');
    logger.step('Writing config files...');
    expect(step).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Writing config files...'));
  });
});
