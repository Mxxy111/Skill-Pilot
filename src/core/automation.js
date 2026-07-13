import { createHash } from 'node:crypto';

import { database } from './database.js';
import { listAll, getSkillContent } from './inventory.js';
import { classifySkill } from './ai.js';
import { checkAllUpdates, getUpdateSummary, updateTrackedInstall } from './updates.js';

let timer = null;
let isRunning = false;

function nextRunAt(now, intervalHours) {
  return new Date(now.getTime() + Math.max(1, Number(intervalHours) || 24) * 60 * 60 * 1000).toISOString();
}

export function normalizeAutomationPatch(current, patch, now = new Date()) {
  const merged = { ...(current || {}), ...(patch || {}) };
  if (!merged.enabled) return { ...(patch || {}), nextRunAt: null };
  const scheduleChanged = !current?.enabled || Number(current.intervalHours) !== Number(merged.intervalHours) || !current.nextRunAt;
  return { ...(patch || {}), nextRunAt: scheduleChanged ? nextRunAt(now, merged.intervalHours) : current.nextRunAt };
}

export function classificationFingerprint(skill) {
  const input = JSON.stringify({ content: String(skill?.content || ''), frontmatter: skill?.frontmatter || {} });
  return createHash('sha256').update(input).digest('hex');
}

function needsClassification(skill, force) {
  if (force || !skill.lastClassifiedAt) return true;
  if (skill.classificationFingerprint && skill.lastClassificationFingerprint) {
    return skill.classificationFingerprint !== skill.lastClassificationFingerprint;
  }
  const modifiedAt = Date.parse(skill.modified || '');
  const classifiedAt = Date.parse(skill.lastClassifiedAt || '');
  return Number.isFinite(modifiedAt) && Number.isFinite(classifiedAt) && modifiedAt > classifiedAt;
}

export function selectSkillsForClassification(skills, ids = [], limit = 25, options = {}) {
  const wanted = new Set(ids);
  const candidates = skills
    .filter(skill => skill.source === 'local' && skill.isEnabled && (!wanted.size || wanted.has(skill.id)))
    .filter(skill => needsClassification(skill, options.force === true));
  const eligible = candidates
    .sort((a, b) => {
      if (!a.lastClassifiedAt && b.lastClassifiedAt) return -1;
      if (a.lastClassifiedAt && !b.lastClassifiedAt) return 1;
      return String(a.lastClassifiedAt || '').localeCompare(String(b.lastClassifiedAt || '')) || a.id.localeCompare(b.id);
    });
  const batchSize = Math.max(1, Math.min(100, Number(limit) || 25));
  return {
    items: eligible.slice(0, batchSize),
    remaining: Math.max(0, eligible.length - batchSize),
    eligible: eligible.length,
    skippedStable: Math.max(0, skills.filter(skill => skill.source === 'local' && skill.isEnabled && (!wanted.size || wanted.has(skill.id))).length - eligible.length)
  };
}

export async function classifySkills(ids = [], options = {}) {
  const settings = database.getSettings();
  if (!settings.ai.enabled) throw new Error('AI classification is not enabled.');
  const skills = listAll().map(skill => {
    const input = getSkillContent(skill.id) || skill;
    return { ...skill, classificationInput: input, classificationFingerprint: classificationFingerprint(input) };
  });
  const selection = selectSkillsForClassification(
    skills,
    ids,
    ids.length ? 100 : settings.automation.classificationBatchSize,
    { force: ids.length > 0 }
  );
  const results = [];
  for (const skill of selection.items) {
    try {
      const classification = await classifySkill(skill.classificationInput);
      database.updateSkill(skill.id, {
        ...classification,
        lastClassifiedAt: new Date().toISOString(),
        lastClassificationFingerprint: skill.classificationFingerprint
      });
      results.push({ id: skill.id, ok: true, classification });
    } catch (error) {
      results.push({ id: skill.id, ok: false, error: error.message });
    }
  }
  const succeeded = results.filter(item => item.ok).length;
  if (options.recordHistory !== false) {
    database.addHistory({ type: 'classify', status: succeeded === results.length ? 'success' : 'partial', message: `Classified ${succeeded}/${results.length} skills` });
  }
  return { total: results.length, succeeded, remaining: selection.remaining, skippedStable: selection.skippedStable, results };
}

export async function runMaintenance({ classify = null, scheduled = false } = {}, options = {}) {
  if (isRunning) throw new Error('Maintenance is already running.');
  isRunning = true;
  const settings = options.settings || database.getSettings();
  const now = options.now || (() => new Date());
  const updateSettings = options.updateSettings || (patch => database.updateSettings(patch));
  const addHistory = options.addHistory || (entry => database.addHistory(entry));
  const result = {
    startedAt: now().toISOString(),
    scheduled,
    updates: null,
    appliedUpdates: [],
    classification: null,
    failures: 0,
    status: 'success'
  };

  try {
    if (settings.automation.updateChecks) {
      result.updates = await (options.checkImpl || checkAllUpdates)({ force: true });
      result.failures += Number(result.updates.failed) || 0;
      if (settings.automation.autoUpdate) {
        for (const plugin of result.updates.plugins.filter(item => item.updateAvailable)) {
          const applied = await (options.updateImpl || updateTrackedInstall)(plugin.id);
          result.appliedUpdates.push(applied);
          if (!applied.ok) result.failures++;
        }
      }
    }
    const shouldClassify = classify ?? settings.automation.classification;
    if (shouldClassify && settings.ai.enabled) {
      result.classification = await (options.classifyImpl || classifySkills)([], { recordHistory: false });
      result.failures += Math.max(0, result.classification.total - result.classification.succeeded);
    }
    result.status = result.failures ? 'partial' : 'success';
    result.finishedAt = now().toISOString();
    updateSettings({ automation: {
      lastRunAt: result.finishedAt,
      nextRunAt: settings.automation.enabled ? nextRunAt(now(), settings.automation.intervalHours) : null
    } });
    addHistory({
      type: 'maintenance',
      status: result.status,
      message: result.status === 'success' ? 'Maintenance completed' : `Maintenance completed with ${result.failures} failures`,
      details: result
    });
    return result;
  } catch (error) {
    result.status = 'error';
    result.failures++;
    result.finishedAt = now().toISOString();
    updateSettings({ automation: {
      lastRunAt: result.finishedAt,
      nextRunAt: settings.automation.enabled ? nextRunAt(now(), settings.automation.intervalHours) : null
    } });
    addHistory({ type: 'maintenance', status: 'error', message: error.message, details: result });
    throw error;
  } finally {
    isRunning = false;
  }
}

export function getAutomationStatus() {
  const data = database.snapshot();
  const automation = data.settings.automation;
  return {
    isRunning,
    lastScheduledRun: automation.lastRunAt || null,
    nextRunAt: automation.nextRunAt || null,
    settings: automation,
    updates: getUpdateSummary(),
    history: data.history.slice(0, 30)
  };
}

function schedulerTick() {
  const automation = database.getSettings().automation;
  if (!automation.enabled || isRunning) return;
  if (!automation.nextRunAt) {
    database.updateSettings({ automation: normalizeAutomationPatch(automation, { enabled: true }, new Date()) });
    return;
  }
  if (Date.now() >= new Date(automation.nextRunAt).getTime()) runMaintenance({ scheduled: true }).catch(() => {});
}

export function startAutomationScheduler() {
  if (timer) clearInterval(timer);
  schedulerTick();
  timer = setInterval(schedulerTick, 60_000);
  timer.unref?.();
  return timer;
}
