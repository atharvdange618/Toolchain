import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detect, pmExec } from './project.js';

let dir: string;

function touch(fileName: string): void {
  writeFileSync(path.join(dir, fileName), '');
}

function writePackageJson(content: Record<string, unknown>): void {
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(content));
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'toolchain-detect-'));
  // The real process.env['npm_config_user_agent'] reflects whatever package
  // manager is running these tests (e.g. pnpm sets it on its child
  // processes), which would otherwise leak into detection results. Stub it
  // empty by default so each test controls it explicitly.
  vi.stubEnv('npm_config_user_agent', '');
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
  vi.unstubAllEnvs();
});

describe('detect', () => {
  it('throws when there is no package.json in the target directory', () => {
    expect(() => detect(dir)).toThrow(/No package\.json found/);
  });

  it('detects a plain TypeScript project by default', () => {
    writePackageJson({ devDependencies: { typescript: '^5.0.0' } });

    const info = detect(dir);

    expect(info.framework).toBe('plain');
    expect(info.hasReact).toBe(false);
    expect(info.isMonorepo).toBe(false);
  });

  it('detects react from dependencies', () => {
    writePackageJson({ dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' } });

    const info = detect(dir);

    expect(info.framework).toBe('react');
    expect(info.hasReact).toBe(true);
  });

  it('detects next and implies react', () => {
    writePackageJson({ dependencies: { next: '^15.0.0', react: '^19.0.0' } });

    const info = detect(dir);

    expect(info.framework).toBe('next');
    expect(info.hasReact).toBe(true);
  });

  it('prefers next over react when both are present', () => {
    writePackageJson({ dependencies: { express: '^5.0.0', next: '^15.0.0', react: '^19.0.0' } });

    expect(detect(dir).framework).toBe('next');
  });

  it('detects express', () => {
    writePackageJson({ dependencies: { express: '^5.0.0' } });

    expect(detect(dir).framework).toBe('express');
  });

  it('detects a monorepo via the workspaces field', () => {
    writePackageJson({ workspaces: ['packages/*'] });

    expect(detect(dir).isMonorepo).toBe(true);
  });

  it('detects a monorepo via pnpm-workspace.yaml', () => {
    writePackageJson({});
    touch('pnpm-workspace.yaml');

    expect(detect(dir).isMonorepo).toBe(true);
  });

  it('is not a monorepo when neither signal is present', () => {
    writePackageJson({});

    expect(detect(dir).isMonorepo).toBe(false);
  });

  it('defaults to npm when nothing else indicates a package manager', () => {
    writePackageJson({});

    expect(detect(dir).packageManager).toBe('npm');
  });

  it('detects pnpm from a lockfile', () => {
    writePackageJson({});
    touch('pnpm-lock.yaml');

    expect(detect(dir).packageManager).toBe('pnpm');
  });

  it('detects yarn from a lockfile', () => {
    writePackageJson({});
    touch('yarn.lock');

    expect(detect(dir).packageManager).toBe('yarn');
  });

  it('detects bun from a lockfile', () => {
    writePackageJson({});
    touch('bun.lockb');

    expect(detect(dir).packageManager).toBe('bun');
  });

  it('prefers npm_config_user_agent over lockfiles', () => {
    writePackageJson({});
    touch('yarn.lock');
    vi.stubEnv('npm_config_user_agent', 'pnpm/9.0.0 node/v20.0.0');

    expect(detect(dir).packageManager).toBe('pnpm');
  });

  it('falls back to devEngines.packageManager.name', () => {
    writePackageJson({ devEngines: { packageManager: { name: 'bun' } } });

    expect(detect(dir).packageManager).toBe('bun');
  });
});

describe('pmExec', () => {
  it('uses "bun run" for bun', () => {
    expect(pmExec('bun')).toBe('bun run');
  });

  it('uses "<pm> exec" for everything else', () => {
    expect(pmExec('npm')).toBe('npm exec');
    expect(pmExec('pnpm')).toBe('pnpm exec');
    expect(pmExec('yarn')).toBe('yarn exec');
  });
});
