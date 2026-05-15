export interface TsconfigOptions {
  isMonorepo: boolean;
}

const FLAT_CONFIG = {
  compilerOptions: {
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    module: 'ESNext',
    moduleResolution: 'bundler',
    noUncheckedIndexedAccess: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    skipLibCheck: true,
    strict: true,
    target: 'ES2022',
    verbatimModuleSyntax: true,
  },
};

const MONOREPO_ROOT_CONFIG = {
  compilerOptions: {
    composite: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    module: 'ESNext',
    moduleResolution: 'bundler',
    noUncheckedIndexedAccess: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    skipLibCheck: true,
    strict: true,
    target: 'ES2022',
    verbatimModuleSyntax: true,
  },
  references: [],
};

export function generateTsconfig(options: TsconfigOptions): string {
  const config = options.isMonorepo ? MONOREPO_ROOT_CONFIG : FLAT_CONFIG;
  return JSON.stringify(config, null, 2) + '\n';
}
