import test from 'node:test';
import assert from 'node:assert/strict';

import { checkForAppUpdate, compareVersions, normalizeRelease } from '../src/core/app-updates.js';

test('semantic version comparison handles v-prefixed stable releases', () => {
  assert.equal(compareVersions('v0.6.0', '0.5.0'), 1);
  assert.equal(compareVersions('0.5.0', 'v0.5.0'), 0);
  assert.equal(compareVersions('1.0.0', '1.2.0'), -1);
  assert.throws(() => compareVersions('latest', '0.5.0'), /version/i);
});

test('release normalization exposes only trusted GitHub Windows assets', () => {
  const result = normalizeRelease({
    tag_name: 'v0.6.0',
    name: 'SkillPilot 0.6.0',
    html_url: 'https://github.com/Mxxy111/Skill-Pilot/releases/tag/v0.6.0',
    published_at: '2026-07-14T00:00:00.000Z',
    body: 'Stable release',
    assets: [
      { name: 'SkillPilot-Setup-0.6.0-x64.exe', size: 100, browser_download_url: 'https://github.com/Mxxy111/Skill-Pilot/releases/download/v0.6.0/SkillPilot-Setup-0.6.0-x64.exe' },
      { name: 'notes.txt', size: 10, browser_download_url: 'https://example.com/notes.txt' }
    ]
  }, '0.5.0');

  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestVersion, '0.6.0');
  assert.equal(result.assets.length, 1);
  assert.match(result.assets[0].name, /Setup/);
});

test('release normalization rejects prereleases and imprecise GitHub URLs', () => {
  const base = {
    tag_name: 'v0.6.0',
    name: 'SkillPilot 0.6.0',
    html_url: 'https://github.com/Mxxy111/Skill-Pilot/releases/tag/v0.6.0',
    assets: []
  };
  assert.throws(() => normalizeRelease({ ...base, prerelease: true }, '0.5.0'), /stable release/i);
  assert.throws(() => normalizeRelease({ ...base, draft: true }, '0.5.0'), /stable release/i);
  assert.throws(() => normalizeRelease({ ...base, html_url: 'https://github.com/Mxxy111/Skill-Pilot/releases/anything' }, '0.5.0'), /URL/i);
});

test('update check treats a repository without releases as unpublished', async () => {
  const result = await checkForAppUpdate({
    currentVersion: '0.5.0',
    force: true,
    fetchImpl: async () => new Response('not found', { status: 404 })
  });

  assert.deepEqual(result, {
    status: 'unpublished',
    currentVersion: '0.5.0',
    latestVersion: null,
    updateAvailable: false,
    checkedAt: result.checkedAt,
    release: null
  });
});

test('update check parses the latest published release response', async () => {
  const result = await checkForAppUpdate({
    currentVersion: '0.5.0',
    force: true,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.github.com/repos/Mxxy111/Skill-Pilot/releases/latest');
      assert.equal(options.headers['X-GitHub-Api-Version'], '2026-03-10');
      return Response.json({
        tag_name: 'v0.6.0',
        name: 'SkillPilot 0.6.0',
        html_url: 'https://github.com/Mxxy111/Skill-Pilot/releases/tag/v0.6.0',
        published_at: '2026-07-14T00:00:00.000Z',
        body: 'Update notes',
        assets: []
      });
    }
  });

  assert.equal(result.status, 'update-available');
  assert.equal(result.latestVersion, '0.6.0');
  assert.equal(result.release.name, 'SkillPilot 0.6.0');
});
