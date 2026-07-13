import { database } from './database.js';
import { listAll, getSkillContent } from './inventory.js';
import { classifySkill } from './ai.js';
import { checkAllUpdates, getUpdateSummary, updatePlugin } from './updates.js';

let timer = null;
let isRunning = false;
let lastScheduledRun = 0;

export async function classifySkills(ids = []) {
  const settings = database.getSettings();
  if (!settings.ai.enabled) throw new Error('AI classification is not enabled.');
  const wanted = new Set(ids);
  const skills = listAll().filter(skill => skill.source === 'local' && skill.isEnabled && (!wanted.size || wanted.has(skill.id))).slice(0, 100);
  const results = [];
  for (const skill of skills) {
    try {
      const classification = await classifySkill(getSkillContent(skill.id) || skill);
      database.updateSkill(skill.id, { ...classification, lastClassifiedAt: new Date().toISOString() });
      results.push({ id: skill.id, ok: true, classification });
    } catch (error) {
      results.push({ id: skill.id, ok: false, error: error.message });
    }
  }
  database.addHistory({ type: 'classify', status: results.every(item => item.ok) ? 'success' : 'partial', message: `Classified ${results.filter(item => item.ok).length}/${results.length} skills` });
  return { total: results.length, succeeded: results.filter(item => item.ok).length, results };
}

export async function runMaintenance({ classify = null } = {}) {
  if (isRunning) throw new Error('Maintenance is already running.');
  isRunning = true;
  const settings = database.getSettings();
  const result = { startedAt: new Date().toISOString(), updates: null, classification: null };
  try {
    if (settings.automation.updateChecks) {
      result.updates = await checkAllUpdates({ force: true });
      if (settings.automation.autoUpdate) {
        for (const plugin of result.updates.plugins.filter(item => item.updateAvailable)) await updatePlugin(plugin.name, plugin.marketplace);
      }
    }
    const shouldClassify = classify ?? settings.automation.classification;
    if (shouldClassify && settings.ai.enabled) result.classification = await classifySkills();
    result.finishedAt = new Date().toISOString();
    database.addHistory({ type: 'maintenance', status: 'success', message: 'Scheduled maintenance completed', details: result });
    lastScheduledRun = Date.now();
    return result;
  } catch (error) {
    database.addHistory({ type: 'maintenance', status: 'error', message: error.message });
    throw error;
  } finally { isRunning = false; }
}

export function getAutomationStatus() {
  const data = database.snapshot();
  return { isRunning, lastScheduledRun: lastScheduledRun ? new Date(lastScheduledRun).toISOString() : null, settings: data.settings.automation, updates: getUpdateSummary(), history: data.history.slice(0, 30) };
}

export function startAutomationScheduler() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    const automation = database.getSettings().automation;
    if (!automation.enabled || isRunning) return;
    const interval = Math.max(1, Number(automation.intervalHours) || 24) * 60 * 60 * 1000;
    if (Date.now() - lastScheduledRun >= interval) runMaintenance().catch(() => {});
  }, 60_000);
  timer.unref?.();
  return timer;
}
