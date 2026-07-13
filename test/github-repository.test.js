import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

import {
  inspectGitHubRepository,
  readRepositoryArchive
} from '../src/core/github-repository.js';
import { installRepositoryFiles } from '../src/core/repository-installer.js';

function repositoryZip() {
  const zip = new AdmZip();
  zip.addFile('owner-repo-deadbeef/skills/writer/SKILL.md', Buffer.from('---\nname: writer\n---\nWrite clearly.'));
  zip.addFile('owner-repo-deadbeef/skills/writer/scripts/check.js', Buffer.from('console.log("safe")'));
  zip.addFile('owner-repo-deadbeef/skills/reviewer/SKILL.md', Buffer.from('# Reviewer'));
  return zip.toBuffer();
}

test('GitHub inspection follows the default branch and pins an immutable commit', async () => {
  const calls = [];
  const archive = repositoryZip();
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).endsWith('/repos/owner/repo')) return Response.json({
      full_name: 'owner/repo',
      default_branch: 'trunk',
      html_url: 'https://github.com/owner/repo',
      description: 'Agent skills',
      stargazers_count: 42,
      license: { spdx_id: 'MIT' },
      owner: { login: 'owner' }
    });
    if (String(url).endsWith('/commits/trunk')) return Response.json({ sha: 'a'.repeat(40) });
    if (String(url).includes('/git/trees/')) return Response.json({
      truncated: false,
      tree: [
        { path: 'skills/writer/SKILL.md', type: 'blob', mode: '100644', size: 38 },
        { path: 'skills/reviewer/SKILL.md', type: 'blob', mode: '100644', size: 10 }
      ]
    });
    if (String(url).includes('/zipball/')) return new Response(archive, { headers: { 'content-type': 'application/zip' } });
    return new Response('not found', { status: 404 });
  };

  const result = await inspectGitHubRepository('owner/repo', { fetchImpl, token: 'test-token' });

  assert.equal(result.repository, 'owner/repo');
  assert.equal(result.defaultBranch, 'trunk');
  assert.equal(result.commitSha, 'a'.repeat(40));
  assert.equal(result.scan.installable, true);
  assert.deepEqual(result.scan.skills.map(skill => skill.path), ['skills/reviewer', 'skills/writer']);
  assert.ok(calls.some(url => url.endsWith('/commits/trunk')));
  assert.ok(calls.some(url => url.endsWith(`/zipball/${'a'.repeat(40)}`)));
});

test('archive reader removes the GitHub wrapper directory and preserves bounded file data', () => {
  const archive = readRepositoryArchive(repositoryZip());
  assert.deepEqual(archive.files.map(file => file.path), [
    'skills/reviewer/SKILL.md',
    'skills/writer/SKILL.md',
    'skills/writer/scripts/check.js'
  ]);
  assert.equal(archive.files[0].data.toString('utf8'), '# Reviewer');
});

test('repository installer copies only selected skill roots and refuses collisions', () => {
  const targetRoot = mkdtempSync(join(tmpdir(), 'skillpilot-target-'));
  const archive = readRepositoryArchive(repositoryZip());
  const available = [
    { name: 'reviewer', path: 'skills/reviewer' },
    { name: 'writer', path: 'skills/writer' }
  ];

  const installed = installRepositoryFiles({
    files: archive.files,
    availableSkills: available,
    selectedPaths: ['skills/writer'],
    targetRoot
  });

  assert.equal(installed.length, 1);
  assert.equal(installed[0].name, 'writer');
  assert.equal(readFileSync(join(targetRoot, 'writer', 'SKILL.md'), 'utf8').includes('Write clearly'), true);
  assert.equal(existsSync(join(targetRoot, 'reviewer')), false);
  assert.throws(() => installRepositoryFiles({
    files: archive.files,
    availableSkills: available,
    selectedPaths: ['skills/writer'],
    targetRoot
  }), /already exists/i);
});
