import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function writeHuskyHooks(targetDir: string, pm: string): void {
  const huskyDir = path.join(targetDir, '.husky');
  mkdirSync(huskyDir, { recursive: true });

  writeFileSync(
    path.join(huskyDir, 'pre-commit'),
    `${pm} exec lint-staged
${pm} run typecheck
`,
  );

  writeFileSync(
    path.join(huskyDir, 'commit-msg'),
    `${pm} exec commitlint --edit $1
`,
  );
}
