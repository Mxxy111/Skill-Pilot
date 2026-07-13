import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { replaceRepositorySkill } from '../src/core/repository-updater.js';

test('tracked skill update creates a backup and atomically replaces the skill contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'skillpilot-update-'));
  const installPath = join(root, 'writer');
  const backupRoot = join(root, 'backups');
  mkdirSync(installPath, { recursive: true });
  writeFileSync(join(installPath, 'SKILL.md'), '# Old writer');
  writeFileSync(join(installPath, 'local-notes.txt'), 'keep in backup');

  const result = replaceRepositorySkill({
    files: [
      { path: 'skills/writer/SKILL.md', data: Buffer.from('# New writer') },
      { path: 'skills/writer/scripts/check.js', data: Buffer.from('console.log("ok")') }
    ],
    sourcePath: 'skills/writer',
    installPath,
    backupRoot
  });

  assert.equal(readFileSync(join(installPath, 'SKILL.md'), 'utf8'), '# New writer');
  assert.equal(existsSync(join(installPath, 'local-notes.txt')), false);
  assert.equal(readFileSync(join(result.backupPath, 'local-notes.txt'), 'utf8'), 'keep in backup');
});

test('tracked skill update refuses a source path without SKILL.md and leaves the original intact', () => {
  const root = mkdtempSync(join(tmpdir(), 'skillpilot-update-'));
  const installPath = join(root, 'writer');
  mkdirSync(installPath, { recursive: true });
  writeFileSync(join(installPath, 'SKILL.md'), '# Original');

  assert.throws(() => replaceRepositorySkill({
    files: [{ path: 'skills/other/readme.md', data: Buffer.from('missing') }],
    sourcePath: 'skills/writer',
    installPath,
    backupRoot: join(root, 'backups')
  }), /SKILL\.md/i);
  assert.equal(readFileSync(join(installPath, 'SKILL.md'), 'utf8'), '# Original');
});
