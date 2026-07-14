import test from 'node:test';
import assert from 'node:assert/strict';

import {
  discoverSkillsCatalog,
  expandDiscoveryQuery,
  parseSkillsLeaderboard
} from '../src/core/skills-catalog.js';

const leaderboardHtml = `
  <a class="group grid leaderboard-row" href="/vercel-labs/skills/find-skills">
    <span class="rank">1</span>
    <h3 class="skill-name">find-skills</h3>
    <p class="skill-source">vercel-labs/skills</p>
    <span class="font-mono text-sm text-foreground">634.9K</span>
    <span class="font-mono text-sm text-green-500">+92</span>
  </a>
  <a class="group grid leaderboard-row" href="/anthropics/skills/frontend-design">
    <span class="rank">2</span>
    <h3 class="skill-name">frontend-design</h3>
    <p class="skill-source">anthropics/skills</p>
    <span class="font-mono text-sm text-foreground">21,340</span>
  </a>`;

test('skills.sh leaderboard rows become install-ranked individual skills', () => {
  const skills = parseSkillsLeaderboard(leaderboardHtml, 'hot');
  assert.equal(skills.length, 2);
  assert.deepEqual(skills[0], {
    id: 'vercel-labs/skills/find-skills',
    skillName: 'find-skills',
    repository: 'vercel-labs/skills',
    installs: 634900,
    change: 92,
    rank: 1,
    url: 'https://skills.sh/vercel-labs/skills/find-skills',
    source: 'skills.sh',
    view: 'hot'
  });
});

test('discovery query expansion understands task language instead of exact skill names', () => {
  assert.equal(expandDiscoveryQuery('我想做一份 PPT 汇报'), 'presentation slides powerpoint deck');
  assert.equal(expandDiscoveryQuery('', 'research'), 'academic research literature review papers');
  assert.equal(expandDiscoveryQuery('React Native'), 'React Native');
});

test('catalog search uses the skills ecosystem index and rejects non-GitHub install sources', async () => {
  const requests = [];
  const fetchImpl = async url => {
    requests.push(String(url));
    return new Response(JSON.stringify({
      searchType: 'semantic',
      skills: [
        { id: 'igorwarzocha/opencode-workflows/powerpoint', name: 'powerpoint', source: 'igorwarzocha/opencode-workflows', installs: 5081 },
        { id: 'example.com/private-skill', name: 'private-skill', source: 'example.com', installs: 9000 }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await discoverSkillsCatalog({ search: '做 PPT', limit: 20 }, { fetchImpl, cache: false });
  assert.match(requests[0], /skills\.sh\/api\/search/);
  assert.match(requests[0], /presentation/);
  assert.equal(result.source, 'skills.sh-search');
  assert.equal(result.searchType, 'blended');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].repository, 'igorwarzocha/opencode-workflows');
  assert.equal(result.items[0].installs, 5081);
});

test('catalog opens with a populated popularity view before the user searches', async () => {
  const fetchImpl = async url => {
    assert.equal(String(url), 'https://skills.sh/');
    return new Response(leaderboardHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const result = await discoverSkillsCatalog({ view: 'popular', limit: 12 }, { fetchImpl, cache: false });
  assert.equal(result.source, 'skills.sh-leaderboard');
  assert.equal(result.view, 'popular');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].rank, 1);
});
