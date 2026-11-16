import { execSync } from 'node:child_process';

import { effectiveScripts, type Entry } from '../generators/entry.js';
import { withHookWants } from '../generators/husky.js';
import { decide, type Decision, nextManifest } from '../manifest/decide.js';
import { isHookPath } from '../manifest/manifest.js';
import { compareProject, loadProject, trackedEntries } from '../manifest/project.js';
import {
  applyWrites,
  assertSafeTargets,
  ContentWriteError,
  prepareWrites,
  writeManifest,
} from '../manifest/write.js';
import { error, info, success, warn } from '../utils/logger.js';
import { getToolchainDeps } from '../utils/versions.js';
import { warnAboutWorkspacePackages, warnAboutWorkspaceTypes } from './init.js';
import { chooseConflicts } from './update-prompts.js';

function selectedEntries(decisions: Decision[]): Entry[] {
  return decisions
    .filter(({ action }) => action === 'write' || action === 'remove')
    .map(({ row, action }) => ({
      path: row.path,
      want: action === 'remove' ? null : (row.want ?? null),
    }));
}

export async function update(options: {
  pm?: string;
  targetDir?: string;
  yes?: boolean;
}): Promise<number> {
  try {
    const project = loadProject(options.targetDir ?? process.cwd(), options.pm);
    assertSafeTargets(
      project.targetDir,
      [
        ...project.plan.entries.map((entry) => entry.path),
        ...Object.keys(project.manifest ?? {}),
      ].map((entryPath) => entryPath.split('#')[0] ?? entryPath),
    );
    const promptOptions = { yes: options.yes ?? false, isTTY: process.stdin.isTTY === true };
    const rows = compareProject(project, trackedEntries(project.plan)).filter(
      (row) => !isHookPath(row.path),
    );
    const decisions = decide(rows, await chooseConflicts(rows, promptOptions));

    // Hook wants follow the scripts we will keep or write, with the same original base and disk.
    const scripts = effectiveScripts(selectedEntries(decisions), project.pkg['scripts']);
    const hookEntries = withHookWants(project.plan.entries, scripts, project.pm).filter((entry) =>
      isHookPath(entry.path),
    );
    const hookRows = compareProject(project, hookEntries).filter((row) => isHookPath(row.path));
    decisions.push(...decide(hookRows, await chooseConflicts(hookRows, promptOptions)));

    const entries = selectedEntries(decisions);
    const dependencyPrefix = 'package.json#devDependencies.';
    const missing = entries
      .filter((entry) => entry.path.startsWith(dependencyPrefix))
      .map((entry) => entry.path.slice(dependencyPrefix.length));
    const versions = missing.length > 0 ? getToolchainDeps(missing) : {};
    for (const entry of entries) {
      if (!entry.path.startsWith(dependencyPrefix)) continue;
      const name = entry.path.slice(dependencyPrefix.length);
      const version = versions[name];
      if (!version || version === 'toolchain:unresolved')
        throw new Error(`Could not resolve required dependency: ${name}`);
      entry.want = JSON.stringify(version);
    }
    entries.push(
      ...project.plan.entries.filter(
        (entry) => entry.path === '.gitattributes' || entry.path === 'tsconfig.json',
      ),
    );
    const writes = prepareWrites(project, entries);
    const manifest = nextManifest(decisions);
    const backups = decisions
      .filter(
        ({ row, action }) =>
          action === 'write' && (row.state === 'conflict' || row.state === 'unknown-origin'),
      )
      .map(({ row }) => row.path.split('#')[0] ?? row.path);
    let completed: string[];
    try {
      completed = applyWrites(project.targetDir, writes, project.snapshot, backups);
    } catch (error_) {
      if (
        error_ instanceof ContentWriteError &&
        missing.length > 0 &&
        error_.completed.includes('package.json')
      ) {
        error(
          `Dependencies were declared, but install did not run. Run "${project.pm} install" manually. A rerun of update will not retry install automatically because the dependencies are now declared.`,
        );
      }
      throw error_;
    }
    for (const file of completed) info(`Updated: ${file}`);

    let failed = false;
    if (missing.length > 0) {
      try {
        execSync(`${project.pm} install`, { cwd: project.targetDir, stdio: 'inherit' });
      } catch {
        failed = true;
        error(
          `Failed to install dependencies. Run "${project.pm} install" manually. A rerun of update will not retry install automatically because the dependencies are now declared.`,
        );
      }
    }
    try {
      writeManifest(project.targetDir, { packageManager: project.pm, entries: manifest });
    } catch (error_) {
      failed = true;
      error(
        `${error_ instanceof Error ? error_.message : String(error_)}. Could not save .toolchain.json; rerun update to record the applied content.`,
      );
    }
    if (failed) return 1;

    for (const { row, action } of decisions) {
      if (action !== 'keep' && action !== 'keep-recorded') continue;
      const unresolved =
        action === 'keep' && (row.state === 'conflict' || row.state === 'unknown-origin');
      warn(
        `Kept ${row.path}${row.disk === undefined ? ' (deleted locally)' : ''}${unresolved ? '; no choice recorded, doctor still needs action' : ''}`,
      );
    }
    warnAboutWorkspaceTypes(project.info.unresolvedWorkspaceTypes);
    if (project.info.isMonorepo) warnAboutWorkspacePackages(project.targetDir, 'update');
    success('Toolchain update complete.');
    return 0;
  } catch (error_) {
    error(error_ instanceof Error ? error_.message : String(error_));
    return 1;
  }
}
