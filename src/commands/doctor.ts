import { effectiveScripts } from '../generators/entry.js';
import { withHookWants } from '../generators/husky.js';
import { needsAction } from '../manifest/classify.js';
import { compareProject, loadProject, trackedEntries } from '../manifest/project.js';
import { nextCommand, reportComparisons } from '../manifest/report.js';
import { error } from '../utils/logger.js';

export function doctor(options: { pm?: string; targetDir?: string }): number {
  try {
    const project = loadProject(options.targetDir ?? process.cwd(), options.pm);
    // Doctor checks the scripts hooks would run now, including intentional deletions.
    const plan = {
      ...project.plan,
      entries: withHookWants(
        project.plan.entries,
        effectiveScripts([], project.pkg['scripts']),
        project.pm,
      ),
    };
    const rows = compareProject(project, trackedEntries(plan));
    const hasManifest = project.manifest !== undefined;
    reportComparisons(rows, { hasManifest });
    if (!hasManifest) console.log('No .toolchain.json found.');
    const next = nextCommand(rows, project.pm, hasManifest);
    if (next !== undefined) console.log(`Next: ${next}`);
    return rows.some(needsAction) ? 1 : 0;
  } catch (error_) {
    error(error_ instanceof Error ? error_.message : String(error_));
    return 1;
  }
}
