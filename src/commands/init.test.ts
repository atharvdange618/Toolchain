import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('../utils/versions.js', () => ({
  getToolchainDeps: vi.fn(() => ({ husky: '^9.0.0', typescript: '^7.0.2' })),
}));

const { execSync } = await import('node:child_process');
const { init } = await import('./init.js');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'toolchain-init-'));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.mocked(execSync).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { force: true, recursive: true });
});

describe('init package manager', () => {
  it('writes hooks for the --pm it installs with, not the detected one', async () => {
    // Detection alone would say npm here.
    vi.stubEnv('npm_config_user_agent', 'npm/10.0.0');

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    const preCommit = readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf8');
    const commitMsg = readFileSync(path.join(dir, '.husky', 'commit-msg'), 'utf8');
    expect(preCommit).toBe('pnpm exec lint-staged\npnpm run typecheck\n');
    expect(commitMsg).toBe('pnpm exec commitlint --edit "$1"\n');
    expect(execSync).toHaveBeenCalledWith('pnpm install', expect.anything());
  });

  it('falls back to the detected package manager without --pm', async () => {
    vi.stubEnv('npm_config_user_agent', 'yarn/4.0.0');

    await init({ targetDir: dir, yes: true });

    const preCommit = readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf8');
    expect(preCommit).toBe('yarn exec lint-staged\nyarn run typecheck\n');
    expect(execSync).toHaveBeenCalledWith('yarn install', expect.anything());
  });
});

describe('init with an existing project setup', () => {
  it('moves shadowing eslint.config.js, eslint.config.mjs and legacy .eslintrc aside, keeping their contents', async () => {
    writeFileSync(path.join(dir, 'eslint.config.js'), 'export default [];\n');
    writeFileSync(path.join(dir, 'eslint.config.mjs'), 'export default [];\n');
    writeFileSync(path.join(dir, '.eslintrc.json'), '{}\n');
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(existsSync(path.join(dir, 'eslint.config.js'))).toBe(false);
    expect(existsSync(path.join(dir, 'eslint.config.mjs'))).toBe(false);
    expect(existsSync(path.join(dir, '.eslintrc.json'))).toBe(false);
    expect(readFileSync(path.join(dir, 'eslint.config.js.bak'), 'utf8')).toBe(
      'export default [];\n',
    );
    expect(readFileSync(path.join(dir, 'eslint.config.mjs.bak'), 'utf8')).toBe(
      'export default [];\n',
    );
    expect(readFileSync(path.join(dir, '.eslintrc.json.bak'), 'utf8')).toBe('{}\n');
    expect(existsSync(path.join(dir, '.oxlintrc.json'))).toBe(true);
    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('Moved eslint.config.js to eslint.config.js.bak'),
    );
  });

  it('writes a tsc -b typecheck script for a tsconfig with references', async () => {
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
    );

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['typecheck']).toBe('tsc -b');
  });
});

describe('init git hooks and commitlint', () => {
  it('separates npm exec flags so commitlint receives --edit', async () => {
    await init({ pm: 'npm', targetDir: dir, yes: true });

    const commitMsg = readFileSync(path.join(dir, '.husky', 'commit-msg'), 'utf8');
    expect(commitMsg).toBe('npm exec -- commitlint --edit "$1"\n');
  });

  // A CommonJS commitlint.config.js crashes in "type": "module" projects.
  it('writes an ESM commitlint config that loads in any package type', async () => {
    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(existsSync(path.join(dir, 'commitlint.config.js'))).toBe(false);
    const config = readFileSync(path.join(dir, 'commitlint.config.mjs'), 'utf8');
    expect(config).toContain('export default');
    expect(config).not.toContain('module.exports');
  });
});

