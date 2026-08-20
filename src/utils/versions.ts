import { execSync } from 'node:child_process';
import semver from 'semver';

import type { ProjectInfo } from '../detectors/project.js';

const VERSION_CACHE = new Map<string, string>();
const PEER_RANGE_CACHE = new Map<string, string | undefined>();
const VERSION_LIST_CACHE = new Map<string, string[]>();

// How many historical releases of an outlier plugin to check before giving
// up on finding one compatible with the chosen eslint ceiling. In practice
// this only needs to look back a handful of versions - eslint-plugin-unicorn
// needed 4 releases back (68 -> 64) to find one still supporting eslint 9 -
// this just bounds the worst case.
const MAX_DOWNGRADE_ATTEMPTS = 30;

const BASE_ESLINT_PLUGINS = [
  '@eslint/js',
  'eslint-plugin-import-x',
  'eslint-plugin-perfectionist',
  'eslint-plugin-unicorn',
  'typescript-eslint',
];

const REACT_ESLINT_PLUGINS = [
  'eslint-plugin-jsx-a11y',
  'eslint-plugin-react',
  'eslint-plugin-react-hooks',
  'eslint-plugin-react-you-might-not-need-an-effect',
];

const NEXT_ESLINT_PLUGINS = ['@next/eslint-plugin-next'];

// Resolves eslint and every ESLint plugin this tool wires into
// eslint.config.mjs together, rather than fetching each package's absolute
// latest independently. Independent fetching is broken by design: a plugin
// can bump its own eslint peer floor (eslint-plugin-unicorn requiring
// eslint >=10.4) while another hasn't caught up to eslint's latest major
// yet (eslint-plugin-react/jsx-a11y still capping at eslint ^9) - resolving
// each in isolation can produce a package.json that fails `npm install`
// outright, with zero code of the user's own involved. This finds the
// highest eslint version every plugin's latest release agrees on, then
// falls back to an older release of whichever plugin doesn't support it.
export function getEslintDeps(
  info: Pick<ProjectInfo, 'framework' | 'hasReact'>,
): Record<string, string> {
  const pluginNames = [...BASE_ESLINT_PLUGINS];
  if (info.hasReact || info.framework === 'next') pluginNames.push(...REACT_ESLINT_PLUGINS);
  if (info.framework === 'next') pluginNames.push(...NEXT_ESLINT_PLUGINS);

  const { eslintVersion, pluginVersions } = resolveEslintPeerGroup(pluginNames);
  return { eslint: eslintVersion, ...pluginVersions };
}

export function getExpressVersion(): string {
  return toRange('express');
}

export function getToolchainDeps(): Record<string, string> {
  return getVersions([
    '@commitlint/cli',
    '@commitlint/config-conventional',
    '@commitlint/cz-commitlint',
    'commitizen',
    'eslint-import-resolver-typescript',
    'husky',
    'lint-staged',
    'prettier',
  ]);
}

export function getTurboVersion(): string {
  return toRange('turbo');
}

export function getTypescriptVersion(): string {
  // typescript-eslint requires <6.1.0, so pin to latest 6.0.x
  return toRange('typescript@6.0.3');
}

export function getTypesExpressVersion(): string {
  return toRange('@types/express');
}

export function getTypesNodeVersion(): string {
  return toRange('@types/node');
}

export function getVersions(packages: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pkg of packages) {
    result[pkg] = toRange(pkg);
  }
  return result;
}

function findCompatibleVersion(pkg: string, targetEslintVersion: string): string {
  // Descending, newest first - checks the fewest releases before finding a
  // compatible one.
  const versions = getPublishedVersions(pkg).sort((a, b) => semver.compare(b, a));
  const checked = versions.slice(0, MAX_DOWNGRADE_ATTEMPTS);

  // Major version of the newest release that declares a peer at all, once
  // found. An undeclared release only gets trusted as "predates peer
  // declarations entirely" once its own major is older than that - an
  // undeclared release at or above it is far more likely a packaging gap
  // right at the boundary (@eslint/js shipped 10.0.0 without the peer it
  // added one patch later, in 10.0.1) than a genuine absence of any
  // constraint.
  let declaringMajor: number | undefined;

  for (const version of checked) {
    const range = getPeerEslintRange(`${pkg}@${version}`);
    if (range) {
      declaringMajor ??= semver.major(version);
      if (semver.satisfies(targetEslintVersion, range)) return version;
      continue;
    }
    if (declaringMajor === undefined || semver.major(version) < declaringMajor) {
      return version;
    }
  }
  throw new Error(
    `No version of "${pkg}" in its last ${checked.length} releases supports eslint@${targetEslintVersion}. The toolchain's plugin list needs a floor/ceiling adjustment.`,
  );
}

