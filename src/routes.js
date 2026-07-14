import { Router } from 'express';
import multer from 'multer';
import { tmpdir, homedir } from 'os';
import { join, resolve } from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, writeFileSync, unlinkSync, realpathSync } from 'fs';
import { listAll, getSkillContent, saveSkillContent } from './core/inventory.js';
import { addSkill } from './core/add.js';
import { removeSkill } from './core/remove.js';
import { exportSkill } from './core/export.js';
import { importSkill } from './core/import.js';
import { SKILLS_DIR, PLUGINS_DIR } from './core/paths.js';
import { syncInit, syncSetRemote, syncPush, syncPull, syncStatus } from './core/sync/index.js';
import { listAvailablePlugins, listCategories, listSources, setSourceEnabled, installPlugin } from './core/registry.js';
import { getUpdateSummary, checkAllUpdates, updatePlugin } from './core/updates.js';
import { readFileSync } from 'fs';
import { database, validateBackup } from './core/database.js';
import { listSources as listSkillSources, addCustomSource, updateSource, removeSource, listInstallTargets } from './core/sources.js';
import { dashboardSummary, exportSkills, runBulkAction } from './core/bulk.js';
import { searchGithub } from './core/discovery.js';
import { cancelMaintenance, classifySkills, getAutomationStatus, normalizeAutomationPatch, startMaintenance } from './core/automation.js';
import { testAI } from './core/ai.js';
import { getDiscoveryRecommendations, inspectDiscoveryRepository, installDiscoveredSkills } from './core/discovery-service.js';
import { normalizeCommitSha, normalizeRepositorySlug } from './core/repository-security.js';
import { checkForAppUpdate, CURRENT_VERSION } from './core/app-updates.js';

const upload = multer({ dest: join(tmpdir(), 'skill-manager-uploads'), limits: { fileSize: 10 * 1024 * 1024 } });

function apiError(res, status, code, message, details) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}

/** Escape special XML characters to prevent injection in plist generation. */
function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Strip system paths and environment details from error messages. */
function sanitizeError(msg) {
  if (!msg) return 'An unexpected error occurred';
  return msg
    .replace(/\/Users\/[^\s:]+/g, '<path>')
    .replace(/\/home\/[^\s:]+/g, '<path>')
    .replace(/\/opt\/[^\s:]+/g, '<path>')
    .replace(/\/tmp\/[^\s:]+/g, '<path>');
}

