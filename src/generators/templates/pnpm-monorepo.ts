import type { TemplateContext, TemplateResult } from './index.js';

const GITIGNORE = `node_modules/
dist/
*.tgz
.env
.env.local
`;

const PNPM_WORKSPACE = `packages:
  - "apps/*"
  - "packages/*"
`;

const APPS_WEB_PKG = `{
  "name": "@repo/web",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsc",
    "dev": "node --watch src/index.ts",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@repo/shared": "workspace:*",
    "@repo/config": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}`;

const APPS_WEB_INDEX = `import { config } from '@repo/config';
import { logger } from '@repo/shared';

logger.info('Web app starting...');
logger.info('Config:', config);
`;

const APPS_MOBILE_PKG = `{
  "name": "@repo/mobile",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsc",
    "dev": "node --watch src/index.ts",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@repo/shared": "workspace:*",
    "@repo/config": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}`;

const APPS_MOBILE_INDEX = `import { config } from '@repo/config';
import { logger } from '@repo/shared';

logger.info('Mobile app starting...');
logger.info('Config:', config);
`;

const APPS_API_PKG = `{
  "name": "@repo/api",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsc",
    "dev": "node --watch src/index.ts",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@repo/shared": "workspace:*",
    "@repo/config": "workspace:*",
    "@repo/db": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}`;

const APPS_API_INDEX = `import { config } from '@repo/config';
import { logger } from '@repo/shared';
import { db } from '@repo/db';

logger.info('API server starting...');
logger.info('Config:', config);
logger.info('Database connected:', db.isConnected());
`;

const PACKAGES_SHARED_PKG = `{
  "name": "@repo/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}`;

const PACKAGES_SHARED_INDEX = `export function logger(msg: string, ...args: unknown[]): void {
  console.log(\`[LOG] \${msg}\`, ...args);
}

export function formatDate(date: Date): string {
  return date.toISOString();
}
`;

const PACKAGES_CONFIG_PKG = `{
  "name": "@repo/config",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}`;

const PACKAGES_CONFIG_INDEX = `export const config = {
  appName: process.env['APP_NAME'] ?? 'my-app',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  port: Number(process.env['PORT']) ?? 3000,
  databaseUrl: process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/mydb',
} as const;

export type Config = typeof config;
`;

const PACKAGES_DB_PKG = `{
  "name": "@repo/db",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@repo/config": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}`;

const PACKAGES_DB_INDEX = `import { config } from '@repo/config';

export const db = {
  isConnected: () => true,
  query: (sql: string) => ({ rows: [], sql }),
};

export type Database = typeof db;
`;

export function generatePnpmMonorepo(ctx: TemplateContext): TemplateResult {
  return {
    files: [
      { content: PNPM_WORKSPACE, path: 'pnpm-workspace.yaml' },

      { content: APPS_WEB_PKG, path: 'apps/web/package.json' },
      { content: tsconfig('../../packages/shared'), path: 'apps/web/tsconfig.json' },
      { content: APPS_WEB_INDEX, path: 'apps/web/src/index.ts' },

      { content: APPS_MOBILE_PKG, path: 'apps/mobile/package.json' },
      { content: tsconfig('../../packages/shared'), path: 'apps/mobile/tsconfig.json' },
      { content: APPS_MOBILE_INDEX, path: 'apps/mobile/src/index.ts' },

      { content: APPS_API_PKG, path: 'apps/api/package.json' },
      { content: tsconfig('../../packages/shared'), path: 'apps/api/tsconfig.json' },
      { content: APPS_API_INDEX, path: 'apps/api/src/index.ts' },

      { content: PACKAGES_SHARED_PKG, path: 'packages/shared/package.json' },
      { content: tsconfig(), path: 'packages/shared/tsconfig.json' },
      { content: PACKAGES_SHARED_INDEX, path: 'packages/shared/src/index.ts' },

      { content: PACKAGES_CONFIG_PKG, path: 'packages/config/package.json' },
      { content: tsconfig(), path: 'packages/config/tsconfig.json' },
      { content: PACKAGES_CONFIG_INDEX, path: 'packages/config/src/index.ts' },

      { content: PACKAGES_DB_PKG, path: 'packages/db/package.json' },
      { content: tsconfig('../../packages/config'), path: 'packages/db/tsconfig.json' },
      { content: PACKAGES_DB_INDEX, path: 'packages/db/src/index.ts' },

      { content: GITIGNORE, path: '.gitignore' },
    ],
    framework: 'plain',
    hasReact: false,
    isMonorepo: true,
    packageJson: {
      name: ctx.projectName,
      version: '0.1.0',
    },
  };
}

function tsconfig(references?: string): string {
  const ref = references ? `,\n  "references": [{ "path": "${references}" }]` : '';
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]${ref}
}
`;
}
