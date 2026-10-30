import type { ProjectInfo } from '../detectors/project.js';

type RuleValue = [Severity, Record<string, unknown>] | Severity;
type Severity = 'error' | 'off' | 'warn';

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
    '**/.expo/**',
  ];
  if (isMonorepo) base.splice(4, 0, '**/packages/*/dist/**');
  return base;
}

// v1 ran typescript-eslint's recommended + recommendedTypeChecked presets.
// Oxlint's default correctness category already covers most of both; these
// are the rest, so v2 enforces the same TypeScript rules v1 did.
const TS_RECOMMENDED_RULES = [
  'ban-ts-comment',
  'no-empty-object-type',
  'no-explicit-any',
  'no-namespace',
  'no-require-imports',
  'no-unnecessary-type-constraint',
  'no-unsafe-function-type',
];

const TS_TYPE_CHECKED_RULES = [
  'no-misused-promises',
  'no-unnecessary-type-assertion',
  'no-unsafe-argument',
  'no-unsafe-assignment',
  'no-unsafe-call',
  'no-unsafe-enum-comparison',
  'no-unsafe-member-access',
  'no-unsafe-return',
  'only-throw-error',
  'prefer-promise-reject-errors',
  'require-await',
  'restrict-plus-operands',
];

const EXPRESS_WARN_RULES = new Set([
  'no-unsafe-assignment',
  'no-unsafe-call',
  'no-unsafe-member-access',
  'no-unsafe-return',
]);

export function generateOxlintConfig(info: ProjectInfo): string {
  const hasReact = info.hasReact || info.framework === 'next';
  const plugins = ['typescript', 'unicorn', 'import'];
  if (hasReact) plugins.push('react', 'jsx-a11y');
  if (info.framework === 'next') plugins.push('nextjs');

  const rules: Record<string, RuleValue> = {
    'eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // no-cycle is off in every preset (expensive), but import cycles are
    // exactly the kind of bug tsc won't catch. v1's
    // import-x/no-useless-path-segments has no oxlint port yet.
    'import/no-cycle': 'warn',
    'import/no-duplicates': 'warn',
    'import/no-self-import': 'error',
    'unicorn/no-thenable': 'off',
  };
  for (const rule of TS_RECOMMENDED_RULES) rules[`typescript/${rule}`] = 'error';
  // Monorepo packages must be built before type-aware rules can resolve
  // their imports, so v1 and v2 both leave them off there.
  if (!info.isMonorepo) {
    for (const rule of TS_TYPE_CHECKED_RULES) {
      rules[`typescript/${rule}`] =
        info.framework === 'express' && EXPRESS_WARN_RULES.has(rule) ? 'warn' : 'error';
    }
  }
  if (hasReact) rules['react/rules-of-hooks'] = 'error';

  const config = {
    $schema: './node_modules/oxlint/configuration_schema.json',
    categories: { correctness: 'error' },
    ignorePatterns: getIgnores(info.isMonorepo),
    options: { typeAware: !info.isMonorepo },
    plugins,
    rules,
  };
  // JSON.stringify puts every array item on its own line, but Prettier joins
  // an array that fits in printWidth onto one. Inline the short plugins list
  // so a fresh `init` passes its own `prettier --check`.
  const inlinePlugins = `"plugins": ${JSON.stringify(plugins).replaceAll(',', ', ')}`;
  return JSON.stringify(config, null, 2).replace(/"plugins": \[[^\]]*\]/, inlinePlugins) + '\n';
}
