import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { DESKTOP_CHANNELS, runtimeInfoSchema } from '@canvas-agent/contracts'
import icon from '../../resources/icon.png?asset'
import { resolveAppConfig } from './config'
import { openWorkspaceDatabase, closeWorkspaceDatabase } from './database'
import { GitRevisionReader } from './git-revision-reader'
import { WorkspaceService } from './workspace-service'
import { ExecutionCoordinator } from './execution-coordinator'
import { seedDemoWorkspace } from './demo-seed'
import { UnavailableWorkerHost } from './worker-host'
import { UtilityProcessWorkerHost } from './utility-process-worker-host'
import { runWorkerSmoke } from './worker-smoke'
import { registerCommandRouter } from './command-router'
import { isTrustedSender } from './security'

const allowedExternalOrigins = new Set(['https://deerflow.tech'])

function resolveMigrationsFolder(): string {
  const sourceDrizzle = join(app.getAppPath(), '..', '..', 'packages', 'persistence', 'drizzle')
  if (existsSync(sourceDrizzle)) {
    return sourceDrizzle
  }
  return join(app.getAppPath(), 'drizzle')
}

function registerRuntimeInfoHandler(): void {
  ipcMain.handle(DESKTOP_CHANNELS.runtimeInfo, (event) => {
    if (!isTrustedSender(event.senderFrame)) {
      throw new Error('Rejected IPC request from an untrusted renderer')
    }

    return runtimeInfoSchema.parse({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      platform: process.platform,
      connected: true
    })
  })
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f7f8fb',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url)
    if (allowedExternalOrigins.has(target.origin)) {
      void shell.openExternal(target.toString())
    }
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('tech.canvasagent.desktop')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Composition root for the real core loop.
  let persistence: ReturnType<typeof openWorkspaceDatabase> | null = null
  let workspace: WorkspaceService | null = null
  let appConfig: Awaited<ReturnType<typeof resolveAppConfig>>['config'] = null
  try {
    const configResult = await resolveAppConfig(app.getPath('userData'))
    if (configResult.error !== null) {
      console.error(`[workspace] configuration error: ${configResult.error}`)
    }
    if (configResult.config !== null) {
      appConfig = configResult.config
      persistence = openWorkspaceDatabase(
        join(app.getPath('userData'), 'canvas-agent.db'),
        undefined,
        resolveMigrationsFolder()
      )
      workspace = new WorkspaceService(persistence, new GitRevisionReader(configResult.config))
      console.error(`[workspace] ready at ${configResult.config.sourceRepositoryPath}`)
    } else if (configResult.error === null) {
      console.error(
        '[workspace] CANVAS_AGENT_REPO is not set; workspace commands are unavailable (fixture UI only). ' +
          'This is a Phase-1 bootstrap mechanism, not the final workspace-selection UX.'
      )
    }
  } catch (error) {
    console.error('[workspace] failed to start the workspace service', error)
  }
  const workerHost =
    appConfig !== null ? new UtilityProcessWorkerHost(appConfig) : new UnavailableWorkerHost()
  const coordinator =
    persistence !== null ? new ExecutionCoordinator(persistence, workerHost) : null

  if (process.env['CANVAS_AGENT_DEMO_SEED'] === '1' && persistence !== null) {
    try {
      const demoProjectId = await seedDemoWorkspace(persistence)
      console.error(`[workspace] demo seed ready at ${demoProjectId}`)
    } catch (error) {
      console.error('[workspace] demo seed failed', error)
    }
  }

  registerRuntimeInfoHandler()
  registerCommandRouter({ workspace, coordinator })

  if (process.env['CANVAS_AGENT_SMOKE'] === '1' && appConfig !== null) {
    void runWorkerSmoke(appConfig, workerHost)
      .catch((error) => {
        console.error('[worker-smoke] FAILED:', error instanceof Error ? error.message : error)
      })
      .finally(() => {
        app.quit()
      })
  }

  let shuttingDown = false
  app.on('before-quit', (event) => {
    if (shuttingDown) return
    event.preventDefault()
    shuttingDown = true
    void (async () => {
      try {
        await workerHost.dispose()
      } catch (error) {
        console.error('[workspace] worker dispose failed', error)
      }
      if (persistence !== null) {
        closeWorkspaceDatabase(persistence)
      }
      app.quit()
    })()
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
