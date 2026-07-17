import type { TemplateContext, TemplateResult } from './index.js';

const GITIGNORE = `node_modules/
dist/
*.tgz
.env
.env.local
`;

const PNPM_WORKSPACE = `packages:
  - "packages/*"
`;

const CORE_PKG = `{
  "name": "@repo/core",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "build": "tsc"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
`;

const CORE_TSINDEX = `export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`;

const UI_PKG = `{
  "name": "@repo/ui",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@repo/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
`;

const UI_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
`;

const UI_TSCONFIG_ROOT = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
`;

const UI_TSINDEX = `import { add } from '@repo/core';

export function sum(a: number, b: number): number {
  return add(a, b);
}
`;

export function generatePnpmMonorepo(ctx: TemplateContext): TemplateResult {
  return {
    files: [
      { content: PNPM_WORKSPACE, path: 'pnpm-workspace.yaml' },
      { content: CORE_PKG, path: 'packages/core/package.json' },
      { content: UI_TSCONFIG_ROOT, path: 'packages/core/tsconfig.json' },
      { content: CORE_TSINDEX, path: 'packages/core/src/index.ts' },
      { content: UI_PKG, path: 'packages/ui/package.json' },
      { content: UI_TSCONFIG, path: 'packages/ui/tsconfig.json' },
      { content: UI_TSINDEX, path: 'packages/ui/src/index.ts' },
      { content: GITIGNORE, path: '.gitignore' },
    ],
    framework: 'plain',
    hasReact: false,
    isMonorepo: true,
    packageJson: {
      name: ctx.projectName,
      pnpm: { workspaces: ["packages/*"] },
      private: true,
      scripts: {
        build: 'pnpm -r build',
        dev: 'pnpm -r --parallel dev',
      },
      version: '0.1.0',
    },
  };
}
