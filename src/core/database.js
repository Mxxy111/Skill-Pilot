import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'node:crypto';
import { DATABASE_FILE } from './paths.js';

export const SCHEMA_VERSION = 2;

const DEFAULT_DATA = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  skills: {},
  groups: [],
  customSources: [],
  settings: {
    locale: 'zh-CN',
    theme: 'system',
    ai: {
      enabled: false,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'qwen3:8b',
      autoClassify: false
    },
    github: { token: '' },
    automation: {
      enabled: false,
      intervalHours: 24,
      updateChecks: true,
      autoUpdate: false,
      classification: false,
      classificationConcurrency: 3,
      lastRunAt: null,
      nextRunAt: null
    }
  },
  history: []
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeSettings(saved = {}) {
  const settings = {
    ...clone(DEFAULT_DATA.settings),
    ...saved,
    ai: { ...DEFAULT_DATA.settings.ai, ...(saved.ai || {}) },
    github: { ...DEFAULT_DATA.settings.github, ...(saved.github || {}) },
    automation: { ...DEFAULT_DATA.settings.automation, ...(saved.automation || {}) }
  };
  delete settings.automation.classificationBatchSize;
  settings.automation.classificationConcurrency = Math.max(1, Math.min(8, Number(settings.automation.classificationConcurrency) || 3));
  return settings;
}

export function validateBackup(input) {
  if (!input || typeof input !== 'object' || ![1, SCHEMA_VERSION].includes(input.schemaVersion)) {
    throw new Error(`Unsupported database schema. Expected schema 1 or ${SCHEMA_VERSION}.`);
  }
  if (!input.skills || Array.isArray(input.skills) || typeof input.skills !== 'object') {
    throw new Error('Invalid skills database.');
  }
  if (!Array.isArray(input.customSources || [])) throw new Error('Invalid custom sources database.');
  if (!Array.isArray(input.history || [])) throw new Error('Invalid history database.');
  if (input.schemaVersion === SCHEMA_VERSION && !Array.isArray(input.groups || [])) throw new Error('Invalid groups database.');
  const skills = clone(input.skills);
  if (input.schemaVersion === 1) {
    for (const metadata of Object.values(skills)) {
      delete metadata.category;
      delete metadata.subcategory;
      metadata.lastClassifiedAt = null;
      metadata.lastClassificationFingerprint = null;
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    skills,
    groups: clone(input.schemaVersion === SCHEMA_VERSION ? (input.groups || []) : []),
    customSources: clone(input.customSources || []),
    settings: mergeSettings(input.settings),
    history: clone(input.history || []).slice(0, 200)
  };
}

export function createDatabase(file = DATABASE_FILE) {
  const replaceBackup = `${file}.replace-backup`;
  function read() {
    try {
      if (!existsSync(file) && existsSync(replaceBackup)) renameSync(replaceBackup, file);
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      const validated = validateBackup(parsed);
      return parsed.schemaVersion === SCHEMA_VERSION ? validated : write(validated);
    } catch (error) {
      if ((existsSync(file) || existsSync(replaceBackup)) && !String(error.message).includes('ENOENT')) throw error;
      return clone(DEFAULT_DATA);
    }
  }

  function write(data) {
    const valid = validateBackup(data);
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    const backup = replaceBackup;
    writeFileSync(temp, JSON.stringify(valid, null, 2) + '\n', { mode: 0o600 });
    try {
      if (existsSync(backup)) rmSync(backup, { force: true });
      if (existsSync(file)) renameSync(file, backup);
      renameSync(temp, file);
      if (existsSync(backup)) rmSync(backup, { force: true });
    } catch (error) {
      if (!existsSync(file) && existsSync(backup)) renameSync(backup, file);
      if (existsSync(temp)) rmSync(temp, { force: true });
      throw error;
    }
    return valid;
  }

  function mutate(callback) {
    const data = read();
    callback(data);
    return write(data);
  }

  return {
    snapshot: () => read(),
    replace: (backup) => write(validateBackup(backup)),
    getSkill: (id) => read().skills[id] || {},
    updateSkill(id, patch) {
      if (!id || typeof id !== 'string') throw new Error('Skill ID is required.');
      return mutate(data => {
        data.skills[id] = { ...(data.skills[id] || {}), ...clone(patch), updatedAt: new Date().toISOString() };
      }).skills[id];
    },
    removeSkill(id) {
      return mutate(data => { delete data.skills[id]; });
    },
    listGroups: () => read().groups,
    createGroup(name) {
      const value = normalizeGroupName(name);
      return mutate(data => {
        assertUniqueGroupName(data.groups, value);
        const now = new Date().toISOString();
        data.groups.push({ id: randomUUID(), name: value, createdAt: now, updatedAt: now });
      }).groups.at(-1);
    },
    updateGroup(id, patch = {}) {
      return mutate(data => {
        const group = data.groups.find(item => item.id === id);
        if (!group) throw new Error('Group not found.');
        if (patch.name !== undefined) {
          const value = normalizeGroupName(patch.name);
          assertUniqueGroupName(data.groups, value, id);
          group.name = value;
        }
        group.updatedAt = new Date().toISOString();
      }).groups.find(item => item.id === id);
    },
    removeGroup(id) {
      let removed;
      mutate(data => {
        const index = data.groups.findIndex(item => item.id === id);
        if (index < 0) throw new Error('Group not found.');
        [removed] = data.groups.splice(index, 1);
        for (const metadata of Object.values(data.skills)) {
          if (metadata.groupId === id) delete metadata.groupId;
        }
      });
      return removed;
    },
    assignSkillsToGroup(ids, groupId = null) {
      const selected = [...new Set(Array.isArray(ids) ? ids.map(String) : [])];
      if (!selected.length || selected.length > 500) throw new Error('Select between 1 and 500 skills.');
      return mutate(data => {
        if (groupId && !data.groups.some(group => group.id === groupId)) throw new Error('Group not found.');
        const now = new Date().toISOString();
        for (const id of selected) {
          data.skills[id] = { ...(data.skills[id] || {}), updatedAt: now };
          if (groupId) data.skills[id].groupId = groupId;
          else delete data.skills[id].groupId;
        }
      }).skills;
    },
    getSettings: () => read().settings,
    getPublicSettings() {
      const settings = read().settings;
      return {
        ...settings,
        ai: { ...settings.ai, apiKey: undefined, hasApiKey: Boolean(settings.ai.apiKey) },
        github: { token: undefined, hasToken: Boolean(settings.github.token) }
      };
    },
    updateSettings(patch) {
      return mutate(data => {
        data.settings = mergeSettings({
          ...data.settings,
          ...patch,
          ai: { ...data.settings.ai, ...(patch.ai || {}) },
          github: { ...data.settings.github, ...(patch.github || {}) },
          automation: { ...data.settings.automation, ...(patch.automation || {}) }
        });
      }).settings;
    },
    listSources: () => read().customSources,
    setSources(sources) {
      return mutate(data => { data.customSources = clone(sources); }).customSources;
    },
    addHistory(entry) {
      return mutate(data => {
        data.history.unshift({ id: randomUUID(), at: new Date().toISOString(), ...clone(entry) });
        data.history = data.history.slice(0, 200);
      }).history[0];
    }
  };
}

function normalizeGroupName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!value) throw new Error('Group name is required.');
  return value;
}

function assertUniqueGroupName(groups, name, exceptId = null) {
  if (groups.some(group => group.id !== exceptId && group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('A group with this name already exists.');
  }
  if (groups.length >= 50 && !exceptId) throw new Error('A maximum of 50 groups is supported.');
}

export const database = createDatabase();
