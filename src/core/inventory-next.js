import { join } from 'path';
import { DISABLED_DIR, ensureDirs } from './paths.js';
import { database } from './database.js';
import { listSources, scanSkillRoot } from './sources.js';

export function enrichSkill(skill) {
  const metadata = database.getSkill(skill.id || `${skill.source}:${skill.dirName}`);
  return {
    ...skill,
    category: metadata.category || (skill.tags?.[0] || 'uncategorized'),
    tags: metadata.tags || skill.tags || [],
    summary: metadata.summary || '',
    risk: metadata.risk || 'unknown',
    isFavorite: Boolean(metadata.isFavorite),
    lastClassifiedAt: metadata.lastClassifiedAt || null
  };
}

export function listLocalSkills() {
  ensureDirs();
  const sources = listSources();
  const active = sources.flatMap(scanSkillRoot);
  const disabled = sources.flatMap(source => scanSkillRoot({
    ...source,
    path: join(DISABLED_DIR, source.id),
    enabled: true
  }).map(skill => ({
    ...skill,
    id: `${source.id}:${skill.dirName}`,
    rootPath: source.path,
    isEnabled: false
  })));
  return [...active, ...disabled].map(enrichSkill).sort((a, b) => a.name.localeCompare(b.name));
}

export function enrichPluginSkills(skills) {
  return skills.map(skill => enrichSkill({
    ...skill,
    id: `plugin:${skill.pluginName || 'unknown'}:${skill.dirName}`,
    sourceId: 'claude-plugins',
    sourceName: 'Claude Plugins',
    agent: 'claude',
    isEnabled: true
  }));
}
