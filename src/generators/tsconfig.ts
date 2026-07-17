export interface TsconfigOptions {
  isMonorepo: boolean;
}

const COMPILER_OPTIONS = {
  // Strict mode
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noFallthroughCasesInSwitch: true,
  noUncheckedIndexedAccess: true,

  // Code quality
  noImplicitOverride: true,
  exactOptionalPropertyTypes: true,
  noPropertyAccessFromIndexSignature: true,

  // Module system
  esModuleInterop: true,
  forceConsistentCasingInFileNames: true,
  module: 'ESNext',
  moduleResolution: 'bundler',
  verbatimModuleSyntax: true,

  // Target
  target: 'ES2022',

  // Performance
  skipLibCheck: true,
};

export function generateTsconfig({ isMonorepo }: TsconfigOptions): string {
  const config = isMonorepo
    ? { compilerOptions: COMPILER_OPTIONS, composite: true, references: [] }
    : { compilerOptions: COMPILER_OPTIONS };
  return JSON.stringify(config, null, 2) + '\n';
}
