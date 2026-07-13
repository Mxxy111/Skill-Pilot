import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { validateArchivePath } from './repository-security.js';

function assertInside(path, root) {
  const target = resolve(path);
  const allowed = resolve(root);
  if (target !== allowed && !target.startsWith(`${allowed}${sep}`)) throw new Error('Update path escapes the allowed directory.');
  return target;
}

export function replaceRepositorySkill({ files, sourcePath, installPath, backupRoot }) {
  const destination = resolve(String(installPath || ''));
  if (!existsSync(destination)) throw new Error('Tracked skill install path was not found.');
  const parent = dirname(destination);
  const prefix = sourcePath === '.' ? '' : `${sourcePath}/`;
  const selected = files.filter(file => sourcePath === '.' || file.path.startsWith(prefix));
  const expectedSkill = sourcePath === '.' ? 'SKILL.md' : `${sourcePath}/SKILL.md`;
  if (!selected.some(file => file.path === expectedSkill)) throw new Error('Updated source does not contain the expected SKILL.md.');

  const suffix = crypto.randomUUID();
  const stage = assertInside(join(parent, `.${basename(destination)}.skillpilot-stage-${suffix}`), parent);
  const rollback = assertInside(join(parent, `.${basename(destination)}.skillpilot-rollback-${suffix}`), parent);
  const backupPath = join(resolve(backupRoot), `${basename(destination)}-${new Date().toISOString().replace(/[:.]/g, '-')}-${suffix.slice(0, 8)}`);

  mkdirSync(stage, { recursive: false });
  try {
    for (const file of selected) {
      const relative = sourcePath === '.' ? file.path : file.path.slice(prefix.length);
      const safe = validateArchivePath(relative);
      const output = assertInside(join(stage, ...safe.split('/')), stage);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, file.data, { flag: 'wx', mode: 0o600 });
    }

    mkdirSync(dirname(backupPath), { recursive: true });
    cpSync(destination, backupPath, { recursive: true, errorOnExist: true });
    renameSync(destination, rollback);
    try {
      renameSync(stage, destination);
      rmSync(rollback, { recursive: true, force: true });
    } catch (error) {
      if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
      if (existsSync(rollback)) renameSync(rollback, destination);
      throw error;
    }
    return { path: destination, backupPath, fileCount: selected.length };
  } catch (error) {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}
