import pc from 'picocolors';

export function error(msg: string): void {
  process.stdout.write(`${pc.red('✖')} ${msg}\n`);
}

export function info(msg: string): void {
  process.stdout.write(`${pc.cyan('ℹ')} ${msg}\n`);
}

export function step(num: number, msg: string): void {
  process.stdout.write(`\n${pc.bold(pc.cyan(`Step ${num}:`))} ${msg}\n`);
}

export function success(msg: string): void {
  process.stdout.write(`${pc.green('✔')} ${msg}\n`);
}

export function warn(msg: string): void {
  process.stdout.write(`${pc.yellow('⚠')} ${msg}\n`);
}
