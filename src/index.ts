import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { init } from './commands/init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

const program = new Command();

program
  .name('toolchain')
  .description(
    'Scaffold ESLint, Prettier, Husky, commitlint, and strict TypeScript into any JS/TS project',
  )
  .version(pkg.version);

program
  .command('init')
  .description('Initialize toolchain in the current project')
  .option('--yes', 'Skip prompts and use defaults')
  .option('--pm <manager>', 'Package manager to use (npm, yarn, pnpm)')
  .action(init);

program.parse();
