import express from 'express';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import open from 'open';
import helmet from 'helmet';
import { createRoutes } from './routes.js';
import { startAutomationScheduler } from './core/automation.js';

function resolveUIPath() {
  // Check 1: Running as .app bundle — bundled CJS is in Resources/,
  // UI is in Resources/ui/
  const scriptDir = typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

  const siblingUI = join(scriptDir, 'ui');
  if (existsSync(siblingUI)) return siblingUI;

  // Check 2: Running as .app bundle — binary in MacOS/, UI in Resources/ui/
  const execDir = dirname(process.execPath);
  const appResourcesUI = join(execDir, '..', 'Resources', 'ui');
  if (existsSync(appResourcesUI)) return appResourcesUI;

  // Check 3: Development mode — UI is at ../ui relative to src/
  return join(scriptDir, '..', 'ui');
}

export function startServer(port = parseInt(process.env.PORT) || 3456, options = {}) {
  const {
    host = '127.0.0.1',
    openBrowser = process.env.SKILLPILOT_NO_OPEN !== '1',
    onReady = null
  } = options;
  const uiPath = resolveUIPath();
  const app = express();

  app.disable('x-powered-by');
  // Express recommends Helmet and reduced fingerprinting:
  // https://expressjs.com/en/advanced/best-practice-security.html
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https:'], connectSrc: ["'self'"] } },
    strictTransportSecurity: false
  }));
  app.use(express.json({ limit: '1mb' }));

  // CORS origin restriction — only allow localhost
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  });

  // Serve static UI files
  app.use(express.static(uiPath));

  // Mount API routes
  app.use('/api', createRoutes());

  // SPA fallback (Express 5 syntax)
  app.get('/{*path}', (req, res) => {
    res.sendFile(join(uiPath, 'index.html'));
  });

  const server = app.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const url = `http://${host}:${actualPort}`;
    console.log(`SkillPilot running at ${url}`);
    startAutomationScheduler();
    onReady?.(url);
    if (openBrowser) open(url);
  });
  return server;
}
