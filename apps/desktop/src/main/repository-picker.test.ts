import { afterEach, describe, expect, it } from 'vitest'
import { EnvRepositoryPicker, PICKER_CANCEL, pickerFromEnvironment } from './repository-picker'

describe('EnvRepositoryPicker (E2E seam)', () => {
  afterEach(() => {
    delete process.env['CANVAS_AGENT_E2E']
    delete process.env['CANVAS_AGENT_USER_DATA']
    delete process.env['CANVAS_AGENT_TEST_PICKER']
  })

  it('strictly parses a path value', async () => {
    process.env['CANVAS_AGENT_TEST_PICKER'] = '/tmp/some-repo'
    const picker = new EnvRepositoryPicker()
    await expect(picker.pick(undefined)).resolves.toEqual({
      cancelled: false,
      path: '/tmp/some-repo'
    })
  })

  it('treats the exact cancel sentinel as cancellation (strict, no trimming)', async () => {
    process.env['CANVAS_AGENT_TEST_PICKER'] = PICKER_CANCEL
    const picker = new EnvRepositoryPicker()
    await expect(picker.pick(undefined)).resolves.toEqual({ cancelled: true, path: null })

    process.env['CANVAS_AGENT_TEST_PICKER'] = ` ${PICKER_CANCEL} `
    await expect(picker.pick(undefined)).resolves.toEqual({
      cancelled: false,
      path: ` ${PICKER_CANCEL} `
    })
  })

  it('treats an unset or empty value as cancellation', async () => {
    const picker = new EnvRepositoryPicker()
    await expect(picker.pick(undefined)).resolves.toEqual({ cancelled: true, path: null })
    process.env['CANVAS_AGENT_TEST_PICKER'] = ''
    await expect(picker.pick(undefined)).resolves.toEqual({ cancelled: true, path: null })
    process.env['CANVAS_AGENT_TEST_PICKER'] = '   '
    await expect(picker.pick(undefined)).resolves.toEqual({ cancelled: false, path: '   ' })
  })

  it('is only enabled when both E2E mode and an isolated userData are present', () => {
    expect(pickerFromEnvironment()).toBeNull()
    process.env['CANVAS_AGENT_E2E'] = '1'
    expect(pickerFromEnvironment()).toBeNull()
    process.env['CANVAS_AGENT_USER_DATA'] = '/tmp/ca-e2e-home'
    expect(pickerFromEnvironment()).toBeInstanceOf(EnvRepositoryPicker)
    process.env['CANVAS_AGENT_E2E'] = '0'
    expect(pickerFromEnvironment()).toBeNull()
  })
})
