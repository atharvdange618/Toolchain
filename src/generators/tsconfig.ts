export interface TsconfigOptions {
  isMonorepo: boolean;
}

const COMPILER_OPTIONS = {
  esModuleInterop: true,
  forceConsistentCasingInFileNames: true,
  module: 'ESNext',
  moduleResolution: 'bundler',
  noFallthroughCasesInSwitch: true,
  noImplicitOverride: true,
  noUncheckedIndexedAccess: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  skipLibCheck: true,
  strict: true,
  target: 'ES2022',
  verbatimModuleSyntax: true,
};

export function generateTsconfig({ isMonorepo }: TsconfigOptions): string {
  const config = isMonorepo
    ? { compilerOptions: COMPILER_OPTIONS, composite: true, references: [] }
    : { compilerOptions: COMPILER_OPTIONS };
  return JSON.stringify(config, null, 2) + '\n';
}
