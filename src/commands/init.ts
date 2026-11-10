import { execSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';

import {
  detect,
  type PackageManager,
  pmExec,
  type UnsupportedStack,
  VALID_PACKAGE_MANAGERS,
  workspacePackageDirs,
} from '../detectors/project.js';
import { writeHuskyHooks } from '../generators/husky.js';
import { generateOxlintConfig } from '../generators/oxlint.js';
import { ESLINT_DEP, updatePackageJson } from '../generators/package-json.js';
import {
  COMMITLINT_CONFIG,
  EDITORCONFIG,
  GITATTRIBUTES,
  PRETTIERIGNORE,
  PRETTIERRC,
} from '../generators/static-configs.js';
import { generateTsconfig } from '../generators/tsconfig.js';
import { readJson, writeFile } from '../utils/fs.js';
import { error, info, step, success, warn } from '../utils/logger.js';

// v2 lints with oxlint, so an ESLint config left in the project does nothing.
// Renaming instead of deleting keeps any custom rules the user wrote. The
// list covers what create-vite, create-next-app and older versions of this
// tool leave behind; ESLint 9 ignores .eslintrc.* entirely. create-vite 9
// ships oxlint instead of ESLint, so its .oxlintrc.json is moved aside too.
const OTHER_ESLINT_CONFIGS = [
  '.oxlintrc.json',
  'eslint.config.js',
  'eslint.config.mjs',
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

// commitlint loads the first of these it finds, so any one of them can
// shadow commitlint.config.mjs or sit next to it as a second config. Covers
// the CommonJS commitlint.config.js older versions of this tool wrote.
const OTHER_COMMITLINT_CONFIGS = [
  '.commitlintrc',
  '.commitlintrc.json',
  '.commitlintrc.yaml',
  '.commitlintrc.yml',
  '.commitlintrc.js',
  '.commitlintrc.cjs',
  '.commitlintrc.mjs',
  '.commitlintrc.ts',
  '.commitlintrc.cts',
  '.commitlintrc.mts',
  'commitlint.config.js',
  'commitlint.config.cjs',
  'commitlint.config.ts',
  'commitlint.config.cts',
  'commitlint.config.mts',
];

export async function init(options: {
  pm?: string;
  targetDir?: string;
  yes?: boolean;
}): Promise<void> {
  if (options.pm && !VALID_PACKAGE_MANAGERS.includes(options.pm as PackageManager)) {
    error(
      `Invalid package manager "${options.pm}". Available: ${VALID_PACKAGE_MANAGERS.join(', ')}`,
    );
    process.exit(1);
  }

  const targetDir = options.targetDir ?? process.cwd();

  step(1, 'Detecting project environment...');
  const projectInfo = detect(targetDir);
  // Resolved once so the hooks and the install can't disagree.
  const pm: PackageManager =
    (options.pm as PackageManager | undefined) ?? projectInfo.packageManager;
  info(`Framework: ${projectInfo.framework}`);
  info(`Package manager: ${pm}`);
  info(`Monorepo: ${projectInfo.isMonorepo ? 'Yes' : 'No'}`);

  // Before the prompt, so the user isn't asked to proceed and then refused.
  if (projectInfo.unsupported) refuseUnsupported(projectInfo.unsupported);

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
  // An existing file may carry LFS filters or per-language rules, so it stays.
  if (existsSync(path.join(targetDir, '.gitattributes'))) {
    info('.gitattributes already exists, leaving it alone (add "* text=auto eol=lf" if missing)');
  } else {
    writeFile(path.join(targetDir, '.gitattributes'), GITATTRIBUTES);
    success('.gitattributes');
  }
  moveAside(targetDir, OTHER_COMMITLINT_CONFIGS, 'commitlint.config.mjs');
  writeFile(path.join(targetDir, 'commitlint.config.mjs'), COMMITLINT_CONFIG);
  success('commitlint.config.mjs');

  step(3, 'Generating oxlint config...');
  moveAside(targetDir, OTHER_ESLINT_CONFIGS, '.oxlintrc.json');
  writeFile(path.join(targetDir, '.oxlintrc.json'), generateOxlintConfig(projectInfo));
  success('.oxlintrc.json');

  step(4, 'Generating TypeScript config...');
  if (projectInfo.hasRootTsconfig) {
    info('tsconfig.json already exists, skipping (preserving existing config)');
  } else if (projectInfo.isMonorepo) {
    // An empty root config makes tsc check every package with the wrong
    // options, and init can't tell which packages build with tsc.
    info('No root tsconfig.json in this monorepo, skipping (each package keeps its own)');
  } else {
    writeFile(
      path.join(targetDir, 'tsconfig.json'),
      generateTsconfig({ isMonorepo: projectInfo.isMonorepo }),
    );
    success('tsconfig.json');
  }

  step(5, 'Updating package.json...');
  try {
    updatePackageJson(targetDir, projectInfo);
  } catch (error_) {
    error(
      error_ instanceof Error ? error_.message : 'Failed to resolve toolchain dependency versions.',
    );
    process.exit(1);
  }
  success('package.json updated with scripts, lint-staged, and devDependencies');
  if (projectInfo.isMonorepo) warnAboutWorkspacePackages(targetDir);

  // After package.json, so the hook sees the final scripts.
  step(6, 'Writing Husky hooks...');
  writeHuskyHooks(targetDir, pm);
  success('.husky/pre-commit');
  success('.husky/commit-msg');

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

// Writing our configs into a Vue, Svelte, Astro or Angular project would hand
// back a typecheck script that skips every component file, which reads as
// passing. Refusing is the honest answer until those checkers run on TS 7.
// One error() call so the message stays on stderr, in one piece.
function refuseUnsupported(stack: UnsupportedStack): never {
  error(
    [
      `Unsupported project: ${stack.name} (found "${stack.package}" in package.json).`,
      `  ${stack.name} checks its components with ${stack.checker}, which needs TypeScript's compiler API,`,
      '  and TypeScript 7 no longer ships one, so "tsc --noEmit" would check none of them.',
      '  Keep this project on TypeScript 6: npm i -D typescript@npm:@typescript/typescript6',
    ].join('\n'),
  );
  return process.exit(1);
}

// Renames rather than deletes, so the user keeps any custom rules.
function moveAside(targetDir: string, names: string[], ours: string): void {
  for (const name of names) {
    const file = path.join(targetDir, name);
    if (!existsSync(file)) continue;
    renameSync(file, `${file}.bak`);
    warn(`Moved ${name} to ${name}.bak so ${ours} takes effect`);
  }
}

// init only touches the root, so per-package ESLint setups and TypeScript
// pins stay. Listing them beats rewriting every package's scripts and deps.
function warnAboutWorkspacePackages(targetDir: string): void {
  const eslint: string[] = [];
  const oldTypescript: string[] = [];
  for (const rel of workspacePackageDirs(targetDir)) {
    const pkg = readJson(path.join(targetDir, rel, 'package.json'));
    const deps = {
      ...(pkg['dependencies'] as Record<string, string> | undefined),
      ...(pkg['devDependencies'] as Record<string, string> | undefined),
    };
    const lint = (pkg['scripts'] as Record<string, string> | undefined)?.['lint'] ?? '';
    if (
      lint.includes('eslint') ||
      Object.keys(deps).some((name) => ESLINT_DEP.test(name)) ||
      OTHER_ESLINT_CONFIGS.some(
        (name) => name !== '.oxlintrc.json' && existsSync(path.join(targetDir, rel, name)),
      )
    ) {
      eslint.push(rel);
    }
    const ts = deps['typescript'];
    const major = Number(/\d+/.exec(ts ?? '')?.[0]);
    if (!Number.isNaN(major) && major < 7) oldTypescript.push(`${rel} (${ts})`);
  }

  const turboPath = path.join(targetDir, 'turbo.json');
  const turboLint =
    existsSync(turboPath) &&
    'lint' in ((readJson(turboPath)['tasks'] as Record<string, unknown> | undefined) ?? {});

  if (eslint.length > 0 || turboLint) {
    warn(
      `ESLint is still set up in workspace packages, which init leaves alone: ${[
        ...eslint,
        ...(turboLint ? ['turbo.json lint task'] : []),
      ].join(
        ', ',
      )}. The root "oxlint ." lints them now, so their eslint configs, ESLint deps and lint scripts can go.`,
    );
  }
  if (oldTypescript.length > 0) {
    warn(
      `The root now uses TypeScript 7, but these packages pin their own older typescript: ${oldTypescript.join(', ')}. Their own check scripts keep using it. When you move them to 7, drop baseUrl, moduleResolution "node"/"node10", target "es5", outFile, and module "amd"/"umd"/"system" from their tsconfigs.`,
    );
  }
}
