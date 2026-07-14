// skills.sh is the ecosystem index used by the official open-source Skills CLI.
// Search protocol: https://github.com/vercel-labs/skills/blob/main/src/commands/find.ts
// Leaderboard semantics and authenticated API contract: https://skills.sh/docs/api
const SKILLS_BASE_URL = 'https://skills.sh';
const GITHUB_REPOSITORY = /^[a-z0-9](?:[a-z0-9_.-]{0,99})\/[a-z0-9](?:[a-z0-9_.-]{0,99})$/i;
const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map();

export const DISCOVERY_CATEGORIES = [
  { id: 'featured', label: '精选起点', query: 'agent workflow productivity' },
  { id: 'development', label: '开发与工程', query: 'software development coding engineering' },
  { id: 'research', label: '科研与论文', query: 'academic research literature review papers' },
  { id: 'data', label: '数据与图表', query: 'data analysis visualization dashboard' },
  { id: 'design', label: '设计与创意', query: 'frontend web design ui ux creative' },
  { id: 'documents', label: '文档与演示', query: 'documents presentation slides powerpoint pdf word' },
  { id: 'automation', label: '自动化与效率', query: 'workflow automation productivity browser' },
  { id: 'testing', label: '测试与质量', query: 'software testing playwright code review quality' },
  { id: 'devops', label: '部署与运维', query: 'devops deployment docker ci cd cloud' },
  { id: 'security', label: '安全与审计', query: 'security audit hardening vulnerability' },
  { id: 'marketing', label: '内容与增长', query: 'marketing seo content growth social media' }
];

const INTENT_GROUPS = [
  { terms: ['ppt', 'powerpoint', '幻灯片', '演示文稿', '汇报'], query: 'presentation slides powerpoint deck' },
  { terms: ['论文', '科研', '文献', '研究', '学术'], query: 'academic research literature review papers' },
  { terms: ['前端', '网页', '界面', 'ui', 'ux'], query: 'frontend web design ui ux' },
  { terms: ['数据', '图表', '分析', '可视化', 'dashboard'], query: 'data analysis visualization dashboard' },
  { terms: ['测试', 'playwright', '质量', '代码审查'], query: 'software testing playwright code review quality' },
  { terms: ['部署', '运维', 'docker', 'kubernetes', 'ci/cd'], query: 'devops deployment docker kubernetes ci cd' },
  { terms: ['写作', '文档', '润色', '编辑'], query: 'writing documentation editing' },
  { terms: ['excel', '表格', '电子表格'], query: 'spreadsheet excel data office' },
  { terms: ['pdf', 'word', '合同'], query: 'pdf document word processing' },
  { terms: ['图片', '图像', '视频', '音频'], query: 'image video audio creative generation' },
  { terms: ['安全', '漏洞', '审计', '加固'], query: 'security audit hardening vulnerability' },
  { terms: ['自动化', '效率', '工作流'], query: 'workflow automation productivity' },
  { terms: ['浏览器', '网页操作', '爬取'], query: 'browser automation web scraping' },
  { terms: ['营销', 'seo', '增长', '社交媒体'], query: 'marketing seo content growth social media' }
];

function decodeHtml(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function plainText(value) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, '')).trim();
}

function compactNumber(value) {
  const clean = String(value || '').trim().replaceAll(',', '').toUpperCase();
  const match = clean.match(/^([+-]?\d+(?:\.\d+)?)\s*([KMB])?$/);
  if (!match) return 0;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[match[2]] || 1;
  return Math.round(Number(match[1]) * multiplier);
}

function validSkillIdentity(id, source) {
  if (!GITHUB_REPOSITORY.test(source)) return false;
  const parts = String(id || '').split('/');
  return parts.length === 3 && `${parts[0]}/${parts[1]}`.toLowerCase() === source.toLowerCase() && Boolean(parts[2]);
}

function normalizeCatalogSkill(raw, extras = {}) {
  const source = plainText(raw.source);
  const id = plainText(raw.id || `${source}/${raw.skillId || raw.name}`);
  if (!validSkillIdentity(id, source)) return null;
  return {
    id,
    skillName: plainText(raw.name || raw.skillId || id.split('/').at(-1)),
    repository: source,
    installs: Math.max(0, Number(raw.installs) || 0),
    change: Number(extras.change) || 0,
    rank: Math.max(0, Number(extras.rank) || 0),
    url: `${SKILLS_BASE_URL}/${id}`,
    source: 'skills.sh',
    view: extras.view || 'search'
  };
}

