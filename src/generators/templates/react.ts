import path from 'node:path';

import type { TemplateContext, TemplateResult } from './index.js';

import { pmDlx } from '../../detectors/project.js';
import { runTask } from '../../utils/progress.js';

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

async function scaffoldReact(ctx: TemplateContext): Promise<void> {
  const { packageManager: pm, projectName, targetDir } = ctx;

  // The template is already chosen, so create-vite has nothing to ask:
  // --no-interactive always. --no-immediate stops it installing and starting
  // a dev server that never exits, which would block init.
  // create-vite creates the directory itself, so run from the parent.
  await runTask(
    `${pmDlx(pm)} create-vite@latest ${projectName} --template react-ts --no-immediate --no-interactive`,
    {
      cwd: path.dirname(targetDir),
      title: 'Creating the React app with create-vite',
      successMessage: 'Project files created by create-vite',
    },
  );
}