/** Simple in-memory rate limiter. */
function rateLimit({ windowMs = 60000, max = 60 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const record = hits.get(key);
    if (!record || now - record.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    record.count++;
    if (record.count > max) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}

/** Check that a path is within allowed skill/plugin directories. */
function isAllowedPath(targetPath) {
  try {
    const resolved = realpathSync(resolve(targetPath));
    const allowedRoots = [realpathSync(SKILLS_DIR), realpathSync(PLUGINS_DIR)];
    return allowedRoots.some(root => resolved.startsWith(root + '/') || resolved === root);
  } catch {
    return false;
  }
}

export function createRoutes() {
  const router = Router();

  // Apply rate limiting to all API routes
  router.use(rateLimit({ windowMs: 60000, max: 120 }));

  // List all skills
  router.get('/skills', (req, res) => {
    try {
      res.json(listAll());
    } catch (e) {
      res.status(500).json({ error: sanitizeError(e.message) });
    }
  });

  // Get skill detail with content
  router.get('/skills/:name', (req, res) => {
    try {
      if (!/^[a-zA-Z0-9_:@.-]+$/.test(req.params.name)) {
        return res.status(400).json({ error: 'Invalid skill name' });
      }
      const skill = getSkillContent(req.params.name);
      if (!skill) return res.status(404).json({ error: 'Skill not found' });
      res.json(skill);
    } catch (e) {
      res.status(500).json({ error: sanitizeError(e.message) });
    }
  });

  // Save skill content
  router.put('/skills/:name', (req, res) => {
    try {
      if (!/^[a-zA-Z0-9_:@.-]+$/.test(req.params.name)) {
        return res.status(400).json({ error: 'Invalid skill name' });
      }
      const { raw } = req.body;
      if (typeof raw !== 'string') return res.status(400).json({ error: 'Raw content required' });
      const result = saveSkillContent(req.params.name, raw);
      res.json({ ok: true, message: `Saved: ${result.name}` });
    } catch (e) {
      res.status(400).json({ error: sanitizeError(e.message) });
    }
  });

  // Add a skill
  router.post('/skills/add', (req, res) => {
    try {
      const { path, copy } = req.body;
      const name = addSkill(path, { copy });
      res.json({ name, message: `Added skill: ${name}` });
    } catch (e) {
      res.status(400).json({ error: sanitizeError(e.message) });
    }
  });

  // Remove a skill
  router.delete('/skills/:name', (req, res) => {
    try {
      if (!/^[a-zA-Z0-9_:@.-]+$/.test(req.params.name)) {
        return res.status(400).json({ error: 'Invalid skill name' });
      }
      removeSkill(req.params.name);
      res.json({ message: `Removed: ${req.params.name}` });
    } catch (e) {
      res.status(400).json({ error: sanitizeError(e.message) });
    }
  });

  // Import a skill zip (multipart upload)
  router.post('/skills/import', upload.single('file'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const name = importSkill(req.file.path);
      res.json({ name, message: `Imported skill: ${name}` });
    } catch (e) {
      res.status(400).json({ error: sanitizeError(e.message) });
    } finally {
      try { if (req.file) unlinkSync(req.file.path); } catch {}
    }
  });

  // Export a skill as zip download
  router.get('/skills/:name/export', (req, res) => {
    try {
      if (!/^[a-zA-Z0-9_:@.-]+$/.test(req.params.name)) {
        return res.status(400).json({ error: 'Invalid skill name' });
      }
      const outPath = exportSkill(req.params.name, tmpdir());
      res.download(outPath, () => { try { unlinkSync(outPath); } catch {} });
    } catch (e) {
      res.status(400).json({ error: sanitizeError(e.message) });
    }
  });

  // Reveal a file/folder in Finder (macOS)
  router.post('/reveal', (req, res) => {
    try {
      const { path } = req.body;
      if (!path) return res.status(400).json({ error: 'Path required' });
      if (!isAllowedPath(path)) {
        return res.status(403).json({ error: 'Path is outside allowed directories' });
      }
      spawnSync('open', ['-R', path]);
      res.json({ message: 'Revealed in Finder' });
    } catch (e) {
      res.status(400).json({ error: sanitizeError(e.message) });
    }
  });

  // --- Launch on startup ---
  const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', 'com.quiver.server.plist');

  router.get('/startup', (req, res) => {
    res.json({ enabled: existsSync(PLIST_PATH) });
  });

  router.post('/startup', (req, res) => {
    try {
      const { enabled } = req.body;
      if (enabled) {
        // Find node safely using execFileSync (no shell interpolation)
        let nodePath;
        try {
          nodePath = execFileSync('which', ['node'], { encoding: 'utf-8', timeout: 5000 }).trim();
        } catch {
          nodePath = '/opt/homebrew/bin/node';
        }
        const scriptPath = join(process.cwd(), 'bin', 'quiver.js');

        const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.quiver.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(scriptPath)}</string>
    <string>ui</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>WorkingDirectory</key>
  <string>${escapeXml(process.cwd())}</string>
</dict>
</plist>`;
        writeFileSync(PLIST_PATH, plist);
        res.json({ enabled: true, message: 'Skill Manager will launch on startup' });
      } else {
        if (existsSync(PLIST_PATH)) {
          try { execFileSync('launchctl', ['unload', PLIST_PATH], { timeout: 5000 }); } catch {}
          unlinkSync(PLIST_PATH);
        }
        res.json({ enabled: false, message: 'Startup disabled' });
      }
    } catch (e) {
      res.status(500).json({ error: sanitizeError(e.message) });
    }
  });

  // --- Registry / Install ---
  router.post('/registry/install', async (req, res) => {
    try {
      const { name, marketplace } = req.body;
      if (!name) return res.status(400).json({ ok: false, error: 'Plugin name required' });
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({ ok: false, error: 'Invalid plugin name' });
      }

      const result = await installPlugin(name, marketplace);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: sanitizeError(e.message) });
    }
  });

  // --- Registry / Browse ---
  router.get('/registry/plugins', async (req, res) => {
    try {
      const { search, category } = req.query;
      const plugins = await listAvailablePlugins({ search, category });
      res.json({ plugins, total: plugins.length });
    } catch (e) {
      res.status(500).json({ error: sanitizeError(e.message) });
    }
  });

  router.get('/registry/categories', async (req, res) => {
    try {
      res.json({ categories: await listCategories() });
    } catch (e) {
      res.status(500).json({ error: sanitizeError(e.message) });
    }
  });

  router.get('/registry/sources', (req, res) => {
    try {
      res.json({ sources: listSources() });
    } catch (e) {
      res.status(500).json({ error: sanitizeError(e.message) });
    }
  });

  router.post('/registry/sources', (req, res) => {
    try {
      const { id, enabled } = req.body;
      if (!id) return res.status(400).json({ error: 'Source ID required' });
      const updated = setSourceEnabled(id, enabled);
      res.json({ ok: true, enabled: updated });
    } catch (e) {
      res.status(500).json({ error: sanitizeError(e.message) });
    }
  });

  router.get('/registry/updates', (req, res) => {
    try {
      res.json(getUpdateSummary());
    } catch (e) {
      res.status(500).json({ error: sanitizeError(e.message) });
    }
  });

  router.post('/registry/updates/check', async (req, res) => {
    try {
      const result = await checkAllUpdates({ force: true });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: sanitizeError(e.message) });
    }
  });

  router.post('/registry/update', async (req, res) => {
    try {
      const { name, marketplace } = req.body;
      if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({ error: 'Invalid plugin name' });
      }
      const result = await updatePlugin(name, marketplace);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: sanitizeError(e.message) });
    }
  });

  // --- Sync ---
  router.get('/sync/status', (req, res) => {
    try {
      res.json(syncStatus());
    } catch (e) {
      res.status(500).json({ ok: false, error: sanitizeError(e.message) });
    }
  });

  router.post('/sync/init', (req, res) => {
    try {
      res.json(syncInit());
    } catch (e) {
      res.status(500).json({ ok: false, error: sanitizeError(e.message) });
    }
  });

  router.post('/sync/remote', (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ ok: false, error: 'URL required' });
      const result = syncSetRemote(url);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: sanitizeError(e.message) });
    }
  });

  router.post('/sync/push', (req, res) => {
    try {
      const result = syncPush();
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: sanitizeError(e.message) });
    }
  });

  router.post('/sync/pull', (req, res) => {
    try {
      const result = syncPull();
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: sanitizeError(e.message) });
    }
  });

  // ── Quiver version check ──
  router.get('/dashboard', (req, res) => {
    try {
      const summary = dashboardSummary();
      summary.updates = getUpdateSummary().total;
      summary.sources = listSkillSources();
      res.json(summary);
    } catch (e) { apiError(res, 500, 'DASHBOARD_FAILED', sanitizeError(e.message)); }
  });

  router.post('/skills/bulk', (req, res) => {
    try {
      const result = runBulkAction(req.body || {});
      res.json({ ok: true, count: result.length, result });
    } catch (e) { apiError(res, 400, 'BULK_ACTION_FAILED', sanitizeError(e.message)); }
  });

  router.post('/skills/bulk/export', (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      if (!ids.length || ids.length > 200) return apiError(res, 400, 'INVALID_SELECTION', 'Select between 1 and 200 skills.');
      const outPath = exportSkills(ids);
      res.download(outPath, 'skillpilot-skills.zip', () => { try { unlinkSync(outPath); } catch {} });
    } catch (e) { apiError(res, 400, 'EXPORT_FAILED', sanitizeError(e.message)); }
  });

  router.get('/sources', (req, res) => res.json({ sources: listSkillSources() }));
  router.post('/sources', (req, res) => {
    try { res.status(201).json({ source: addCustomSource(req.body || {}) }); }
    catch (e) { apiError(res, 400, 'SOURCE_INVALID', sanitizeError(e.message)); }
  });
  router.patch('/sources/:id', (req, res) => {
    try { res.json({ source: updateSource(req.params.id, req.body || {}) }); }
    catch (e) { apiError(res, 400, 'SOURCE_UPDATE_FAILED', sanitizeError(e.message)); }
  });
  router.delete('/sources/:id', (req, res) => {
    try { res.json({ ok: true, source: removeSource(req.params.id) }); }
    catch (e) { apiError(res, 400, 'SOURCE_REMOVE_FAILED', sanitizeError(e.message)); }
  });

  router.get('/settings', (req, res) => res.json(database.getPublicSettings()));
  router.put('/settings', (req, res) => {
    try {
      const patch = req.body || {};
      if (patch.ai?.baseUrl) {
        const url = new URL(patch.ai.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('AI endpoint must use HTTP or HTTPS.');
      }
      if (patch.automation?.intervalHours !== undefined) {
        const hours = Number(patch.automation.intervalHours);
        if (!Number.isFinite(hours) || hours < 1 || hours > 720) throw new Error('Automation interval must be between 1 and 720 hours.');
        patch.automation.intervalHours = hours;
      }
      if (patch.automation?.classificationBatchSize !== undefined) {
        const size = Number(patch.automation.classificationBatchSize);
        if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error('Classification batch size must be between 1 and 100.');
        patch.automation.classificationBatchSize = size;
      }
      if (patch.automation) patch.automation = normalizeAutomationPatch(database.getSettings().automation, patch.automation, new Date());
      database.updateSettings(patch);
      res.json({ ok: true, settings: database.getPublicSettings() });
    } catch (e) { apiError(res, 400, 'SETTINGS_INVALID', sanitizeError(e.message)); }
  });

  router.post('/ai/test', async (req, res) => {
    try { res.json(await testAI(req.body || {})); }
    catch (e) { apiError(res, 400, 'AI_CONNECTION_FAILED', sanitizeError(e.message)); }
  });
  router.post('/ai/classify', async (req, res) => {
    try { res.json(await classifySkills(Array.isArray(req.body?.ids) ? req.body.ids : [])); }
    catch (e) { apiError(res, 400, 'CLASSIFICATION_FAILED', sanitizeError(e.message)); }
  });
  router.get('/automation/status', (req, res) => res.json(getAutomationStatus()));
  router.post('/automation/run', (req, res) => {
    try { res.status(202).json({ run: startMaintenance({ classify: req.body?.classify }) }); }
    catch (e) { apiError(res, 409, 'MAINTENANCE_FAILED', sanitizeError(e.message)); }
  });
  router.post('/automation/run/cancel', (req, res) => {
    try { res.json({ run: cancelMaintenance(req.body?.id) }); }
    catch (e) { apiError(res, 409, 'MAINTENANCE_CANCEL_FAILED', sanitizeError(e.message)); }
  });

  router.get('/app-updates/status', async (req, res) => {
    try {
      res.json(await checkForAppUpdate({
        force: req.query.force === '1',
        token: database.getSettings().github.token
      }));
    } catch (e) { apiError(res, 502, 'APP_UPDATE_CHECK_FAILED', sanitizeError(e.message)); }
  });

  router.get('/discovery/github', async (req, res) => {
    try { res.json(await searchGithub(req.query)); }
    catch (e) { apiError(res, 502, 'GITHUB_SEARCH_FAILED', sanitizeError(e.message)); }
  });

  router.get('/skill-installations/targets', (req, res) => {
    res.json({ targets: listInstallTargets().map(({ path, ...target }) => target) });
  });

  router.post('/discovery/inspections', async (req, res) => {
    try {
      const repository = normalizeRepositorySlug(req.body?.repository);
      res.json(await inspectDiscoveryRepository({ repository, useAI: req.body?.useAI !== false }));
    } catch (e) { apiError(res, 422, 'REPOSITORY_INSPECTION_FAILED', sanitizeError(e.message)); }
  });

  router.post('/discovery/recommendations', async (req, res) => {
    try {
      res.json(await getDiscoveryRecommendations({ query: req.body?.query, repositories: req.body?.repositories }));
    } catch (e) { apiError(res, 422, 'RECOMMENDATION_FAILED', sanitizeError(e.message)); }
  });

  router.post('/skill-installations', async (req, res) => {
    try {
      const repository = normalizeRepositorySlug(req.body?.repository);
      const commitSha = normalizeCommitSha(req.body?.commitSha);
      const targetAgent = String(req.body?.targetAgent || '');
      const skillPaths = Array.isArray(req.body?.skillPaths) ? req.body.skillPaths.map(String) : [];
      res.status(201).json(await installDiscoveredSkills({
        repository,
        commitSha,
        targetAgent,
        skillPaths,
        acknowledgeRisk: req.body?.acknowledgeRisk === true
      }));
    } catch (e) { apiError(res, 422, 'SKILL_INSTALLATION_FAILED', sanitizeError(e.message)); }
  });

  router.get('/database/export', (req, res) => {
    const data = database.snapshot();
    data.settings.ai.apiKey = '';
    data.settings.github.token = '';
    res.setHeader('Content-Disposition', `attachment; filename="skillpilot-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.type('application/json').send(JSON.stringify(data, null, 2));
  });
  router.post('/database/import', upload.single('file'), (req, res) => {
    try {
      if (!req.file) return apiError(res, 400, 'FILE_REQUIRED', 'Select a database backup file.');
      const backup = validateBackup(JSON.parse(readFileSync(req.file.path, 'utf8')));
      database.replace(backup);
      res.json({ ok: true, imported: Object.keys(backup.skills).length });
    } catch (e) { apiError(res, 400, 'BACKUP_INVALID', sanitizeError(e.message)); }
    finally { try { if (req.file) unlinkSync(req.file.path); } catch {} }
  });

  router.get('/version', async (req, res) => {
    try {
      const result = await checkForAppUpdate({ token: database.getSettings().github.token });
      res.json({
        current: CURRENT_VERSION,
        latest: result.latestVersion || CURRENT_VERSION,
        updateAvailable: result.updateAvailable,
        releaseUrl: result.release?.url || null
      });
    } catch {
      res.json({ current: CURRENT_VERSION, latest: CURRENT_VERSION, updateAvailable: false });
    }
  });

  return router;
}
