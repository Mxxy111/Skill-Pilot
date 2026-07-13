import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { getInstallTarget, listInstallTargets } from '../src/core/sources.js';

test('discovery installation supports every built-in Agent target', () => {
  const home = join('D:', 'Users', 'tester');
  assert.deepEqual(listInstallTargets(home).map(target => target.id), [
    'claude', 'codex', 'agents', 'openclaw', 'gemini', 'cursor'
  ]);
  assert.equal(getInstallTarget('codex', home).path, join(home, '.codex', 'skills'));
  assert.throws(() => getInstallTarget('custom', home), /target Agent/i);
});
