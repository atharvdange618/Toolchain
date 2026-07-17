import type { TemplateContext, TemplateResult } from './index.js';

const GITIGNORE = `node_modules/
dist/
*.tgz
.env
.env.local
`;

export function generatePlain(ctx: TemplateContext): TemplateResult {
  return {
    files: [
      {
        content: `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet('World'));
`,
        path: 'src/index.ts',
      },
      { content: GITIGNORE, path: '.gitignore' },
    ],
    framework: 'plain',
    hasReact: false,
    isMonorepo: false,
    packageJson: {
      devDependencies: {
        typescript: '^5.8.3',
      },
      main: 'dist/index.js',
      name: ctx.projectName,
      scripts: {
        build: 'tsc',
        dev: 'tsc --watch',
        start: 'node dist/index.js',
      },
      type: 'module',
      version: '0.1.0',
    },
  };
}
