import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detect, detectPackageManager, pmExec, workspacePackageDirs } from './project.js';

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

  // An Expo app also depends on react and react-dom, so it has to win.
  it('detects expo as its own framework and still sees react', () => {
    writePackageJson({
      dependencies: { expo: '^54.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' },
    });

    const info = detect(dir);

    expect(info.framework).toBe('expo');
    expect(info.hasReact).toBe(true);
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
    writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');

    expect(detect(dir).isMonorepo).toBe(true);
  });

  // v1 wrote allowBuilds into pnpm-workspace.yaml for single-package pnpm
  // projects, so the file alone can't mean "monorepo".
  it('is not a monorepo when pnpm-workspace.yaml only holds settings', () => {
    writePackageJson({});
    writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'allowBuilds:\n  unrs-resolver: true\n');

    expect(detect(dir).isMonorepo).toBe(false);
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

describe('detectPackageManager', () => {
  it('reports which signal chose the manager', () => {
    writePackageJson({});
    expect(detectPackageManager(dir, {})).toEqual({
      packageManager: 'npm',
      source: 'default',
    });

    touch('yarn.lock');
    expect(detectPackageManager(dir, {})).toEqual({
      packageManager: 'yarn',
      source: 'lockfile',
    });
  });

  it('reports devEngines as the source when no lockfile exists', () => {
    expect(detectPackageManager(dir, { devEngines: { packageManager: { name: 'pnpm' } } })).toEqual(
      { packageManager: 'pnpm', source: 'devEngines' },
    );
  });

  it('treats package-lock.json as an npm lockfile rather than a default', () => {
    touch('package-lock.json');

    expect(detectPackageManager(dir, {})).toEqual({
      packageManager: 'npm',
      source: 'lockfile',
    });
  });

  it('accepts npm in devEngines instead of treating it as absent', () => {
    expect(detectPackageManager(dir, { devEngines: { packageManager: { name: 'npm' } } })).toEqual({
      packageManager: 'npm',
      source: 'devEngines',
    });
  });

  it('reports the user agent as the source when init is allowed to read it', () => {
    writePackageJson({});
    vi.stubEnv('npm_config_user_agent', 'pnpm/9.0.0 node/v20.0.0');

    expect(detectPackageManager(dir, {})).toEqual({
      packageManager: 'pnpm',
      source: 'user-agent',
    });
  });

  // doctor and update pass useUserAgent: false: the shell that ran the CLI
  // must not rewrite hooks generated for the project's own manager.
  it('ignores the user agent when asked, letting the lockfile decide', () => {
    writePackageJson({});
    touch('yarn.lock');
    vi.stubEnv('npm_config_user_agent', 'pnpm/9.0.0 node/v20.0.0');

    expect(detectPackageManager(dir, {}, undefined, { useUserAgent: false })).toEqual({
      packageManager: 'yarn',
      source: 'lockfile',
    });
  });
});

describe('detect hasTypeScriptFiles', () => {
  it('reports a project with a .ts file and one without', () => {
    writePackageJson({});
    expect(detect(dir).hasTypeScriptFiles).toBe(false);

    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const a = 1;\n');

    expect(detect(dir).hasTypeScriptFiles).toBe(true);
  });

  it.each(['.tsx', '.mts', '.cts'])('counts a %s file', (ext) => {
    writePackageJson({});
    writeFileSync(path.join(dir, `main${ext}`), '');

    expect(detect(dir).hasTypeScriptFiles).toBe(true);
  });

  it('ignores TypeScript inside node_modules and build output', () => {
    writePackageJson({});
    for (const sub of [
      ['node_modules', 'dep', 'index.d.ts'],
      ['dist', 'index.ts'],
    ] as const) {
      const target = path.join(dir, ...sub);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, '');
    }

    expect(detect(dir).hasTypeScriptFiles).toBe(false);
  });

  it('does not count a lone .js file', () => {
    writePackageJson({});
    writeFileSync(path.join(dir, 'index.js'), 'module.exports = 1;\n');

    expect(detect(dir).hasTypeScriptFiles).toBe(false);
  });
});

