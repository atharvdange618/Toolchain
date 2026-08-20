import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readJson, writeFile } from './fs.js';

describe('readJson', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'toolchain-fs-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it('parses a JSON file into an object', () => {
    const filePath = path.join(dir, 'data.json');
    writeFile(filePath, JSON.stringify({ name: 'test', version: '1.0.0' }));

    expect(readJson(filePath)).toEqual({ name: 'test', version: '1.0.0' });
  });

  it('throws when the file does not exist', () => {
    expect(() => readJson(path.join(dir, 'missing.json'))).toThrow();
  });
});

describe('writeFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'toolchain-fs-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it('creates parent directories that do not exist yet', () => {
    const filePath = path.join(dir, 'nested', 'deep', 'file.txt');
    writeFile(filePath, 'hello');

    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toBe('hello');
  });

  it('overwrites an existing file', () => {
    const filePath = path.join(dir, 'file.txt');
    writeFile(filePath, 'first');
    writeFile(filePath, 'second');

    expect(readFileSync(filePath, 'utf8')).toBe('second');
  });
});
