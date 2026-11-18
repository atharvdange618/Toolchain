import { existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { confirm, isCancel } from '@clack/prompts';

import {
  detect,
  type PackageManager,
  pmExec,
  type UnsupportedStack,
  unsupportedMessage,
  VALID_PACKAGE_MANAGERS,
  workspacePackageDirs,
} from '../detectors/project.js';
import { applyEntries, type Plan } from '../generators/entry.js';
import { ESLINT_DEP } from '../generators/package-json.js';
import { buildPlan } from '../generators/plan.js';
import { hashEntry, type Manifest } from '../manifest/manifest.js';
import { trackedEntries, validatePackageJson } from '../manifest/project.js';
import { writeManifest } from '../manifest/write.js';
import { readJson } from '../utils/fs.js';
import { error, info, intro, note, outro, step, success, warn } from '../utils/logger.js';
import { CommandCancelledError, isCommandCancelled } from '../utils/process.js';
import { runTask, withProgress } from '../utils/progress.js';
import { getToolchainDeps } from '../utils/versions.js';

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
  nested?: boolean;
}): Promise<void> {
  if (options.pm && !VALID_PACKAGE_MANAGERS.includes(options.pm as PackageManager)) {
    error(
      `Invalid package manager "${options.pm}". Available: ${VALID_PACKAGE_MANAGERS.join(', ')}`,
    );
    process.exit(1);
  }

  const targetDir = options.targetDir ?? process.cwd();

  try {
    const packageJson = path.join(targetDir, 'package.json');
    if (!existsSync(packageJson)) {
      throw new Error(
        'No package.json found in current directory. Run this command from the root of your project.',
      );
    }
    validatePackageJson(readJson(packageJson));
  } catch (error_) {
    const message = error_ instanceof Error ? error_.message : 'Could not read or validate file.';
    error(message.startsWith('package.json:') ? message : `package.json: ${message}`);
    return process.exit(1);
  }

  if (!options.nested) intro('Toolchain setup');
  const projectInfo = detect(targetDir);
  // Resolved once so the hooks and the install can't disagree.
  const pm: PackageManager =
    (options.pm as PackageManager | undefined) ?? projectInfo.packageManager;
  note(
    `Framework: ${projectInfo.framework}\nPackage manager: ${pm}\nMonorepo: ${projectInfo.isMonorepo ? 'Yes' : 'No'}`,
    'Detected project',
  );

  // Before the prompt, so the user isn't asked to proceed and then refused.
  if (projectInfo.unsupported) refuseUnsupported(projectInfo.unsupported);

  // Expo is the one framework whose .js files stay in the lint run.
  if (!projectInfo.hasTypeScriptFiles && projectInfo.framework !== 'expo') {
    warn(
      'No TypeScript files found. The generated .oxlintrc.json ignores .js files and lint-staged only matches .ts/.tsx, so a commit would lint nothing. Rename the sources to .ts, or run "oxlint . --fix" by hand.',
    );
  }

  // The config keeps type-aware rules on either way: writing a weaker config
  // would hide the problem, and the same imports fail typecheck on that tree.
  // So init names the imports and the two ways to resolve them.
  warnAboutWorkspaceTypes(projectInfo.unresolvedWorkspaceTypes);

  if (!options.yes) {
    if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
      throw new Error('Init has no terminal to ask. Rerun with --yes to proceed.');
    }
    const proceed = await confirm({
      initialValue: true,
      message: `Proceed with toolchain setup for ${projectInfo.framework} project?`,
    });
    if (isCancel(proceed)) {
      warn('Setup cancelled. No files were changed.');
      throw new CommandCancelledError('Confirm setup');
    }
    if (!proceed) {
      warn('Aborted by user.');
      return;
    }
  }

  // Planned in full before any write, so a failed version lookup leaves the
  // project as it was.
  let plan: Plan;
  try {
    const deps = await withProgress(
      'Resolving toolchain versions',
      'Toolchain versions resolved',
      (signal) => getToolchainDeps(undefined, signal),
    );
    plan = buildPlan(targetDir, projectInfo, pm, deps);
  } catch (error_) {
    if (isCommandCancelled(error_)) throw error_;
    error(
      error_ instanceof Error ? error_.message : 'Failed to resolve toolchain dependency versions.',
    );
    return process.exit(1);
  }
  for (const message of plan.messages) {
    if (message.level === 'warn') warn(message.text);
    else info(message.text);
  }

  await uninstallRemovedFirst(targetDir, pm, plan);
  step('Writing config files...');
  moveAside(targetDir, OTHER_COMMITLINT_CONFIGS, 'commitlint.config.mjs');
  moveAside(targetDir, OTHER_ESLINT_CONFIGS, '.oxlintrc.json');
  applyEntries(targetDir, plan.entries);
  try {
    const entries: Manifest = {};
    for (const entry of trackedEntries(plan)) {
      const hash = hashEntry(entry.path, entry.want ?? undefined);
      if (hash !== undefined) entries[entry.path] = hash;
    }
    writeManifest(targetDir, { packageManager: pm, entries });
  } catch (error_) {
    error(error_ instanceof Error ? error_.message : 'Failed to record .toolchain.json.');
    return process.exit(1);
  }
  const fileCount = plan.entries.filter((entry) => !entry.path.startsWith('package.json#')).length;
  success(`Wrote ${fileCount} config files, updated package.json and recorded .toolchain.json`);
  if (projectInfo.isMonorepo) warnAboutWorkspacePackages(targetDir);

  // Cancellation propagates, so neither Husky nor the success lines run after Ctrl+C.
  try {
    await runTask(`${pm} install`, {
      cwd: targetDir,
      title: `Installing dependencies with ${pm}`,
      successMessage: 'Dependencies installed',
    });
  } catch (error_) {
    if (isCommandCancelled(error_)) {
      warn(`Run "${pm} install" manually to finish setup.`);
      throw error_;
    }
    error(`Failed to install dependencies with ${pm}. Run "${pm} install" manually.`);
    return process.exit(1);
  }

  try {
    await runTask(`${pmExec(pm)} husky`, {
      cwd: targetDir,
      title: 'Initializing Husky',
      successMessage: 'Husky initialized',
    });
  } catch (error_) {
    if (isCommandCancelled(error_)) {
      warn(`Run "${pmExec(pm)} husky" manually to finish setup.`);
      throw error_;
    }
    error('Failed to initialize Husky. Run "husky" manually.');
    return process.exit(1);
  }

  if (options.nested) return;
  info(
    'Supported: Next.js, Vite + React, Expo, Express, plain TypeScript, and pnpm/Turbo monorepos.',
  );
  note(`${pm} run lint:fix\n${pm} run typecheck\nMake a test commit to verify hooks`, 'Next steps');
  outro('Toolchain is ready!');
}

