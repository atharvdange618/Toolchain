import type { TemplateContext, TemplateResult } from './index.js';

const GITIGNORE = `node_modules/
dist/
*.tgz
.env
.env.local
.turbo/
`;

const PNPM_WORKSPACE = `packages:
  - "packages/*"
  - "apps/*"
`;

const TURBO_JSON = `{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    }
  }
}
`;

const APPS_WEB_PKG = `{
  "name": "@repo/web",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsc",
    "dev": "node --watch src/index.ts",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@repo/ui": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
`;

const APPS_WEB_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [{ "path": "../../packages/ui" }]
}
`;

const APPS_WEB_INDEX = `import { Button } from '@repo/ui';

console.log(Button({ label: 'Hello from web' }));
`;

const PKGS_UI_PKG = `{
  "name": "@repo/ui",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
`;

const PKGS_UI_TSCONFIG = `{
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

const PKGS_UI_INDEX = `export function Button({ label }: { label: string }): string {
  return \`<button>\${label}</button>\`;
}
`;

export function generateTurbo(ctx: TemplateContext): TemplateResult {
  return {
    files: [
      { content: PNPM_WORKSPACE, path: 'pnpm-workspace.yaml' },
      { content: TURBO_JSON, path: 'turbo.json' },
      { content: APPS_WEB_PKG, path: 'apps/web/package.json' },
      { content: APPS_WEB_TSCONFIG, path: 'apps/web/tsconfig.json' },
      { content: APPS_WEB_INDEX, path: 'apps/web/src/index.ts' },
      { content: PKGS_UI_PKG, path: 'packages/ui/package.json' },
      { content: PKGS_UI_TSCONFIG, path: 'packages/ui/tsconfig.json' },
      { content: PKGS_UI_INDEX, path: 'packages/ui/src/index.ts' },
      { content: GITIGNORE, path: '.gitignore' },
    ],
    framework: 'plain',
    hasReact: false,
    isMonorepo: true,
    packageJson: {
      devDependencies: {
        turbo: '^2.5.3',
      },
      name: ctx.projectName,
      pnpm: { workspaces: ["packages/*", "apps/*"] },
      private: true,
      scripts: {
        build: 'turbo run build',
        dev: 'turbo run dev',
        lint: 'turbo run lint',
      },
      version: '0.1.0',
    },
  };
}
