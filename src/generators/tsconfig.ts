export interface TsconfigOptions {
  isMonorepo: boolean;
}

const COMPILER_OPTIONS = {
  // Module system
  esModuleInterop: true,
  exactOptionalPropertyTypes: true,
  forceConsistentCasingInFileNames: true,
  module: 'ESNext',
  moduleResolution: 'bundler',

  noFallthroughCasesInSwitch: true,
  // Code quality
  noImplicitOverride: true,
  noPropertyAccessFromIndexSignature: true,

  noUncheckedIndexedAccess: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  // Performance
  skipLibCheck: true,
  // Strict mode
  strict: true,

  // Target
  target: 'ES2022',

  verbatimModuleSyntax: true,
};

export function generateTsconfig({ isMonorepo }: TsconfigOptions): string {
  const config = isMonorepo
    ? { compilerOptions: COMPILER_OPTIONS, composite: true, references: [] }
    : { compilerOptions: COMPILER_OPTIONS };
  return JSON.stringify(config, null, 2) + '\n';
}