// Writing our configs into a Vue, Svelte, Astro or Angular project would hand
// back a typecheck script that skips every component file, which reads as
// passing. Refusing is the honest answer until those checkers run on TS 7.
// One error() call so the message stays on stderr, in one piece.
function refuseUnsupported(stack: UnsupportedStack): never {
  error(unsupportedMessage(stack));
  return process.exit(1);
}

// npm builds the new tree from the old lockfile and checks every peer edge
// before it prunes, so one install that drops ESLint and moves TypeScript to 7
// prints ERESOLVE for each typescript-eslint package it is about to remove
// (#11). Uninstalling them while package.json still holds the old TypeScript
// prunes them first. Only with a lockfile: without one, the uninstall would
// install the whole project once more. A failure costs the warnings, not the
// setup, so init carries on; a cancel stops before init writes anything.
// ponytail: npm only, the one manager seen printing these; extend if pnpm,
// yarn or bun turn out to warn the same way.
async function uninstallRemovedFirst(
  targetDir: string,
  pm: PackageManager,
  plan: Plan,
): Promise<void> {
  if (pm !== 'npm' || !existsSync(path.join(targetDir, 'package-lock.json'))) return;
  const prefix = 'package.json#devDependencies.';
  const names = plan.entries
    .filter((entry) => entry.want === null && entry.path.startsWith(prefix))
    .map((entry) => entry.path.slice(prefix.length));
  if (names.length === 0) return;
  const command = `npm uninstall ${names.join(' ')}`;
  try {
    await runTask(command, {
      cwd: targetDir,
      title: 'Removing ESLint packages',
      successMessage: 'ESLint packages removed',
    });
  } catch (error_) {
    if (isCommandCancelled(error_)) {
      warn(
        'Setup cancelled before any config files were written; npm may have removed some ESLint packages. Rerun init to continue.',
      );
      throw error_;
    }
    warn(`${command} failed; the install below may print ERESOLVE warnings for those packages.`);
  }
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
export function warnAboutWorkspaceTypes(imports: readonly string[]): void {
  if (imports.length === 0) return;
  warn(
    `Type-aware lint needs each workspace import to resolve, and these don't: ${imports.join(', ')}. Every use of them reports under the no-unsafe-* rules until they do. Add the dependency to the importing package's tsconfig "references" (needs no build), or build the packages before lint runs (a fresh clone or CI needs that build too).`,
  );
}

export function warnAboutWorkspacePackages(
  targetDir: string,
  command: 'init' | 'update' = 'init',
): void {
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
    const packages = [...eslint, ...(turboLint ? ['turbo.json lint task'] : [])].join(', ');
    warn(
      command === 'init'
        ? `ESLint is still set up in workspace packages, which init leaves alone: ${packages}. The root "oxlint ." lints them now, so their eslint configs, ESLint deps and lint scripts can go.`
        : `ESLint is still set up in workspace packages, which update leaves alone: ${packages}. Review their ESLint configs, dependencies and lint scripts when moving them to oxlint.`,
    );
  }
  if (oldTypescript.length > 0) {
    const rootTs = (
      readJson(path.join(targetDir, 'package.json'))['devDependencies'] as
        Record<string, string> | undefined
    )?.['typescript'];
    warn(
      `${command === 'init' ? 'The root now uses TypeScript 7, but these packages pin their own older typescript' : `The root TypeScript declaration is ${rootTs ?? 'absent'}; these packages pin TypeScript below 7`}: ${oldTypescript.join(', ')}. Their own check scripts keep using it. When you move them to 7, drop baseUrl, moduleResolution "node"/"node10", target "es5", outFile, and module "amd"/"umd"/"system" from their tsconfigs.`,
    );
  }
}
