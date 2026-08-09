import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { DESKTOP_CHANNELS, runtimeInfoSchema } from '@canvas-agent/contracts'
import icon from '../../resources/icon.png?asset'
import { seedDemoWorkspace } from './demo-seed'
import { runWorkerSmoke } from './worker-smoke'
import { runPhase3Smoke } from './phase3-smoke'
import { registerCommandRouter } from './command-router'
import { isTrustedSender } from './security'
import { MigrationFolderNotFoundError, resolveMigrationFolder } from './migration-path'
import { WorkspaceRuntimeManager } from './workspace-runtime-manager'
import { NativeDirectoryPicker, pickerFromEnvironment } from './repository-picker'
import {
  AgentRuntimeLocator,
  NativeExecutablePicker,
  executablePickerFromEnvironment
} from './agent-runtime-locator'

const allowedExternalOrigins = new Set(['https://deerflow.tech'])

// macOS does not honor $HOME for userData; this escape hatch lets smoke/E2E
// runs isolate the workspace database (fresh DB per run).
if (process.env['CANVAS_AGENT_USER_DATA']) {
  app.setPath('userData', process.env['CANVAS_AGENT_USER_DATA'])
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

  // Composition root: one Main-owned WorkspaceRuntimeManager.
  let manager: WorkspaceRuntimeManager
  try {
    const migrationFolder = resolveMigrationFolder({
      mode: app.isPackaged ? 'packaged' : 'source',
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath
    })
    const picker = pickerFromEnvironment() ?? new NativeDirectoryPicker()
    manager = new WorkspaceRuntimeManager({
      userData: app.getPath('userData'),
      picker,
      migrationsFolder: migrationFolder,
      bootstrapPath: process.env['CANVAS_AGENT_REPO'] ?? null
    })
  } catch (error) {
    if (error instanceof MigrationFolderNotFoundError && app.isPackaged) {
      console.error(`[workspace] FATAL: ${error.message}`)
      app.exit(1)
      return
    }
    throw error
  }

  const probePath = [process.env['PATH'], '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
    .filter((entry): entry is string => entry !== undefined && entry.length > 0)
    .join(':')
  const agent = new AgentRuntimeLocator({
    userData: app.getPath('userData'),
    homePath: app.getPath('home'),
    environment: {
      PATH: probePath,
      HOME: app.getPath('home')
    },
    picker: executablePickerFromEnvironment() ?? new NativeExecutablePicker(),
    isChangeBlocked: () => manager.hasActiveRuns()
  })

  const startupStatus = await manager.startup()
  if (startupStatus.state !== 'CLOSED' && startupStatus.lastError !== null) {
    console.error(
      `[workspace] startup left the runtime in ${startupStatus.state} (${startupStatus.lastError.reasonCode})`
    )
  }

  if (process.env['CANVAS_AGENT_DEMO_SEED'] === '1') {
    const runtime = manager.getReadyRuntime()
    if (runtime !== null) {
      try {
        const demoProjectId = await seedDemoWorkspace(runtime.persistence)
        console.error(`[workspace] demo seed ready at ${demoProjectId}`)
      } catch (error) {
        console.error('[workspace] demo seed failed', error)
      }
    }
  }

  registerRuntimeInfoHandler()
  registerCommandRouter({ manager, agent })

  if (process.env['CANVAS_AGENT_SMOKE'] === '1') {
    const runtime = manager.getReadyRuntime()
    if (runtime !== null) {
      void runWorkerSmoke(runtime.appConfig, runtime.workerHost)
        .catch((error) => {
          console.error('[worker-smoke] FAILED:', error instanceof Error ? error.message : error)
        })
        .finally(() => {
          app.quit()
        })
    }
  }

  if (process.env['CANVAS_AGENT_PHASE3_SMOKE'] === '1') {
    void runPhase3Smoke({ manager, agent })
      .catch((error) => {
        console.error('[phase3-smoke] FAILED:', error instanceof Error ? error.message : error)
      })
      .finally(() => {
        app.quit()
      })
  }

  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void (async () => {
      const status = await manager.close()
      if (status.state === 'CLOSED') {
        app.quit()
      } else {
        quitting = false
        console.error(`[workspace] quit blocked: state=${status.state}`)
      }
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
