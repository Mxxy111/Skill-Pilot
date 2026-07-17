import test from 'node:test';
import assert from 'node:assert/strict';

import { groupSummaries, setGroupEnabled } from '../src/core/groups.js';

test('group summaries include ungrouped and live status counts', () => {
  const skills = [
    { id: 'a', groupId: 'g1', isEnabled: true },
    { id: 'b', groupId: 'g1', isEnabled: false },
    { id: 'c', groupId: null, isEnabled: true }
  ];
  const result = groupSummaries([{ id: 'g1', name: 'Work' }], skills);
  assert.deepEqual(result[0], { id: 'g1', name: 'Work', count: 2, enabled: 1, disabled: 1 });
  assert.deepEqual(result.ungrouped, { count: 1, enabled: 1, disabled: 0 });
});

test('group status operation continues after an individual failure and skips plugins', () => {
  const skills = [
    { id: 'local:a', source: 'local', groupId: 'g1', isEnabled: false },
    { id: 'local:b', source: 'local', groupId: 'g1', isEnabled: false },
    { id: 'plugin:c', source: 'plugin', groupId: 'g1', isEnabled: true }
  ];
  const result = setGroupEnabled('g1', true, {
    groups: [{ id: 'g1', name: 'Work' }],
    skills,
    setEnabled: (id, _enabled, skill) => {
      assert.equal(skill.id, id);
      if (id === 'local:b') throw new Error('blocked');
      return { id, isEnabled: true };
    }
  });

  assert.equal(result.total, 2);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.results[1].error, 'blocked');
});