function getLatestVersion(pkg: string): string | undefined {
  if (VERSION_CACHE.has(pkg)) return VERSION_CACHE.get(pkg);
  try {
    const version = execSync(`npm view ${pkg} version`, { encoding: 'utf8' }).trim();
    VERSION_CACHE.set(pkg, version);
    return version;
  } catch {
    return undefined;
  }
}

function getPeerEslintRange(spec: string): string | undefined {
  if (PEER_RANGE_CACHE.has(spec)) return PEER_RANGE_CACHE.get(spec);
  let range: string | undefined;
  try {
    const output = execSync(`npm view ${spec} peerDependencies.eslint`, {
      encoding: 'utf8',
    }).trim();
    range = output === '' ? undefined : output;
  } catch {
    range = undefined;
  }
  PEER_RANGE_CACHE.set(spec, range);
  return range;
}

// Always returns a fresh copy - callers sort the result, and sorting the
// cached array in place would corrupt it for the next caller.
function getPublishedVersions(pkg: string): string[] {
  const cached = VERSION_LIST_CACHE.get(pkg);
  if (cached) return [...cached];
  let versions: string[];
  try {
    const output = execSync(`npm view ${pkg} versions --json`, { encoding: 'utf8' });
    versions = (JSON.parse(output) as string[]).filter((v) => semver.valid(v) !== null);
  } catch {
    throw new Error(
      `Could not list published versions of "${pkg}" from npm. Check your network connection and try again.`,
    );
  }
  VERSION_LIST_CACHE.set(pkg, versions);
  return [...versions];
}

// The highest eslint version a single peer range allows. A range with only
// a floor (eslint-plugin-unicorn's ">=10.4") has to resolve to the newest
// published eslint, not get treated as "requires exactly 10.4+" when
// intersected against everything else - that's what a naive
// every-range-must-match-one-version check gets wrong, since a plugin that
// simply hasn't raised its floor recently would incorrectly veto every
// version below it even though an older release of that same plugin might
// support them fine.
function maxEslintSatisfying(
  versionsAscending: string[],
  range: string | undefined,
): string | undefined {
  if (!range) return versionsAscending.at(-1);
  for (let i = versionsAscending.length - 1; i >= 0; i -= 1) {
    const version = versionsAscending[i];
    if (version !== undefined && semver.satisfies(version, range)) return version;
  }
  return undefined;
}

function resolveEslintPeerGroup(pluginNames: string[]): {
  eslintVersion: string;
  pluginVersions: Record<string, string>;
} {
  const plugins = pluginNames.map((pkg) => {
    const version = getLatestVersion(pkg);
    if (version === undefined) {
      throw new Error(
        `Could not resolve the latest version of "${pkg}" from npm. Check your network connection and try again.`,
      );
    }
    return { pkg, range: getPeerEslintRange(`${pkg}@${version}`), version };
  });

  const eslintVersions = getPublishedVersions('eslint').sort(semver.compare);

  // Each plugin's own achievable ceiling: the highest eslint version its
  // *latest* release can support at all. The group ceiling is whichever
  // plugin's latest release is most restrictive - typically the one that
  // hasn't caught up to eslint's newest major yet.
  const perPluginCeilings = plugins.map((p) => ({
    ...p,
    ceiling: maxEslintSatisfying(eslintVersions, p.range),
  }));

  const unresolvable = perPluginCeilings.filter((p) => p.ceiling === undefined);
  if (unresolvable.length > 0) {
    const summary = unresolvable
      .map((p) => `${p.pkg}@${p.version} (eslint${p.range ?? '*'})`)
      .join(', ');
    throw new Error(
      `No published eslint version satisfies this plugin's peer requirement at all: ${summary}.`,
    );
  }

  const ceiling = perPluginCeilings.reduce(
    (min, p) => (semver.lt(p.ceiling!, min) ? p.ceiling! : min),
    perPluginCeilings[0]!.ceiling!,
  );

  const pluginVersions: Record<string, string> = {};
  for (const p of plugins) {
    pluginVersions[p.pkg] =
      !p.range || semver.satisfies(ceiling, p.range)
        ? `^${p.version}`
        : `^${findCompatibleVersion(p.pkg, ceiling)}`;
  }

  return { eslintVersion: `^${ceiling}`, pluginVersions };
}

// Resolves a package to a caret range. A failed lookup throws rather than
// degrading to an unconstrained "*" (or worse, the invalid range "^*") -
// the caller aborts the whole init/scaffold run instead of writing a
// looser dependency range than the rest of the toolchain promises.
function toRange(pkg: string): string {
  const version = getLatestVersion(pkg);
  if (version === undefined) {
    throw new Error(
      `Could not resolve the latest version of "${pkg}" from npm. Check your network connection and try again.`,
    );
  }
  return `^${version}`;
}
