import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase, SCHEMA_VERSION, validateBackup } from '../src/core/database.js';

test('database persists metadata and exports a schema-versioned backup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skillpilot-db-'));
  const file = join(dir, 'database.json');
  const db = createDatabase(file);

  db.updateSkill('codex:writer', { category: 'Writing', isFavorite: true });
  db.addHistory({ type: 'classify', status: 'success', message: 'classified 1 skill' });

  const reloaded = createDatabase(file);
  assert.equal(reloaded.getSkill('codex:writer').category, 'Writing');
  assert.equal(reloaded.getSkill('codex:writer').isFavorite, true);
  assert.equal(reloaded.snapshot().schemaVersion, SCHEMA_VERSION);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).history.length, 1);
});
test('backup validation rejects unknown or malformed schemas', () => {
  assert.throws(() => validateBackup({ schemaVersion: 99 }), /schema/i);
  assert.throws(() => validateBackup({ schemaVersion: 1, skills: [] }), /skills/i);
});

test('public settings never expose stored credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skillpilot-secrets-'));
  const db = createDatabase(join(dir, 'database.json'));
  db.updateSettings({ ai: { apiKey: 'secret-ai' }, github: { token: 'secret-gh' } });

  const settings = db.getPublicSettings();
  assert.equal(settings.ai.apiKey, undefined);
  assert.equal(settings.github.token, undefined);
  assert.equal(settings.ai.hasApiKey, true);
  assert.equal(settings.github.hasToken, true);
});

test('schema v1 migration clears legacy classification and introduces empty groups', () => {
  const migrated = validateBackup({
    schemaVersion: 1,
    skills: {
      'codex:writer': {
        category: 'Very narrow writing subtype',
        subcategory: 'Old subtype',
        tags: ['citations'],
        isFavorite: true,
        lastClassifiedAt: '2026-01-01T00:00:00.000Z',
        lastClassificationFingerprint: 'old'
      }
    },
    customSources: [],
    settings: {},
    history: []
  });

  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.skills['codex:writer'].category, undefined);
  assert.equal(migrated.skills['codex:writer'].subcategory, undefined);
  assert.equal(migrated.skills['codex:writer'].lastClassifiedAt, null);
  assert.equal(migrated.skills['codex:writer'].isFavorite, true);
  assert.deepEqual(migrated.groups, []);
  assert.equal(migrated.settings.automation.classificationConcurrency, 3);
  assert.equal(migrated.settings.automation.classificationBatchSize, undefined);
});

test('schema v2 migration preserves custom groups and removes classification audit payloads', () => {
  const migrated = validateBackup({
    schemaVersion: 2,
    skills: { 'codex:writer': { groupId: 'g1', category: 'Writing' } },
    groups: [{ id: 'g1', name: 'Work' }],
    customSources: [],
    settings: {},
    history: [
      { id: 'classify', type: 'classify', details: { category: 'Writing' } },
      { id: 'maintenance', type: 'maintenance', details: { updates: { checked: 1 }, classification: { results: [{ category: 'Writing' }] } } },
      { id: 'delete', type: 'delete', details: { count: 1 } }
    ]
  });

  assert.equal(migrated.groups[0].name, 'Work');
  assert.equal(migrated.skills['codex:writer'].groupId, 'g1');
  assert.equal(migrated.skills['codex:writer'].category, undefined);
  assert.deepEqual(migrated.history.map(entry => entry.id), ['maintenance', 'delete']);
  assert.equal(migrated.history[0].details.classification, undefined);
  assert.equal(migrated.history[0].details.updates.checked, 1);
});

test('opening a schema v1 database safely persists the migration on Windows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skillpilot-migration-'));
  const file = join(dir, 'database.json');
  writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    skills: { 'codex:writer': { category: 'Old category' } },
    customSources: [],
    settings: {},
    history: []
  }));

  const snapshot = createDatabase(file).snapshot();
  assert.equal(snapshot.schemaVersion, SCHEMA_VERSION);
  assert.equal(snapshot.skills['codex:writer'].category, undefined);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).schemaVersion, SCHEMA_VERSION);
});

test('database restores an interrupted replacement backup before reading', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skillpilot-recovery-'));
  const file = join(dir, 'database.json');
  writeFileSync(`${file}.replace-backup`, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    skills: { 'codex:writer': { isFavorite: true } },
    groups: [],
    customSources: [],
    settings: {},
    history: []
  }));

  const snapshot = createDatabase(file).snapshot();
  assert.equal(snapshot.skills['codex:writer'].isFavorite, true);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).schemaVersion, SCHEMA_VERSION);
});

test('database supports custom group CRUD and unassigns skills when a group is deleted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skillpilot-groups-'));
  const db = createDatabase(join(dir, 'database.json'));
  const group = db.createGroup('Research');
  db.assignSkillsToGroup(['codex:writer', 'codex:reader'], group.id);

  assert.equal(db.getSkill('codex:writer').groupId, group.id);
  assert.equal(db.updateGroup(group.id, { name: 'Research Ops' }).name, 'Research Ops');
  db.removeGroup(group.id);
  assert.equal(db.getSkill('codex:writer').groupId, undefined);
  assert.deepEqual(db.listGroups(), []);
});
