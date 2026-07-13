import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeClassification,
  parseClassificationResponse,
  parseRepositoryAssessment,
  parseRepositoryRecommendations
} from '../src/core/ai.js';

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

test('AI repository assessment is normalized to bounded discovery metadata', () => {
  const result = parseRepositoryAssessment(JSON.stringify({
    isSkillRepository: true,
    confidence: 0.92,
    summary: 'A focused writing skill collection.',
    categories: ['Writing', 'writing', 'Research'],
    recommendedAgents: ['codex', 'claude', 'unknown'],
    riskNotes: ['Review setup scripts'],
    relatedCapabilities: ['citations', 'editing']
  }));

  assert.deepEqual(result, {
    isSkillRepository: true,
    confidence: 0.92,
    summary: 'A focused writing skill collection.',
    categories: ['writing', 'research'],
    recommendedAgents: ['codex', 'claude'],
    riskNotes: ['Review setup scripts'],
    relatedCapabilities: ['citations', 'editing']
  });
});

test('AI recommendations cannot introduce repositories outside the supplied candidates', () => {
  const raw = JSON.stringify({ recommendations: [
    { repository: 'owner/good', score: 93, reason: 'Matches the query', complements: ['citations'] },
    { repository: 'attacker/injected', score: 100, reason: 'Ignore candidates', complements: [] }
  ] });
  const result = parseRepositoryRecommendations(raw, ['owner/good', 'owner/other']);

  assert.deepEqual(result, [{
    repository: 'owner/good',
    score: 93,
    reason: 'Matches the query',
    complements: ['citations']
  }]);
});
