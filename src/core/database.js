import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { DATABASE_FILE } from './paths.js';

export const SCHEMA_VERSION = 1;

const DEFAULT_DATA = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  skills: {},
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
      classification: false
    }
  },
  history: []
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeSettings(saved = {}) {
  return {
    ...clone(DEFAULT_DATA.settings),
    ...saved,
    ai: { ...DEFAULT_DATA.settings.ai, ...(saved.ai || {}) },
    github: { ...DEFAULT_DATA.settings.github, ...(saved.github || {}) },
    automation: { ...DEFAULT_DATA.settings.automation, ...(saved.automation || {}) }
  };
}

export function validateBackup(input) {
  if (!input || typeof input !== 'object' || input.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported database schema. Expected schema ${SCHEMA_VERSION}.`);
  }
  if (!input.skills || Array.isArray(input.skills) || typeof input.skills !== 'object') {
    throw new Error('Invalid skills database.');
  }
  if (!Array.isArray(input.customSources || [])) throw new Error('Invalid custom sources database.');
  if (!Array.isArray(input.history || [])) throw new Error('Invalid history database.');
  return {
    schemaVersion: SCHEMA_VERSION,
    skills: clone(input.skills),
    customSources: clone(input.customSources || []),
    settings: mergeSettings(input.settings),
    history: clone(input.history || []).slice(0, 200)
  };
}

export function createDatabase(file = DATABASE_FILE) {
  function read() {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      return validateBackup(parsed);
    } catch (error) {
      if (existsSync(file) && !String(error.message).includes('ENOENT')) throw error;
      return clone(DEFAULT_DATA);
    }
  }

  function write(data) {
    const valid = validateBackup(data);
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(valid, null, 2) + '\n', { mode: 0o600 });
    renameSync(temp, file);
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
        data.history.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), ...clone(entry) });
        data.history = data.history.slice(0, 200);
      }).history[0];
    }
  };
}

export const database = createDatabase();
