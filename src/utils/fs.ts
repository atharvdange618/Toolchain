import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export function readOptional(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  }
}

export function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.resolve(filePath), 'utf8')) as Record<string, unknown>;
}

export function writeFile(filePath: string, content: string): void {
  const fullPath = path.resolve(filePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}
