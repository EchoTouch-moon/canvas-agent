import { dialog, type BrowserWindow } from 'electron'

export interface RepositoryPickResult {
  cancelled: boolean
  path: string | null
}

export interface RepositoryPicker {
  pick(window: BrowserWindow | undefined): Promise<RepositoryPickResult>
}

export class NativeDirectoryPicker implements RepositoryPicker {
  async pick(window: BrowserWindow | undefined): Promise<RepositoryPickResult> {
    const result =
      window === undefined
        ? await dialog.showOpenDialog({ properties: ['openDirectory'] })
        : await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true, path: null }
    }
    return { cancelled: false, path: result.filePaths[0] }
  }
}

export const PICKER_CANCEL = '__CANCEL__'

export class EnvRepositoryPicker implements RepositoryPicker {
  async pick(_window: BrowserWindow | undefined): Promise<RepositoryPickResult> {
    void _window
    const value = process.env['CANVAS_AGENT_TEST_PICKER']
    if (value === undefined || value === '' || value === PICKER_CANCEL) {
      return { cancelled: true, path: null }
    }
    return { cancelled: false, path: value }
  }
}

export function pickerFromEnvironment(): RepositoryPicker | null {
  const e2eEnabled = process.env['CANVAS_AGENT_E2E'] === '1'
  const isolatedUserData = Boolean(process.env['CANVAS_AGENT_USER_DATA'])
  if (!e2eEnabled || !isolatedUserData) {
    return null
  }
  return new EnvRepositoryPicker()
}
