import { execSync } from 'node:child_process';
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
    result = await generator(ctx);
  } catch (error_) {
    error(
      error_ instanceof Error ? error_.message : `Failed to generate the ${template} template.`,
    );
    process.exit(1);
  }

  if (result.scaffold) {
    // CLI-based template (react, nextjs) - let the external tool handle project creation
    step(`Running ${template} scaffolding tool...`);
    result.scaffold(ctx);
    success('Project files created by official tooling');
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
  if (!existsSync(path.join(targetDir, '.git'))) {
    step('Initializing git repository...');
    try {
      execSync('git init', { cwd: targetDir, stdio: 'inherit' });
      success('Git repository initialized');
    } catch {
      warn('Failed to initialize git repository. You can run "git init" manually.');
    }
  }

  await init({ pm, targetDir, yes: true, nested: true });

  // Generated code (ours, create-vite's, create-next-app's) doesn't follow the
  // rules init just set up, so a new project would fail its own checks.
  step('Fixing lint and formatting generated files...');
  try {
    execSync(`${pm} run lint:fix`, { cwd: targetDir, stdio: 'inherit' });
  } catch {
    warn(`Some lint errors need a manual fix. Run "${pm} run lint" to see them.`);
  }
  try {
    execSync(`${pm} run format`, { cwd: targetDir, stdio: 'inherit' });
    success('Generated files formatted');
  } catch {
    warn(`Formatting failed. Run "${pm} run format" manually.`);
  }

  const nextCmd = NEXT_COMMAND[template];
  info(
    `If you re-initialize git (git init) after setup, run "${pm} run prepare" to restore hooks.`,
  );
  note(`cd ${projectName}\n${pm} run ${nextCmd}`, 'Next steps');
  outro(`Project "${projectName}" is ready!`);
}

function isValidProjectName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}
