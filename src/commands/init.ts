import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';

import { detect, type PackageManager, pmExec, VALID_PACKAGE_MANAGERS } from '../detectors/project.js';
import { generateEslintConfig } from '../generators/eslint.js';
import { writeHuskyHooks } from '../generators/husky.js';
import { updatePackageJson } from '../generators/package-json.js';
import {
  COMMITLINT_CONFIG,
  EDITORCONFIG,
  PRETTIERIGNORE,
  PRETTIERRC,
} from '../generators/static-configs.js';
import { generateTsconfig } from '../generators/tsconfig.js';
import { writeFile } from '../utils/fs.js';
import { error, info, step, success, warn } from '../utils/logger.js';

export async function init(options: { pm?: string; targetDir?: string; yes?: boolean; }): Promise<void> {
  const targetDir = options.targetDir ?? process.cwd();

  step(1, 'Detecting project environment...');
  const projectInfo = detect(targetDir);
  info(`Framework: ${projectInfo.framework}`);
  info(`Package manager: ${projectInfo.packageManager}`);
  info(`Monorepo: ${projectInfo.isMonorepo ? 'Yes' : 'No'}`);

  if (!options.yes) {
    const response = await prompts({
      initial: true,
      message: `Proceed with toolchain setup for ${projectInfo.framework} project?`,
      name: 'proceed',
      type: 'confirm',
    });
    if (!response.proceed) {
      warn('Aborted by user.');
      return;
    }
  }

  step(2, 'Writing config files...');
  writeFile(path.join(targetDir, '.editorconfig'), EDITORCONFIG);
  success('.editorconfig');
  writeFile(path.join(targetDir, '.prettierrc'), PRETTIERRC);
  success('.prettierrc');
  writeFile(path.join(targetDir, '.prettierignore'), PRETTIERIGNORE);
  success('.prettierignore');
  writeFile(path.join(targetDir, 'commitlint.config.js'), COMMITLINT_CONFIG);
  success('commitlint.config.js');

  step(3, 'Generating ESLint config...');
  const eslintConfig = generateEslintConfig(projectInfo);
  writeFile(path.join(targetDir, 'eslint.config.mjs'), eslintConfig);
  success('eslint.config.mjs');

  step(4, 'Generating TypeScript config...');
  const tsconfigPath = path.join(targetDir, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    info('tsconfig.json already exists, skipping (preserving existing config)');
  } else {
    const tsconfig = generateTsconfig({ isMonorepo: projectInfo.isMonorepo });
    writeFile(tsconfigPath, tsconfig);
    success('tsconfig.json');
  }

  step(5, 'Writing Husky hooks...');
  writeHuskyHooks(targetDir, projectInfo.packageManager);
  success('.husky/pre-commit');
  success('.husky/commit-msg');

  step(6, 'Updating package.json...');
  try {
    updatePackageJson(targetDir, projectInfo);
  } catch (error_) {
    error(
      error_ instanceof Error ? error_.message : 'Failed to resolve toolchain dependency versions.',
    );
    process.exit(1);
  }
  success('package.json updated with scripts, lint-staged, and devDependencies');

  const pm: PackageManager =
    options.pm && VALID_PACKAGE_MANAGERS.includes(options.pm as PackageManager)
      ? (options.pm as PackageManager)
      : projectInfo.packageManager;

  step(7, `Installing dependencies with ${pm}...`);
  try {
    execSync(`${pm} install`, { cwd: targetDir, stdio: 'inherit' });
  } catch {
    error(`Failed to install dependencies with ${pm}. Run "${pm} install" manually.`);
    process.exit(1);
  }
  success('Dependencies installed');

  step(8, 'Initializing Husky...');
  try {
    execSync(`${pmExec(pm)} husky`, { cwd: targetDir, stdio: 'inherit' });
  } catch {
    error('Failed to initialize Husky. Run "husky" manually.');
    process.exit(1);
  }
  success('Husky initialized');

  console.log(`\n${'='.repeat(50)}`);
  success('Toolchain is ready!');
  console.log(`\nNext steps:`);
  console.log(`  1. ${pm} run lint:fix`);
  console.log(`  2. ${pm} run typecheck`);
  console.log(`  3. Make a test commit to verify hooks`);
}