describe('detect unsupported stacks', () => {
  it.each([
    ['@angular/core', 'Angular', 'ngc'],
    ['vue', 'Vue', 'vue-tsc'],
    ['nuxt', 'Nuxt', 'vue-tsc'],
    ['svelte', 'Svelte', 'svelte-check'],
    ['@sveltejs/kit', 'SvelteKit', 'svelte-check'],
    ['astro', 'Astro', 'astro check'],
  ])('flags %s as %s', (dep, name, checker) => {
    writePackageJson({ dependencies: { [dep]: '^1.0.0' } });

    expect(detect(dir).unsupported).toEqual({ checker, name, package: dep });
  });

  it('reads devDependencies too', () => {
    writePackageJson({ devDependencies: { '@angular/core': '^20.0.0' } });

    expect(detect(dir).unsupported?.name).toBe('Angular');
  });

  // Angular wins because its template checker is the one that goes furthest
  // past tsc; a Vue app that also lists Angular by accident is still Angular.
  it('reports Angular when several unsupported stacks are present', () => {
    writePackageJson({ dependencies: { '@angular/core': '^20.0.0', vue: '^3.5.0' } });

    expect(detect(dir).unsupported?.name).toBe('Angular');
  });

  it('flags neither an Expo app nor a Next app', () => {
    writePackageJson({ dependencies: { expo: '^54.0.0', react: '^19.0.0' } });
    expect(detect(dir).unsupported).toBeUndefined();

    writePackageJson({ dependencies: { next: '^15.0.0', react: '^19.0.0' } });
    expect(detect(dir).unsupported).toBeUndefined();
  });
});

describe('pmExec', () => {
  it('uses "bun run" for bun', () => {
    expect(pmExec('bun')).toBe('bun run');
  });

  // Without -- npm parses flags meant for the command, so
  // "npm exec commitlint --edit $1" never passes --edit to commitlint.
  it('ends npm exec with -- so flags reach the command', () => {
    expect(pmExec('npm')).toBe('npm exec --');
  });

  it('uses "<pm> exec" for pnpm and yarn', () => {
    expect(pmExec('pnpm')).toBe('pnpm exec');
    expect(pmExec('yarn')).toBe('yarn exec');
  });
});

describe('detect project references', () => {
  it('flags a create-vite style tsconfig, comments and all', () => {
    writePackageJson({});
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      '{\n  // solution-style root\n  "files": [],\n  "references": [\n    { "path": "./tsconfig.app.json" }\n  ]\n}\n',
    );

    expect(detect(dir).hasProjectReferences).toBe(true);
  });

  it('ignores an empty references array like the monorepo tsconfig we generate', () => {
    writePackageJson({});
    writeFileSync(path.join(dir, 'tsconfig.json'), '{ "compilerOptions": {}, "references": [] }');

    expect(detect(dir).hasProjectReferences).toBe(false);
  });

  it('is false when there is no tsconfig.json', () => {
    writePackageJson({});

    expect(detect(dir).hasProjectReferences).toBe(false);
  });
});

describe('detect hasRootTsconfig', () => {
  it('reports whether a root tsconfig.json exists before init writes one', () => {
    writePackageJson({});
    expect(detect(dir).hasRootTsconfig).toBe(false);
    touch('tsconfig.json');
    expect(detect(dir).hasRootTsconfig).toBe(true);
  });
});

