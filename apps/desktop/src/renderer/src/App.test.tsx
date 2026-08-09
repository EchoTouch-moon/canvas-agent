// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n'
import App from './App'

vi.mock('@/components/app/product-onboarding', () => ({
  ProductOnboarding: () => <div>product-live-workspace</div>
}))

vi.mock('@/components/app/core-flow-workspace', () => ({
  CoreFlowWorkspace: () => <div>fixture-workspace</div>
}))

afterEach(cleanup)

describe('App production composition', () => {
  it('starts Live and exposes no Fixture chooser without the explicit development flag', () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>
    )

    expect(screen.getByText('product-live-workspace')).toBeTruthy()
    expect(screen.queryByText('fixture-workspace')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Fixture flow' })).toBeNull()
  })
})
