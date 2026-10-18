import { execSync } from 'node:child_process';
import path from 'node:path';

import type { TemplateContext, TemplateResult } from './index.js';

import { pmDlx } from '../../detectors/project.js';

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
  const { packageManager: pm, projectName, targetDir, yes } = ctx;

  // --yes fills unasked options from saved preferences, so pin the ones this
  // template promises (TypeScript, App Router) rather than trust the machine.
  const flags = yes ? ' --ts --app --yes' : '';

  // Run from parent directory since create-next-app creates the folder
  const parentDir = path.dirname(targetDir);
  execSync(`${pmDlx(pm)} create-next-app@latest ${projectName} --use-${pm}${flags}`, {
    cwd: parentDir,
    stdio: 'inherit',
  });
}
