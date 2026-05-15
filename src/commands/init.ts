import { execSync } from 'node:child_process';
import path from 'node:path';
import prompts from 'prompts';

import { detect, pmExec, type PackageManager } from '../detectors/project.js';
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
import { info, step, success, warn } from '../utils/logger.js';

export async function init(options: { pm?: string; yes?: boolean }): Promise<void> {
  const targetDir = process.cwd();

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

  step(3, 'Writing config files...');
  writeFile(path.join(targetDir, '.editorconfig'), EDITORCONFIG);
  success('.editorconfig');
  writeFile(path.join(targetDir, '.prettierrc'), PRETTIERRC);
  success('.prettierrc');
  writeFile(path.join(targetDir, '.prettierignore'), PRETTIERIGNORE);
  success('.prettierignore');
  writeFile(path.join(targetDir, 'commitlint.config.js'), COMMITLINT_CONFIG);
  success('commitlint.config.js');

  step(4, 'Generating ESLint config...');
  const eslintConfig = generateEslintConfig(projectInfo);
  writeFile(path.join(targetDir, 'eslint.config.mjs'), eslintConfig);
  success('eslint.config.mjs');

  step(5, 'Generating TypeScript config...');
  const tsconfig = generateTsconfig({ isMonorepo: projectInfo.isMonorepo });
  writeFile(path.join(targetDir, 'tsconfig.json'), tsconfig);
  success('tsconfig.json');

  step(6, 'Writing Husky hooks...');
  writeHuskyHooks(targetDir, projectInfo.packageManager);
  success('.husky/pre-commit');
  success('.husky/commit-msg');

  step(7, 'Updating package.json...');
  updatePackageJson(targetDir, projectInfo);
  success('package.json updated with scripts, lint-staged, and devDependencies');

  const pm: PackageManager = (options.pm as PackageManager) ?? projectInfo.packageManager;

  step(8, `Installing dependencies with ${pm}...`);
  execSync(`${pm} install`, { cwd: targetDir, stdio: 'inherit' });
  success('Dependencies installed');

  step(9, 'Initializing Husky...');
  execSync(`${pmExec(pm)} husky`, { cwd: targetDir, stdio: 'inherit' });
  success('Husky initialized');

  console.log(`\n${'='.repeat(50)}`);
  success('Toolchain is ready!');
  console.log(`\nNext steps:`);
  console.log(`  1. ${pm} run lint:fix`);
  console.log(`  2. ${pm} run typecheck`);
  console.log(`  3. Make a test commit to verify hooks`);
}
