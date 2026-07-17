import type { TemplateContext, TemplateResult } from './index.js';

const GITIGNORE = `node_modules/
dist/
*.tgz
.env
.env.local
`;

const EXPRESS_ENTRY = `import express from 'express';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ message: 'Hello from Express API' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(\`Server running on http://localhost:\${port}\`);
});
`;

export function generateExpress(ctx: TemplateContext): TemplateResult {
  return {
    files: [
      { content: EXPRESS_ENTRY, path: 'src/index.ts' },
      { content: GITIGNORE, path: '.gitignore' },
    ],
    framework: 'express',
    hasReact: false,
    isMonorepo: false,
    packageJson: {
      dependencies: {
        express: '^5.1.0',
      },
      devDependencies: {
        '@types/express': '^5.0.2',
        '@types/node': '^22.15.3',
        typescript: '^5.8.3',
      },
      main: 'dist/index.js',
      name: ctx.projectName,
      scripts: {
        build: 'tsc',
        dev: 'node --watch --experimental-strip-types src/index.ts',
        start: 'node dist/index.js',
      },
      type: 'module',
      version: '0.1.0',
    },
  };
}
