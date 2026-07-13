import { readFileSync } from 'node:fs';

const REPOSITORY = 'Mxxy111/Skill-Pilot';
const API_VERSION = '2026-03-10';
const CACHE_TTL_MS = 60 * 60 * 1000;
const packageData = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export const CURRENT_VERSION = String(packageData.version);
let cache = null;

function versionParts(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) throw new Error('Invalid application version.');
  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function trustedGithubReleaseUrl(value, type) {
  try {
    const url = new URL(String(value || ''));
    const path = url.pathname.toLowerCase();
    const validPath = type === 'asset'
      ? /^\/mxxy111\/skill-pilot\/releases\/download\/[^/]+\/[^/]+$/.test(path)
      : /^\/mxxy111\/skill-pilot\/releases\/tag\/[^/]+$/.test(path);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || url.hash || !validPath) return null;
    return url.href;
  } catch { return null; }
}

export function normalizeRelease(release, currentVersion = CURRENT_VERSION) {
  if (!release || typeof release !== 'object') throw new Error('GitHub returned an invalid release.');
  if (release.draft === true || release.prerelease === true) throw new Error('GitHub did not return a stable release.');
  const latestParts = versionParts(release.tag_name);
  const latestVersion = latestParts.join('.');
  const url = trustedGithubReleaseUrl(release.html_url, 'release');
  if (!url) throw new Error('GitHub returned an invalid release URL.');
  const assets = Array.isArray(release.assets) ? release.assets.flatMap(asset => {
    const name = String(asset?.name || '').slice(0, 180);
    const assetUrl = trustedGithubReleaseUrl(asset?.browser_download_url, 'asset');
    if (!assetUrl || !/^SkillPilot-(?:Setup|Portable)-.+-x64\.exe$/i.test(name)) return [];
    return [{ name, url: assetUrl, size: Math.max(0, Number(asset.size) || 0) }];
  }).slice(0, 4) : [];
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    name: String(release.name || `SkillPilot ${latestVersion}`).trim().slice(0, 160),
    url,
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
    notes: String(release.body || '').trim().slice(0, 2000),
    assets
  };
}

export async function checkForAppUpdate(options = {}) {
  const currentVersion = String(options.currentVersion || CURRENT_VERSION);
  const now = options.now instanceof Date ? options.now : new Date();
  if (!options.force && cache?.currentVersion === currentVersion && now.getTime() - cache.at < CACHE_TTL_MS) return cache.result;

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SkillPilot-Desktop',
    'X-GitHub-Api-Version': API_VERSION,
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
  };
  const response = await (options.fetchImpl || fetch)(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
    headers,
    signal: AbortSignal.timeout(15_000)
  });
  const checkedAt = now.toISOString();
  let result;
  if (response.status === 404) {
    result = { status: 'unpublished', currentVersion, latestVersion: null, updateAvailable: false, checkedAt, release: null };
  } else {
    if (!response.ok) {
      if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
        throw new Error('GitHub API rate limit reached. Add a token in Settings or try again later.');
      }
      throw new Error(`GitHub release check returned HTTP ${response.status}.`);
    }
    const release = normalizeRelease(await response.json(), currentVersion);
    result = {
      status: release.updateAvailable ? 'update-available' : 'current',
      currentVersion,
      latestVersion: release.latestVersion,
      updateAvailable: release.updateAvailable,
      checkedAt,
      release
    };
  }
  cache = { at: now.getTime(), currentVersion, result };
  return result;
}
