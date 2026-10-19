import { execSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync } from 'node:fs';
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

// ESLint loads eslint.config.js before eslint.config.mjs, so a leftover .js
// (create-vite ships one) silently replaces ours. The rest never shadow it
// but would leave a second config that does nothing. ESLint 9 ignores
// .eslintrc.* entirely.
const OTHER_ESLINT_CONFIGS = [
  'eslint.config.js',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yaml',
  '.eslintrc.yml',
];

export async function init(options: { pm?: string; targetDir?: string; yes?: boolean; }): Promise<void> {
  if (options.pm && !VALID_PACKAGE_MANAGERS.includes(options.pm as PackageManager)) {
    error(`Invalid package manager "${options.pm}". Available: ${VALID_PACKAGE_MANAGERS.join(', ')}`);
    process.exit(1);
  }

  const targetDir = options.targetDir ?? process.cwd();

  step(1, 'Detecting project environment...');
  const projectInfo = detect(targetDir);
  // Resolved once so the hooks and the install can't disagree.
  const pm: PackageManager = (options.pm as PackageManager | undefined) ?? projectInfo.packageManager;
  info(`Framework: ${projectInfo.framework}`);
  info(`Package manager: ${pm}`);
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
  writeFile(path.join(targetDir, 'commitlint.config.mjs'), COMMITLINT_CONFIG);
  success('commitlint.config.mjs');

  step(3, 'Generating ESLint config...');
  for (const name of OTHER_ESLINT_CONFIGS) {
    const file = path.join(targetDir, name);
    if (!existsSync(file)) continue;
    renameSync(file, `${file}.bak`);
    warn(`Moved ${name} to ${name}.bak so eslint.config.mjs takes effect`);
  }
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
  writeHuskyHooks(targetDir, pm);
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
  if (pm === 'pnpm') allowPnpmBuilds(targetDir);

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

// pnpm 11 fails the install when a dependency's build script isn't approved,
// and eslint-import-resolver-typescript pulls in unrs-resolver, which has one.
// ponytail: line-based edit, not a YAML parser. An inline `allowBuilds: {...}`
// map would get a second allowBuilds key; parse with a YAML lib if that shows up.
function allowPnpmBuilds(targetDir: string): void {
  const file = path.join(targetDir, 'pnpm-workspace.yaml');
  const yaml = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (/^\s+unrs-resolver:/m.test(yaml)) return;

  const entry = '  unrs-resolver: true\n';
  const header = /^allowBuilds:[ \t]*\n/m;
  const updated = header.test(yaml)
    ? yaml.replace(header, `allowBuilds:\n${entry}`)
    : `${yaml}${yaml === '' || yaml.endsWith('\n') ? '' : '\n'}allowBuilds:\n${entry}`;
  writeFile(file, updated);
  success('pnpm-workspace.yaml allows the unrs-resolver build');
}
