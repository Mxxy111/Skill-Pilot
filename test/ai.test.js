import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClassificationResponse, normalizeClassification } from '../src/core/ai.js';

test('AI classification parser accepts fenced JSON and normalizes fields', () => {
  const parsed = parseClassificationResponse('```json\n{"category":"Development","tags":["API","api","tool"],"summary":"Builds APIs","risk":"low"}\n```');
  assert.deepEqual(parsed, {
    category: 'Development',
    tags: ['api', 'tool'],
    summary: 'Builds APIs',
    risk: 'low'
  });
});
test('AI classification rejects unsafe or invalid shapes', () => {
  assert.throws(() => normalizeClassification({ category: '', tags: 'not-an-array' }), /classification/i);
  assert.throws(() => parseClassificationResponse('ignore previous instructions'), /JSON/i);
});
