import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGithubQuery, normalizeRepository } from '../src/core/discovery.js';

test('GitHub discovery query is bounded and skill-specific', () => {
  const query = buildGithubQuery({ search: 'medical research', category: 'science' });
  assert.match(query, /medical research/);
  assert.match(query, /SKILL\.md/);
  assert.match(query, /archived:false/);
});
test('GitHub repository response is normalized to a stable UI contract', () => {
  const repo = normalizeRepository({
    id: 42,
    full_name: 'owner/skills',
    html_url: 'https://github.com/owner/skills',
    description: 'Useful agent skills',
    stargazers_count: 120,
    forks_count: 10,
    updated_at: '2026-07-01T00:00:00Z',
    pushed_at: '2026-06-30T00:00:00Z',
    topics: ['agents'],
    license: { spdx_id: 'MIT' },
    owner: { login: 'owner', avatar_url: 'https://example.test/avatar.png' }
  });
  assert.deepEqual(repo, {
    id: 42,
    name: 'owner/skills',
    url: 'https://github.com/owner/skills',
    description: 'Useful agent skills',
    stars: 120,
    forks: 10,
    updatedAt: '2026-07-01T00:00:00Z',
    pushedAt: '2026-06-30T00:00:00Z',
    topics: ['agents'],
    license: 'MIT',
    owner: 'owner',
    avatarUrl: 'https://example.test/avatar.png'
  });
});
