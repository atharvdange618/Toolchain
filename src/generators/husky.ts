import path from 'node:path';

import { type PackageManager, pmExec } from '../detectors/project.js';
import { readJson, writeFile } from '../utils/fs.js';

// `npm init` writes this placeholder, which always exits 1.
const NPM_PLACEHOLDER_TEST = 'no test specified';

export function writeHuskyHooks(targetDir: string, pm: PackageManager): void {
  // Git runs hooks with stdin closed, so vitest (and jest) run once instead of watching.
  const scripts = readJson(path.join(targetDir, 'package.json'))['scripts'] as
    | Record<string, string>
    | undefined;
  const test = scripts?.['test'];
  const runTests = test !== undefined && !test.includes(NPM_PLACEHOLDER_TEST);
  // A monorepo with no root tsconfig and no typecheck script of its own gets none.
  const typecheck = scripts?.['typecheck'] !== undefined;

  writeFile(
    path.join(targetDir, '.husky', 'pre-commit'),
    `${pmExec(pm)} lint-staged\n${typecheck ? `${pm} run typecheck\n` : ''}${runTests ? `${pm} run test\n` : ''}`,
  );

  // Quoted so a path with spaces reaches commitlint as one argument.
  writeFile(path.join(targetDir, '.husky', 'commit-msg'), `${pmExec(pm)} commitlint --edit "$1"\n`);
}