describe('init with conflicting commitlint configs', () => {
  // commitlint loads .commitlintrc* and commitlint.config.js before our .mjs,
  // so a leftover one (e.g. the CommonJS file older versions wrote) wins.
  it('moves shadowing commitlint configs aside, keeping their contents', async () => {
    writeFileSync(path.join(dir, 'commitlint.config.js'), 'module.exports = {};\n');
    writeFileSync(path.join(dir, '.commitlintrc.json'), '{}\n');

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(existsSync(path.join(dir, 'commitlint.config.js'))).toBe(false);
    expect(readFileSync(path.join(dir, 'commitlint.config.js.bak'), 'utf8')).toBe(
      'module.exports = {};\n',
    );
    expect(readFileSync(path.join(dir, '.commitlintrc.json.bak'), 'utf8')).toBe('{}\n');
    expect(existsSync(path.join(dir, 'commitlint.config.mjs'))).toBe(true);
  });

  // techtalks ships a commitlint.config.ts, which used to stay as a second config.
  it('moves a TypeScript commitlint config aside', async () => {
    writeFileSync(path.join(dir, 'commitlint.config.ts'), 'export default {};\n');

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(existsSync(path.join(dir, 'commitlint.config.ts'))).toBe(false);
    expect(existsSync(path.join(dir, 'commitlint.config.ts.bak'))).toBe(true);
  });
});

describe('init in a monorepo with no root tsconfig', () => {
  function writeWorkspace(rootScripts: Record<string, string>): void {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'monorepo', scripts: rootScripts }),
    );
    writeFileSync(
      path.join(dir, 'pnpm-workspace.yaml'),
      'packages:\n  - "apps/*"\n  - "packages/*"\n',
    );
    writeFileSync(path.join(dir, 'turbo.json'), JSON.stringify({ tasks: { build: {}, lint: {} } }));
    mkdirSync(path.join(dir, 'apps', 'api'), { recursive: true });
    writeFileSync(
      path.join(dir, 'apps', 'api', 'package.json'),
      JSON.stringify({
        devDependencies: { eslint: '^9.0.0', typescript: '^5.9.2' },
        name: 'api',
        scripts: { check: 'tsc --noEmit', lint: 'eslint .' },
      }),
    );
    writeFileSync(path.join(dir, 'apps', 'api', 'eslint.config.ts'), 'export default [];\n');
    mkdirSync(path.join(dir, 'packages', 'ui'), { recursive: true });
    writeFileSync(
      path.join(dir, 'packages', 'ui', 'package.json'),
      JSON.stringify({ devDependencies: { typescript: '^7.0.2' }, name: 'ui' }),
    );
  }

  function readScripts(): Record<string, string> {
    return (
      JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
  }

  // A root config with no include made tsc check every package with the
  // wrong options: 251 errors on techtalks.
  it('writes no root tsconfig and keeps the existing typecheck script', async () => {
    writeWorkspace({ typecheck: 'turbo run check' });

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(existsSync(path.join(dir, 'tsconfig.json'))).toBe(false);
    expect(readScripts()['typecheck']).toBe('turbo run check');
    expect(readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf8')).toBe(
      'pnpm exec lint-staged\npnpm run typecheck\n',
    );
  });

  it('warns and leaves typecheck out of the hook when there is no typecheck script', async () => {
    writeWorkspace({ build: 'turbo run build' });
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(readScripts()).not.toHaveProperty('typecheck');
    expect(readFileSync(path.join(dir, '.husky', 'pre-commit'), 'utf8')).toBe(
      'pnpm exec lint-staged\n',
    );
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('No typecheck script'));
  });

  it('lists packages that still use ESLint or pin TypeScript below 7', async () => {
    writeWorkspace({ typecheck: 'turbo run check' });
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain(
      'ESLint is still set up in workspace packages, which init leaves alone: apps/api, turbo.json lint task.',
    );
    expect(output).toContain('pin their own older typescript: apps/api (^5.9.2).');
    expect(output).not.toContain('packages/ui');
  });
});

describe('init in an unsupported project', () => {
  it('refuses a Vue project before writing anything', async () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { vue: '^3.5.0' }, name: 'demo' }),
    );
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    // Mocked exits that return let init carry on, so throw instead and check
    // the work never started.
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });

    await expect(init({ pm: 'pnpm', targetDir: dir, yes: true })).rejects.toThrow(
      'process.exit(1)',
    );

    const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(exit).toHaveBeenCalledWith(1);
    expect(output).toContain('Unsupported project: Vue (found "vue" in package.json).');
    expect(output).toContain('Vue checks its components with vue-tsc');
    expect(output).toContain('npm i -D typescript@npm:@typescript/typescript6');
    expect(existsSync(path.join(dir, '.editorconfig'))).toBe(false);
    expect(existsSync(path.join(dir, '.oxlintrc.json'))).toBe(false);
    expect(existsSync(path.join(dir, '.husky'))).toBe(false);
    expect(execSync).not.toHaveBeenCalled();
  });
});

