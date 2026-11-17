import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { hashEntry, parseManifest, serializeManifest } from '../manifest/manifest.js';
import * as writer from '../manifest/write.js';
import { getToolchainDeps, TOOLCHAIN_DEP_NAMES } from '../utils/versions.js';
import { doctor } from './doctor.js';
import { init } from './init.js';
import { update } from './update.js';

vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }));
vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('../utils/versions.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/versions.js')>();
  return {
    ...original,
    getToolchainDeps: vi.fn((names: readonly string[] = original.TOOLCHAIN_DEP_NAMES) =>
      Object.fromEntries(names.map((name) => [name, '^7.0.2'])),
    ),
  };
});

let dir: string;
let output: MockInstance<typeof process.stdout.write>;
let errors: MockInstance<typeof process.stderr.write>;
let select: MockInstance<typeof prompts.prompts.select>;
const originalTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

function put(file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}
function read(file: string): string {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}
function json(file: string): Record<string, unknown> {
  return JSON.parse(read(file)) as Record<string, unknown>;
}
function putJson(file: string, value: unknown): void {
  put(file, `${JSON.stringify(value, null, 2)}\n`);
}
function editPackage(edit: (pkg: Record<string, unknown>) => void): void {
  const pkg = json('package.json');
  edit(pkg);
  putJson('package.json', pkg);
}
function base(file: string, value: string | undefined): void {
  const document = parseManifest(read('.toolchain.json')) ?? { entries: {} };
  const hash = hashEntry(file, value);
  if (hash === undefined) delete document.entries[file];
  else document.entries[file] = hash;
  put('.toolchain.json', serializeManifest(document));
}
function stale(file = '.prettierrc'): void {
  put(file, 'old\n');
  base(file, 'old\n');
}
function conflict(file = '.prettierrc'): void {
  base(file, 'old\n');
  put(file, 'local\n');
}
function files(root = dir): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) Object.assign(result, files(file));
    else result[path.relative(dir, file)] = fs.readFileSync(file).toString('base64');
  }
  return result;
}
function stderr(): string {
  return errors.mock.calls.map(([text]) => String(text)).join('');
}
function stdout(): string {
  return output.mock.calls.map(([text]) => String(text)).join('');
}
async function run(yes = true, pm = 'pnpm'): Promise<number> {
  return update({ targetDir: dir, yes, pm });
}
async function fresh(pkg: Record<string, unknown>): Promise<void> {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  putJson('package.json', pkg);
  await init({ targetDir: dir, yes: true, pm: 'pnpm' });
  vi.mocked(execSync).mockClear();
  vi.mocked(getToolchainDeps).mockClear();
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(tmpdir(), 'toolchain-update-'));
  output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  errors = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, get: () => true });
  select = vi.spyOn(prompts.prompts, 'select').mockImplementation(() => 'keep');
  vi.mocked(execSync).mockReset();
  vi.mocked(getToolchainDeps)
    .mockReset()
    .mockImplementation((names = TOOLCHAIN_DEP_NAMES) =>
      Object.fromEntries(names.map((name) => [name, '^7.0.2'])),
    );
  await fresh({ name: 'demo' });
  output.mockClear();
});
afterEach(() => {
  Reflect.deleteProperty(prompts, '_injected');
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (originalTTY) Object.defineProperty(process.stdin, 'isTTY', originalTTY);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('update decisions and adoption', () => {
  it('updates a genuinely stale hook while retaining a local rule edit', async () => {
    const config = json('.oxlintrc.json');
    (config['rules'] as Record<string, unknown>)['typescript/no-explicit-any'] = 'off';
    putJson('.oxlintrc.json', config);
    stale('.husky/pre-commit');
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(1);
    expect(await run()).toBe(0);
    expect(read('.husky/pre-commit')).toContain('pnpm run typecheck');
    expect(
      (json('.oxlintrc.json')['rules'] as Record<string, unknown>)['typescript/no-explicit-any'],
    ).toBe('off');
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
  });

  it('adopts matches and safe creations under --yes, leaving unknown origins unrecorded', async () => {
    fs.rmSync(path.join(dir, '.toolchain.json'));
    put('.prettierrc', 'local\n');
    fs.rmSync(path.join(dir, '.editorconfig'));
    expect(await run()).toBe(0);
    const manifest = parseManifest(read('.toolchain.json'))?.entries;
    expect(manifest?.['.prettierrc']).toBeUndefined();
    expect(manifest?.['.editorconfig']).toBe(hashEntry('.editorconfig', read('.editorconfig')));
    expect(manifest?.['.prettierignore']).toBeDefined();
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(1);
    expect(stdout()).toContain('Kept');
  });

  it('records interactive keep as an accepted local edit', async () => {
    fs.rmSync(path.join(dir, '.toolchain.json'));
    put('.prettierrc', 'local\n');
    expect(await run(false)).toBe(0);
    expect(read('.prettierrc')).toBe('local\n');
    expect(select).toHaveBeenCalledTimes(1);
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
  });

  it('backs up the entire JSON file once before a selected rule overwrite', async () => {
    const config = json('.oxlintrc.json');
    (config['rules'] as Record<string, unknown>)['typescript/no-explicit-any'] = 'off';
    putJson('.oxlintrc.json', config);
    base('.oxlintrc.json#rules.typescript/no-explicit-any', '"warn"');
    const original = read('.oxlintrc.json');
    select.mockImplementation(() => 'overwrite');
    expect(await run(false)).toBe(0);
    expect(read('.oxlintrc.json.bak')).toBe(original);
    expect(fs.existsSync(path.join(dir, '.oxlintrc.json.bak.1'))).toBe(false);
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
  });

  it('cancels after package choices but before any content or manifest write', async () => {
    editPackage((pkg) => {
      (pkg['scripts'] as Record<string, string>)['lint'] = 'custom';
    });
    base('package.json#scripts.lint', '"old"');
    conflict('.husky/pre-commit');
    const before = files();
    prompts.inject(['overwrite', new Error('cancel')]);
    expect(await run(false)).toBe(1);
    expect(files()).toEqual(before);
    expect(stderr()).toContain('cancelled');
    expect(execSync).not.toHaveBeenCalled();
  });

  it('fails before writing when a non-TTY needs a choice', async () => {
    vi.spyOn(process.stdin, 'isTTY', 'get').mockReturnValue(false);
    conflict();
    const before = files();
    expect(await run(false)).toBe(1);
    expect(files()).toEqual(before);
    expect(stderr()).toContain('has no terminal to ask');
  });

  it('keeps --yes conflicts and their old base so doctor still fails', async () => {
    conflict();
    const manifest = read('.toolchain.json');
    expect(await run()).toBe(0);
    expect(read('.prettierrc')).toBe('local\n');
    expect(read('.toolchain.json')).toBe(manifest);
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(1);
  });
});

describe('--keep and --overwrite', () => {
  function unknown(file: string): void {
    base(file, undefined);
    put(file, 'local\n');
  }
  function noTTY(): void {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, get: () => false });
  }
  async function flagged(keep: string[], overwrite: string[] = [], yes = false): Promise<number> {
    return update({ targetDir: dir, pm: 'pnpm', yes, keep, overwrite });
  }
  function expectNothingRan(before: Record<string, string>): void {
    expect(files()).toEqual(before);
    expect(getToolchainDeps).not.toHaveBeenCalled();
    expect(execSync).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  }

  it('records a flag keep without a terminal so doctor passes', async () => {
    const generated = read('.prettierrc');
    unknown('.prettierrc');
    noTTY();
    expect(await flagged(['.prettierrc'])).toBe(0);
    // Like an interactive keep, the recorded base is the generator's value.
    expect(parseManifest(read('.toolchain.json'))?.entries['.prettierrc']).toBe(
      hashEntry('.prettierrc', generated),
    );
    expect(read('.prettierrc')).toBe('local\n');
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });

  it('rejects a cross-file wildcard before reading the project', async () => {
    unknown('.prettierrc');
    noTTY();
    const before = files();
    expect(await flagged(['*'])).toBe(1);
    expect(stderr()).toMatch(/file name before # must be literal/);
    expectNothingRan(before);
  });

  it('rejects a keep that matches nothing', async () => {
    unknown('.prettierrc');
    noTTY();
    const before = files();
    expect(await flagged(['.prettierrc', '.nope'])).toBe(1);
    expect(stderr()).toContain("No differing entry matches --keep '.nope'");
    expectNothingRan(before);
  });

  it('reports a typo instead of a retry when another row is still open', async () => {
    unknown('.prettierrc');
    unknown('.editorconfig');
    noTTY();
    const before = files();
    expect(await flagged(['.nope', '.prettierrc'])).toBe(1);
    expect(stderr()).toContain("No differing entry matches --keep '.nope'");
    expect(stderr()).not.toContain('Rerun with a choice');
    expectNothingRan(before);
  });

  it('does not report a hook keep as unused after the first pass', async () => {
    unknown('.husky/pre-commit');
    noTTY();
    expect(await flagged(['.husky/pre-commit'])).toBe(0);
    expect(read('.husky/pre-commit')).toBe('local\n');
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
  });

  it('prints the next command for entries --yes kept without a choice', async () => {
    unknown('.prettierrc');
    noTTY();
    expect(await run()).toBe(0);
    expect(stdout()).toContain(
      "Next: pnpm dlx @atharvdange/toolchain update --pm pnpm --keep '.prettierrc'",
    );
  });

  it('keeps a supplied overwrite in the first-pass retry, and the retry converges', async () => {
    const generated = read('.prettierrc');
    unknown('.prettierrc');
    unknown('.editorconfig');
    noTTY();
    const before = files();
    expect(await flagged([], ['.prettierrc'])).toBe(1);
    expect(stderr()).toContain(
      "pnpm dlx @atharvdange/toolchain update --pm pnpm --keep '.editorconfig' --overwrite '.prettierrc'",
    );
    expectNothingRan(before);

    expect(await flagged(['.editorconfig'], ['.prettierrc'])).toBe(0);
    expect(read('.prettierrc')).toBe(generated);
    expect(read('.editorconfig')).toBe('local\n');
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
  });

  it('keeps a first-pass overwrite in the hook-pass retry, and the retry converges', async () => {
    const generated = read('.prettierrc');
    unknown('.prettierrc');
    unknown('.husky/pre-commit');
    noTTY();
    const before = files();
    expect(await flagged([], ['.prettierrc'])).toBe(1);
    expect(stderr()).toContain(
      "update --pm pnpm --keep '.husky/pre-commit' --overwrite '.prettierrc'",
    );
    expectNothingRan(before);

    expect(await flagged(['.husky/pre-commit'], ['.prettierrc'])).toBe(0);
    expect(read('.prettierrc')).toBe(generated);
    expect(read('.husky/pre-commit')).toBe('local\n');
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
  });

  it('keeps a hook choice in the first-pass retry', async () => {
    unknown('.prettierrc');
    unknown('.husky/pre-commit');
    noTTY();
    const before = files();
    expect(await flagged([], ['.husky/pre-commit'])).toBe(1);
    expect(stderr()).toContain(
      "update --pm pnpm --keep '.prettierrc' --overwrite '.husky/pre-commit'",
    );
    expectNothingRan(before);
  });

  describe.each([false, true])('with yes=%s', (yes) => {
    it('rejects keep and overwrite on the same rule', async () => {
      const config = json('.oxlintrc.json');
      (config['rules'] as Record<string, unknown>)['import/no-cycle'] = 'off';
      putJson('.oxlintrc.json', config);
      base('.oxlintrc.json#rules.import/no-cycle', '"error"');
      noTTY();
      const before = files();
      expect(
        await flagged(['.oxlintrc.json#rules.*'], ['.oxlintrc.json#rules.import/no-cycle'], yes),
      ).toBe(1);
      expect(stderr()).toContain('.oxlintrc.json#rules.import/no-cycle matches both');
      expectNothingRan(before);
    });

    it('rejects an unused exact path', async () => {
      noTTY();
      const before = files();
      expect(await flagged([], ['.prettierrc'], yes)).toBe(1);
      expect(stderr()).toContain("No differing entry matches --overwrite '.prettierrc'");
      expectNothingRan(before);
    });

    it('rejects a wildcard that matches only in-sync and stale rows', async () => {
      const config = json('.oxlintrc.json');
      const rules = config['rules'] as Record<string, unknown>;
      const [rule, value] = Object.entries(rules)[0] ?? [];
      if (rule === undefined) throw new Error('fixture has no rules');
      base(`.oxlintrc.json#rules.${rule}`, JSON.stringify(value === 'off' ? 'warn' : 'off'));
      noTTY();
      const before = files();
      expect(await flagged(['.oxlintrc.json#rules.*'], [], yes)).toBe(1);
      expect(stderr()).toContain("No differing entry matches --keep '.oxlintrc.json#rules.*'");
      expectNothingRan(before);
    });
  });
});

describe('script-first hooks and root-only scope', () => {
  it('retains a typecheck deletion and updates its stale hook from resulting scripts', async () => {
    editPackage((pkg) => {
      delete (pkg['scripts'] as Record<string, string>)['typecheck'];
    });
    expect(await run()).toBe(0);
    expect(
      (json('package.json')['scripts'] as Record<string, string>)['typecheck'],
    ).toBeUndefined();
    expect(read('.husky/pre-commit')).not.toContain('run typecheck');
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
  });

  it('removes an unedited obsolete script before deriving its hook', async () => {
    editPackage((pkg) => {
      (pkg['scripts'] as Record<string, string>)['test'] = 'vitest run';
    });
    base('package.json#scripts.test', '"vitest run"');
    put('.husky/pre-commit', `${read('.husky/pre-commit')}pnpm run test\n`);
    base('.husky/pre-commit', read('.husky/pre-commit'));
    expect(await run()).toBe(0);
    expect((json('package.json')['scripts'] as Record<string, string>)['test']).toBeUndefined();
    expect(read('.husky/pre-commit')).not.toContain('pnpm run test');
    expect(
      parseManifest(read('.toolchain.json'))?.entries['package.json#scripts.test'],
    ).toBeUndefined();
  });

  it.each(['keep', 'overwrite'] as const)(
    'uses decided Next lint before the hook prompt (%s hook)',
    async (hookChoice) => {
      await fresh({ name: 'next', dependencies: { next: '^16.0.0' } });
      editPackage((pkg) => {
        (pkg['scripts'] as Record<string, string>)['lint'] = 'custom lint';
      });
      base('package.json#scripts.lint', '"old lint"');
      conflict('.husky/pre-commit');
      select
        .mockImplementationOnce(() => 'keep')
        .mockImplementationOnce((question) => {
          expect(String(question.message)).toContain('.husky/pre-commit');
          expect(read('package.json')).toContain('custom lint');
          return hookChoice;
        });
      expect(await run(false)).toBe(0);
      expect(select).toHaveBeenCalledTimes(2);
      const hook = read('.husky/pre-commit');
      if (hookChoice === 'keep') expect(hook).toBe('local\n');
      else {
        expect(hook).not.toContain('exec next typegen');
        expect(hook).toContain('pnpm run typecheck');
      }
      expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
    },
  );

  it('keeps a hook deletion until its manifest entry is explicitly removed', async () => {
    fs.rmSync(path.join(dir, '.husky/pre-commit'));
    expect(await run()).toBe(0);
    expect(fs.existsSync(path.join(dir, '.husky/pre-commit'))).toBe(false);
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(1);
    base('.husky/pre-commit', undefined);
    expect(await run()).toBe(0);
    expect(fs.existsSync(path.join(dir, '.husky/pre-commit'))).toBe(true);
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
  });

  it('adds Next typegen to a stale hook after overwriting a conflicting lint script', async () => {
    await fresh({ name: 'next', dependencies: { next: '^16.0.0' } });
    editPackage((pkg) => {
      (pkg['scripts'] as Record<string, string>)['lint'] = 'custom lint';
    });
    base('package.json#scripts.lint', '"old lint"');
    put('.husky/pre-commit', 'pnpm exec lint-staged\npnpm run typecheck\n');
    base('.husky/pre-commit', read('.husky/pre-commit'));
    select.mockImplementation(() => 'overwrite');
    expect(await run(false)).toBe(0);
    expect(select).toHaveBeenCalledTimes(1);
    expect((json('package.json')['scripts'] as Record<string, string>)['lint']).toBe(
      'next typegen && oxlint .',
    );
    expect(read('.husky/pre-commit')).toContain('pnpm exec next typegen');
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
  });

  it('creates eligible absent create-only files but never tracks or overwrites them', async () => {
    for (const file of ['.gitattributes', 'tsconfig.json']) fs.rmSync(path.join(dir, file));
    expect(await run()).toBe(0);
    for (const file of ['.gitattributes', 'tsconfig.json']) {
      expect(fs.existsSync(path.join(dir, file))).toBe(true);
      expect(parseManifest(read('.toolchain.json'))?.entries[file]).toBeUndefined();
    }
    put('.gitattributes', 'custom attributes\n');
    put('tsconfig.json', '{ "compilerOptions": {} }\n');
    expect(await run()).toBe(0);
    expect(read('.gitattributes')).toBe('custom attributes\n');
    expect(read('tsconfig.json')).toBe('{ "compilerOptions": {} }\n');
  });

  it('leaves workspace files, ESLint deps/configs and root TypeScript ranges unchanged', async () => {
    fs.rmSync(path.join(dir, 'tsconfig.json'));
    editPackage((pkg) => {
      pkg['workspaces'] = ['packages/*'];
      const deps = pkg['devDependencies'] as Record<string, string>;
      deps['typescript'] = '^5.8.0';
      deps['eslint'] = '^9.0.0';
    });
    putJson('packages/a/package.json', {
      name: 'a',
      devDependencies: { typescript: '^5.8.0', eslint: '^9.0.0' },
      scripts: { lint: 'eslint .' },
    });
    put('eslint.config.mjs', 'export default [];\n');
    const workspace = read('packages/a/package.json');
    expect(await run()).toBe(0);
    expect(fs.existsSync(path.join(dir, 'tsconfig.json'))).toBe(false);
    expect(read('packages/a/package.json')).toBe(workspace);
    expect((json('package.json')['devDependencies'] as Record<string, string>)['typescript']).toBe(
      '^5.8.0',
    );
    expect((json('package.json')['devDependencies'] as Record<string, string>)['eslint']).toBe(
      '^9.0.0',
    );
    expect(read('eslint.config.mjs')).toBe('export default [];\n');
    expect(fs.existsSync(path.join(dir, 'eslint.config.mjs.bak'))).toBe(false);
    expect(stdout()).toContain('^5.8.0');
    expect(stdout()).not.toContain('root now uses TypeScript 7');
    expect(stdout()).not.toContain('Removing');
    expect(stdout()).not.toContain('Overwriting');
    expect(execSync).not.toHaveBeenCalled();
  });
});

describe('dependency restoration and recovery', () => {
  it('resolves only absent husky, keeps other ranges and installs once with selected manager', async () => {
    editPackage((pkg) => {
      delete (pkg['devDependencies'] as Record<string, string>)['husky'];
    });
    const before = json('package.json')['devDependencies'] as Record<string, string>;
    expect(await run(true, 'yarn')).toBe(0);
    expect(getToolchainDeps).toHaveBeenCalledExactlyOnceWith(['husky']);
    expect(json('package.json')['devDependencies']).toEqual({ ...before, husky: '^7.0.2' });
    expect(execSync).toHaveBeenCalledExactlyOnceWith('yarn install', {
      cwd: dir,
      stdio: 'inherit',
    });
    expect(
      parseManifest(read('.toolchain.json'))?.entries['package.json#devDependencies.husky'],
    ).toBe(hashEntry('package.json#devDependencies.husky', 'true'));
  });

  it('restores TypeScript using its fixed range without a registry command', async () => {
    const actual =
      await vi.importActual<typeof import('../utils/versions.js')>('../utils/versions.js');
    vi.mocked(getToolchainDeps).mockImplementationOnce(actual.getToolchainDeps);
    editPackage((pkg) => {
      delete (pkg['devDependencies'] as Record<string, string>)['typescript'];
    });
    expect(await run()).toBe(0);
    expect(getToolchainDeps).toHaveBeenCalledExactlyOnceWith(['typescript']);
    expect((json('package.json')['devDependencies'] as Record<string, string>)['typescript']).toBe(
      '^7.0.2',
    );
    expect(execSync).toHaveBeenCalledExactlyOnceWith('pnpm install', {
      cwd: dir,
      stdio: 'inherit',
    });
  });

  it('leaves every byte untouched when a required version lookup fails', async () => {
    editPackage((pkg) => {
      delete (pkg['devDependencies'] as Record<string, string>)['husky'];
    });
    stale();
    const before = files();
    vi.mocked(getToolchainDeps).mockImplementationOnce(() => {
      throw new Error('registry down');
    });
    expect(await run()).toBe(1);
    expect(files()).toEqual(before);
    expect(stderr()).toContain('registry down');
    expect(execSync).not.toHaveBeenCalled();
  });

  it('aborts if an input changes during a prompt without applying prepared decisions', async () => {
    conflict();
    const manifest = read('.toolchain.json');
    const pkg = read('package.json');
    select.mockImplementationOnce(() => {
      put('package.json', `${pkg} `);
      return 'overwrite';
    });
    expect(await run(false)).toBe(1);
    expect(read('.prettierrc')).toBe('local\n');
    expect(read('.toolchain.json')).toBe(manifest);
    expect(fs.existsSync(path.join(dir, '.prettierrc.bak'))).toBe(false);
    expect(stderr()).toContain('changed during update');
  });

  it('rechecks snapshot inputs after dependency lookup before any content write', async () => {
    editPackage((pkg) => {
      delete (pkg['devDependencies'] as Record<string, string>)['husky'];
    });
    stale();
    const pkg = read('package.json');
    const manifest = read('.toolchain.json');
    vi.mocked(getToolchainDeps).mockImplementationOnce(() => {
      put('.prettierignore', 'changed externally\n');
      return { husky: '^9.1.7' };
    });
    expect(await run()).toBe(1);
    expect(read('package.json')).toBe(pkg);
    expect(read('.prettierrc')).toBe('old\n');
    expect(read('.toolchain.json')).toBe(manifest);
    expect(stderr()).toContain('.prettierignore changed during update');
    expect(execSync).not.toHaveBeenCalled();
  });

  it('completes every backup before content writes and aborts all writes on backup failure', async () => {
    conflict('.prettierrc');
    conflict('.prettierignore');
    const before = files();
    const copy = fs.copyFileSync;
    vi.spyOn(fs, 'copyFileSync').mockImplementation((source, destination, mode) => {
      expect(read('.prettierrc')).toBe('local\n');
      expect(read('.prettierignore')).toBe('local\n');
      if (String(source).endsWith('.prettierignore')) throw new Error('backup denied');
      copy(source, destination, mode);
    });
    select.mockImplementation(() => 'overwrite');
    expect(await run(false)).toBe(1);
    for (const [file, content] of Object.entries(before)) {
      expect(fs.readFileSync(path.join(dir, file)).toString('base64')).toBe(content);
    }
    expect(stderr()).toContain('backup denied');
    expect(execSync).not.toHaveBeenCalled();
  });

  it('reports completed writes, retains the old base and converges after a partial write failure', async () => {
    stale('.editorconfig');
    stale('.prettierrc');
    const manifest = read('.toolchain.json');
    const rename = fs.renameSync;
    const fault = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (String(destination).endsWith('.prettierrc')) throw new Error('rename denied');
      rename(source, destination);
    });
    expect(await run()).toBe(1);
    expect(read('.editorconfig')).not.toBe('old\n');
    expect(read('.prettierrc')).toBe('old\n');
    expect(read('.toolchain.json')).toBe(manifest);
    expect(stderr()).toContain('Completed writes: .editorconfig');
    expect(execSync).not.toHaveBeenCalled();
    fault.mockRestore();
    expect(await run()).toBe(0);
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
  });

  it('records applied content after install failure, prints exact manual command and never retries automatically', async () => {
    editPackage((pkg) => {
      delete (pkg['devDependencies'] as Record<string, string>)['husky'];
    });
    base('package.json#devDependencies.husky', undefined);
    stale();
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error('install denied');
    });
    expect(await run()).toBe(1);
    expect(
      parseManifest(read('.toolchain.json'))?.entries['package.json#devDependencies.husky'],
    ).toBeDefined();
    expect(doctor({ targetDir: dir, pm: 'pnpm' })).toBe(0);
    expect(stderr()).toContain('pnpm install');
    expect(stderr()).toContain('will not retry');
    expect(stdout()).not.toContain('Toolchain update complete.');
    expect(await run()).toBe(0);
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it('prints the selected manual install command when declarations complete before a later write fails', async () => {
    editPackage((pkg) => {
      delete (pkg['devDependencies'] as Record<string, string>)['typescript'];
    });
    stale('.husky/pre-commit');
    const manifest = read('.toolchain.json');
    const rename = fs.renameSync;
    const fault = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (String(destination).endsWith('pre-commit')) throw new Error('hook rename denied');
      rename(source, destination);
    });
    expect(await run(true, 'yarn')).toBe(1);
    expect((json('package.json')['devDependencies'] as Record<string, string>)['typescript']).toBe(
      '^7.0.2',
    );
    expect(read('.toolchain.json')).toBe(manifest);
    expect(stderr()).toContain('Completed writes: package.json');
    expect(stderr()).toContain('hook rename denied');
    expect(stderr()).toContain('Run "yarn install" manually.');
    expect(stderr()).toContain('will not retry install automatically');
    expect(execSync).not.toHaveBeenCalled();
    fault.mockRestore();
    expect(await run(true, 'yarn')).toBe(0);
    expect(doctor({ targetDir: dir, pm: 'yarn' })).toBe(0);
    expect(execSync).not.toHaveBeenCalled();
  });

  it.each(['content', 'backup'])(
    'prints no install instruction when %s fails before declarations complete',
    async (failure) => {
      editPackage((pkg) => {
        delete (pkg['devDependencies'] as Record<string, string>)['typescript'];
      });
      if (failure === 'backup') conflict();
      else stale();
      const pkg = read('package.json');
      const manifest = read('.toolchain.json');
      if (failure === 'backup') {
        select.mockImplementation(() => 'overwrite');
        vi.spyOn(fs, 'copyFileSync').mockImplementation(() => {
          throw new Error('backup denied');
        });
      } else {
        vi.spyOn(fs, 'renameSync').mockImplementation(() => {
          throw new Error('content denied');
        });
      }
      expect(await run(false)).toBe(1);
      expect(read('package.json')).toBe(pkg);
      expect(read('.toolchain.json')).toBe(manifest);
      expect(stderr()).toContain(`${failure} denied`);
      expect(stderr()).not.toContain('install" manually');
      expect(execSync).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'reports manifest failure with rerun instructions (install failure %s)',
    async (installFails) => {
      stale();
      const manifest = read('.toolchain.json');
      if (installFails) {
        editPackage((pkg) => {
          delete (pkg['devDependencies'] as Record<string, string>)['husky'];
        });
        vi.mocked(execSync).mockImplementationOnce(() => {
          throw new Error('install denied');
        });
      }
      vi.spyOn(writer, 'writeManifest').mockImplementationOnce(() => {
        throw new Error('manifest denied');
      });
      expect(await run()).toBe(1);
      expect(read('.prettierrc')).not.toBe('old\n');
      expect(read('.toolchain.json')).toBe(manifest);
      expect(stderr()).toContain('manifest denied');
      expect(stderr()).toContain('rerun update');
      expect(stdout()).not.toContain('Toolchain update complete.');
      if (installFails) expect(stderr()).toContain('pnpm install');
    },
  );

  it('makes no writes, lookup or install on repeated unchanged successful runs', async () => {
    expect(await run()).toBe(0);
    const before = files();
    const rename = vi.spyOn(fs, 'renameSync');
    const write = vi.spyOn(fs, 'writeFileSync');
    expect(await run()).toBe(0);
    expect(files()).toEqual(before);
    expect(rename).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(execSync).not.toHaveBeenCalled();
    expect(getToolchainDeps).not.toHaveBeenCalled();
  });

  it('forgets dropped dependency bases without removing their declaration', async () => {
    editPackage((pkg) => {
      (pkg['devDependencies'] as Record<string, string>)['old-tool'] = '^1.0.0';
    });
    base('package.json#devDependencies.old-tool', 'true');
    expect(await run()).toBe(0);
    expect((json('package.json')['devDependencies'] as Record<string, string>)['old-tool']).toBe(
      '^1.0.0',
    );
    expect(
      parseManifest(read('.toolchain.json'))?.entries['package.json#devDependencies.old-tool'],
    ).toBeUndefined();
    expect(getToolchainDeps).not.toHaveBeenCalled();
    expect(execSync).not.toHaveBeenCalled();
  });

  it('preflights symlink targets before prompts and dependency lookups', async () => {
    editPackage((pkg) => {
      delete (pkg['devDependencies'] as Record<string, string>)['husky'];
    });
    conflict();
    const before = files();
    const stat = fs.lstatSync;
    vi.spyOn(fs, 'lstatSync').mockImplementation((...args) => {
      const result = stat(...args);
      if (String(args[0]).endsWith('.prettierrc') && result) {
        Object.defineProperty(result, 'isSymbolicLink', { value: () => true });
      }
      return result;
    });
    expect(await run(false)).toBe(1);
    expect(files()).toEqual(before);
    expect(select).not.toHaveBeenCalled();
    expect(getToolchainDeps).not.toHaveBeenCalled();
    expect(execSync).not.toHaveBeenCalled();
    expect(stderr()).toContain('symlink');
  });

  it.each([
    ['package.json', '{'],
    ['package.json', '{"scripts":[]}'],
    ['package.json', '{"dependencies":{"vue":"^3.0.0"}}'],
    ['.oxlintrc.json', '{"plugins":[7]}'],
    ['.toolchain.json', '{"entries":{".prettierrc":"bad"}}'],
  ])('refuses invalid or unsupported input in %s without writes', async (file, content) => {
    put(file, content);
    const before = files();
    expect(await run()).toBe(1);
    expect(files()).toEqual(before);
    expect(stderr()).not.toBe('');
    expect(execSync).not.toHaveBeenCalled();
    expect(getToolchainDeps).not.toHaveBeenCalled();
  });

  it('rejects an unsafe manifest target even when no content write is needed', async () => {
    fs.rmSync(path.join(dir, '.toolchain.json'));
    fs.mkdirSync(path.join(dir, '.toolchain.json'));
    expect(await run()).toBe(1);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('returns 1 for invalid input instead of exiting the process', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const before = files();
    expect(await run(true, 'invalid')).toBe(1);
    expect(files()).toEqual(before);
    expect(exit).not.toHaveBeenCalled();
    expect(stderr()).toContain('Invalid package manager');
  });
});

