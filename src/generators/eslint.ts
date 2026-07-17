import type { ProjectInfo } from '../detectors/project.js';

function getIgnores(isMonorepo: boolean): string[] {
  const base = [
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/build/**',
    '**/*.{js,mjs,cjs}',
    '**/.pnpm-store/**',
    '**/*.config.*',
    '**/components/ui/**',
    '**/.env*',
  ];
  if (isMonorepo) base.splice(4, 0, '**/packages/**');
  return base;
}

const UNICORN_RULES = `
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-null': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/no-await-expression-member': 'off',
      'unicorn/no-thenable': 'off',
      'unicorn/no-useless-undefined': 'off',
      'unicorn/no-array-sort': 'off',
      'unicorn/import-style': 'off',
      'unicorn/no-process-exit': 'off',`;

const EXPRESS_WARN_RULES = `
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',`;

export function generateEslintConfig(info: ProjectInfo): string {
  const imports = [
    `import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import perfectionist from 'eslint-plugin-perfectionist';
import unicorn from 'eslint-plugin-unicorn';`,
  ];

  if (info.hasReact || info.framework === 'next') {
    imports.push(`import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';`);
  }
  if (info.framework === 'next') {
    imports.push(`import nextPlugin from '@next/eslint-plugin-next';`);
  }

  const ignoresObj = JSON.stringify({ ignores: getIgnores(info.isMonorepo) }, null, 2)
    .split('\n')
    .map((l) => '  ' + l)
    .join('\n');

  const sections = [
    imports.join('\n'),
    '',
    'export default tseslint.config(',
    ignoresObj + ',',
    '  js.configs.recommended,',
    '  ...tseslint.configs.recommended,',
    '  ...tseslint.configs.recommendedTypeChecked,',
    `  unicorn.configs['flat/recommended'],`,
    "  perfectionist.configs['recommended-alphabetical'],",
    `  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],${info.framework === 'express' ? EXPRESS_WARN_RULES : ''}
      ${UNICORN_RULES.trim()}
    },
  },`,
  ];

  if (info.hasReact || info.framework === 'next') {
    sections.push(`  {
    files: ['**/*.{ts,tsx}'],
    plugins: { react: reactPlugin, 'react-hooks': reactHooksPlugin },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactHooksPlugin.configs.flat.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
    settings: { react: { version: 'detect' } },
  },`);
  }

  if (info.framework === 'next') {
    sections.push(`  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },`);
  }

  if (info.isMonorepo) {
    sections.push(`  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    rules: { 'perfectionist/sort-imports': 'off' },
  },`);
  }

  sections.push(');\n');
  return sections.join('\n');
}
