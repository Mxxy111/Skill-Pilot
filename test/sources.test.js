import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanSkillRoot } from '../src/core/sources.js';

test('source scanner discovers valid skill directories and ignores hidden entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'skillpilot-source-'));
  mkdirSync(join(root, 'writer'));
  writeFileSync(join(root, 'writer', 'SKILL.md'), '---\nname: writer\ndescription: Writes clean docs\n---\nUse this skill.');
  mkdirSync(join(root, '.hidden'));
  writeFileSync(join(root, '.hidden', 'SKILL.md'), '# hidden');

  const skills = scanSkillRoot({ id: 'custom', name: 'Custom', agent: 'custom', path: root, enabled: true });
  assert.equal(skills.length, 1);
  assert.equal(skills[0].id, 'custom:writer');
  assert.equal(skills[0].description, 'Writes clean docs');
  assert.equal(existsSync(skills[0].path), true);
});
