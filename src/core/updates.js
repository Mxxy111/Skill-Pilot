import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { database } from './database.js';
import { inspectGitHubRepository, readRepositoryArchive } from './github-repository.js';
import { BACKUP_DIR, MANIFEST_FILE } from './paths.js';
import { replaceRepositorySkill } from './repository-updater.js';
import { normalizeCommitSha, normalizeRepositorySlug } from './repository-security.js';

const CHECK_INTERVAL = 4 * 60 * 60 * 1000;
const API_VERSION = '2026-03-10';

export function loadManifest() {
  try {
    const value = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function saveManifest(data) {
  mkdirSync(dirname(MANIFEST_FILE), { recursive: true });
  const temp = `${MANIFEST_FILE}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(temp, MANIFEST_FILE);
}

export function recordInstall(name, marketplace, details) {
  return recordInstalls([{ name, marketplace, ...details }])[0];
}

export function recordInstalls(installs) {
  const manifest = loadManifest();
  const created = installs.map(details => {
    const key = details.id || `${details.marketplace}/${details.name}`;
    const entry = {
      id: key,
      name: details.name,
      marketplace: details.marketplace,
      installedAt: new Date().toISOString(),
      installPath: details.installPath || null,
      sourceRepo: details.sourceRepo || null,
      sourcePath: details.sourcePath || null,
      targetAgent: details.targetAgent || null,
      commitHash: details.commitHash || null,
      version: details.version || null,
      checkedAt: null,
      latestCommitHash: null,
      updateAvailable: false,
      lastError: null,
      lastBackupPath: null
    };
    manifest[key] = entry;
    return entry;
  });
  saveManifest(manifest);
  return created;
}

export async function resolveLatestCommit(repository, options = {}) {
  const slug = normalizeRepositorySlug(repository);
  const fetchImpl = options.fetchImpl || fetch;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SkillPilot-Desktop',
    'X-GitHub-Api-Version': API_VERSION,
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
  };
  const repoResponse = await fetchImpl(`https://api.github.com/repos/${slug}`, { headers, signal: AbortSignal.timeout(30_000) });
  if (!repoResponse.ok) throw new Error(`GitHub repository lookup returned HTTP ${repoResponse.status}.`);
  const repo = await repoResponse.json();
  if (typeof repo.default_branch !== 'string' || !repo.default_branch) throw new Error('GitHub repository has no default branch.');
  const commitResponse = await fetchImpl(`https://api.github.com/repos/${slug}/commits/${encodeURIComponent(repo.default_branch)}`, { headers, signal: AbortSignal.timeout(30_000) });
  if (!commitResponse.ok) throw new Error(`GitHub commit lookup returned HTTP ${commitResponse.status}.`);
  const commit = await commitResponse.json();
  return normalizeCommitSha(commit.sha);
}

export async function checkAllUpdates(options = {}) {
  const force = options.force === true;
  const load = options.loadManifestImpl || loadManifest;
  const save = options.saveManifestImpl || saveManifest;
  const latest = options.resolveLatestCommitImpl || resolveLatestCommit;
  const token = options.token ?? database.getSettings().github.token;
  const manifest = load();
  const results = [];
  let checked = 0;
  let skipped = 0;
  let failed = 0;
  let updatesAvailable = 0;

  for (const [key, saved] of Object.entries(manifest)) {
    const entry = { ...saved, id: saved.id || key };
    manifest[key] = entry;
    if (!entry.sourceRepo || !entry.commitHash) {
      skipped++;
      entry.lastError = 'Source provenance is unavailable.';
      results.push(entry);
      continue;
    }
    if (!force && entry.checkedAt && Date.now() - new Date(entry.checkedAt).getTime() < CHECK_INTERVAL) {
      skipped++;
      if (entry.updateAvailable) updatesAvailable++;
      results.push(entry);
      continue;
    }
    try {
      const latestHash = await latest(entry.sourceRepo, { token, fetchImpl: options.fetchImpl });
      entry.latestCommitHash = latestHash;
      entry.updateAvailable = latestHash !== entry.commitHash;
      entry.checkedAt = new Date().toISOString();
      entry.lastError = null;
      checked++;
      if (entry.updateAvailable) updatesAvailable++;
    } catch (error) {
      failed++;
      entry.checkedAt = new Date().toISOString();
      entry.lastError = String(error.message || error).slice(0, 240);
    }
    results.push(entry);
  }

  save(manifest);
  return { tracked: results.length, checked, skipped, failed, updatesAvailable, plugins: results };
}

export function getUpdateSummary() {
  const entries = Object.values(loadManifest());
  const updates = entries.filter(entry => entry.updateAvailable);
  return {
    tracked: entries.length,
    eligible: entries.filter(entry => entry.sourceRepo && entry.sourcePath && entry.commitHash).length,
    failed: entries.filter(entry => entry.lastError).length,
    updates,
    total: updates.length
  };
}

export async function updateTrackedInstall(id, options = {}) {
  const load = options.loadManifestImpl || loadManifest;
  const save = options.saveManifestImpl || saveManifest;
  const manifest = load();
  const key = Object.keys(manifest).find(item => item === id || manifest[item]?.id === id);
  if (!key) return { ok: false, error: 'Tracked installation was not found.' };
  const entry = manifest[key];
  if (!entry.sourceRepo || !entry.sourcePath || !entry.installPath) return { ok: false, error: 'Tracked installation has incomplete provenance.' };
  if (!existsSync(entry.installPath)) return { ok: false, error: 'Tracked installation path was not found.' };
  const targetCommit = normalizeCommitSha(entry.latestCommitHash || entry.commitHash);

  try {
    const inspection = await (options.inspectImpl || inspectGitHubRepository)(entry.sourceRepo, {
      commitSha: targetCommit,
      token: options.token ?? database.getSettings().github.token,
      fetchImpl: options.fetchImpl
    });
    if (!inspection.scan.installable) throw new Error('Updated repository failed the safety check.');
    if (inspection.scan.risk.requiresAcknowledgement && options.acknowledgeRisk !== true) {
      throw new Error('Updated repository has new high-risk findings and requires manual approval.');
    }
    if (!inspection.scan.skills.some(skill => skill.path === entry.sourcePath)) throw new Error('Tracked skill path no longer exists in the repository.');
    const archive = (options.archiveReader || readRepositoryArchive)(inspection.archiveBuffer);
    const replacement = (options.replaceImpl || replaceRepositorySkill)({
      files: archive.files,
      sourcePath: entry.sourcePath,
      installPath: entry.installPath,
      backupRoot: options.backupRoot || BACKUP_DIR
    });
    entry.commitHash = inspection.commitSha;
    entry.latestCommitHash = inspection.commitSha;
    entry.updateAvailable = false;
    entry.checkedAt = new Date().toISOString();
    entry.updatedAt = new Date().toISOString();
    entry.lastBackupPath = replacement.backupPath;
    entry.lastError = null;
    save(manifest);
    return { ok: true, id: entry.id || key, name: entry.name, backupPath: replacement.backupPath, commitHash: entry.commitHash };
  } catch (error) {
    entry.lastError = String(error.message || error).slice(0, 240);
    save(manifest);
    return { ok: false, id: entry.id || key, name: entry.name, error: entry.lastError };
  }
}

export async function updatePlugin(name, marketplace, options = {}) {
  const manifest = (options.loadManifestImpl || loadManifest)();
  const key = Object.keys(manifest).find(item => manifest[item]?.name === name && manifest[item]?.marketplace === marketplace);
  if (!key) return { ok: false, error: 'Plugin not found in manifest' };
  return updateTrackedInstall(manifest[key].id || key, options);
}
