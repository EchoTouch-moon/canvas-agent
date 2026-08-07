import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { dictionaries, type Locale, type Messages, type TParams } from './i18n-messages'

export type { Locale, Messages, TParams } from './i18n-messages'

function lookup(messages: Messages, key: string): unknown {
  const path = key.split('.')
  let node: unknown = messages
  for (const segment of path) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  return node
}

function resolveValue(value: unknown, params?: TParams): string {
  if (typeof value === 'function') {
    return (value as (params: TParams) => string)(params ?? {})
  }
  if (typeof value !== 'string') return String(value ?? '')
  if (!params) return value
  return value.replace(/\{(\w+)\}/g, (match, name: string) => {
    const replacement = params[name]
    return replacement === undefined ? match : String(replacement)
  })
}

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, params?: TParams) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  const stored = window.localStorage.getItem('canvas-agent-locale')
  if (stored === 'en' || stored === 'zh') return stored
  return window.navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function I18nProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    window.localStorage.setItem('canvas-agent-locale', next)
  }, [])

  const t = useCallback(
    (key: string, params?: TParams) => {
      const value = lookup(dictionaries[locale], key)
      return resolveValue(value, params)
    },
    [locale]
  )

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (context === null) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}
