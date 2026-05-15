import type { ProjectInfo } from '../detectors/project.js';

const IMPORTS_BASE = `import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import perfectionist from 'eslint-plugin-perfectionist';
import unicorn from 'eslint-plugin-unicorn';`;

const IMPORTS_REACT = `import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';`;

const IMPORTS_NEXT = `import nextPlugin from '@next/eslint-plugin-next';`;

const CONFIG_IGNORES = `  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/*.{js,mjs,cjs}',
      '**/.pnpm-store/**',
      '**/*.config.*',
      '**/components/ui/**',
      '**/.env*',
    ],
  },`;

const CONFIG_IGNORES_MONOREPO = `  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/packages/**',
      '**/*.{js,mjs,cjs}',
      '**/.pnpm-store/**',
      '**/*.config.*',
      '**/components/ui/**',
      '**/.env*',
    ],
  },`;

const TS_RULES_BLOCK = `  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {`;

const EXPRESS_WARN_RULES = `      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',`;

const UNICORN_OVERRIDES = `      'unicorn/prevent-abbreviations': 'off',
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
      'unicorn/import-style': 'off',`;

const REACT_RULES_BLOCK = `  {
    files: ['**/*.{ts,tsx}'],
    plugins: { react: reactPlugin, 'react-hooks': reactHooksPlugin },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactHooksPlugin.configs.flat.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
    settings: { react: { version: 'detect' } },
  },`;

const NEXT_RULES_BLOCK = `  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },`;

export function generateEslintConfig(info: ProjectInfo): string {
  const lines: string[] = [];

  // --- Imports ---
  const imports = [IMPORTS_BASE];
  if (info.hasReact || info.framework === 'next') {
    imports.push(IMPORTS_REACT);
  }
  if (info.framework === 'next') {
    imports.push(IMPORTS_NEXT);
  }
  lines.push(
    imports.join('\n'),
    '',
    'export default tseslint.config(',
    info.isMonorepo ? CONFIG_IGNORES_MONOREPO : CONFIG_IGNORES,
    '  js.configs.recommended,',
    '  ...tseslint.configs.recommended,',
    '  ...tseslint.configs.recommendedTypeChecked,',
    `  unicorn.configs['flat/recommended'],`,
    "  perfectionist.configs['recommended-alphabetical'],",
    TS_RULES_BLOCK,
    `      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],`,
  );
  if (info.framework === 'express') {
    lines.push(EXPRESS_WARN_RULES);
  }
  lines.push('', UNICORN_OVERRIDES, '    },', '  },');

  // React rules
  if (info.hasReact || info.framework === 'next') {
    lines.push('', REACT_RULES_BLOCK);
  }

  // Next.js rules
  if (info.framework === 'next') {
    lines.push(NEXT_RULES_BLOCK);
  }

  // Monorepo per-package overrides
  if (info.isMonorepo) {
    lines.push(`  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    rules: { 'perfectionist/sort-imports': 'off' },
  },`);
  }

  lines.push(');\n');
  return lines.join('\n');
}
