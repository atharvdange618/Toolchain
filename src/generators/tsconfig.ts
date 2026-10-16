export interface TsconfigOptions {
  isMonorepo: boolean;
  // A Node app built with tsc and run from dist/, as the plain and express
  // templates are. Bundler resolution would accept extensionless imports
  // that Node then fails to load at runtime.
  nodeApp?: boolean;
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

const NODE_APP_OPTIONS = {
  module: 'NodeNext',
  moduleResolution: 'NodeNext',
  outDir: 'dist',
  rootDir: 'src',
};

export function generateTsconfig({ isMonorepo, nodeApp = false }: TsconfigOptions): string {
  if (isMonorepo) {
    const config = { compilerOptions: { ...COMPILER_OPTIONS, composite: true }, references: [] };
    return JSON.stringify(config, null, 2) + '\n';
  }
  const config = nodeApp
    ? { compilerOptions: { ...COMPILER_OPTIONS, ...NODE_APP_OPTIONS }, include: ['src'] }
    : { compilerOptions: COMPILER_OPTIONS };
  return JSON.stringify(config, null, 2) + '\n';
}
