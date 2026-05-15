import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { pmExec, type PackageManager } from '../detectors/project.js';

export function writeHuskyHooks(targetDir: string, pm: PackageManager): void {
  const huskyDir = path.join(targetDir, '.husky');
  mkdirSync(huskyDir, { recursive: true });

  writeFileSync(
    path.join(huskyDir, 'pre-commit'),
    `${pmExec(pm)} lint-staged
${pm} run typecheck
`,
  );

  writeFileSync(
    path.join(huskyDir, 'commit-msg'),
    `${pmExec(pm)} commitlint --edit $1
`,
  );
}
