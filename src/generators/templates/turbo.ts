import type { TemplateContext, TemplateResult } from './index.js';

import { getTurboVersion } from '../../utils/versions.js';
import { generateMonorepoPackageFiles, PNPM_WORKSPACE } from './monorepo-shared.js';

const GITIGNORE = `node_modules/
dist/
*.tgz
.env
.env.local
.turbo/
`;

export function generateTurbo(ctx: TemplateContext): TemplateResult {
  const turboVersion = getTurboVersion();

  return {
    files: [
      { content: PNPM_WORKSPACE, path: 'pnpm-workspace.yaml' },
      { content: turboJson(), path: 'turbo.json' },
      ...generateMonorepoPackageFiles('node --watch src/index.ts'),
      { content: GITIGNORE, path: '.gitignore' },
    ],
    framework: 'plain',
    hasReact: false,
    isMonorepo: true,
    packageJson: {
      devDependencies: {
        turbo: turboVersion,
      },
      name: ctx.projectName,
      packageManager: 'pnpm@9.0.0',
      scripts: {
        build: 'pnpm turbo run build',
        dev: 'pnpm turbo run dev',
        lint: 'pnpm turbo run lint',
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
          lint: { dependsOn: ['^build'] },
          typecheck: { dependsOn: ['^build'] },
        },
      },
      null,
      2,
    ) + '\n'
  );
}
