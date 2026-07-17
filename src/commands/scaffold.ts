import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';

import { type PackageManager, VALID_PACKAGE_MANAGERS } from '../detectors/project.js';
import { generateExpress } from '../generators/templates/express.js';
import {
  TEMPLATE_DESCRIPTIONS,
  type TemplateContext,
  TEMPLATES,
  type TemplateType,
} from '../generators/templates/index.js';
import { generateNextjs } from '../generators/templates/nextjs.js';
import { generatePlain } from '../generators/templates/plain.js';
import { generatePnpmMonorepo } from '../generators/templates/pnpm-monorepo.js';
import { generateReact } from '../generators/templates/react.js';
import { generateTurbo } from '../generators/templates/turbo.js';
import { writeFile } from '../utils/fs.js';
import { error, info, step, success, warn } from '../utils/logger.js';
import { init } from './init.js';

const GENERATORS: Record<TemplateType, (ctx: TemplateContext) => ReturnType<typeof generatePlain>> = {
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
    error(`Invalid project name "${projectName}". Use lowercase letters, numbers, and hyphens only.`);
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

  if (!template && !options.yes) {
    const response = await prompts({
      choices: TEMPLATES.map((t) => ({
        description: TEMPLATE_DESCRIPTIONS[t],
        title: t,
        value: t,
      })),
      message: 'Select a project template:',
      name: 'template',
      type: 'select',
    });
    template = response.template as TemplateType;
    if (!template) {
      warn('Aborted by user.');
      return;
    }
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
      error(`Invalid package manager "${options.pm}". Available: ${VALID_PACKAGE_MANAGERS.join(', ')}`);
      process.exit(1);
    }
  }

  info(`Creating ${template} project "${projectName}"...`);

  const ctx: TemplateContext = {
    packageManager: pm,
    projectName,
    targetDir,
  };

  const generator = GENERATORS[template];
  const result = generator(ctx);

  if (result.scaffold) {
    // CLI-based template (react, nextjs) - let the external tool handle project creation
    step(1, `Running ${template} scaffolding tool...`);
    result.scaffold(ctx);
    success('Project files created by official tooling');
  } else {
    // File-based template - create directory and write files ourselves
    step(1, 'Creating project directory...');
    mkdirSync(targetDir, { recursive: true });

    step(2, 'Generating project files...');
    for (const file of result.files) {
      const filePath = path.join(targetDir, file.path);
      writeFile(filePath, file.content);
      success(file.path);
    }

    step(3, 'Writing package.json...');
    writeFile(path.join(targetDir, 'package.json'), JSON.stringify(result.packageJson, null, 2) + '\n');
    success('package.json');
  }

  // Skip git init for CLI templates (they handle it)
  if (!result.scaffold) {
    step(4, 'Initializing git repository...');
    try {
      const { execSync } = await import('node:child_process');
      execSync('git init', { cwd: targetDir, stdio: 'inherit' });
      success('Git repository initialized');
    } catch {
      warn('Failed to initialize git repository. You can run "git init" manually.');
    }
  }

  step(result.scaffold ? 2 : 5, 'Setting up toolchain...');
  await init({ pm, targetDir, yes: true });

  const nextCmd = NEXT_COMMAND[template];
  console.log(`\n${'='.repeat(50)}`);
  success(`Project "${projectName}" is ready!`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${projectName}`);
  console.log(`  ${pm} run ${nextCmd}`);
  console.log(`\nNote: If you re-initialize git (git init) after setup, run "${pm} run prepare" to restore hooks.`);
}

function isValidProjectName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}
