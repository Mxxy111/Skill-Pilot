import { database } from './database.js';
import { listAll } from './inventory.js';
import { setSkillEnabled } from './bulk.js';

export function groupSummaries(groups, skills) {
  const summaries = groups.map(group => {
    const members = skills.filter(skill => skill.groupId === group.id);
    return {
      id: group.id,
      name: group.name,
      count: members.length,
      enabled: members.filter(skill => skill.isEnabled).length,
      disabled: members.filter(skill => !skill.isEnabled).length
    };
  });
  const groupIds = new Set(groups.map(group => group.id));
  const ungrouped = skills.filter(skill => !skill.groupId || !groupIds.has(skill.groupId));
  summaries.ungrouped = {
    count: ungrouped.length,
    enabled: ungrouped.filter(skill => skill.isEnabled).length,
    disabled: ungrouped.filter(skill => !skill.isEnabled).length
  };
  return summaries;
}

export function listGroupSummaries(options = {}) {
  return groupSummaries(options.groups || database.listGroups(), options.skills || listAll());
}

export function setGroupEnabled(groupId, enabled, options = {}) {
  const groups = options.groups || database.listGroups();
  if (!groups.some(group => group.id === groupId)) throw new Error('Group not found.');
  const members = (options.skills || listAll()).filter(skill => skill.groupId === groupId);
  const local = members.filter(skill => skill.source === 'local');
  const setEnabled = options.setEnabled || ((id, next, skill) => setSkillEnabled(id, next, skill));
  const results = local.map(skill => {
    try {
      return { id: skill.id, ok: true, skill: setEnabled(skill.id, Boolean(enabled), skill) };
    } catch (error) {
      return { id: skill.id, ok: false, error: error.message };
    }
  });
  return {
    groupId,
    enabled: Boolean(enabled),
    total: local.length,
    succeeded: results.filter(item => item.ok).length,
    failed: results.filter(item => !item.ok).length,
    skipped: members.length - local.length,
    results
  };
}
