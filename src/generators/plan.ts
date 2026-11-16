import { existsSync } from 'node:fs';
import path from 'node:path';

import type { PackageManager, ProjectInfo } from '../detectors/project.js';

import { readJson } from '../utils/fs.js';
import { getToolchainDeps } from '../utils/versions.js';
import { effectiveScripts, type Entry, type Plan, type PlanMessage } from './entry.js';
import { generateHuskyHooks } from './husky.js';
import { generateOxlintConfig } from './oxlint.js';
import { planPackageJson } from './package-json.js';
import {
  COMMITLINT_CONFIG,
  EDITORCONFIG,
  GITATTRIBUTES,
  PRETTIERIGNORE,
  PRETTIERRC,
} from './static-configs.js';
import { generateTsconfig } from './tsconfig.js';

// Everything init would write, read from the project but written nowhere.
// The version lookup runs here, so a failed one leaves the project untouched.
export function buildPlan(
  targetDir: string,
  info: ProjectInfo,
  pm: PackageManager,
  deps?: Record<string, string>,
  pkg: Record<string, unknown> = readJson(path.join(targetDir, 'package.json')),
): Plan {
  const entries: Entry[] = [
    { path: '.editorconfig', want: EDITORCONFIG },
    { path: '.prettierrc', want: PRETTIERRC },
    { path: '.prettierignore', want: PRETTIERIGNORE },
  ];
  const messages: PlanMessage[] = [];

  // An existing file may carry LFS filters or per-language rules, so it stays.
  if (existsSync(path.join(targetDir, '.gitattributes'))) {
    messages.push({
      level: 'info',
      text: '.gitattributes already exists, leaving it alone (add "* text=auto eol=lf" if missing)',
    });
  } else {
    entries.push({ path: '.gitattributes', want: GITATTRIBUTES });
  }
  entries.push(
    { path: 'commitlint.config.mjs', want: COMMITLINT_CONFIG },
    { path: '.oxlintrc.json', want: generateOxlintConfig(info) },
  );

  if (info.hasRootTsconfig) {
    messages.push({
      level: 'info',
      text: 'tsconfig.json already exists, skipping (preserving existing config)',
    });
  } else if (info.isMonorepo) {
    // An empty root config makes tsc check every package with the wrong
    // options, and init can't tell which packages build with tsc.
    messages.push({
      level: 'info',
      text: 'No root tsconfig.json in this monorepo, skipping (each package keeps its own)',
    });
  } else {
    entries.push({ path: 'tsconfig.json', want: generateTsconfig() });
  }

  const packagePlan = planPackageJson(pkg, info, deps ?? getToolchainDeps());
  entries.push(...packagePlan.entries);
  messages.push(...packagePlan.messages);

  // From the planned scripts, so the hooks match the package.json they ship with.
  const hooks = generateHuskyHooks(effectiveScripts(packagePlan.entries, pkg['scripts']), pm);
  entries.push(
    { path: '.husky/pre-commit', want: hooks.preCommit },
    { path: '.husky/commit-msg', want: hooks.commitMsg },
  );

  return { entries, messages };
}
