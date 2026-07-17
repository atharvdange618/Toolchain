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

  let createCmd: string;
  switch (pm) {
    case 'bun': {
      createCmd = 'bun create vite';
      break;
    }
    case 'npm': {
      createCmd = 'npm create vite@latest';
      break;
    }
    case 'yarn': {
      createCmd = 'yarn create vite';
      break;
    }
    default: {
      createCmd = `${pm} create vite`;
    }
  }

  // create-vite creates the directory itself, so run from parent
  const parentDir = path.dirname(targetDir);
  execSync(`${createCmd} ${projectName} --template react-ts`, {
    cwd: parentDir,
    stdio: 'inherit',
  });
}
