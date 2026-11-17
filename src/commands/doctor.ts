import { effectiveScripts } from '../generators/entry.js';
import { withHookWants } from '../generators/husky.js';
import { isStricterRule, needsAction } from '../manifest/classify.js';
import { compareProject, loadProject, trackedEntries } from '../manifest/project.js';
import { nextCommand, reportComparisons } from '../manifest/report.js';
import { error } from '../utils/logger.js';

export function doctor(options: { pm?: string; targetDir?: string; json?: boolean }): number {
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
    const next = nextCommand(rows, project.pm, hasManifest);
    if (options.json === true) {
      // One document on stdout and nothing else, so a script can parse it whole.
      // `base` is a manifest hash an agent can't act on; `state` already says
      // how it relates to disk and want.
      const document = {
        manifest: hasManifest,
        needsAction: rows.some(needsAction),
        next: next ?? null,
        rows: rows.map((row) => ({
          path: row.path,
          state: row.state,
          disk: row.disk ?? null,
          want: row.want ?? null,
          needsAction: needsAction(row),
          stricter: isStricterRule(row.path, row.disk, row.want),
        })),
      };
      process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
      return document.needsAction ? 1 : 0;
    }
    reportComparisons(rows, { hasManifest });
    if (!hasManifest) console.log('No .toolchain.json found.');
    if (next !== undefined) console.log(`Next: ${next}`);
    return rows.some(needsAction) ? 1 : 0;
  } catch (error_) {
    error(error_ instanceof Error ? error_.message : String(error_));
    return 1;
  }
}
