import type { TemplateContext, TemplateResult } from './index.js';

import { generateMonorepoPackageFiles, PNPM_WORKSPACE } from './monorepo-shared.js';

const GITIGNORE = `node_modules/
dist/
*.tgz
.env
.env.local
`;

export function generatePnpmMonorepo(ctx: TemplateContext): TemplateResult {
  return {
    files: [
      { content: PNPM_WORKSPACE, path: 'pnpm-workspace.yaml' },
      ...generateMonorepoPackageFiles('tsc --watch'),
      { content: GITIGNORE, path: '.gitignore' },
    ],
    framework: 'plain',
    hasReact: false,
    isMonorepo: true,
    packageJson: {
      name: ctx.projectName,
      scripts: {
        build: 'pnpm -r build',
        dev: 'pnpm -r --parallel dev',
        lint: 'pnpm -r lint',
        typecheck: 'pnpm -r typecheck',
      },
      version: '0.1.0',
    },
  };
}
