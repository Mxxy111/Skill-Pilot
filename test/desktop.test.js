import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isAllowedAppUrl,
  isSafeExternalUrl,
  normalizeWindowBounds
} from '../desktop/policies.js';

test('desktop app only accepts the exact loopback origin assigned at startup', () => {
  const appUrl = 'http://127.0.0.1:43127';

  assert.equal(isAllowedAppUrl(`${appUrl}/`, appUrl), true);
  assert.equal(isAllowedAppUrl(`${appUrl}/skills/one`, appUrl), true);
  assert.equal(isAllowedAppUrl('http://localhost:43127/', appUrl), false);
  assert.equal(isAllowedAppUrl('http://127.0.0.1:43128/', appUrl), false);
  assert.equal(isAllowedAppUrl('https://example.com/', appUrl), false);
});

test('external links require https and reject credential-bearing URLs', () => {
  assert.equal(isSafeExternalUrl('https://github.com/openai/skills'), true);
  assert.equal(isSafeExternalUrl('https://example.com/docs?q=skills'), true);
  assert.equal(isSafeExternalUrl('http://example.com'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('file:///C:/Windows/System32'), false);
  assert.equal(isSafeExternalUrl('https://user:pass@example.com'), false);
  assert.equal(isSafeExternalUrl('not a url'), false);
});

test('window bounds are clamped to practical desktop limits', () => {
  assert.deepEqual(normalizeWindowBounds({ width: 420, height: 300 }), {
    width: 1000,
    height: 700
  });
  assert.deepEqual(normalizeWindowBounds({ width: 1600, height: 980 }), {
    width: 1600,
    height: 980
  });
  assert.deepEqual(normalizeWindowBounds({ width: 12000, height: 9000 }), {
    width: 2560,
    height: 1440
  });
  assert.deepEqual(normalizeWindowBounds(null), {
    width: 1440,
    height: 900
  });
});
