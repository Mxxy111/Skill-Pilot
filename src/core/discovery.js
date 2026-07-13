import { database } from './database.js';

const CATEGORY_TERMS = {
  development: 'coding OR development',
  science: 'research OR science',
  data: 'data OR analytics',
  design: 'design OR frontend',
  productivity: 'productivity OR automation',
  security: 'security OR audit',
  writing: 'writing OR documentation'
};

export function buildGithubQuery({ search = '', category = '' } = {}) {
  const cleanSearch = String(search).replace(/[\r\n]/g, ' ').trim().slice(0, 100);
  const categoryTerm = CATEGORY_TERMS[String(category).toLowerCase()] || '';
  return [cleanSearch, categoryTerm, '"SKILL.md"', 'agent skills', 'archived:false']
    .filter(Boolean)
    .join(' ');
}

export function normalizeRepository(repo) {
  return {
    id: repo.id,
    name: repo.full_name,
    url: repo.html_url,
    description: repo.description || '',
    stars: Number(repo.stargazers_count || 0),
    forks: Number(repo.forks_count || 0),
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    topics: Array.isArray(repo.topics) ? repo.topics.slice(0, 8) : [],
    license: repo.license?.spdx_id || null,
    owner: repo.owner?.login || '',
    avatarUrl: repo.owner?.avatar_url || ''
  };
}

export async function searchGithub({ search, category, sort = 'popular', page = 1 } = {}) {
  // GitHub repository search contract:
  // https://docs.github.com/en/rest/search/search#search-repositories
  const query = buildGithubQuery({ search, category });
  const params = new URLSearchParams({
    q: query,
    sort: sort === 'latest' ? 'updated' : 'stars',
    order: 'desc',
    per_page: '24',
    page: String(Math.max(1, Math.min(10, Number(page) || 1)))
  });
  const settings = database.getSettings().github;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SkillPilot-Local'
  };
  if (settings.token) headers.Authorization = `Bearer ${settings.token}`;
  const response = await fetch(`https://api.github.com/search/repositories?${params}`, {
    headers,
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    throw new Error(response.status === 403 && remaining === '0'
      ? 'GitHub API rate limit reached. Add a token in Settings.'
      : `GitHub returned HTTP ${response.status}.`);
  }
  const data = await response.json();
  return {
    items: Array.isArray(data.items) ? data.items.map(normalizeRepository) : [],
    total: Math.min(Number(data.total_count || 0), 1000),
    page: Number(page) || 1,
    query
  };
}
