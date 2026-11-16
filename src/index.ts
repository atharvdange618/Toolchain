import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { doctor } from './commands/doctor.js';
import { init } from './commands/init.js';
import { scaffold } from './commands/scaffold.js';
import { update } from './commands/update.js';
import { TEMPLATES } from './generators/templates/index.js';
import { error } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

const program = new Command();

program
  .name('toolchain')
  .description(
    'Set up oxlint, Prettier, Husky, commitlint and strict TypeScript 7 in Next.js, React, Expo, Express and plain TS projects',
  )
  .version(pkg.version);

program
  .command('init')
  .description('Initialize toolchain in the current project')
  .option('--yes', 'Skip prompts and use defaults')
  .option('--pm <manager>', 'Package manager to use (bun, npm, pnpm, yarn)')
  .action(init);

program
  .command('doctor')
  .description('Check tracked toolchain declarations and hook source files without changing them')
  .option('--pm <manager>', 'Package manager to use (bun, npm, pnpm, yarn)')
  .addHelpText(
    'after',
    '\nChecks root devDependency declarations, not node_modules or registry versions.\nChecks hook source files, not .husky/_ or Git setup.\nCreate-only .gitattributes and tsconfig.json are not checked.\nExits 1 when tracked entries need action; local edits and obsolete entries pass.',
  )
  .action((options: { pm?: string }) => {
    process.exitCode = doctor(options);
  });

program
  .command('update')
  .description('Update toolchain entries while preserving local edits and deletions')
  .option('--yes', 'Keep conflicts without recording a choice')
  .option('--pm <manager>', 'Package manager to use (bun, npm, pnpm, yarn)')
  .action(async (options: { yes?: boolean; pm?: string }) => {
    process.exitCode = await update(options);
  });

program
  .command('scaffold <project-name>')
  .description('Create a new project and initialize toolchain')
  .option('--template <type>', `Project template (${TEMPLATES.join(', ')})`)
  .option('--pm <manager>', 'Package manager to use (bun, npm, pnpm, yarn)')
  .option('--yes', 'Skip prompts and use defaults')
  .action(scaffold);

// parseAsync so a rejected async action lands here as a one-line message
// instead of an unhandled rejection with a stack trace.
try {
  await program.parseAsync();
} catch (error_) {
  error(error_ instanceof Error ? error_.message : String(error_));
  process.exit(1);
}
