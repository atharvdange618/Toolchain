import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isCancel, select } from '@clack/prompts';

import { type PackageManager, VALID_PACKAGE_MANAGERS } from '../detectors/project.js';
import { generateExpress } from '../generators/templates/express.js';
import {
  TEMPLATE_DESCRIPTIONS,
  type TemplateContext,
  type TemplateResult,
  TEMPLATES,
  type TemplateType,
} from '../generators/templates/index.js';
import { generateNextjs } from '../generators/templates/nextjs.js';
import { generatePlain } from '../generators/templates/plain.js';
import { generatePnpmMonorepo } from '../generators/templates/pnpm-monorepo.js';
import { generateReact } from '../generators/templates/react.js';
import { generateTurbo } from '../generators/templates/turbo.js';
import { writeFile } from '../utils/fs.js';
import { error, info, intro, note, outro, step, success, warn } from '../utils/logger.js';
import { isCommandCancelled } from '../utils/process.js';
import { runTask, withProgress } from '../utils/progress.js';
import { init } from './init.js';

const GENERATORS: Record<
  TemplateType,
  (ctx: TemplateContext) => TemplateResult | Promise<TemplateResult>
> = {
  express: generateExpress,
  nextjs: generateNextjs,
  plain: generatePlain,
  'pnpm-monorepo': generatePnpmMonorepo,
  react: generateReact,
  turbo: generateTurbo,
};

const NEXT_COMMAND: Record<TemplateType, string> = {
  express: 'start',
  nextjs: 'dev',
  plain: 'build',
  'pnpm-monorepo': 'dev',
  react: 'dev',
  turbo: 'dev',
};

// Templates whose generator asks the registry for dependency versions.
const RESOLVES_VERSIONS: ReadonlySet<TemplateType> = new Set(['express', 'pnpm-monorepo', 'turbo']);

// Templates that require a specific package manager
const REQUIRED_PM: Partial<Record<TemplateType, PackageManager>> = {
  'pnpm-monorepo': 'pnpm',
  turbo: 'pnpm',
};

export async function scaffold(
  projectName: string,
  options: { pm?: string; template?: string; yes?: boolean },
): Promise<void> {
  if (projectName === '.' || projectName === '..') {
    error('Cannot use "." or ".." as project name.');
    process.exit(1);
  }

  if (!isValidProjectName(projectName)) {
    error(
      `Invalid project name "${projectName}". Use lowercase letters, numbers, and hyphens only.`,
    );
    process.exit(1);
  }

  const targetDir = path.resolve(process.cwd(), projectName);

  if (existsSync(targetDir)) {
    const contents = readdirSync(targetDir);
    if (contents.length > 0) {
      error(`Directory "${projectName}" already exists and is not empty.`);
      process.exit(1);
    }
  }

  let template: TemplateType | undefined = options.template as TemplateType | undefined;

  if (template && !TEMPLATES.includes(template)) {
    error(`Unknown template "${template}". Available: ${TEMPLATES.join(', ')}`);
    process.exit(1);
  }

  intro(`Create ${projectName}`);
  if (!template && !options.yes) {
    if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
      throw new Error('Scaffold has no terminal to ask. Rerun with --template <type>.');
    }
    const selected = await select({
      options: TEMPLATES.map((t) => ({
        hint: TEMPLATE_DESCRIPTIONS[t],
        label: t,
        value: t,
      })),
      message: 'Select a project template:',
    });
    if (isCancel(selected)) {
      warn('Aborted by user.');
      return;
    }
    template = selected;
  }

  if (!template) {
    error('--template is required when using --yes.');
    process.exit(1);
  }

  // Determine package manager - template requirements override user choice
  let pm: PackageManager = 'pnpm';
  if (REQUIRED_PM[template]) {
    pm = REQUIRED_PM[template]!;
    if (options.pm && options.pm !== pm) {
      warn(`Template "${template}" requires ${pm}. Ignoring --pm ${options.pm}.`);
    }
  } else if (options.pm) {
    if (VALID_PACKAGE_MANAGERS.includes(options.pm as PackageManager)) {
      pm = options.pm as PackageManager;
    } else {
      error(
        `Invalid package manager "${options.pm}". Available: ${VALID_PACKAGE_MANAGERS.join(', ')}`,
      );
      process.exit(1);
    }
  }

  const ctx: TemplateContext = {
    packageManager: pm,
    projectName,
    targetDir,
    yes: options.yes === true,
  };

  const generator = GENERATORS[template];
  let result: TemplateResult;
  try {
    result = RESOLVES_VERSIONS.has(template)
      ? await withProgress(
          'Resolving template versions',
          'Template versions resolved',
          async (signal) => generator({ ...ctx, signal }),
        )
      : await generator(ctx);
  } catch (error_) {
    if (isCommandCancelled(error_)) throw error_;
    error(
      error_ instanceof Error ? error_.message : `Failed to generate the ${template} template.`,
    );
    process.exit(1);
  }

  if (result.scaffold) {
    // CLI-based template (react, nextjs): the external tool creates the project.
    // Any failure or cancellation stops here, before git, init or cleanup.
    await result.scaffold(ctx);
  } else {
    // File-based template - create directory and write files ourselves
    step(`Creating ${template} project files...`);
    mkdirSync(targetDir, { recursive: true });

    for (const file of result.files) {
      const filePath = path.join(targetDir, file.path);
      writeFile(filePath, file.content);
    }

    writeFile(
      path.join(targetDir, 'package.json'),
      JSON.stringify(result.packageJson, null, 2) + '\n',
    );
    success(`Created ${result.files.length + 1} project files`);
  }

  // create-next-app makes a repo, create-vite doesn't. Husky needs one.
  // Ordinary failures warn and continue; cancellation propagates, so nothing
  // after Ctrl+C runs and no ready message prints.
  if (!existsSync(path.join(targetDir, '.git'))) {
    await warnOnFailure(
      'git init',
      targetDir,
      'Initializing git repository',
      'Git repository initialized',
      'Failed to initialize git repository. You can run "git init" manually.',
    );
  }

  await init({ pm, targetDir, yes: true, nested: true });

  // Generated code (ours, create-vite's, create-next-app's) doesn't follow the
  // rules init just set up, so a new project would fail its own checks.
  await warnOnFailure(
    `${pm} run lint:fix`,
    targetDir,
    'Fixing lint in generated files',
    'Lint fixes applied',
    `Some lint errors need a manual fix. Run "${pm} run lint" to see them.`,
    `Run "${pm} run lint:fix" and "${pm} run format" manually to finish setup.`,
  );
  await warnOnFailure(
    `${pm} run format`,
    targetDir,
    'Formatting generated files',
    'Generated files formatted',
    `Formatting failed. Run "${pm} run format" manually.`,
    `Run "${pm} run format" manually to finish setup.`,
  );

  const nextCmd = NEXT_COMMAND[template];
  info(
    `If you re-initialize git (git init) after setup, run "${pm} run prepare" to restore hooks.`,
  );
  note(`cd ${projectName}\n${pm} run ${nextCmd}`, 'Next steps');
  outro(`Project "${projectName}" is ready!`);
}

async function warnOnFailure(
  command: string,
  cwd: string,
  title: string,
  successMessage: string,
  failure: string,
  cancelRetry?: string,
): Promise<void> {
  try {
    await runTask(command, { cwd, title, successMessage });
  } catch (error_) {
    if (isCommandCancelled(error_)) {
      if (cancelRetry) warn(cancelRetry);
      throw error_;
    }
    warn(failure);
  }
}

function isValidProjectName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}
