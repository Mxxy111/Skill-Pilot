import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkAllUpdates, updateTrackedInstall } from '../src/core/updates.js';

test('update checking reports tracked, skipped and failed sources separately', async () => {
  const manifest = {
    good: { id: 'good', name: 'writer', installPath: 'D:/skills/writer', sourceRepo: 'owner/good', sourcePath: 'skills/writer', commitHash: 'a'.repeat(40), updateAvailable: false },
    failing: { id: 'failing', name: 'bad', installPath: 'D:/skills/bad', sourceRepo: 'owner/failing', sourcePath: 'skills/bad', commitHash: 'b'.repeat(40), updateAvailable: false },
    local: { id: 'local', name: 'local-only', sourceRepo: null, sourcePath: null, commitHash: null, updateAvailable: false }
  };
  let saved = null;
  const result = await checkAllUpdates({
    force: true,
    loadManifestImpl: () => structuredClone(manifest),
    saveManifestImpl: value => { saved = value; },
    resolveLatestCommitImpl: async repository => {
      if (repository === 'owner/failing') throw new Error('rate limited');
      return 'c'.repeat(40);
    }
  });

  assert.equal(result.tracked, 3);
  assert.equal(result.eligible, 2);
  assert.equal(result.checked, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.updatesAvailable, 1);
  assert.equal(saved.good.updateAvailable, true);
  assert.equal(saved.failing.lastError, 'rate limited');
});

test('update checking resolves the latest commit once per repository', async () => {
  const manifest = {
    writer: { id: 'writer', installPath: 'D:/skills/writer', sourceRepo: 'owner/shared', sourcePath: 'skills/writer', commitHash: 'a'.repeat(40) },
    reviewer: { id: 'reviewer', installPath: 'D:/skills/reviewer', sourceRepo: 'owner/shared', sourcePath: 'skills/reviewer', commitHash: 'a'.repeat(40) }
  };
  let lookups = 0;
  const result = await checkAllUpdates({
    force: true,
    loadManifestImpl: () => structuredClone(manifest),
    saveManifestImpl: () => {},
    resolveLatestCommitImpl: async () => {
      lookups++;
      return 'b'.repeat(40);
    }
  });

  assert.equal(lookups, 1);
  assert.equal(result.eligible, 2);
  assert.equal(result.checked, 2);
  assert.equal(result.updatesAvailable, 2);
});

test('tracked updates replace from a rescanned immutable commit and persist backup metadata', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skillpilot-tracked-update-'));
  const installPath = join(root, 'writer');
  mkdirSync(installPath);
  const manifest = {
    good: {
      id: 'good', name: 'writer', sourceRepo: 'owner/good', sourcePath: 'skills/writer',
      targetAgent: 'codex', installPath, commitHash: 'a'.repeat(40), latestCommitHash: 'c'.repeat(40), updateAvailable: true
    }
  };
  let saved = null;
  const result = await updateTrackedInstall('good', {
    loadManifestImpl: () => structuredClone(manifest),
    saveManifestImpl: value => { saved = value; },
    inspectImpl: async (_repo, options) => ({
      repository: 'owner/good', commitSha: options.commitSha, archiveBuffer: Buffer.from('zip'),
      scan: { installable: true, skills: [{ name: 'writer', path: 'skills/writer' }], risk: { level: 'low', findings: [] } }
    }),
    archiveReader: () => ({ files: [{ path: 'skills/writer/SKILL.md', data: Buffer.from('# Updated') }] }),
    replaceImpl: () => ({ backupPath: 'D:/backups/writer-1', fileCount: 1 }),
    backupRoot: 'D:/backups'
  });

  assert.equal(result.ok, true);
  assert.equal(result.backupPath, 'D:/backups/writer-1');
  assert.equal(saved.good.commitHash, 'c'.repeat(40));
  assert.equal(saved.good.updateAvailable, false);
  assert.equal(saved.good.lastBackupPath, 'D:/backups/writer-1');
});
