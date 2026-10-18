import { execSync } from 'node:child_process';
import path from 'node:path';

import type { TemplateContext, TemplateResult } from './index.js';

import { pmDlx } from '../../detectors/project.js';

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
  const { packageManager: pm, projectName, targetDir, yes } = ctx;

  // --no-immediate always: otherwise create-vite may install and start a dev
  // server that never exits, so init would never run. In a TTY it prompts
  // unless told --no-interactive.
  const flags = yes ? ' --no-interactive' : '';

  // create-vite creates the directory itself, so run from parent
  const parentDir = path.dirname(targetDir);
  execSync(`${pmDlx(pm)} create-vite@latest ${projectName} --template react-ts --no-immediate${flags}`, {
    cwd: parentDir,
    stdio: 'inherit',
  });
}
