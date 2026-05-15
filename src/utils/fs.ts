import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function fileExists(filePath: string): boolean {
  return existsSync(path.resolve(filePath));
}

export function readFile(filePath: string): string {
  return readFileSync(path.resolve(filePath), 'utf8');
}

export function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.resolve(filePath), 'utf8')) as Record<string, unknown>;
}

export function writeFile(filePath: string, content: string): void {
  const fullPath = path.resolve(filePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}
