import type { TemplateContext, TemplateResult } from './index.js';

import { getVersions } from '../../utils/versions.js';
import { generateMonorepoPackageFiles, PNPM_WORKSPACE } from './monorepo-shared.js';

const GITIGNORE = `node_modules/
dist/
*.tsbuildinfo
*.tgz
.env
.env.local
.turbo/
`;

export async function generateTurbo(ctx: TemplateContext): Promise<TemplateResult> {
  const versions = await getVersions(['turbo', '@types/node'], ctx.signal);
  const typesNodeVersion = versions['@types/node'];
  if (!typesNodeVersion) throw new Error('Could not resolve @types/node');

  return {
    files: [
      { content: PNPM_WORKSPACE, path: 'pnpm-workspace.yaml' },
      { content: turboJson(), path: 'turbo.json' },
      ...generateMonorepoPackageFiles('node --watch src/index.ts', typesNodeVersion),
      { content: GITIGNORE, path: '.gitignore' },
    ],
    framework: 'plain',
    hasReact: false,
    isMonorepo: true,
    packageJson: {
      devDependencies: {
        turbo: versions['turbo'],
      },
      name: ctx.projectName,
      packageManager: 'pnpm@9.0.0',
      scripts: {
        build: 'pnpm turbo run build',
        dev: 'pnpm turbo run dev',
        typecheck: 'pnpm turbo run typecheck',
      },
      version: '0.1.0',
    },
  };
}

function turboJson(): string {
  return (
    JSON.stringify(
      {
        $schema: 'https://turbo.build/schema.json',
        tasks: {
          build: { dependsOn: ['^build'], outputs: ['dist/**'] },
          clean: { cache: false },
          dev: { cache: false, persistent: true },
          typecheck: { dependsOn: ['^build'] },
        },
      },
      null,
      2,
    ) + '\n'
  );
}
