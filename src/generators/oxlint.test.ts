import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import type { ProjectInfo } from '../detectors/project.js';

import { generateOxlintConfig } from './oxlint.js';
import { PRETTIERRC } from './static-configs.js';

interface OxlintConfig {
  ignorePatterns: string[];
  options: { typeAware: boolean };
  plugins: string[];
  rules: Record<string, unknown>;
}

const BASE_INFO: ProjectInfo = {
  framework: 'plain',
  hasProjectReferences: false,
  hasReact: false,
  hasRootTsconfig: false,
  isMonorepo: false,
  packageManager: 'pnpm',
};

const VARIANTS = [
  ['plain', BASE_INFO],
  ['express', { ...BASE_INFO, framework: 'express' }],
  ['react', { ...BASE_INFO, hasReact: true }],
  ['next', { ...BASE_INFO, framework: 'next', hasReact: true }],
  ['monorepo', { ...BASE_INFO, isMonorepo: true }],
] as const;

function generate(info: ProjectInfo): OxlintConfig {
  return JSON.parse(generateOxlintConfig(info)) as OxlintConfig;
}

describe('generateOxlintConfig', () => {
  it.each(VARIANTS)('matches the snapshot for %s', (_name, info) => {
    expect(generateOxlintConfig(info)).toMatchSnapshot();
  });

  it.each(VARIANTS)(
    "generates output that already matches the tool's own .prettierrc for %s",
    async (_name, info) => {
      // JSON.stringify puts every array item on its own line while Prettier
      // joins short arrays, so a fresh `init` could ship a config that fails
      // its own `prettier --check`.
      const options = { ...(JSON.parse(PRETTIERRC) as Record<string, unknown>), parser: 'json' };
      await expect(prettier.check(generateOxlintConfig(info), options)).resolves.toBe(true);
    },
  );

  // Oxlint refuses a whole config over one unknown rule name or bad option,
  // so a typo here would break linting in every repo `init` touches.
  it.each(VARIANTS)('generates a config oxlint accepts for %s', (_name, info) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'toolchain-oxlint-'));
    try {
      const configPath = path.join(dir, '.oxlintrc.json');
      writeFileSync(configPath, generateOxlintConfig(info));
      const oxlintBin = path.join(process.cwd(), 'node_modules', 'oxlint', 'bin', 'oxlint');

      expect(() =>
        execFileSync(process.execPath, [oxlintBin, '--print-config', '-c', configPath], {
          cwd: dir,
          stdio: 'pipe',
        }),
      ).not.toThrow();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('carries over the import rules v1 enabled', () => {
    const { rules } = generate(BASE_INFO);

    expect(rules['import/no-cycle']).toBe('warn');
    expect(rules['import/no-duplicates']).toBe('warn');
    expect(rules['import/no-self-import']).toBe('error');
  });

  it('turns on type-aware linting and its rules for a single-package project', () => {
    const config = generate(BASE_INFO);

    expect(config.options.typeAware).toBe(true);
    expect(config.rules['typescript/no-unsafe-assignment']).toBe('error');
  });

  it('leaves type-aware linting and its rules off for a monorepo', () => {
    const config = generate({ ...BASE_INFO, isMonorepo: true });

    expect(config.options.typeAware).toBe(false);
    expect(config.rules['typescript/no-unsafe-assignment']).toBeUndefined();
    expect(config.rules['typescript/no-explicit-any']).toBe('error');
    expect(config.ignorePatterns).toContain('**/packages/*/dist/**');
  });

  it('relaxes no-unsafe-* rules to warn for express projects', () => {
    const { rules } = generate({ ...BASE_INFO, framework: 'express' });

    expect(rules['typescript/no-unsafe-assignment']).toBe('warn');
    expect(rules['typescript/no-unsafe-call']).toBe('warn');
    expect(rules['typescript/no-unsafe-member-access']).toBe('warn');
    expect(rules['typescript/no-unsafe-return']).toBe('warn');
    expect(rules['typescript/no-unsafe-argument']).toBe('error');
  });

  it('adds no react or next plugins for a plain project', () => {
    const config = generate(BASE_INFO);

    expect(config.plugins).toEqual(['typescript', 'unicorn', 'import']);
    expect(config.rules['react/rules-of-hooks']).toBeUndefined();
  });

  it('adds react, jsx-a11y and rules-of-hooks when hasReact is true', () => {
    const config = generate({ ...BASE_INFO, hasReact: true });

    expect(config.plugins).toEqual(expect.arrayContaining(['react', 'jsx-a11y']));
    expect(config.plugins).not.toContain('nextjs');
    expect(config.rules['react/rules-of-hooks']).toBe('error');
  });

  it('adds the react and nextjs plugins for next even when hasReact is false', () => {
    const config = generate({ ...BASE_INFO, framework: 'next', hasReact: false });

    expect(config.plugins).toEqual(expect.arrayContaining(['react', 'jsx-a11y', 'nextjs']));
  });
});
