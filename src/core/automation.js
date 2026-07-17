import { createHash } from 'node:crypto';

import { database } from './database.js';
import { listAll, readSkillContent } from './inventory.js';
import { classifySkill } from './ai.js';
import { checkAllUpdates, getUpdateSummary, updateTrackedInstall } from './updates.js';

let timer = null;
let isRunning = false;
let currentRun = null;
let currentController = null;

function runSnapshot() {
  return currentRun ? JSON.parse(JSON.stringify(currentRun)) : null;
}

function reportProgress(callback, patch) {
  callback?.({ at: new Date().toISOString(), ...patch });
}

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

export function selectSkillsForClassification(skills, ids = [], _limit = 25, _options = {}) {
  const wanted = new Set(ids);
  const eligible = skills.filter(skill => skill.source === 'local' && skill.isEnabled && (!wanted.size || wanted.has(skill.id)));
  return {
    items: eligible,
    remaining: 0,
    eligible: eligible.length,
    skippedStable: 0
  };
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(8, Number(concurrency) || 3));
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

export function prepareClassificationBatch(skills, ids = [], limit = 25, readContent = readSkillContent, options = {}) {
  const selection = selectSkillsForClassification(skills, ids, limit, options);
  return {
    ...selection,
    items: selection.items.map(skill => {
      const input = readContent(skill) || skill;
      return {
        ...skill,
        classificationInput: input,
        classificationFingerprint: classificationFingerprint(input)
      };
    })
  };
}

export async function classifySkills(ids = [], options = {}) {
  const settings = options.settings || database.getSettings();
  if (!settings.ai.enabled) throw new Error('AI classification is not enabled.');
  const skills = (options.inventoryImpl || listAll)();
  const selection = prepareClassificationBatch(
    skills,
    ids,
    Number.POSITIVE_INFINITY,
    options.readContentImpl || readSkillContent,
    { force: ids.length > 0 }
  );
  let completed = 0;
  reportProgress(options.onProgress, {
    phase: 'classification',
    completed: 0,
    total: selection.items.length,
    remaining: selection.remaining,
    message: selection.items.length ? `准备维护全部 ${selection.items.length} 个 Skills` : '没有可维护的已启用 Skills'
  });
  const results = await mapWithConcurrency(selection.items, settings.automation.classificationConcurrency, async skill => {
    options.signal?.throwIfAborted?.();
    let result;
    try {
      const classification = await (options.classifyImpl || classifySkill)(skill.classificationInput, { signal: options.signal });
      (options.updateSkill || ((id, patch) => database.updateSkill(id, patch)))(skill.id, {
        ...classification,
        lastClassifiedAt: new Date().toISOString(),
        lastClassificationFingerprint: skill.classificationFingerprint
      });
      result = { id: skill.id, ok: true, classification };
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason || error;
      result = { id: skill.id, ok: false, error: error.message };
    }
    completed++;
    reportProgress(options.onProgress, {
      phase: 'classification',
      completed,
      total: selection.items.length,
      remaining: selection.remaining,
      current: skill.name,
      message: `已维护 ${completed}/${selection.items.length}`
    });
    return result;
  });
  const succeeded = results.filter(item => item.ok).length;
  if (options.recordHistory !== false) {
    (options.addHistory || (entry => database.addHistory(entry)))({ type: 'classify', status: succeeded === results.length ? 'success' : 'partial', message: `Classified ${succeeded}/${results.length} skills` });
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
    reportProgress(options.onProgress, { phase: 'starting', completed: 0, total: 0, message: '正在准备维护环境' });
    if (settings.automation.updateChecks) {
      reportProgress(options.onProgress, { phase: 'updates', completed: 0, total: 0, message: '正在检查可追踪来源' });
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
      result.classification = await (options.classifyImpl || classifySkills)([], {
        recordHistory: false,
        onProgress: options.onProgress,
        signal: options.signal
      });
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
    reportProgress(options.onProgress, { phase: 'complete', completed: 1, total: 1, message: '维护任务已完成' });
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

export function startMaintenance(input = {}, options = {}) {
  if (isRunning || currentRun?.status === 'running') throw new Error('Maintenance is already running.');
  const id = crypto.randomUUID();
  const controller = new AbortController();
  currentController = controller;
  currentRun = {
    id,
    status: 'running',
    phase: 'queued',
    completed: 0,
    total: 0,
    remaining: 0,
    current: null,
    message: '维护任务已进入队列',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null
  };
  const onProgress = progress => {
    if (currentRun?.id !== id) return;
    currentRun = { ...currentRun, ...progress };
  };
  new Promise(resolve => setImmediate(resolve))
    .then(() => runMaintenance(input, { ...options, onProgress, signal: controller.signal }))
    .then(result => {
      if (currentRun?.id !== id) return;
      currentRun = {
        ...currentRun,
        status: result.status,
        phase: 'complete',
        completed: 1,
        total: 1,
        message: result.status === 'success' ? '维护任务已完成' : '维护完成，存在需要处理的问题',
        finishedAt: result.finishedAt,
        result
      };
    })
    .catch(error => {
      if (currentRun?.id !== id) return;
      const cancelled = controller.signal.aborted;
      currentRun = {
        ...currentRun,
        status: cancelled ? 'cancelled' : 'error',
        phase: cancelled ? 'cancelled' : 'error',
        message: cancelled ? '维护任务已停止' : error.message,
        error: cancelled ? null : error.message,
        finishedAt: new Date().toISOString()
      };
    })
    .finally(() => {
      if (currentController === controller) currentController = null;
    });
  return runSnapshot();
}

export function cancelMaintenance(id) {
  if (!currentRun || currentRun.status !== 'running' || !currentController) throw new Error('No maintenance run is active.');
  if (id && id !== currentRun.id) throw new Error('Maintenance run does not match the active task.');
  currentRun = { ...currentRun, status: 'cancelling', message: '当前操作结束后停止任务' };
  currentController.abort(new Error('Maintenance cancelled.'));
  return runSnapshot();
}

export function getAutomationStatus() {
  const data = database.snapshot();
  const automation = data.settings.automation;
  return {
    isRunning,
    lastScheduledRun: automation.lastRunAt || null,
    nextRunAt: automation.nextRunAt || null,
    run: runSnapshot(),
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
  if (Date.now() >= new Date(automation.nextRunAt).getTime()) {
    try { startMaintenance({ scheduled: true }); } catch {}
  }
}

export function startAutomationScheduler() {
  if (timer) clearInterval(timer);
  schedulerTick();
  timer = setInterval(schedulerTick, 60_000);
  timer.unref?.();
  return timer;
}
