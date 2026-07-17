import type { TemplateContext, TemplateResult } from './index.js';
import { getTypescriptVersion } from '../../utils/versions.js';

const GITIGNORE = `node_modules/
dist/
*.tgz
.env
.env.local
`;

export function generatePlain(ctx: TemplateContext): TemplateResult {
  const tsVersion = getTypescriptVersion();
  return {
    framework: 'plain',
    hasReact: false,
    isMonorepo: false,
    packageJson: {
      name: ctx.projectName,
      version: '0.1.0',
      type: 'module',
      main: 'dist/index.js',
      scripts: {
        build: 'tsc',
        dev: 'tsc --watch',
        start: 'node dist/index.js',
      },
      devDependencies: {
        typescript: `^${tsVersion}`,
      },
    },
    files: [
      {
        path: 'src/index.ts',
        content: `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet('World'));
`,
      },
      { path: '.gitignore', content: GITIGNORE },
    ],
  };
}
