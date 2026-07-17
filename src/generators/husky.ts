import path from 'node:path';

import { type PackageManager, pmExec } from '../detectors/project.js';
import { writeFile } from '../utils/fs.js';

export function writeHuskyHooks(targetDir: string, pm: PackageManager): void {
  writeFile(
    path.join(targetDir, '.husky', 'pre-commit'),
    `${pmExec(pm)} lint-staged\n${pm} run typecheck\n`,
  );

  writeFile(
    path.join(targetDir, '.husky', 'commit-msg'),
    `${pmExec(pm)} commitlint --edit $1\n`,
  );
}
