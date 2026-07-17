import { execSync } from 'node:child_process';
import path from 'node:path';

import type { TemplateContext, TemplateResult } from './index.js';

export function generateReact(_ctx: TemplateContext): TemplateResult {
  return {
    files: [],
    framework: 'react',
    hasReact: true,
    isMonorepo: false,
    packageJson: {},
    scaffold: scaffoldReact,
  };
}

function scaffoldReact(ctx: TemplateContext): void {
  const { packageManager: pm, projectName, targetDir } = ctx;

  // Use npx create-vite directly for reliable non-interactive scaffolding
  const npx = pm === 'npm' ? 'npx' : `${pm} exec npx`;

  // create-vite creates the directory itself, so run from parent
  const parentDir = path.dirname(targetDir);
  execSync(`${npx} --yes create-vite@latest ${projectName} --template react-ts`, {
    cwd: parentDir,
    stdio: 'inherit',
  });
}
