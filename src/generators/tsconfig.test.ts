import { describe, expect, it } from 'vitest';

import { generateTsconfig } from './tsconfig.js';

describe('generateTsconfig', () => {
  it('produces valid JSON with strict compiler options', () => {
    const output = generateTsconfig({ isMonorepo: false });
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const compilerOptions = parsed['compilerOptions'] as Record<string, unknown>;

    expect(compilerOptions['strict']).toBe(true);
    expect(compilerOptions['noUncheckedIndexedAccess']).toBe(true);
    expect(compilerOptions['exactOptionalPropertyTypes']).toBe(true);
    expect(compilerOptions['verbatimModuleSyntax']).toBe(true);
  });

  it('omits composite and references for a single-package project', () => {
    const output = generateTsconfig({ isMonorepo: false });
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed['composite']).toBeUndefined();
    expect(parsed['references']).toBeUndefined();
  });

  it('adds composite and an empty references array for a monorepo', () => {
    const output = generateTsconfig({ isMonorepo: true });
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed['composite']).toBe(true);
    expect(parsed['references']).toEqual([]);
  });

  it('ends with a trailing newline', () => {
    const output = generateTsconfig({ isMonorepo: false });
    expect(output.endsWith('\n')).toBe(true);
  });
});
