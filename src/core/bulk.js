import AdmZip from 'adm-zip';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs';
import { basename, join, resolve, sep } from 'path';
import { tmpdir } from 'os';
import { database } from './database.js';
import { BACKUP_DIR, DISABLED_DIR } from './paths.js';
import { getSkill, listAll } from './inventory.js';

function requireLocalSkill(id) {
  const skill = getSkill(id);
  if (!skill) throw new Error(`Skill not found: ${id}`);
  if (skill.source !== 'local') throw new Error(`Plugin-backed skill cannot be modified: ${skill.name}`);
  return skill;
}

function assertWithin(path, root) {
  const target = resolve(path);
  const allowed = resolve(root);
  if (target !== allowed && !target.startsWith(allowed + sep)) throw new Error('Skill path is outside its registered source.');
}

export function setSkillEnabled(id, enabled) {
  const skill = requireLocalSkill(id);
  if (skill.isEnabled === enabled) return skill;
  const disabledRoot = join(DISABLED_DIR, skill.sourceId);
  if (enabled) {
    assertWithin(skill.path, disabledRoot);
    mkdirSync(skill.rootPath, { recursive: true });
    const target = join(skill.rootPath, skill.dirName);
    if (existsSync(target)) throw new Error(`Cannot enable ${skill.name}: destination already exists.`);
    movePath(skill.path, target);
  } else {
    assertWithin(skill.path, skill.rootPath);
    mkdirSync(disabledRoot, { recursive: true });
    const target = join(disabledRoot, skill.dirName);
    if (existsSync(target)) throw new Error(`Cannot disable ${skill.name}: disabled copy already exists.`);
    movePath(skill.path, target);
  }
  database.updateSkill(id, { isEnabled: enabled });
  return getSkill(id);
}

function movePath(source, target) {
  try { renameSync(source, target); }
  catch (error) {
    if (error.code !== 'EXDEV') throw error;
    cpSync(source, target, { recursive: true, verbatimSymlinks: true });
    rmSync(source, { recursive: true, force: false });
  }
}

export function categorizeSkills(ids, category) {
  const value = String(category || '').trim().slice(0, 60);
  if (!value) throw new Error('Category is required.');
  return ids.map(id => database.updateSkill(id, { category: value }));
}

export function deleteSkills(ids) {
  const skills = ids.map(requireLocalSkill);
  skills.forEach(skill => assertWithin(skill.path, skill.isEnabled ? skill.rootPath : join(DISABLED_DIR, skill.sourceId)));
  const backupPath = exportSkills(ids, BACKUP_DIR, 'deleted');
  const deleted = skills.map(skill => {
    rmSync(skill.path, { recursive: true, force: false });
    database.removeSkill(skill.id);
    return { id: skill.id, name: skill.name };
  });
  database.addHistory({ type: 'delete', status: 'success', message: `Deleted ${deleted.length} skills`, details: { backupPath } });
  return deleted;
}

const BLOCKED_EXPORT_NAMES = new Set(['.git', 'node_modules', '.DS_Store']);

function addFolderSafe(zip, root, zipRoot, relative = '') {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    if (BLOCKED_EXPORT_NAMES.has(entry.name) || entry.name.startsWith('.env') || /\.(?:pem|key)$/i.test(entry.name)) continue;
    const next = relative ? join(relative, entry.name) : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) addFolderSafe(zip, root, zipRoot, next);
    else zip.addLocalFile(join(root, next), join(zipRoot, relative));
  }
}

export function exportSkills(ids, outputDir = tmpdir(), prefix = 'export') {
  const zip = new AdmZip();
  for (const id of ids) {
    const skill = getSkill(id);
    if (!skill) continue;
    if (skill.path.endsWith('.md')) zip.addLocalFile(skill.path, skill.dirName);
    else addFolderSafe(zip, skill.path, basename(skill.path));
  }
  mkdirSync(outputDir, { recursive: true });
  const file = join(outputDir, `skillpilot-${prefix}-${Date.now()}.zip`);
  zip.writeZip(file);
  return file;
}

export function runBulkAction({ ids, action, category }) {
  const selected = [...new Set(Array.isArray(ids) ? ids.map(String) : [])];
  if (!selected.length || selected.length > 200) throw new Error('Select between 1 and 200 skills.');
  if (action === 'enable') return selected.map(id => setSkillEnabled(id, true));
  if (action === 'disable') return selected.map(id => setSkillEnabled(id, false));
  if (action === 'categorize') return categorizeSkills(selected, category);
  if (action === 'delete') return deleteSkills(selected);
  throw new Error('Unsupported bulk action.');
}

export function dashboardSummary() {
  const skills = listAll();
  const categories = {};
  const agents = {};
  for (const skill of skills) {
    categories[skill.category || 'uncategorized'] = (categories[skill.category || 'uncategorized'] || 0) + 1;
    agents[skill.agent || 'other'] = (agents[skill.agent || 'other'] || 0) + 1;
  }
  return {
    total: skills.length,
    enabled: skills.filter(skill => skill.isEnabled).length,
    disabled: skills.filter(skill => !skill.isEnabled).length,
    categories,
    agents,
    recentlyModified: [...skills].sort((a, b) => new Date(b.modified) - new Date(a.modified)).slice(0, 6)
  };
}
