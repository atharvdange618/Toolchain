import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import type { ProjectInfo } from '../detectors/project.js';

import { generateOxlintConfig, serializeOxlintConfig } from './oxlint.js';
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
  hasTypeScriptFiles: true,
  isMonorepo: false,
  packageManager: 'pnpm',
  unresolvedWorkspaceTypes: [],
};

const VARIANTS = [
  ['plain', BASE_INFO],
  ['express', { ...BASE_INFO, framework: 'express' }],
  ['react', { ...BASE_INFO, hasReact: true }],
  ['next', { ...BASE_INFO, framework: 'next', hasReact: true }],
  ['expo', { ...BASE_INFO, framework: 'expo', hasReact: true }],
  ['monorepo', { ...BASE_INFO, isMonorepo: true }],
] as const;

function generate(info: ProjectInfo): OxlintConfig {
  return JSON.parse(generateOxlintConfig(info)) as OxlintConfig;
}

describe('generateOxlintConfig for Expo', () => {
  const expo = { ...BASE_INFO, framework: 'expo', hasReact: true } as const;

  it('keeps plain .js files in the lint run', () => {
    const config = generate(expo);

    expect(config.ignorePatterns).not.toContain('**/*.{js,mjs,cjs}');
    expect(config.ignorePatterns).toContain('**/node_modules/**');
  });

  it('still ignores .js in every other framework', () => {
    for (const info of [BASE_INFO, { ...BASE_INFO, framework: 'next' } as const]) {
      expect(generate(info).ignorePatterns).toContain('**/*.{js,mjs,cjs}');
    }
  });

  it('allows require() and turns on the React Compiler rules at warn', () => {
    const { rules } = generate(expo);

    expect(rules['typescript/no-require-imports']).toBe('off');
    expect(rules['typescript/no-explicit-any']).toBe('error');
    expect(rules['react/purity']).toBe('warn');
    expect(rules['react/immutability']).toBe('warn');
    expect(rules['react/set-state-in-render']).toBe('warn');
  });

  it('relaxes rules-of-hooks to warn inside tests only', () => {
    const config = generateOxlintConfig(expo);
    const parsed = JSON.parse(config) as {
      overrides: { files: string[]; rules: Record<string, string> }[];
      rules: Record<string, string>;
    };

    expect(parsed.rules['react/rules-of-hooks']).toBe('error');
    expect(parsed.overrides).toEqual([
      { files: ['**/*.test.{ts,tsx}'], rules: { 'react/rules-of-hooks': 'warn' } },
    ]);
  });

  it('leaves the other frameworks without overrides', () => {
    expect(JSON.parse(generateOxlintConfig(BASE_INFO))).not.toHaveProperty('overrides');
  });
});

describe('serializeOxlintConfig', () => {
  // update will serialize a config it merged, with no ProjectInfo to hand.
  it('inlines short arrays without a framework', () => {
    const json = serializeOxlintConfig({
      overrides: [{ files: ['**/*.test.ts'], rules: {} }],
      plugins: ['a', 'b'],
    });

    expect(json).toContain('"plugins": ["a", "b"]');
    expect(json).toContain('"files": ["**/*.test.ts"]');
    expect(json.endsWith('}\n')).toBe(true);
  });
});

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

  it('turns on type-aware linting for a monorepo whose workspace imports resolve', () => {
    const config = generate({ ...BASE_INFO, isMonorepo: true });

    expect(config.options.typeAware).toBe(true);
    expect(config.rules['typescript/no-unsafe-assignment']).toBe('error');
    expect(config.rules['typescript/no-explicit-any']).toBe('error');
    expect(config.ignorePatterns).toContain('**/packages/*/dist/**');
  });

  // An unresolved import is an error type, so the no-unsafe-* rules report
  // every use of it instead of the code around it.
  it('keeps type-aware lint on when a workspace import cannot resolve', () => {
    const config = generate({
      ...BASE_INFO,
      isMonorepo: true,
      unresolvedWorkspaceTypes: ['@repo/web -> @repo/shared'],
    });

    expect(config.options.typeAware).toBe(true);
    expect(config.rules['typescript/no-unsafe-assignment']).toBe('error');
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
