import { describe, expect, it } from 'vitest';

import { generateTsconfig } from './tsconfig.js';

describe('generateTsconfig', () => {
  it('produces valid JSON with strict compiler options', () => {
    const output = generateTsconfig();
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const compilerOptions = parsed['compilerOptions'] as Record<string, unknown>;

    expect(compilerOptions['strict']).toBe(true);
    expect(compilerOptions['noUncheckedIndexedAccess']).toBe(true);
    expect(compilerOptions['exactOptionalPropertyTypes']).toBe(true);
    expect(compilerOptions['verbatimModuleSyntax']).toBe(true);
  });

  it('omits composite and references', () => {
    const output = generateTsconfig();
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed['composite']).toBeUndefined();
    expect(parsed['references']).toBeUndefined();
  });

  it('builds a Node app from src/ into dist/ with Node module resolution', () => {
    const output = generateTsconfig({ nodeApp: true });
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const compilerOptions = parsed['compilerOptions'] as Record<string, unknown>;

    expect(compilerOptions['outDir']).toBe('dist');
    expect(compilerOptions['rootDir']).toBe('src');
    expect(compilerOptions['module']).toBe('NodeNext');
    expect(compilerOptions['moduleResolution']).toBe('NodeNext');
    expect(compilerOptions['strict']).toBe(true);
    expect(parsed['include']).toEqual(['src']);
  });

  it('ends with a trailing newline', () => {
    const output = generateTsconfig();
    expect(output.endsWith('\n')).toBe(true);
  });
});
