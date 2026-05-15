import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ProjectInfo } from '../detectors/project.js';

const SCRIPTS: Record<string, string> = {
  format: 'prettier --write .',
  'format:check': 'prettier --check .',
  lint: 'eslint .',
  'lint:fix': 'eslint . --fix',
  'lint:strict': 'eslint . --max-warnings 0',
  prepare: 'husky',
  typecheck: 'tsc --noEmit',
};

const LINT_STAGED = {
  '*.{json,md,css}': ['prettier --write'],
  '*.{ts,tsx}': ['eslint --fix', 'prettier --write'],
};

const BASE_DEV_DEPS: Record<string, string> = {
  '@commitlint/cli': '^21.0.1',
  '@commitlint/config-conventional': '^21.0.1',
  '@eslint/js': '^9.39.4',
  eslint: '^9.39.4',
  'eslint-plugin-perfectionist': '^5.9.0',
  'eslint-plugin-unicorn': '^64.0.0',
  husky: '^9.1.7',
  'lint-staged': '^17.0.4',
  prettier: '^3.8.3',
  'typescript-eslint': '^8.59.3',
};

export function updatePackageJson(targetDir: string, info: ProjectInfo): void {
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;

  pkg.scripts = { ...(pkg.scripts as Record<string, string>), ...SCRIPTS };
  pkg['lint-staged'] = LINT_STAGED;

  const devDeps: Record<string, string> = { ...BASE_DEV_DEPS };
  if (info.hasReact || info.framework === 'next') {
    devDeps['eslint-plugin-react'] = '^7.37.5';
    devDeps['eslint-plugin-react-hooks'] = '^7.1.1';
  }
  if (info.framework === 'next') {
    devDeps['@next/eslint-plugin-next'] = '^16.2.6';
  }

  pkg.devDependencies = { ...(pkg.devDependencies as Record<string, string>), ...devDeps };

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
