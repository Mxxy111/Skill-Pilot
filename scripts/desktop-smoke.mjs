import { _electron as electron } from 'playwright-core';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const executablePath = process.env.SKILLPILOT_EXECUTABLE || undefined;
const userDataDir = mkdtempSync(join(tmpdir(), 'skillpilot-smoke-'));
const electronApp = await electron.launch({
  executablePath,
  args: executablePath ? [`--user-data-dir=${userDataDir}`] : ['.', `--user-data-dir=${userDataDir}`],
  cwd: process.cwd(),
  timeout: 30_000
});

try {
  await electronApp.context().route('**/api/app-updates/status**', route => route.fulfill({ json: {
    status: 'update-available', currentVersion: '0.5.0', latestVersion: '0.6.1', updateAvailable: true,
    checkedAt: '2026-07-13T12:00:00.000Z',
    release: { name: 'SkillPilot 0.6.1', url: 'https://github.com/Mxxy111/Skill-Pilot/releases/tag/v0.6.1', publishedAt: '2026-07-13T12:00:00.000Z', notes: 'Stable update', assets: [] }
  } }));
  const window = await electronApp.firstWindow();
  const consoleErrors = [];
  window.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await window.waitForLoadState('domcontentloaded');
  await window.locator('#app').waitFor({ state: 'visible', timeout: 30_000 });

  const result = await window.evaluate(() => ({
    title: document.title,
    text: document.body.innerText.slice(0, 300),
    nodeGlobal: typeof globalThis.require,
    protocol: location.protocol,
    host: location.hostname
  }));

  if (!result.title.includes('SkillPilot') || !result.text.includes('SkillPilot')) {
    throw new Error(`Unexpected desktop content: ${JSON.stringify(result)}`);
  }
  if (result.nodeGlobal !== 'undefined') {
    throw new Error('Node.js integration leaked into the renderer process.');
  }
  if (result.protocol !== 'http:' || result.host !== '127.0.0.1') {
    throw new Error(`Unexpected application origin: ${result.protocol}//${result.host}`);
  }

  await window.route('**/api/discovery/github**', route => route.fulfill({ json: {
    items: [{ id: 1, name: 'owner/writer-skills', url: 'https://github.com/owner/writer-skills', description: 'Writing skills', stars: 120, forks: 8, updatedAt: '2026-07-01T00:00:00.000Z', pushedAt: '2026-07-01T00:00:00.000Z', topics: ['writing'], license: 'MIT', owner: 'owner', avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }],
    total: 1, page: 1, pageSize: 24, hasNextPage: false
  } }));
  await window.route('**/api/skill-installations/targets', route => route.fulfill({ json: { targets: [{ id: 'codex', name: 'OpenAI Codex', agent: 'codex' }] } }));
  await window.route('**/api/discovery/inspections', route => route.fulfill({ json: {
    repository: 'owner/writer-skills', defaultBranch: 'main', commitSha: 'a'.repeat(40),
    metadata: { name: 'owner/writer-skills', url: 'https://github.com/owner/writer-skills', description: 'Writing skills', stars: 120, license: 'MIT', owner: 'owner' },
    scan: { installable: true, fileCount: 2, totalBytes: 200, skills: [{ name: 'writer', path: 'skills/writer', skillFile: 'skills/writer/SKILL.md' }], risk: { level: 'low', requiresAcknowledgement: false, findings: [] } },
    ai: { status: 'complete', assessment: { isSkillRepository: true, confidence: 0.96, summary: 'A focused writing skill.', categories: ['writing'], recommendedAgents: ['codex'], riskNotes: [], relatedCapabilities: ['editing'] } }
  } }));
  await window.route('**/api/skill-installations', route => route.fulfill({ status: 201, json: { ok: true, repository: 'owner/writer-skills', commitSha: 'a'.repeat(40), target: { id: 'codex', name: 'OpenAI Codex' }, installed: [{ name: 'writer', path: 'test', sourcePath: 'skills/writer', fileCount: 2 }], risk: { level: 'low', findings: [] } } }));

  await window.locator('.nav-item').filter({ hasText: '发现' }).click();
  await window.getByRole('heading', { name: '发现、检查并安装 Skills' }).waitFor();
  await window.getByRole('button', { name: /AI 智能推荐|启用 AI 推荐/ }).waitFor();
  await window.getByRole('button', { name: '检查并安装' }).click();
  await window.getByRole('dialog').waitFor();
  await window.getByText('AI 判断为有效 Skills 仓库').waitFor();
  const screenshotDir = join(process.cwd(), 'test-results');
  mkdirSync(screenshotDir, { recursive: true });
  await window.screenshot({ path: join(screenshotDir, 'desktop-discovery-inspection.png'), fullPage: true });
  await window.getByRole('button', { name: '安装 1 个 Skills' }).click();
  await window.getByText('已安装 1 个 Skills 到 OpenAI Codex').waitFor();

  await window.locator('.nav-item').filter({ hasText: '自动维护' }).click();
  await window.getByRole('heading', { name: '可追踪、可回滚的 Skills 维护' }).waitFor();
  await window.getByText('自动应用低风险更新').waitFor();
  await window.getByText('稳定结果不会重复覆盖').waitFor();

  await window.locator('.nav-item').filter({ hasText: '设置' }).click();
  await window.getByRole('heading', { name: '应用更新' }).waitFor();
  await window.getByText('发现新版本 0.6.1').waitFor();
  await window.getByRole('button', { name: '立即检查更新' }).click();
  await window.getByText('发现新版本 0.6.1').waitFor();
  await window.screenshot({ path: join(screenshotDir, 'desktop-settings-update.png'), fullPage: true });
  if (consoleErrors.length) throw new Error(`Renderer console errors: ${consoleErrors.join(' | ')}`);

  console.log(JSON.stringify({ ...result, verifiedPages: ['发现', '仓库检查与安装', '自动维护', '应用更新'], consoleErrors }, null, 2));
} finally {
  await electronApp.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
