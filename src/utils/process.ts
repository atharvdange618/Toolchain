import { type ChildProcess, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export type CommandMode = 'capture' | 'inherit' | 'stream';
export type OutputStream = 'stderr' | 'stdout';

export interface CommandOptions {
  cwd: string;
  // inherit: the child owns the terminal (use for anything that may prompt).
  // stream: both streams go to onOutput and nothing is kept.
  // capture: like stream, and stdout is also returned, up to CAPTURE_LIMIT_BYTES.
  mode: CommandMode;
  onOutput?: (text: string, stream: OutputStream) => void;
  signal?: AbortSignal;
}

export interface CommandResult {
  stdout: string;
}

export const CAPTURE_LIMIT_BYTES = 1024 * 1024;
// How long a cancelled command gets after SIGTERM before SIGKILL (POSIX).
// Windows uses taskkill /F, which does not wait.
export const KILL_GRACE_MS = 2000;
// After SIGKILL, settle even if a stray descendant still holds a pipe open.
const SETTLE_AFTER_KILL_MS = 1000;

export class CommandCancelledError extends Error {
  constructor(command: string) {
    super(`Cancelled: ${command}`);
    this.name = 'CommandCancelledError';
  }
}

export class CommandFailedError extends Error {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;

  constructor(command: string, exitCode: number | null, signal: NodeJS.Signals | null) {
    super(
      exitCode === null
        ? `Command stopped by ${signal ?? 'an unknown signal'}: ${command}`
        : `Command failed with exit code ${exitCode}: ${command}`,
    );
    this.name = 'CommandFailedError';
    this.exitCode = exitCode;
    this.signal = signal;
  }
}

export function isCommandCancelled(error: unknown): error is CommandCancelledError {
  return error instanceof CommandCancelledError;
}

const isWindows = process.platform === 'win32';

// Runs one of the CLI's own command strings through the platform shell, so
// Windows .cmd shims (npm.cmd, pnpm.cmd) resolve. Never pass user input as
// `command`; pass directories as `cwd`.
export function runCommand(command: string, options: CommandOptions): Promise<CommandResult> {
  const { cwd, mode, onOutput, signal } = options;
  if (signal?.aborted) return Promise.reject(new CommandCancelledError(command));

  return new Promise((resolve, reject) => {
    // An inherit child stays in the caller's process group: a background group
    // that reads the TTY gets SIGTTIN and stops. Others get their own group on
    // POSIX so cancellation can signal the whole tree. On Windows, detached
    // would open a new console, and taskkill /T handles the tree.
    const ownGroup = mode !== 'inherit' && !isWindows;
    let child: ChildProcess;
    try {
      child = spawn(command, {
        cwd,
        detached: ownGroup,
        shell: true,
        stdio: mode === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        windowsHide: mode !== 'inherit',
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    let settled = false;
    let cancelled = false;
    let overflow = false;
    let stdout = '';
    let capturedBytes = 0;
    const timers: NodeJS.Timeout[] = [];
    const decoders: Record<OutputStream, StringDecoder> = {
      stderr: new StringDecoder('utf8'),
      stdout: new StringDecoder('utf8'),
    };

    const emit = (text: string, stream: OutputStream): void => {
      if (text === '') return;
      if (stream === 'stdout' && mode === 'capture') stdout += text;
      onOutput?.(text, stream);
    };

    const killTree = (killSignal: NodeJS.Signals): void => {
      const pid = child.pid;
      if (pid === undefined) return;
      if (isWindows) {
        // Kills the shell and everything it started, and nothing else.
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        }).on('error', () => {});
        return;
      }
      try {
        if (ownGroup) process.kill(-pid, killSignal);
        else child.kill(killSignal);
      } catch {
        // Already gone.
      }
    };

    const stop = (): void => {
      if (settled || cancelled) return;
      cancelled = true;
      killTree('SIGTERM');
      if (isWindows) {
        timers.push(setTimeout(() => finish(), SETTLE_AFTER_KILL_MS));
        return;
      }
      timers.push(
        setTimeout(() => {
          killTree('SIGKILL');
          timers.push(setTimeout(() => finish(), SETTLE_AFTER_KILL_MS));
        }, KILL_GRACE_MS),
      );
    };

    const onSignal = (): void => stop();

    const cleanup = (): void => {
      for (const timer of timers) clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    };

    const finish = (code: number | null = null, exitSignal: NodeJS.Signals | null = null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      emit(decoders.stdout.end(), 'stdout');
      emit(decoders.stderr.end(), 'stderr');
      if (cancelled) reject(new CommandCancelledError(command));
      else if (overflow)
        reject(new Error(`Command output exceeded 1 MiB and was not read: ${command}`));
      else if (code === 0) resolve({ stdout });
      else reject(new CommandFailedError(command, code, exitSignal));
    };

    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream]?.on('data', (chunk: Buffer) => {
        if (settled) return;
        if (stream === 'stdout' && mode === 'capture') {
          capturedBytes += chunk.length;
          if (capturedBytes > CAPTURE_LIMIT_BYTES) {
            if (!overflow) {
              overflow = true;
              killTree('SIGKILL');
            }
            return;
          }
        }
        emit(decoders[stream].write(chunk), stream);
      });
    }

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cancelled ? new CommandCancelledError(command) : error);
    });
    // 'close' waits for the stdio pipes, so output written by a descendant
    // after the shell exits is still delivered.
    child.on('close', (code, exitSignal) => finish(code, exitSignal));

    signal?.addEventListener('abort', stop, { once: true });
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  });
}
