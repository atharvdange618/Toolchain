import * as clack from '@clack/prompts';
import type { WriteStream } from 'node:tty';
import pc from 'picocolors';

export function useTerminalOutput(output: WriteStream = process.stdout): boolean {
  return process.stdin.isTTY === true && output.isTTY === true && !clack.isCI();
}

export function error(msg: string): void {
  if (useTerminalOutput(process.stderr)) return clack.log.error(msg, { output: process.stderr });
  process.stderr.write(`✖ ${msg}\n`);
}

export function info(msg: string): void {
  if (useTerminalOutput()) return clack.log.info(msg);
  process.stdout.write(`${pc.cyan('ℹ')} ${msg}\n`);
}

export function step(msg: string): void {
  if (useTerminalOutput()) return clack.log.step(msg);
  process.stdout.write(`\n${pc.bold(pc.cyan(msg))}\n`);
}

export function success(msg: string): void {
  if (useTerminalOutput()) return clack.log.success(msg);
  process.stdout.write(`${pc.green('✔')} ${msg}\n`);
}

export function warn(msg: string): void {
  if (useTerminalOutput()) return clack.log.warn(msg);
  process.stdout.write(`${pc.yellow('⚠')} ${msg}\n`);
}

export function intro(msg: string): void {
  if (useTerminalOutput()) return clack.intro(pc.bold(msg));
  process.stdout.write(`\n${msg}\n`);
}

export function outro(msg: string): void {
  if (useTerminalOutput()) return clack.outro(msg);
  success(msg);
}

export function note(msg: string, title: string): void {
  if (useTerminalOutput()) return clack.note(msg, title);
  process.stdout.write(`\n${title}:\n${msg}\n`);
}
