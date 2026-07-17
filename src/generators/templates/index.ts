import type { PackageManager } from '../../detectors/project.js';

export type TemplateType = 'express' | 'nextjs' | 'plain' | 'pnpm-monorepo' | 'react' | 'turbo';

export const TEMPLATES: readonly TemplateType[] = [
  'plain',
  'react',
  'nextjs',
  'express',
  'pnpm-monorepo',
  'turbo',
];

export const TEMPLATE_DESCRIPTIONS: Record<TemplateType, string> = {
  express: 'Express 4 REST API with TypeScript',
  nextjs: 'Next.js 15 with App Router (via create-next-app)',
  plain: 'Basic TypeScript project',
  'pnpm-monorepo': 'pnpm workspaces monorepo',
  react: 'React 19 with Vite and TypeScript (via create-vite)',
  turbo: 'Turborepo monorepo with packages',
};

export interface TemplateContext {
  packageManager: PackageManager;
  projectName: string;
  targetDir: string;
}

export interface TemplateResult {
  files: Array<{ content: string; path: string; }>;
  framework: 'express' | 'next' | 'plain' | 'react';
  hasReact: boolean;
  isMonorepo: boolean;
  packageJson: Record<string, unknown>;

  scaffold?: (ctx: TemplateContext) => void;
}
