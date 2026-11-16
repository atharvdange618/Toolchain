import { type PackageManager, pmExec } from '../detectors/project.js';

// `npm init` writes this placeholder, which always exits 1.
const NPM_PLACEHOLDER_TEST = 'no test specified';

// Takes the scripts package.json will hold after init, not the ones on disk,
// so the hooks match the plan they are written with.
export function generateHuskyHooks(
  scripts: Record<string, string> | undefined,
  pm: PackageManager,
): { commitMsg: string; preCommit: string } {
  // Git runs hooks with stdin closed, so vitest (and jest) run once instead of watching.
  const test = scripts?.['test'];
  const runTests = test !== undefined && !test.includes(NPM_PLACEHOLDER_TEST);
  // A monorepo with no root tsconfig and no typecheck script of its own gets none.
  const typecheck = scripts?.['typecheck'] !== undefined;
  // lint-staged calls oxlint directly, so a typegen in the lint script never
  // runs here; type-aware rules need the generated Next route types first.
  const typegen = scripts?.['lint']?.startsWith('next typegen') === true;

  return {
    // Quoted so a path with spaces reaches commitlint as one argument.
    commitMsg: `${pmExec(pm)} commitlint --edit "$1"\n`,
    preCommit: `${typegen ? `${pmExec(pm)} next typegen\n` : ''}${pmExec(pm)} lint-staged\n${typecheck ? `${pm} run typecheck\n` : ''}${runTests ? `${pm} run test\n` : ''}`,
  };
}
