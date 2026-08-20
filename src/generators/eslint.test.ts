import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { ProjectInfo } from '../detectors/project.js';

import { generateEslintConfig } from './eslint.js';

const BASE_INFO: ProjectInfo = {
  framework: 'plain',
  hasReact: false,
  isMonorepo: false,
  packageManager: 'pnpm',
};

// Writes the generated config next to node_modules and imports it for real,
// so a change that produces invalid JS (a real risk with string-templated
// codegen) fails the test instead of only being caught by eyeballing output.
async function importGeneratedConfig(source: string): Promise<unknown> {
  const filePath = path.join(
    process.cwd(),
    `.tmp-eslint-config-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  writeFileSync(filePath, source, 'utf8');
  try {
    const mod = (await import(pathToFileURL(filePath).href)) as { default: unknown };
    return mod.default;
  } finally {
    rmSync(filePath, { force: true });
  }
}

describe('generateEslintConfig', () => {
  it('generates a config that is valid, importable JS for a plain project', async () => {
    const output = generateEslintConfig(BASE_INFO);
    const config = await importGeneratedConfig(output);

    expect(Array.isArray(config)).toBe(true);
  });

  it('includes recommendedTypeChecked and projectService for a single-package project', () => {
    const output = generateEslintConfig(BASE_INFO);

    expect(output).toContain('tseslint.configs.recommendedTypeChecked');
    expect(output).toContain('projectService: true');
  });

  it('omits type-checked rules and projectService for a monorepo', async () => {
    const output = generateEslintConfig({ ...BASE_INFO, isMonorepo: true });
    const config = await importGeneratedConfig(output);

    expect(output).not.toContain('tseslint.configs.recommendedTypeChecked');
    expect(output).not.toContain('projectService: true');
    expect(Array.isArray(config)).toBe(true);
  });

  it('adds the packages ignore glob and a perfectionist override for a monorepo', () => {
    const output = generateEslintConfig({ ...BASE_INFO, isMonorepo: true });

    expect(output).toContain('**/packages/*/dist/**');
    expect(output).toContain("files: ['packages/*/src/**/*.{ts,tsx}']");
    expect(output).toContain("'perfectionist/sort-imports': 'off'");
  });

  it('relaxes unsafe-* rules to warn for express projects', () => {
    const output = generateEslintConfig({ ...BASE_INFO, framework: 'express' });

    expect(output).toContain("'@typescript-eslint/no-unsafe-assignment': 'warn'");
    expect(output).toContain("'@typescript-eslint/no-unsafe-call': 'warn'");
  });

  it('does not add react or next plugins for a plain project', () => {
    const output = generateEslintConfig(BASE_INFO);

    expect(output).not.toContain('eslint-plugin-react');
    expect(output).not.toContain('@next/eslint-plugin-next');
  });

  it('adds react and react-hooks plugins when hasReact is true', () => {
    const output = generateEslintConfig({ ...BASE_INFO, hasReact: true });

    expect(output).toContain("import reactPlugin from 'eslint-plugin-react'");
    expect(output).toContain("import reactHooksPlugin from 'eslint-plugin-react-hooks'");
    expect(output).toContain("'react/react-in-jsx-scope': 'off'");
  });

  it('adds the next plugin and core-web-vitals rules for a next project', () => {
    const output = generateEslintConfig({ ...BASE_INFO, framework: 'next', hasReact: true });

    expect(output).toContain("import nextPlugin from '@next/eslint-plugin-next'");
    expect(output).toContain("nextPlugin.configs['core-web-vitals'].rules");
  });

  it('adds the next plugin even when hasReact is false but framework is next', () => {
    const output = generateEslintConfig({ ...BASE_INFO, framework: 'next', hasReact: false });

    expect(output).toContain("import reactPlugin from 'eslint-plugin-react'");
    expect(output).toContain("import nextPlugin from '@next/eslint-plugin-next'");
  });
});
