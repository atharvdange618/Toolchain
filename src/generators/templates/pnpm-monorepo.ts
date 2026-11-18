import type { TemplateContext, TemplateResult } from './index.js';

import { getVersions } from '../../utils/versions.js';
import { generateMonorepoPackageFiles, PNPM_WORKSPACE } from './monorepo-shared.js';

const GITIGNORE = `node_modules/
dist/
*.tsbuildinfo
*.tgz
.env
.env.local
`;

export async function generatePnpmMonorepo(ctx: TemplateContext): Promise<TemplateResult> {
  const versions = await getVersions(['@types/node'], ctx.signal);
  const typesNodeVersion = versions['@types/node'];
  if (!typesNodeVersion) throw new Error('Could not resolve @types/node');
  return {
    files: [
      { content: PNPM_WORKSPACE, path: 'pnpm-workspace.yaml' },
      ...generateMonorepoPackageFiles('tsc --watch', typesNodeVersion),
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
        typecheck: 'pnpm -r typecheck',
      },
      version: '0.1.0',
    },
  };
}