export function parseSkillsLeaderboard(html, view = 'popular') {
  const items = [];
  const seen = new Set();
  const rowPattern = /<a\b[^>]*class="[^"]*\bgroup\s+grid\b[^"]*"[^>]*href="\/([^"?#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || '').matchAll(rowPattern)) {
    const id = decodeHtml(match[1]);
    const body = match[2];
    const name = plainText(body.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
    const source = plainText(body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    const rank = Number(plainText(body.match(/<span\b[^>]*>(\d+)<\/span>/i)?.[1])) || items.length + 1;
    const signals = [...body.matchAll(/<span\b[^>]*class="[^"]*font-mono\s+text-sm[^"]*"[^>]*>([^<]+)<\/span>/gi)]
      .map(signal => plainText(signal[1]));
    const installs = compactNumber(signals[0]);
    const change = signals.length > 1 ? compactNumber(signals[1]) : 0;
    const item = normalizeCatalogSkill({ id, name, source, installs }, { change, rank, view });
    if (!item || seen.has(item.id.toLowerCase())) continue;
    seen.add(item.id.toLowerCase());
    items.push(item);
  }
  return items;
}

export function expandDiscoveryQuery(search = '', category = '') {
  const input = String(search || '').replace(/[\r\n]/g, ' ').trim().slice(0, 160);
  if (!input) return DISCOVERY_CATEGORIES.find(item => item.id === category)?.query || '';
  const lowered = input.toLowerCase();
  const matches = INTENT_GROUPS.filter(group => group.terms.some(term => lowered.includes(term)));
  if (!matches.length) return input;
  return [...new Set(matches.flatMap(group => group.query.split(' ')))].join(' ');
}

async function cachedFetch(url, options) {
  const useCache = options.cache !== false;
  const cached = cache.get(url);
  if (useCache && cached?.expiresAt > Date.now()) return cached.value;
  const response = await options.fetchImpl(url, {
    headers: { Accept: 'application/json, text/html;q=0.9', 'User-Agent': 'SkillPilot-Local/0.8.0' },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Skills catalog returned HTTP ${response.status}.`);
  const value = await response.text();
  if (useCache) {
    if (!cache.has(url) && cache.size >= 80) cache.delete(cache.keys().next().value);
    cache.set(url, { value, expiresAt: Date.now() + CACHE_TTL });
  }
  return value;
}

async function searchCatalog(query, limit, options) {
  const words = query.split(/\s+/).filter(word => word.length >= 3);
  const queries = [...new Set([query, ...words])].slice(0, 5);
  const responses = await Promise.allSettled(queries.map(async searchQuery => {
    const url = `${SKILLS_BASE_URL}/api/search?${new URLSearchParams({ q: searchQuery, limit: String(limit) })}`;
    return { searchQuery, data: JSON.parse(await cachedFetch(url, options)) };
  }));
  const successful = responses.filter(result => result.status === 'fulfilled').map(result => result.value);
  if (!successful.length) throw responses[0]?.reason || new Error('Skills search is unavailable.');
  const byId = new Map();
  for (const { searchQuery, data } of successful) {
    for (const skill of Array.isArray(data.skills) ? data.skills : []) {
      const normalized = normalizeCatalogSkill(skill, { view: 'search' });
      if (!normalized) continue;
      if (searchQuery !== query && !normalized.skillName.toLowerCase().includes(searchQuery.toLowerCase())) continue;
      const existing = byId.get(normalized.id.toLowerCase());
      if (!existing || normalized.installs > existing.installs) byId.set(normalized.id.toLowerCase(), normalized);
    }
  }
  const items = [...byId.values()]
    .sort((a, b) => b.installs - a.installs || a.skillName.localeCompare(b.skillName))
    .slice(0, limit)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return { items, searchType: queries.length > 1 ? 'blended' : successful[0]?.data?.searchType || 'fuzzy' };
}

export async function discoverSkillsCatalog(input = {}, overrides = {}) {
  const options = { fetchImpl: overrides.fetchImpl || fetch, cache: overrides.cache };
  const view = ['popular', 'trending', 'hot'].includes(input.view) ? input.view : 'popular';
  const limit = Math.max(8, Math.min(50, Number(input.limit) || 24));
  const resolvedQuery = expandDiscoveryQuery(input.search, input.category);

  if (resolvedQuery) {
    const result = await searchCatalog(resolvedQuery, limit, options);
    return {
      source: 'skills.sh-search',
      view: 'search',
      query: String(input.search || ''),
      resolvedQuery,
      searchType: result.searchType,
      total: result.items.length,
      items: result.items.slice(0, limit)
    };
  }

  const pageUrl = `${SKILLS_BASE_URL}${view === 'popular' ? '/' : `/${view}`}`;
  const html = await cachedFetch(pageUrl, options);
  const items = parseSkillsLeaderboard(html, view).slice(0, limit);
  if (!items.length) throw new Error('Skills catalog did not return any usable GitHub skills.');
  return {
    source: 'skills.sh-leaderboard',
    view,
    query: '',
    resolvedQuery: '',
    searchType: null,
    total: items.length,
    items
  };
}
