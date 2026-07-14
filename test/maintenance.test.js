import test from 'node:test';
import assert from 'node:assert/strict';

import { cancelMaintenance, getAutomationStatus, normalizeAutomationPatch, runMaintenance, startMaintenance } from '../src/core/automation.js';

test('maintenance reports partial status when checks or individual updates fail', async () => {
  let savedSettings = null;
  let history = null;
  const result = await runMaintenance({ classify: false }, {
    settings: {
      ai: { enabled: false },
      automation: { enabled: true, intervalHours: 24, updateChecks: true, autoUpdate: true, classification: false }
    },
    checkImpl: async () => ({
      tracked: 2, checked: 1, skipped: 0, failed: 1, updatesAvailable: 1,
      plugins: [{ id: 'writer', name: 'writer', updateAvailable: true }]
    }),
    updateImpl: async () => ({ ok: false, id: 'writer', error: 'new risk requires approval' }),
    updateSettings: patch => { savedSettings = patch; },
    addHistory: entry => { history = entry; },
    now: () => new Date('2026-07-13T12:00:00.000Z')
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.failures, 2);
  assert.equal(result.appliedUpdates[0].ok, false);
  assert.equal(history.status, 'partial');
  assert.equal(savedSettings.automation.lastRunAt, '2026-07-13T12:00:00.000Z');
  assert.equal(savedSettings.automation.nextRunAt, '2026-07-14T12:00:00.000Z');
});

test('automation settings schedule the first run after the selected interval', () => {
  const patch = normalizeAutomationPatch(
    { enabled: false, intervalHours: 24, nextRunAt: null },
    { enabled: true, intervalHours: 6 },
    new Date('2026-07-13T12:00:00.000Z')
  );
  assert.equal(patch.nextRunAt, '2026-07-13T18:00:00.000Z');
  assert.equal(normalizeAutomationPatch({ enabled: true }, { enabled: false }, new Date()).nextRunAt, null);
});

test('maintenance suppresses the duplicate standalone classification history entry', async () => {
  let classifyArguments = null;
  const history = [];
  await runMaintenance({ classify: true }, {
    settings: {
      ai: { enabled: true },
      automation: { enabled: false, intervalHours: 24, updateChecks: false, autoUpdate: false, classification: true }
    },
    classifyImpl: async (...args) => {
      classifyArguments = args;
      return { total: 0, succeeded: 0, remaining: 0, skippedStable: 4, results: [] };
    },
    updateSettings: () => {},
    addHistory: entry => history.push(entry),
    now: () => new Date('2026-07-13T12:00:00.000Z')
  });

  assert.equal(classifyArguments[1].recordHistory, false);
  assert.equal(history.length, 1);
  assert.equal(history[0].type, 'maintenance');
});

test('manual maintenance starts in the background and exposes live progress', async () => {
  let finishClassification;
  const classification = new Promise(resolve => { finishClassification = resolve; });
  const run = startMaintenance({ classify: true }, {
    settings: {
      ai: { enabled: true },
      automation: { enabled: false, intervalHours: 24, updateChecks: false, autoUpdate: false, classification: true }
    },
    classifyImpl: async (_ids, options) => {
      options.onProgress({ phase: 'classification', completed: 1, total: 3, message: 'Classifying 1/3' });
      return classification;
    },
    updateSettings: () => {},
    addHistory: () => {},
    now: () => new Date('2026-07-14T00:00:00.000Z')
  });

  assert.equal(run.status, 'running');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(getAutomationStatus().run.completed, 1);
  assert.equal(getAutomationStatus().run.total, 3);

  finishClassification({ total: 3, succeeded: 3, remaining: 0, skippedStable: 0, results: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(getAutomationStatus().run.status, 'success');
});

test('running maintenance can be cancelled without leaving the runner locked', async () => {
  const run = startMaintenance({ classify: true }, {
    settings: {
      ai: { enabled: true },
      automation: { enabled: false, intervalHours: 24, updateChecks: false, autoUpdate: false, classification: true }
    },
    classifyImpl: async (_ids, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }),
    updateSettings: () => {},
    addHistory: () => {}
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelMaintenance(run.id).status, 'cancelling');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(getAutomationStatus().run.status, 'cancelled');
});
