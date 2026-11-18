import * as clack from '@clack/prompts';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { stripVTControlCharacters } from 'node:util';

import { error, info, step, success, warn } from './logger.js';
import {
  CommandCancelledError,
  isCommandCancelled,
  type OutputStream,
  runCommand,
} from './process.js';

export interface TaskOptions {
  cwd: string;
  title: string;
  successMessage: string;
  interactive?: boolean;
  signal?: AbortSignal;
}

function terminalProgress(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true && !clack.isCI();
}

export async function withProgress<T>(
  title: string,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const spinner = terminalProgress()
    ? clack.spinner({ signal: controller.signal, onCancel: abort })
    : undefined;
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  try {
    if (spinner) spinner.start(title);
    else step(title);
    const value = await work(controller.signal);
    if (controller.signal.aborted) throw new CommandCancelledError(title);
    if (spinner) spinner.stop(title);
    else success(title);
    return value;
  } catch (failure) {
    if (!spinner?.isCancelled) {
      const message = `${title} ${isCommandCancelled(failure) ? 'cancelled' : 'failed'}`;
      if (spinner) {
        if (isCommandCancelled(failure)) spinner.cancel(message);
        else spinner.error(message);
      } else error(message);
    }
    throw failure;
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

export async function runTask(command: string, options: TaskOptions): Promise<void> {
  const { cwd, title, successMessage, interactive, signal } = options;
  if (signal?.aborted) throw new CommandCancelledError(command);
  if (interactive || !terminalProgress()) {
    step(title);
    await runCommand(command, {
      cwd,
      mode: interactive ? 'inherit' : 'stream',
      ...(signal ? { signal } : {}),
      onOutput: (text, stream) => process[stream].write(text),
    });
    success(successMessage);
    return;
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), 'toolchain-progress-'));
  const file = path.join(directory, 'output.log');
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const log = createWriteStream(file, { flags: 'wx' });
  const closed = finished(log, { cleanup: true });
  // A failed log must stop the child rather than silently lose diagnostics,
  // and must not read as Ctrl+C to the caller.
  let logFailure: unknown;
  void closed.catch((failure: unknown) => {
    logFailure = failure;
    abort();
  });
  const display = clack.taskLog({ title, limit: 40, retainLog: false });
  const warnings: string[] = [];
  let diagnostics = 0;
  let truncatedDiagnostics = false;
  const warning = /\b(?:warn|warning|deprecated)\b/i;
  const lines: Record<
    OutputStream,
    {
      text: string;
      carriage: boolean;
      scan: string;
      diagnostic: boolean;
      truncated: boolean;
      nonblank: boolean;
    }
  > = {
    stdout: {
      text: '',
      carriage: false,
      scan: '',
      diagnostic: false,
      truncated: false,
      nonblank: false,
    },
    stderr: {
      text: '',
      carriage: false,
      scan: '',
      diagnostic: false,
      truncated: false,
      nonblank: false,
    },
  };
  const emit = (stream: OutputStream, show = true): void => {
    const state = lines[stream];
    const line =
      stripVTControlCharacters(state.text).trimEnd() ||
      (state.truncated && state.nonblank ? '[output truncated]' : '');
    const diagnostic =
      stream === 'stderr' || state.diagnostic || warning.test(stripVTControlCharacters(state.scan));
    const truncated = state.truncated;
    state.text = '';
    state.scan = '';
    state.diagnostic = false;
    state.truncated = false;
    state.nonblank = false;
    if (!line.trim()) return;
    if (show || diagnostic) display.message(line);
    if (diagnostic) {
      truncatedDiagnostics ||= truncated;
      diagnostics++;
      if (warnings.length < 20) warnings.push(line);
    }
  };
  const onOutput = (text: string, stream: OutputStream): void => {
    log.write(text);
    const line = lines[stream];
    for (const char of text) {
      if (line.carriage) {
        line.carriage = false;
        if (char !== '\n') emit(stream, false);
      }
      if (char === '\r') line.carriage = true;
      else if (char === '\n') emit(stream);
      else {
        line.nonblank ||= /\S/.test(char);
        if (line.text.length < 16 * 1024) line.text += char;
        else line.truncated = true;
        // Keep classifying after the display cap so late warnings retain the raw log.
        line.scan = (line.scan + char).slice(-128);
        if (/\W/.test(char)) line.diagnostic ||= warning.test(stripVTControlCharacters(line.scan));
      }
    }
  };
  try {
    await runCommand(command, { cwd, mode: 'stream', signal: controller.signal, onOutput });
    log.end();
    await closed;
    emit('stdout');
    emit('stderr');
    if (controller.signal.aborted) throw new CommandCancelledError(command);
    const retain = diagnostics > warnings.length || truncatedDiagnostics;
    display.success(successMessage);
    for (const line of warnings) warn(line);
    if (diagnostics > warnings.length) {
      warn(`${diagnostics - warnings.length} more diagnostic lines`);
    }
    if (truncatedDiagnostics) warn('Some diagnostic output was truncated for display');
    if (retain) info(`Full log: ${file}`);
    else
      await rm(directory, { recursive: true }).catch(() =>
        warn(`Could not remove task log: ${file}`),
      );
  } catch (failure) {
    log.end();
    await closed.catch(() => error('Could not save the complete task log'));
    emit('stdout');
    emit('stderr');
    const reported =
      logFailure === undefined
        ? failure
        : new Error(`Could not write the task log for: ${command}`, { cause: logFailure });
    display.error(`${title} ${isCommandCancelled(reported) ? 'cancelled' : 'failed'}`);
    info(`Full log: ${file}`);
    throw reported;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
