import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
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
