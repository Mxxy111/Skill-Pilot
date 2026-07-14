import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { getDiscoveryCatalog, installDiscoveredSkills } from '../src/core/discovery-service.js';

test('discovery falls back to GitHub repositories when the skills index is unavailable', async () => {
  const result = await getDiscoveryCatalog({ search: 'PPT', view: 'popular' }, {
    catalogImpl: async () => { throw new Error('catalog offline'); },
    githubImpl: async input => {
      assert.match(input.search, /presentation/);
      return { items: [{
        name: 'owner/presentation-skills', url: 'https://github.com/owner/presentation-skills', description: 'Slides',
        stars: 120, topics: ['slides'], license: 'MIT', updatedAt: '2026-07-01T00:00:00.000Z'
      }] };
    }
  });
  assert.equal(result.source, 'github-fallback');
  assert.equal(result.items[0].repository, 'owner/presentation-skills');
  assert.equal(result.items[0].stars, 120);
  assert.match(result.warning, /catalog offline/);
});

function inspection(riskLevel = 'low') {
  return {
    repository: 'owner/repo',
    commitSha: 'a'.repeat(40),
    archiveBuffer: Buffer.from('archive-placeholder'),
    scan: {
      installable: true,
      skills: [{ name: 'writer', path: 'skills/writer' }],
      risk: {
        level: riskLevel,
        requiresAcknowledgement: riskLevel === 'high',
        findings: riskLevel === 'high' ? [{ code: 'REMOTE_PIPE_EXECUTION', severity: 'high' }] : []
      }
    }
  };
}

test('installation requires explicit acknowledgement for high-risk repositories', async () => {
  await assert.rejects(() => installDiscoveredSkills({
    repository: 'owner/repo',
    commitSha: 'a'.repeat(40),
    targetAgent: 'codex',
    skillPaths: ['skills/writer'],
    acknowledgeRisk: false
  }, {
    inspectImpl: async () => inspection('high'),
    targetResolver: () => ({ id: 'codex', name: 'Codex', path: mkdtempSync(join(tmpdir(), 'skillpilot-codex-')) }),
    archiveReader: () => ({ files: [] }),
    installer: () => []
  }), /acknowledge/i);
});

test('installation records immutable repository provenance for maintenance', async () => {
  const targetRoot = mkdtempSync(join(tmpdir(), 'skillpilot-codex-'));
  let recorded = null;
  const result = await installDiscoveredSkills({
    repository: 'owner/repo',
    commitSha: 'a'.repeat(40),
    targetAgent: 'codex',
    skillPaths: ['skills/writer'],
    acknowledgeRisk: false
  }, {
    inspectImpl: async (_repo, options) => {
      assert.equal(options.commitSha, 'a'.repeat(40));
      return inspection('low');
    },
    targetResolver: () => ({ id: 'codex', name: 'Codex', path: targetRoot }),
    archiveReader: () => ({ files: [{ path: 'skills/writer/SKILL.md', data: Buffer.from('# Writer') }] }),
    installer: () => [{ name: 'writer', path: join(targetRoot, 'writer'), sourcePath: 'skills/writer', fileCount: 1 }],
    recordInstallsImpl: entries => { recorded = entries; },
    addHistory: () => {}
  });

  assert.equal(result.installed.length, 1);
  assert.deepEqual(recorded[0], {
    id: 'github:codex:owner/repo:skills/writer',
    name: 'writer',
    marketplace: 'github:codex',
    installPath: join(targetRoot, 'writer'),
    sourceRepo: 'owner/repo',
    sourcePath: 'skills/writer',
    targetAgent: 'codex',
    commitHash: 'a'.repeat(40),
    version: null
  });
});
