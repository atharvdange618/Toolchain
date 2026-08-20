import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import type { ProjectInfo } from '../detectors/project.js';

import { generateEslintConfig } from './eslint.js';
import { PRETTIERRC } from './static-configs.js';

const PRETTIER_OPTIONS = {
  ...(JSON.parse(PRETTIERRC) as Record<string, unknown>),
  parser: 'babel',
};

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

  it('adds the you-might-not-need-an-effect config wherever the react block appears', () => {
    const reactOutput = generateEslintConfig({ ...BASE_INFO, hasReact: true });
    const nextOutput = generateEslintConfig({ ...BASE_INFO, framework: 'next', hasReact: false });
    const plainOutput = generateEslintConfig(BASE_INFO);

    for (const output of [reactOutput, nextOutput]) {
      expect(output).toContain(
        "import reactYouMightNotNeedAnEffect from 'eslint-plugin-react-you-might-not-need-an-effect'",
      );
      expect(output).toContain('reactYouMightNotNeedAnEffect.configs.recommended');
    }
    expect(plainOutput).not.toContain('eslint-plugin-react-you-might-not-need-an-effect');
  });

  it('adds jsx-a11y wherever the react block appears, but not for a plain project', () => {
    const reactOutput = generateEslintConfig({ ...BASE_INFO, hasReact: true });
    const nextOutput = generateEslintConfig({ ...BASE_INFO, framework: 'next', hasReact: false });
    const plainOutput = generateEslintConfig(BASE_INFO);

    for (const output of [reactOutput, nextOutput]) {
      expect(output).toContain("import jsxA11y from 'eslint-plugin-jsx-a11y'");
      expect(output).toContain('jsxA11y.flatConfigs.recommended');
    }
    expect(plainOutput).not.toContain('eslint-plugin-jsx-a11y');
  });

  it('wires import-x with the TypeScript resolver in the base block for every project', async () => {
    const plainOutput = generateEslintConfig(BASE_INFO);
    const expressOutput = generateEslintConfig({ ...BASE_INFO, framework: 'express' });
    const config = await importGeneratedConfig(plainOutput);

    for (const output of [plainOutput, expressOutput]) {
      expect(output).toContain("import importX from 'eslint-plugin-import-x'");
      expect(output).toContain(
        "import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'",
      );
      expect(output).toContain("'import-x/no-cycle': 'warn'");
      expect(output).toContain("'import-x/no-self-import': 'error'");
    }
    // Deliberately not enabled: these overlap with what tsc already
    // guarantees via recommendedTypeChecked, and are prone to false
    // positives on TS path aliases and monorepo workspace packages.
    expect(plainOutput).not.toContain("'import-x/no-unresolved'");
    expect(Array.isArray(config)).toBe(true);
  });

  it.each([
    ['plain', BASE_INFO],
    ['express', { ...BASE_INFO, framework: 'express' }],
    ['react', { ...BASE_INFO, hasReact: true }],
    ['next', { ...BASE_INFO, framework: 'next', hasReact: true }],
    ['monorepo', { ...BASE_INFO, isMonorepo: true }],
  ] as const)(
    "generates output that already matches the tool's own .prettierrc for %s",
    async (_name, info) => {
      const output = generateEslintConfig(info);

      // Regression guard for a real bug: generateEslintConfig used to build
      // the ignores block with JSON.stringify, which always produces
      // double-quoted keys/strings and no trailing comma - conflicting with
      // the singleQuote/trailingComma settings in the .prettierrc this same
      // tool generates. Every fresh `init` shipped an eslint.config.mjs that
      // failed `prettier --check` before the user touched a line of their
      // own code. This runs the real prettier package against the real
      // generated output with the real generated .prettierrc, so any future
      // string-templating drift fails here instead of shipping.
      await expect(prettier.check(output, PRETTIER_OPTIONS)).resolves.toBe(true);
    },
  );
});
