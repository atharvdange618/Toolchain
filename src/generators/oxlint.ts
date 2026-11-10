import type { ProjectInfo } from '../detectors/project.js';

type RuleValue = [Severity, Record<string, unknown>] | Severity;
type Severity = 'error' | 'off' | 'warn';

function getIgnores(info: ProjectInfo): string[] {
  const base = [
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/build/**',
    // Expo config plugins, app sources and metro.config.js can all be plain
    // .js, so an Expo project keeps them in the lint run. Every other
    // framework ignores .js and lints only .ts/.tsx.
    ...(info.framework === 'expo' ? [] : ['**/*.{js,mjs,cjs}']),
    '**/.pnpm-store/**',
    '**/*.config.*',
    '**/components/ui/**',
    '**/.env*',
    '**/.expo/**',
  ];
  if (info.isMonorepo) base.splice(4, 0, '**/packages/*/dist/**');
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

const EXPO_TEST_GLOB = ['**/*.test.{ts,tsx}'];

// Expo SDK 54 and later ship the React Compiler by default, so these describe
// code that actually runs. They stay at warn: several are new enough that a
// first run over an existing app would otherwise fail on day one, and
// `lint:strict` (--deny-warnings) still turns them into errors when asked.
const EXPO_COMPILER_RULES = [
  'error-boundaries',
  'immutability',
  'incompatible-library',
  'memo-dependencies',
  'no-deriving-state-in-effects',
  'preserve-manual-memoization',
  'purity',
  'refs',
  'set-state-in-effect',
  'set-state-in-render',
  'static-components',
  'unsupported-syntax',
  'use-memo',
  'void-use-memo',
];

export function generateOxlintConfig(info: ProjectInfo): string {
  const hasReact = info.hasReact || info.framework === 'next' || info.framework === 'expo';
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
  if (info.framework === 'expo') {
    // Metro resolves assets through require(), and themed components use it.
    rules['typescript/no-require-imports'] = 'off';
    for (const rule of EXPO_COMPILER_RULES) rules[`react/${rule}`] = 'warn';
  }

  const config: Record<string, unknown> = {
    $schema: './node_modules/oxlint/configuration_schema.json',
    categories: { correctness: 'error' },
    ignorePatterns: getIgnores(info),
    options: { typeAware: !info.isMonorepo },
    plugins,
    rules,
  };
  if (info.framework === 'expo') {
    // renderHook helpers call hooks from callbacks, which the rule reads as a
    // violation. Warn so a test still surfaces it without failing the commit.
    config['overrides'] = [{ files: EXPO_TEST_GLOB, rules: { 'react/rules-of-hooks': 'warn' } }];
  }
  // JSON.stringify puts every array item on its own line, but Prettier joins
  // an array that fits in printWidth onto one. Inline the short arrays (the
  // plugins list and Expo's test glob) so a fresh `init` passes its own
  // `prettier --check`.
  const inlinePlugins = `"plugins": ${JSON.stringify(plugins).replaceAll(',', ', ')}`;
  let json = JSON.stringify(config, null, 2).replace(/"plugins": \[[^\]]*\]/, inlinePlugins);
  if (info.framework === 'expo') {
    json = json.replace(/"files": \[[^\]]*\]/, `"files": ${JSON.stringify(EXPO_TEST_GLOB)}`);
  }
  return `${json}\n`;
}
