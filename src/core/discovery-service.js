import { rmSync } from 'node:fs';

import { assessRepository, recommendRepositories } from './ai.js';
import { database } from './database.js';
import { searchGithub } from './discovery.js';
import { inspectGitHubRepository, publicInspection, readRepositoryArchive } from './github-repository.js';
import { installRepositoryFiles } from './repository-installer.js';
import { getInstallTarget } from './sources.js';
import { discoverSkillsCatalog, expandDiscoveryQuery } from './skills-catalog.js';
import { recordInstalls } from './updates.js';

export async function getDiscoveryCatalog(input = {}, options = {}) {
  try {
    return await (options.catalogImpl || discoverSkillsCatalog)(input, options);
  } catch (catalogError) {
    const resolvedQuery = expandDiscoveryQuery(input.search, input.category) || 'agent skills workflow';
    const fallback = await (options.githubImpl || searchGithub)({
      search: resolvedQuery,
      category: '',
      sort: input.view === 'trending' ? 'latest' : 'popular',
      page: 1
    });
    return {
      source: 'github-fallback',
      view: input.view || 'popular',
      query: String(input.search || ''),
      resolvedQuery,
      searchType: 'repository-fallback',
      total: fallback.items.length,
      warning: `Skills index unavailable: ${String(catalogError.message || catalogError).slice(0, 160)}`,
      items: fallback.items.map((repository, index) => ({
        id: `github:${repository.name}`,
        skillName: repository.name.split('/').at(-1),
        repository: repository.name,
        installs: 0,
        change: 0,
        rank: index + 1,
        url: repository.url,
        source: 'github',
        view: 'fallback',
        stars: repository.stars,
        description: repository.description,
        topics: repository.topics,
        license: repository.license,
        updatedAt: repository.updatedAt
      }))
    };
  }
}

export async function inspectDiscoveryRepository({ repository, useAI = true }, options = {}) {
  const settings = database.getSettings();
  const inspectImpl = options.inspectImpl || inspectGitHubRepository;
  const inspection = await inspectImpl(repository, {
    fetchImpl: options.fetchImpl,
    token: options.token ?? settings.github.token,
    includeFiles: false
  });
  const result = publicInspection(inspection);
  if (!useAI) return { ...result, ai: { status: 'skipped' } };
  if (!settings.ai.enabled) return { ...result, ai: { status: 'disabled' } };
  try {
    const assessment = await (options.assessImpl || assessRepository)(result);
    return { ...result, ai: { status: 'complete', assessment } };
  } catch (error) {
    return { ...result, ai: { status: 'error', message: String(error.message || error).slice(0, 200) } };
  }
}

export async function getDiscoveryRecommendations({ query, repositories }, options = {}) {
  const settings = database.getSettings();
  if (!settings.ai.enabled) throw new Error('AI must be enabled before requesting recommendations.');
  if (!Array.isArray(repositories) || !repositories.length || repositories.length > 8) {
    throw new Error('Select between 1 and 8 repository candidates.');
  }
  return {
    recommendations: await (options.recommendImpl || recommendRepositories)(String(query || '').slice(0, 300), repositories)
  };
}

export async function installDiscoveredSkills(input, options = {}) {
  const settings = database.getSettings();
  const inspectImpl = options.inspectImpl || inspectGitHubRepository;
  const inspection = await inspectImpl(input.repository, {
    commitSha: input.commitSha,
    fetchImpl: options.fetchImpl,
    token: options.token ?? settings.github.token,
    includeFiles: true,
    skillPaths: input.skillPaths
  });
  if (inspection.commitSha !== String(input.commitSha).toLowerCase()) throw new Error('Repository commit changed during inspection.');
  if (!inspection.scan.installable) throw new Error('Repository did not pass the installation safety check.');
  if (inspection.scan.risk.requiresAcknowledgement && input.acknowledgeRisk !== true) {
    throw new Error('You must acknowledge the high-risk findings before installation.');
  }

  const target = (options.targetResolver || getInstallTarget)(input.targetAgent);
  const files = inspection.repositoryFiles || (options.archiveReader || readRepositoryArchive)(inspection.archiveBuffer).files;
  const installer = options.installer || installRepositoryFiles;
  const installed = installer({
    files,
    availableSkills: inspection.scan.skills,
    selectedPaths: input.skillPaths,
    targetRoot: target.path
  });

  const entries = installed.map(item => ({
    id: `github:${target.id}:${inspection.repository}:${item.sourcePath}`,
    name: item.name,
    marketplace: `github:${target.id}`,
    installPath: item.path,
    sourceRepo: inspection.repository,
    sourcePath: item.sourcePath,
    targetAgent: target.id,
    commitHash: inspection.commitSha,
    version: null
  }));

  try {
    (options.recordInstallsImpl || recordInstalls)(entries);
    (options.addHistory || database.addHistory)({
      type: 'install',
      status: 'success',
      message: `Installed ${installed.length} skills from ${inspection.repository}`,
      details: { repository: inspection.repository, commitSha: inspection.commitSha, targetAgent: target.id, skills: installed.map(item => item.name) }
    });
  } catch (error) {
    for (const item of installed) rmSync(item.path, { recursive: true, force: true });
    throw error;
  }

  return {
    ok: true,
    repository: inspection.repository,
    commitSha: inspection.commitSha,
    target: { id: target.id, name: target.name },
    installed,
    risk: inspection.scan.risk
  };
}
