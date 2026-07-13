import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase, validateBackup } from '../src/core/database.js';

test('database persists metadata and exports a schema-versioned backup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skillpilot-db-'));
  const file = join(dir, 'database.json');
  const db = createDatabase(file);

  db.updateSkill('codex:writer', { category: 'Writing', isFavorite: true });
  db.addHistory({ type: 'classify', status: 'success', message: 'classified 1 skill' });

  const reloaded = createDatabase(file);
  assert.equal(reloaded.getSkill('codex:writer').category, 'Writing');
  assert.equal(reloaded.getSkill('codex:writer').isFavorite, true);
  assert.equal(reloaded.snapshot().schemaVersion, 1);
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
