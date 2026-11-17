import * as clack from '@clack/prompts';
import pc from 'picocolors';

export function error(msg: string): void {
  if (process.stdout.isTTY === true) return clack.log.error(msg, { output: process.stderr });
  process.stderr.write(`${pc.red('✖')} ${msg}\n`);
}

export function info(msg: string): void {
  if (process.stdout.isTTY === true) return clack.log.info(msg);
  process.stdout.write(`${pc.cyan('ℹ')} ${msg}\n`);
}

export function step(msg: string): void {
  if (process.stdout.isTTY === true) return clack.log.step(msg);
  process.stdout.write(`\n${pc.bold(pc.cyan(msg))}\n`);
}

export function success(msg: string): void {
  if (process.stdout.isTTY === true) return clack.log.success(msg);
  process.stdout.write(`${pc.green('✔')} ${msg}\n`);
}

export function warn(msg: string): void {
  if (process.stdout.isTTY === true) return clack.log.warn(msg);
  process.stdout.write(`${pc.yellow('⚠')} ${msg}\n`);
}

export function intro(msg: string): void {
  if (process.stdout.isTTY === true) return clack.intro(pc.bold(msg));
  process.stdout.write(`\n${msg}\n`);
}

export function outro(msg: string): void {
  if (process.stdout.isTTY === true) return clack.outro(msg);
  success(msg);
}

export function note(msg: string, title: string): void {
  if (process.stdout.isTTY === true) return clack.note(msg, title);
  process.stdout.write(`\n${title}:\n${msg}\n`);
}
