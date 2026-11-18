import path from 'node:path';

import type { TemplateContext, TemplateResult } from './index.js';

import { pmDlx } from '../../detectors/project.js';
import { runTask } from '../../utils/progress.js';

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

async function scaffoldNextjs(ctx: TemplateContext): Promise<void> {
  const { packageManager: pm, projectName, targetDir, yes } = ctx;

  // --yes fills unasked options from saved preferences, so pin the ones this
  // template promises (TypeScript, App Router) rather than trust the machine.
  // Without --yes, pass no flags at all: create-next-app 16 skips every question
  // when any -- flag is present. It reads the package manager from the runner
  // pmDlx picked (npx, pnpm dlx, yarn dlx, bunx), so --use-<pm> isn't needed.
  const flags = yes ? ` --use-${pm} --ts --app --yes` : '';

  // Run from parent directory since create-next-app creates the folder
  await runTask(`${pmDlx(pm)} create-next-app@latest ${projectName}${flags}`, {
    cwd: path.dirname(targetDir),
    title: 'Creating the Next.js app with create-next-app',
    successMessage: 'Project files created by create-next-app',
    interactive: !yes,
  });
}
