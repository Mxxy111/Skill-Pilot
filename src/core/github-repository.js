import AdmZip from 'adm-zip';
import { posix } from 'node:path';

import {
  analyzeRepositoryFiles,
  normalizeCommitSha,
  normalizeRepositorySlug,
  normalizeSkillSelection,
  validateArchivePath
} from './repository-security.js';

const API_ROOT = 'https://api.github.com';
const API_VERSION = '2026-03-10';
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.sh', '.bash', '.ps1', '.bat', '.cmd']);

function headers(token, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    'User-Agent': 'SkillPilot-Desktop',
    'X-GitHub-Api-Version': API_VERSION,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function githubJson(path, { fetchImpl, token }) {
  const response = await fetchImpl(`${API_ROOT}${path}`, {
    headers: headers(token),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
      throw new Error('GitHub API rate limit reached. Add a token in Settings or retry after the reset time.');
    }
    throw new Error(`GitHub API returned HTTP ${response.status}.`);
  }
  const value = await response.json();
  if (!value || typeof value !== 'object') throw new Error('GitHub returned an invalid response.');
  return value;
}

export async function downloadRepositoryArchive(repository, commitSha, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const slug = normalizeRepositorySlug(repository);
  const sha = normalizeCommitSha(commitSha);
  const response = await fetchImpl(`${API_ROOT}/repos/${slug}/zipball/${sha}`, {
    headers: headers(options.token, 'application/vnd.github+json'),
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`GitHub archive download returned HTTP ${response.status}.`);
  const declared = Number(response.headers.get('content-length')) || 0;
  if (declared > MAX_ARCHIVE_BYTES) throw new Error('Repository archive is too large.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_ARCHIVE_BYTES) throw new Error('Repository archive is empty or too large.');
  return buffer;
}

function isTextPath(path) {
  return TEXT_EXTENSIONS.has(posix.extname(path).toLowerCase()) || posix.basename(path) === 'SKILL.md';
}

function isRiskScanPath(path) {
  const name = posix.basename(path);
  if (name === 'SKILL.md') return true;
  return ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.sh', '.bash', '.ps1', '.bat', '.cmd'].includes(posix.extname(path).toLowerCase());
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function readRepositoryArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_ARCHIVE_BYTES) throw new Error('Invalid repository archive.');
  let entries;
  try { entries = new AdmZip(buffer).getEntries(); }
  catch { throw new Error('GitHub returned an invalid ZIP archive.'); }
  if (!entries.length) throw new Error('Repository archive is empty.');

  const firstSegments = new Set(entries.map(entry => String(entry.entryName).replace(/\\/g, '/').split('/')[0]).filter(Boolean));
  if (firstSegments.size !== 1) throw new Error('Repository archive has an unexpected root layout.');
  const wrapper = [...firstSegments][0];
  const files = [];
  let totalBytes = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const raw = String(entry.entryName).replace(/\\/g, '/');
    if (!raw.startsWith(`${wrapper}/`)) throw new Error('Repository archive contains an unsafe path.');
    const path = validateArchivePath(raw.slice(wrapper.length + 1));
    const declaredSize = Number(entry.header?.size) || 0;
    if (declaredSize < 0 || declaredSize > 5 * 1024 * 1024) throw new Error('Repository archive contains an oversized file.');
    totalBytes += declaredSize;
    if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('Repository archive expands beyond the allowed size.');
    const data = entry.getData();
    if (data.length !== declaredSize || data.length > 5 * 1024 * 1024) throw new Error('Repository archive contains an invalid file size.');
    files.push({
      path,
      size: data.length,
      text: isTextPath(path) && data.length <= MAX_TEXT_BYTES ? data.toString('utf8') : '',
      data
    });
  }

  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { files, totalBytes };
}

export async function inspectGitHubRepository(repository, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const token = options.token || '';
  const slug = normalizeRepositorySlug(repository);
  const repo = await githubJson(`/repos/${slug}`, { fetchImpl, token });
  if (typeof repo.full_name !== 'string' || typeof repo.default_branch !== 'string' || !repo.default_branch) {
    throw new Error('GitHub repository metadata is incomplete.');
  }
  const canonicalSlug = normalizeRepositorySlug(repo.full_name);
  const requestedRef = options.commitSha ? normalizeCommitSha(options.commitSha) : repo.default_branch;
  const commit = await githubJson(`/repos/${canonicalSlug}/commits/${encodeURIComponent(requestedRef)}`, { fetchImpl, token });
  const commitSha = normalizeCommitSha(commit.sha);
  const tree = await githubJson(`/repos/${canonicalSlug}/git/trees/${commitSha}?recursive=1`, { fetchImpl, token });
  if (!Array.isArray(tree.tree)) throw new Error('GitHub repository tree is incomplete.');

  const blobEntries = tree.tree.filter(entry => entry?.type === 'blob' && typeof entry.path === 'string');
  const skillRoots = blobEntries
    .filter(entry => posix.basename(entry.path) === 'SKILL.md')
    .map(entry => posix.dirname(entry.path));
  const availableSkills = skillRoots.map(root => ({ name: root === '.' ? canonicalSlug.split('/')[1] : posix.basename(root), path: root }));
  const selectedRoots = options.skillPaths?.length ? normalizeSkillSelection(options.skillPaths, availableSkills) : skillRoots;
  const relevantEntries = blobEntries.filter(entry => selectedRoots.some(root => root === '.' || entry.path === `${root}/SKILL.md` || entry.path.startsWith(`${root}/`)));
  const preliminary = analyzeRepositoryFiles(relevantEntries.map(entry => ({ path: entry.path, size: entry.size, text: '' })), {
    isTreeTruncated: Boolean(tree.truncated),
    hasUnsupportedLinks: tree.tree.some(entry => entry?.mode === '120000' || entry?.type === 'commit')
  });
  let repositoryFiles = relevantEntries.map(entry => ({ path: entry.path, size: Number(entry.size) || 0, text: '', data: null }));
  if (preliminary.installable) {
    const includeFiles = options.includeFiles !== false;
    repositoryFiles = await mapWithConcurrency(relevantEntries, 6, async entry => {
      const shouldFetch = includeFiles || isRiskScanPath(entry.path);
      if (!shouldFetch) return { path: entry.path, size: Number(entry.size) || 0, text: '', data: null };
      const encodedPath = entry.path.split('/').map(encodeURIComponent).join('/');
      const response = await fetchImpl(`https://raw.githubusercontent.com/${canonicalSlug}/${commitSha}/${encodedPath}`, {
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error(`GitHub raw file download returned HTTP ${response.status}.`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > 5 * 1024 * 1024) throw new Error('Repository contains an oversized file.');
      return { path: entry.path, size: data.length, text: isTextPath(entry.path) && data.length <= MAX_TEXT_BYTES ? data.toString('utf8') : '', data };
    });
  }
  const scan = analyzeRepositoryFiles(repositoryFiles, {
    isTreeTruncated: Boolean(tree.truncated),
    hasUnsupportedLinks: tree.tree.some(entry => entry?.mode === '120000' || entry?.type === 'commit')
  });

  return {
    repository: canonicalSlug,
    defaultBranch: repo.default_branch,
    commitSha,
    metadata: {
      name: canonicalSlug,
      url: typeof repo.html_url === 'string' ? repo.html_url : `https://github.com/${canonicalSlug}`,
      description: typeof repo.description === 'string' ? repo.description.slice(0, 500) : '',
      stars: Number(repo.stargazers_count) || 0,
      license: typeof repo.license?.spdx_id === 'string' ? repo.license.spdx_id : null,
      owner: typeof repo.owner?.login === 'string' ? repo.owner.login : canonicalSlug.split('/')[0]
    },
    scan,
    repositoryFiles
  };
}

export function publicInspection(inspection) {
  const { archiveBuffer, repositoryFiles, ...safe } = inspection;
  return safe;
}