describe('init with an existing .gitattributes', () => {
  it('writes one that keeps checkouts on LF', async () => {
    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(readFileSync(path.join(dir, '.gitattributes'), 'utf8')).toContain('* text=auto eol=lf');
  });

  // It may carry LFS filters or per-language rules that init cannot know about.
  it('leaves an existing file untouched and says so', async () => {
    writeFileSync(path.join(dir, '.gitattributes'), '*.png filter=lfs diff=lfs merge=lfs -text\n');
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(readFileSync(path.join(dir, '.gitattributes'), 'utf8')).toBe(
      '*.png filter=lfs diff=lfs merge=lfs -text\n',
    );
    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('.gitattributes already exists, leaving it alone'),
    );
  });
});

describe('init in a JavaScript-only project', () => {
  it('warns that a commit would lint nothing', async () => {
    writeFileSync(path.join(dir, 'index.js'), 'module.exports = 1;\n');
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining(
        'No TypeScript files found. The generated .oxlintrc.json ignores .js',
      ),
    );
    // The configs are still written: the project can grow into TypeScript.
    expect(existsSync(path.join(dir, '.oxlintrc.json'))).toBe(true);
  });

  it('stays quiet once a .ts file exists', async () => {
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const a = 1;\n');
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(stdout).not.toHaveBeenCalledWith(expect.stringContaining('No TypeScript files found'));
  });

  // Expo keeps .js in the lint run, so its warning would be wrong.
  it('stays quiet for an Expo project with no .ts files', async () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { expo: '^54.0.0', react: '^19.0.0' }, name: 'demo' }),
    );
    writeFileSync(path.join(dir, 'App.js'), 'export default function App() { return null; }\n');
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(stdout).not.toHaveBeenCalledWith(expect.stringContaining('No TypeScript files found'));
  });

  it('names the stacks it supports when it finishes', async () => {
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const a = 1;\n');
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    const output = [...write.mock.calls, ...log.mock.calls]
      .map(([chunk]) => String(chunk))
      .join('');
    expect(output).toContain('Supported: Next.js, Vite + React, Expo, Express');
  });
});

describe('init with a create-vite oxlint setup', () => {
  // create-vite 9 ships oxlint instead of ESLint. Our lint script replaces
  // its "oxlint" one, so its config would sit there unused.
  it('moves .oxlintrc.json aside and writes ours', async () => {
    writeFileSync(path.join(dir, '.oxlintrc.json'), '{}\n');

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(readFileSync(path.join(dir, '.oxlintrc.json'), 'utf8')).toContain('"categories"');
    expect(readFileSync(path.join(dir, '.oxlintrc.json.bak'), 'utf8')).toBe('{}\n');
  });
});

describe('init upgrading a v1 repo', () => {
  it('moves the ESLint config aside, drops ESLint deps and upgrades a TS 6 range', async () => {
    writeFileSync(path.join(dir, 'eslint.config.mjs'), 'export default [];\n');
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        devDependencies: {
          eslint: '^9.0.0',
          'eslint-import-resolver-typescript': '^4.0.0',
          typescript: '~6.0.3',
          'typescript-eslint': '^8.0.0',
        },
        name: 'demo',
      }),
    );
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies).toEqual({ husky: '^9.0.0', typescript: '^7.0.2' });
    expect(existsSync(path.join(dir, 'eslint.config.mjs.bak'))).toBe(true);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Removing ESLint devDependencies'));
    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('Upgrading typescript from ~6.0.3 to 7'),
    );
  });

  // v1 approved unrs-resolver's build for eslint-import-resolver-typescript.
  // oxlint ships prebuilt binaries, so v2 has nothing to approve.
  it('writes no pnpm-workspace.yaml for a single-package pnpm project', async () => {
    await init({ pm: 'pnpm', targetDir: dir, yes: true });

    expect(existsSync(path.join(dir, 'pnpm-workspace.yaml'))).toBe(false);
  });
});
