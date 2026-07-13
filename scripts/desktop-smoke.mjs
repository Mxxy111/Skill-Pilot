import { _electron as electron } from 'playwright-core';

const executablePath = process.env.SKILLPILOT_EXECUTABLE || undefined;
const electronApp = await electron.launch({
  executablePath,
  args: executablePath ? [] : ['.'],
  cwd: process.cwd(),
  timeout: 30_000
});

try {
  const window = await electronApp.firstWindow();
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

  console.log(JSON.stringify(result, null, 2));
} finally {
  await electronApp.close();
}
