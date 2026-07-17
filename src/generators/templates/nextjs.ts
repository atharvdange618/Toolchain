import { execSync } from 'node:child_process';
import path from 'node:path';

import type { TemplateContext, TemplateResult } from './index.js';

export function generateNextjs(_ctx: TemplateContext): TemplateResult {
  return {
    files: [],
    framework: 'next',
    hasReact: true,
    isMonorepo: false,
    packageJson: {},
    scaffold: scaffoldNextjs,
  };
}

function scaffoldNextjs(ctx: TemplateContext): void {
  const { packageManager: pm, projectName, targetDir } = ctx;

  // create-next-app expects npx even with pnpm
  const npx = pm === 'npm' ? 'npx' : `${pm} exec npx`;

  // Run from parent directory since create-next-app creates the folder
  const parentDir = path.dirname(targetDir);
  execSync(`${npx} --yes create-next-app@latest ${projectName} --use-${pm}`, {
    cwd: parentDir,
    stdio: 'inherit',
  });
}
