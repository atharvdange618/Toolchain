import type { TemplateContext, TemplateResult } from './index.js';

import { getTypescriptVersion, getVersions } from '../../utils/versions.js';
import { generateTsconfig } from '../tsconfig.js';

const GITIGNORE = `node_modules/
dist/
*.tgz
.env
.env.local
`;

const EXPRESS_ENTRY = `import express from 'express';

const app = express();
const port = process.env['PORT'] || 3000;

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

export async function generateExpress(ctx: TemplateContext): Promise<TemplateResult> {
  const tsVersion = getTypescriptVersion();
  const versions = await getVersions(['express', '@types/express', '@types/node'], ctx.signal);

  return {
    files: [
      { content: EXPRESS_ENTRY, path: 'src/index.ts' },
      { content: GITIGNORE, path: '.gitignore' },
      { content: generateTsconfig({ nodeApp: true }), path: 'tsconfig.json' },
    ],
    framework: 'express',
    hasReact: false,
    isMonorepo: false,
    packageJson: {
      dependencies: {
        express: versions['express'],
      },
      devDependencies: {
        '@types/express': versions['@types/express'],
        '@types/node': versions['@types/node'],
        typescript: tsVersion,
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
