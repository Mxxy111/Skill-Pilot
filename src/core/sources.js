import { homedir } from 'os';
import { basename, join, resolve } from 'path';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'fs';
import matter from 'gray-matter';
import { database } from './database.js';

export function builtInSources(home = homedir()) {
  return [
    { id: 'claude', name: 'Claude Code', agent: 'claude', path: join(home, '.claude', 'skills'), builtIn: true },
    { id: 'codex', name: 'OpenAI Codex', agent: 'codex', path: join(home, '.codex', 'skills'), builtIn: true },
    { id: 'agents', name: 'Agent Skills', agent: 'agents', path: join(home, '.agents', 'skills'), builtIn: true },
    { id: 'openclaw', name: 'OpenClaw', agent: 'openclaw', path: join(home, '.openclaw', 'skills'), builtIn: true },
    { id: 'gemini', name: 'Gemini CLI', agent: 'gemini', path: join(home, '.gemini', 'skills'), builtIn: true },
    { id: 'cursor', name: 'Cursor', agent: 'cursor', path: join(home, '.cursor', 'skills'), builtIn: true }
  ];
}

export function listInstallTargets(home = homedir()) {
  return builtInSources(home).map(({ id, name, agent, path }) => ({ id, name, agent, path }));
}

export function getInstallTarget(id, home = homedir()) {
  const target = listInstallTargets(home).find(item => item.id === id);
  if (!target) throw new Error('Unsupported target Agent.');
  return target;
}

export function listSources() {
  const states = database.getSettings().sourceStates || {};
  return [...builtInSources(), ...database.listSources()].map(source => ({
    ...source,
    enabled: states[source.id] !== false,
    exists: existsSync(source.path)
  }));
}

export function addCustomSource({ name, path }) {
  const absolute = resolve(String(path || ''));
  if (!path || !existsSync(absolute) || !statSync(absolute).isDirectory()) throw new Error('Source must be an existing absolute directory.');
  const real = realpathSync(absolute);
  if (listSources().some(source => existsSync(source.path) && realpathSync(source.path) === real)) throw new Error('This source directory is already registered.');
  const source = { id: `custom-${crypto.randomUUID().slice(0, 8)}`, name: String(name || basename(absolute)).trim().slice(0, 80), agent: 'custom', path: absolute, builtIn: false };
  database.setSources([...database.listSources(), source]);
  return source;
}

export function updateSource(id, patch) {
  const source = listSources().find(item => item.id === id);
  if (!source) throw new Error('Source not found.');
  if (typeof patch.enabled === 'boolean') {
    const current = database.getSettings().sourceStates || {};
    database.updateSettings({ sourceStates: { ...current, [id]: patch.enabled } });
  }
  if (!source.builtIn && typeof patch.name === 'string') {
    database.setSources(database.listSources().map(item => item.id === id ? { ...item, name: patch.name.trim().slice(0, 80) || item.name } : item));
  }
  return listSources().find(item => item.id === id);
}

export function removeSource(id) {
  const source = database.listSources().find(item => item.id === id);
  if (!source) throw new Error('Only custom sources can be removed.');
  database.setSources(database.listSources().filter(item => item.id !== id));
  return source;
}

function collectFiles(dir, base = '', depth = 0, visited = new Set()) {
  if (depth > 8) return [];
  let real;
  try { real = realpathSync(dir); } catch { return []; }
  if (visited.has(real)) return [];
  visited.add(real);
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) results.push(...collectFiles(join(dir, entry.name), rel, depth + 1, visited));
    else results.push(rel);
  }
  return results;
}

export function scanSkillRoot(source) {
  if (!source.enabled || !existsSync(source.path)) return [];
  const skills = [];
  for (const entry of readdirSync(source.path, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
    const skillPath = join(source.path, entry.name);
    const skillFile = join(skillPath, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    try {
      const parsed = matter(readFileSync(skillFile, 'utf8'));
      const files = collectFiles(skillPath);
      skills.push({
        id: `${source.id}:${entry.name}`,
        name: parsed.data.name || entry.name,
        dirName: entry.name,
        description: parsed.data.description || '',
        tags: Array.isArray(parsed.data.tags) ? parsed.data.tags : [],
        version: parsed.data.version || null,
        author: parsed.data.author || null,
        path: skillPath,
        rootPath: source.path,
        isSymlink: lstatSync(skillPath).isSymbolicLink(),
        files,
        fileCount: files.length,
        modified: statSync(skillPath).mtime.toISOString(),
        hasSkillFile: true,
        source: 'local',
        sourceId: source.id,
        sourceName: source.name,
        agent: source.agent,
        pluginName: null,
        isEnabled: true
      });
    } catch {}
  }
  return skills;
}
