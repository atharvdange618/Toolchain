import { getTypescriptVersion, getTypesNodeVersion } from '../../utils/versions.js';

export const PNPM_WORKSPACE = `packages:
  - "apps/*"
  - "packages/*"
`;

// The apps/packages* file set both the pnpm-monorepo and turbo templates
// scaffold - identical except for each app's "dev" script, which differs
// between plain tsc --watch and turbo's node --watch invocation.
export function generateMonorepoPackageFiles(
  devScript: string,
): Array<{ content: string; path: string }> {
  return [
    {
      content: monorepoPkgJson('@repo/web', devScript, {
        '@repo/config': 'workspace:*',
        '@repo/shared': 'workspace:*',
      }),
      path: 'apps/web/package.json',
    },
    {
      content: monorepoTsconfig(['../../packages/shared', '../../packages/config']),
      path: 'apps/web/tsconfig.json',
    },
    {
      content:
        "import { config } from '@repo/config';\nimport { logger } from '@repo/shared';\n\nlogger('Web app starting...');\nlogger('Config:', config);\n",
      path: 'apps/web/src/index.ts',
    },

    {
      content: monorepoPkgJson('@repo/mobile', devScript, {
        '@repo/config': 'workspace:*',
        '@repo/shared': 'workspace:*',
      }),
      path: 'apps/mobile/package.json',
    },
    {
      content: monorepoTsconfig(['../../packages/shared', '../../packages/config']),
      path: 'apps/mobile/tsconfig.json',
    },
    {
      content:
        "import { config } from '@repo/config';\nimport { logger } from '@repo/shared';\n\nlogger('Mobile app starting...');\nlogger('Config:', config);\n",
      path: 'apps/mobile/src/index.ts',
    },

    {
      content: monorepoPkgJson('@repo/api', devScript, {
        '@repo/config': 'workspace:*',
        '@repo/db': 'workspace:*',
        '@repo/shared': 'workspace:*',
      }),
      path: 'apps/api/package.json',
    },
    {
      content: monorepoTsconfig([
        '../../packages/shared',
        '../../packages/config',
        '../../packages/db',
      ]),
      path: 'apps/api/tsconfig.json',
    },
    {
      content:
        "import { config } from '@repo/config';\nimport { database } from '@repo/db';\nimport { logger } from '@repo/shared';\n\nlogger('API server starting...');\nlogger('Config:', config);\nlogger('Database connected:', database.isConnected());\n",
      path: 'apps/api/src/index.ts',
    },

    { content: monorepoPkgJson('@repo/shared', devScript), path: 'packages/shared/package.json' },
    { content: monorepoTsconfig(), path: 'packages/shared/tsconfig.json' },
    {
      content:
        'export function formatDate(date: Date): string {\n  return date.toISOString();\n}\n\nexport function logger(message: string, ...rest: unknown[]): void {\n  console.log(`[LOG] ${message}`, ...rest);\n}\n',
      path: 'packages/shared/src/index.ts',
    },

    { content: monorepoPkgJson('@repo/config', devScript), path: 'packages/config/package.json' },
    { content: monorepoTsconfig(), path: 'packages/config/tsconfig.json' },
    {
      content:
        "export const config = {\n  appName: process.env['APP_NAME'] ?? 'my-app',\n  databaseUrl: process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/mydb',\n  nodeEnv: process.env['NODE_ENV'] ?? 'development',\n  port: Number(process.env['PORT'] ?? '3000'),\n} as const;\n\nexport type Config = typeof config;\n",
      path: 'packages/config/src/index.ts',
    },

    {
      content: monorepoPkgJson('@repo/db', devScript, { '@repo/config': 'workspace:*' }),
      path: 'packages/db/package.json',
    },
    { content: monorepoTsconfig(['../../packages/config']), path: 'packages/db/tsconfig.json' },
    {
      content:
        'export const database = {\n  isConnected: () => true,\n  query: (_sql: string) => ({ rows: [], sql: _sql }),\n};\n\nexport type Database = typeof database;\n',
      path: 'packages/db/src/index.ts',
    },
  ];
}

export function monorepoTsconfig(refs?: string[]): string {
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

function monorepoPkgJson(name: string, devScript: string, deps?: Record<string, string>): string {
  const tsVersion = getTypescriptVersion();
  const typesNodeVersion = getTypesNodeVersion();
  return (
    JSON.stringify(
      {
        dependencies: deps && Object.keys(deps).length > 0 ? deps : undefined,
        devDependencies: {
          '@types/node': typesNodeVersion,
          typescript: tsVersion,
        },
        main: 'dist/index.js',
        name,
        scripts: {
          build: 'tsc',
          dev: devScript,
          lint: 'tsc --noEmit',
          typecheck: 'tsc --noEmit',
        },
        type: 'module',
        types: 'dist/index.d.ts',
        version: '0.0.0',
      },
      null,
      2,
    ) + '\n'
  );
}