describe('workspacePackageDirs', () => {
  function addPackage(rel: string): void {
    mkdirSync(path.join(dir, rel), { recursive: true });
    writeFileSync(path.join(dir, rel, 'package.json'), '{}');
  }

  it('expands npm workspaces, keeping only folders with a package.json', () => {
    writePackageJson({ workspaces: ['apps/*', 'tools/cli', 'libs/**'] });
    addPackage('apps/web');
    addPackage('tools/cli');
    addPackage('libs/deep/pkg');
    mkdirSync(path.join(dir, 'apps', 'not-a-package'), { recursive: true });

    expect(workspacePackageDirs(dir)).toEqual(['apps/web', 'tools/cli']);
  });

  it("reads pnpm-workspace.yaml's packages list and stops at the next key", () => {
    writePackageJson({});
    writeFileSync(
      path.join(dir, 'pnpm-workspace.yaml'),
      "packages:\r\n  - 'packages/*'\r\n\r\nallowBuilds:\r\n  - esbuild\r\n",
    );
    addPackage('packages/ui');

    expect(workspacePackageDirs(dir)).toEqual(['packages/ui']);
  });
});

describe('unresolvedWorkspaceTypes', () => {
  function addPackage(rel: string, pkg: Record<string, unknown>, tsconfig?: string): void {
    mkdirSync(path.join(dir, rel), { recursive: true });
    writeFileSync(path.join(dir, rel, 'package.json'), JSON.stringify(pkg));
    if (tsconfig) writeFileSync(path.join(dir, rel, 'tsconfig.json'), tsconfig);
  }

  function addWebApp(tsconfig: string): void {
    addPackage(
      'apps/web',
      { dependencies: { '@repo/shared': 'workspace:*' }, name: '@repo/web' },
      tsconfig,
    );
  }

  const SHARED = {
    main: 'dist/index.js',
    name: '@repo/shared',
    types: 'dist/index.d.ts',
  };

  beforeEach(() => {
    writePackageJson({ workspaces: ['apps/*', 'packages/*'] });
    addPackage('packages/shared', SHARED);
  });

  // tsgolint follows a reference to the dependency's source, so a monorepo
  // that references its packages lints type-aware with nothing built.
  it('accepts a tsconfig reference to the package', () => {
    addWebApp('{ "compilerOptions": {}, "references": [{ "path": "../../packages/shared" }] }');

    expect(detect(dir).unresolvedWorkspaceTypes).toEqual([]);
  });

  it('accepts a built dependency', () => {
    addWebApp('{ "compilerOptions": {} }');
    mkdirSync(path.join(dir, 'packages', 'shared', 'dist'), { recursive: true });
    writeFileSync(path.join(dir, 'packages', 'shared', 'dist', 'index.d.ts'), '');

    expect(detect(dir).unresolvedWorkspaceTypes).toEqual([]);
  });

  it('lists a workspace import with neither a reference nor built types', () => {
    addWebApp('{ "compilerOptions": {} }');

    expect(detect(dir).unresolvedWorkspaceTypes).toEqual(['@repo/web -> @repo/shared']);
  });

  it('ignores dependencies that are not workspace packages', () => {
    addPackage(
      'apps/web',
      { dependencies: { react: '^19.0.0' }, name: '@repo/web' },
      '{ "compilerOptions": {} }',
    );

    expect(detect(dir).unresolvedWorkspaceTypes).toEqual([]);
  });

  it('ignores a package with no tsconfig of its own', () => {
    addPackage('apps/web', { dependencies: { '@repo/shared': 'workspace:*' }, name: '@repo/web' });

    expect(detect(dir).unresolvedWorkspaceTypes).toEqual([]);
  });

  it('accepts a package that declares no type entry to resolve', () => {
    addPackage('packages/shared', { name: '@repo/shared' });
    addWebApp('{ "compilerOptions": {} }');

    expect(detect(dir).unresolvedWorkspaceTypes).toEqual([]);
  });

  it('is empty for a single-package project', () => {
    rmSync(path.join(dir, 'pnpm-workspace.yaml'), { force: true });
    writePackageJson({ name: 'single' });

    expect(detect(dir).unresolvedWorkspaceTypes).toEqual([]);
  });
});
