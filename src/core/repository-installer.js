import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { normalizeSkillSelection, validateArchivePath } from './repository-security.js';

function safeDirectoryName(value) {
  const name = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100);
  if (!name || name === '.' || name === '..') throw new Error('Skill has an invalid installation name.');
  return name;
}

function assertInside(path, root) {
  const target = resolve(path);
  const allowed = resolve(root);
  if (target !== allowed && !target.startsWith(`${allowed}${sep}`)) throw new Error('Installation path escapes the target directory.');
  return target;
}

export function installRepositoryFiles({ files, availableSkills, selectedPaths, targetRoot }) {
  if (!Array.isArray(files) || !files.length) throw new Error('Repository files are required.');
  const root = resolve(String(targetRoot || ''));
  const selected = normalizeSkillSelection(selectedPaths, availableSkills);
  const plans = selected.map(sourcePath => {
    const skill = availableSkills.find(item => item.path === sourcePath);
    const fallback = sourcePath === '.' ? skill.name : basename(sourcePath);
    const name = safeDirectoryName(skill.name || fallback);
    const destination = assertInside(join(root, name), root);
    if (existsSync(destination)) throw new Error(`Skill "${name}" already exists in the target Agent.`);
    return { name, sourcePath, destination };
  });

  mkdirSync(root, { recursive: true });
  const installed = [];
  const staged = [];
  try {
    for (const plan of plans) {
      const temp = assertInside(join(root, `.${plan.name}.skillpilot-${crypto.randomUUID()}`), root);
      staged.push(temp);
      mkdirSync(temp, { recursive: false });
      const prefix = plan.sourcePath === '.' ? '' : `${plan.sourcePath}/`;
      const selectedFiles = files.filter(file => plan.sourcePath === '.' || file.path === `${plan.sourcePath}/SKILL.md` || file.path.startsWith(prefix));
      if (!selectedFiles.some(file => file.path === (plan.sourcePath === '.' ? 'SKILL.md' : `${plan.sourcePath}/SKILL.md`))) {
        throw new Error(`Selected skill ${plan.sourcePath} has no SKILL.md.`);
      }
      for (const file of selectedFiles) {
        const relative = plan.sourcePath === '.' ? file.path : file.path.slice(prefix.length);
        const safeRelative = validateArchivePath(relative);
        const output = assertInside(join(temp, ...safeRelative.split('/')), temp);
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, file.data, { flag: 'wx', mode: 0o600 });
      }
      renameSync(temp, plan.destination);
      staged.pop();
      installed.push({ name: plan.name, path: plan.destination, sourcePath: plan.sourcePath, fileCount: selectedFiles.length });
    }
    return installed;
  } catch (error) {
    for (const path of staged) rmSync(path, { recursive: true, force: true });
    for (const item of installed) rmSync(item.path, { recursive: true, force: true });
    throw error;
  }
}
