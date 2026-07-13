import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  session,
  shell,
  Tray
} from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { startServer } from '../src/server.js';
import {
  isAllowedAppUrl,
  isSafeExternalUrl,
  normalizeWindowBounds
} from './policies.js';

const APP_ID = 'io.skillpilot.desktop';
const APP_NAME = 'SkillPilot';
const TRAY_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="8" fill="#18231f"/>
    <path d="M9 10.5C9 8.57 10.57 7 12.5 7h9v4h-8.75a1.75 1.75 0 0 0 0 3.5h6.5a5.75 5.75 0 0 1 0 11.5H10v-4h9.25a1.75 1.75 0 0 0 0-3.5h-6.5A5.75 5.75 0 0 1 7 12.75c0-.8.16-1.56.45-2.25H9Z" fill="#f26b4c"/>
  </svg>
`)}`;

let mainWindow = null;
let tray = null;
let server = null;
let appUrl = null;
let isQuitting = false;

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);
app.enableSandbox();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

function windowStatePath() {
  return join(app.getPath('userData'), 'window-state.json');
}

function readWindowState() {
  try {
    const statePath = windowStatePath();
    if (!existsSync(statePath)) return { bounds: normalizeWindowBounds(null), maximized: false };
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    return {
      bounds: normalizeWindowBounds(state.bounds),
      maximized: Boolean(state.maximized)
    };
  } catch {
    return { bounds: normalizeWindowBounds(null), maximized: false };
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const maximized = mainWindow.isMaximized();
    const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    writeFileSync(windowStatePath(), JSON.stringify({ bounds, maximized }, null, 2));
  } catch (error) {
    console.warn('Unable to save window state:', error.message);
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function openExternalUrl(url) {
  if (!isSafeExternalUrl(url)) return;
  await shell.openExternal(url, { activate: true });
}

function createMainWindow() {
  const state = readWindowState();
  const icon = nativeImage.createFromDataURL(TRAY_ICON);

  mainWindow = new BrowserWindow({
    ...state.bounds,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f0e8',
    title: 'SkillPilot · 本地 Skills 管理中心',
    icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged
    }
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppUrl(url, appUrl)) return;
    event.preventDefault();
    void openExternalUrl(url);
  });

  mainWindow.once('ready-to-show', showMainWindow);
  mainWindow.on('close', (event) => {
    saveWindowState();
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(appUrl);
}

function createTray() {
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
  tray.setToolTip('SkillPilot · 本地 Skills 管理中心');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 SkillPilot', click: showMainWindow },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('double-click', showMainWindow);
}

function startDesktopServer() {
  return new Promise((resolve, reject) => {
    server = startServer(0, {
      openBrowser: false,
      onReady: resolve
    });
    server.once('error', reject);
  });
}

app.on('second-instance', showMainWindow);

app.on('before-quit', () => {
  isQuitting = true;
  saveWindowState();
  server?.close();
});

app.on('activate', () => {
  if (mainWindow) showMainWindow();
  else if (appUrl) createMainWindow();
});

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    appUrl = await startDesktopServer();
    createTray();
    createMainWindow();
  }).catch((error) => {
    console.error('SkillPilot failed to start:', error);
    app.quit();
  });
}
