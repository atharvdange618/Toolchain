import type { TemplateContext, TemplateResult } from './index.js';

import { getTurboVersion, getTypescriptVersion, getTypesNodeVersion } from '../../utils/versions.js';

const GITIGNORE = `node_modules/
dist/
*.tgz
.env
.env.local
.turbo/
`;

const PNPM_WORKSPACE = `packages:
  - "apps/*"
  - "packages/*"
`;

export function generateTurbo(ctx: TemplateContext): TemplateResult {
  const turboVersion = getTurboVersion();

  return {
    files: [
      { content: PNPM_WORKSPACE, path: 'pnpm-workspace.yaml' },
      { content: turboJson(), path: 'turbo.json' },

      { content: pkgJson('@repo/web', { deps: { '@repo/config': 'workspace:*', '@repo/shared': 'workspace:*' } }), path: 'apps/web/package.json' },
      { content: tsconfig(['../../packages/shared', '../../packages/config']), path: 'apps/web/tsconfig.json' },
      { content: "import { config } from '@repo/config';\nimport { logger } from '@repo/shared';\n\nlogger('Web app starting...');\nlogger('Config:', config);\n", path: 'apps/web/src/index.ts' },

      { content: pkgJson('@repo/mobile', { deps: { '@repo/config': 'workspace:*', '@repo/shared': 'workspace:*' } }), path: 'apps/mobile/package.json' },
      { content: tsconfig(['../../packages/shared', '../../packages/config']), path: 'apps/mobile/tsconfig.json' },
      { content: "import { config } from '@repo/config';\nimport { logger } from '@repo/shared';\n\nlogger('Mobile app starting...');\nlogger('Config:', config);\n", path: 'apps/mobile/src/index.ts' },

      { content: pkgJson('@repo/api', { deps: { '@repo/config': 'workspace:*', '@repo/db': 'workspace:*', '@repo/shared': 'workspace:*' } }), path: 'apps/api/package.json' },
      { content: tsconfig(['../../packages/shared', '../../packages/config', '../../packages/db']), path: 'apps/api/tsconfig.json' },
      { content: "import { config } from '@repo/config';\nimport { database } from '@repo/db';\nimport { logger } from '@repo/shared';\n\nlogger('API server starting...');\nlogger('Config:', config);\nlogger('Database connected:', database.isConnected());\n", path: 'apps/api/src/index.ts' },

      { content: pkgJson('@repo/shared'), path: 'packages/shared/package.json' },
      { content: tsconfig(), path: 'packages/shared/tsconfig.json' },
      { content: "export function formatDate(date: Date): string {\n  return date.toISOString();\n}\n\nexport function logger(message: string, ...rest: unknown[]): void {\n  console.log(`[LOG] ${message}`, ...rest);\n}\n", path: 'packages/shared/src/index.ts' },

      { content: pkgJson('@repo/config'), path: 'packages/config/package.json' },
      { content: tsconfig(), path: 'packages/config/tsconfig.json' },
      { content: "export const config = {\n  appName: process.env['APP_NAME'] ?? 'my-app',\n  databaseUrl: process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/mydb',\n  nodeEnv: process.env['NODE_ENV'] ?? 'development',\n  port: Number(process.env['PORT'] ?? '3000'),\n} as const;\n\nexport type Config = typeof config;\n", path: 'packages/config/src/index.ts' },

      { content: pkgJson('@repo/db', { deps: { '@repo/config': 'workspace:*' } }), path: 'packages/db/package.json' },
      { content: tsconfig(['../../packages/config']), path: 'packages/db/tsconfig.json' },
      { content: "export const database = {\n  isConnected: () => true,\n  query: (_sql: string) => ({ rows: [], sql: _sql }),\n};\n\nexport type Database = typeof database;\n", path: 'packages/db/src/index.ts' },

      { content: GITIGNORE, path: '.gitignore' },
    ],
    framework: 'plain',
    hasReact: false,
    isMonorepo: true,
    packageJson: {
      devDependencies: {
        turbo: `^${turboVersion}`,
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

function pkgJson(name: string, opts?: { deps?: Record<string, string> }): string {
  const tsVersion = getTypescriptVersion();
  const typesNodeVersion = getTypesNodeVersion();
  const deps = opts?.deps ?? {};
  return JSON.stringify({
    dependencies: Object.keys(deps).length > 0 ? deps : undefined,
    devDependencies: {
      '@types/node': `^${typesNodeVersion}`,
      typescript: `^${tsVersion}`,
    },
    main: 'dist/index.js',
    name,
    scripts: {
      build: 'tsc',
      dev: 'node --watch src/index.ts',
      lint: 'tsc --noEmit',
      typecheck: 'tsc --noEmit',
    },
    type: 'module',
    types: 'dist/index.d.ts',
    version: '0.0.0',
  }, null, 2) + '\n';
}

function tsconfig(refs?: string[]): string {
  const references = refs?.length
    ? `,\n  "references": [${refs.map((r) => `{"path":"${r}"}`).join(',')}]`
    : '';
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "composite": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]${references}
}
`;
}

function turboJson(): string {
  return JSON.stringify({
    $schema: 'https://turbo.build/schema.json',
    tasks: {
      build: { dependsOn: ['^build'], outputs: ['dist/**'] },
      clean: { cache: false },
      dev: { cache: false, persistent: true },
      lint: { dependsOn: ['^build'] },
      typecheck: { dependsOn: ['^build'] },
    },
  }, null, 2) + '\n';
}