describe('package manager provenance', () => {
  it('keeps an npm project on npm when doctor and update run through pnpm', async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir);
    putJson('package.json', { name: 'demo' });
    put('package-lock.json', '{}');
    await init({ targetDir: dir, yes: true, pm: 'npm' });
    vi.mocked(execSync).mockClear();
    vi.mocked(getToolchainDeps).mockClear();
    const hooks = { commitMsg: read('.husky/commit-msg'), preCommit: read('.husky/pre-commit') };
    expect(hooks.preCommit).toContain('npm exec --');

    vi.stubEnv('npm_config_user_agent', 'pnpm/9.0.0 node/v20.0.0');

    expect(doctor({ targetDir: dir })).toBe(0);
    expect(await update({ targetDir: dir, yes: true })).toBe(0);
    expect(read('.husky/pre-commit')).toBe(hooks.preCommit);
    expect(read('.husky/commit-msg')).toBe(hooks.commitMsg);
    expect(parseManifest(read('.toolchain.json'))?.packageManager).toBe('npm');
  });

  it('reports a lockfile migration as stale hooks and records the new manager', async () => {
    // init recorded pnpm with no lockfile, then the project moved to npm.
    put('package-lock.json', '{}');
    expect(doctor({ targetDir: dir })).toBe(1);

    expect(await update({ targetDir: dir, yes: true })).toBe(0);

    expect(read('.husky/pre-commit')).toContain('npm exec --');
    expect(parseManifest(read('.toolchain.json'))?.packageManager).toBe('npm');
  });
});
