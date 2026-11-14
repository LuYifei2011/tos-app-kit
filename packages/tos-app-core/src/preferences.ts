import { createState } from './state.ts'

export type Locale = 'zh-CN' | 'en-US'
export type Theme = 'light' | 'dark'
export type ThemePreference = 'tos' | 'browser' | Theme
export type LanguagePreference = 'tos' | 'browser' | Locale
export interface Preferences { theme: ThemePreference; language: LanguagePreference }
export interface PreferenceState {
  preferences: Readonly<Preferences>
  theme: Theme
  language: Locale
  themeSource: 'tos' | 'browser' | 'manual'
  languageSource: 'tos' | 'browser' | 'manual'
}
export interface PreferenceOptions {
  storageKey: string
  timeoutMs?: number
  syncIntervalMs?: number
  readTheme?: (signal: AbortSignal) => Promise<Theme | null>
  readLanguage?: (signal: AbortSignal) => Promise<Locale | null>
}
export function browserLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    if (/^zh(?:[-_]|$)/i.test(language)) return 'zh-CN'
    if (/^en(?:[-_]|$)/i.test(language)) return 'en-US'
  }
  return 'en-US'
}
export function parseDesktopTheme(payload: unknown): Theme | null {
  if (!payload || typeof payload !== 'object') return null
  const response = payload as { code?: unknown; is_login?: unknown; data?: { display_mode?: unknown } }
  if (response.code !== true || response.is_login === false) return null
  const mode = response.data?.display_mode
  return mode === 'light' || mode === 'dark' ? mode : null
}
export function parseDesktopLanguage(payload: unknown): Locale | null {
  if (!payload || typeof payload !== 'object') return null
  const response = payload as { code?: unknown; is_login?: unknown; data?: { tos_lang?: unknown } }
  if (response.code !== true || response.is_login === false || typeof response.data?.tos_lang !== 'string') return null
  const value = response.data.tos_lang
  if (/^zh(?:[-_]|$)/i.test(value)) return 'zh-CN'
  return /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(value) ? 'en-US' : null
}
export function readDesktopThemeCookie(): Theme | null {
  try {
    const value = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('themeMode='))?.slice(10)
    return value === 'light' || value === 'dark' ? value : null
  } catch { return null }
}
export function parsePreferences(raw: string | null): Preferences {
  try {
    const value = JSON.parse(raw ?? '{}') ?? {}
    return {
      theme: value.theme === 'auto' ? 'tos' : ['tos', 'browser', 'light', 'dark'].includes(value.theme) ? value.theme : 'tos',
      language: value.language === 'auto' ? 'browser' : ['tos', 'browser', 'zh-CN', 'en-US'].includes(value.language) ? value.language : 'tos',
    }
  } catch { return { theme: 'tos', language: 'tos' } }
}
// Optional preferences never feed application authentication or diagnostics.
async function readPlatformPreference<T>(path: string, parse: (payload: unknown) => T | null, signal: AbortSignal): Promise<T | null> {
  try {
    let csrf = ''
    try { csrf = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('X-Csrf-Token='))?.slice(13) ?? '' } catch { /* Browser fallback remains available. */ }
    const response = await fetch(path, { credentials: 'include', cache: 'no-store', redirect: 'error', signal, headers: csrf ? { 'X-Csrf-Token': csrf } : {} })
    return response.ok ? parse(await response.json()) : null
  } catch { return null }
}
export const readDesktopTheme = async (signal: AbortSignal): Promise<Theme | null> => readDesktopThemeCookie() ?? readPlatformPreference('/v2/person/desktopDisplay', parseDesktopTheme, signal)
export const readDesktopLanguage = (signal: AbortSignal) => readPlatformPreference('/v2/timesetting/getlang', parseDesktopLanguage, signal)

export function createPreferences(options: PreferenceOptions) {
  if (!options.storageKey) throw new Error('A preference storage key is required')
  for (const value of [options.timeoutMs ?? 2000, options.syncIntervalMs ?? 30000]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Preference intervals must be positive')
  }
  let preferences: Preferences = { theme: 'tos', language: 'tos' }
  let browserTheme: Theme = 'light'
  let browserLanguage: Locale = 'zh-CN'
  let desktopTheme: Theme | null = null
  let desktopLanguage: Locale | null = null
  const snapshot = (): PreferenceState => ({
    preferences: Object.freeze({ ...preferences }),
    theme: preferences.theme === 'tos' ? desktopTheme ?? browserTheme : preferences.theme === 'browser' ? browserTheme : preferences.theme,
    language: preferences.language === 'tos' ? desktopLanguage ?? browserLanguage : preferences.language === 'browser' ? browserLanguage : preferences.language,
    themeSource: preferences.theme === 'tos' ? desktopTheme ? 'tos' : 'browser' : preferences.theme === 'browser' ? 'browser' : 'manual',
    languageSource: preferences.language === 'tos' ? desktopLanguage ? 'tos' : 'browser' : preferences.language === 'browser' ? 'browser' : 'manual',
  })
  const state = createState(snapshot())
  const publish = () => state.update(snapshot())
  let stop = () => {}
  let sync = () => {}
  let cancelRequest = (_key: 'theme' | 'language') => {}
  function set(next: Preferences, save = true) {
    for (const key of ['theme', 'language'] as const) {
      if (next[key] !== preferences[key]) {
        cancelRequest(key)
        if (key === 'theme') desktopTheme = null
        else desktopLanguage = null
      }
    }
    preferences = next
    if (save) {
      try { localStorage.setItem(options.storageKey, JSON.stringify(preferences)) } catch { /* Session-only changes still work. */ }
    }
    publish()
    sync()
  }
  return {
    get snapshot() { return state.snapshot },
    subscribe: state.subscribe,
    setTheme(theme: ThemePreference) {
      if (!['tos', 'browser', 'light', 'dark'].includes(theme)) throw new Error('Invalid theme preference')
      set({ ...preferences, theme })
    },
    setLanguage(language: LanguagePreference) {
      if (!['tos', 'browser', 'zh-CN', 'en-US'].includes(language)) throw new Error('Invalid language preference')
      set({ ...preferences, language })
    },
    start(): () => void {
      stop()
      let saved: string | null = null
      try { saved = localStorage.getItem(options.storageKey) } catch { /* Storage can be unavailable in embedded browsers. */ }
      preferences = parsePreferences(saved)
      desktopTheme = preferences.theme === 'tos' ? readDesktopThemeCookie() : null
      desktopLanguage = null
      browserLanguage = browserLocale(navigator.languages ?? [navigator.language])
      const media = matchMedia('(prefers-color-scheme: dark)')
      browserTheme = media.matches ? 'dark' : 'light'
      const requests = new Map<'theme' | 'language', { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()
      let disposed = false
      cancelRequest = key => {
        const pending = requests.get(key)
        if (!pending) return
        requests.delete(key)
        clearTimeout(pending.timer)
        pending.controller.abort()
      }
      function refresh<T>(key: 'theme' | 'language', read: (signal: AbortSignal) => Promise<T | null>, apply: (value: T | null) => void) {
        if (disposed || requests.has(key) || document.visibilityState === 'hidden') return
        const controller = new AbortController()
        const finish = (value: T | null) => {
          const current = requests.get(key)
          if (disposed || current?.controller !== controller) return
          clearTimeout(current.timer)
          requests.delete(key)
          apply(value)
          publish()
        }
        const timer = setTimeout(() => { finish(null); controller.abort() }, options.timeoutMs ?? 2000)
        requests.set(key, { controller, timer })
        void (async () => {
          try { finish(await read(controller.signal)) } catch { finish(null) }
        })()
      }
      sync = () => {
        if (preferences.theme === 'tos') refresh('theme', options.readTheme ?? readDesktopTheme, value => { desktopTheme = value })
        if (preferences.language === 'tos') refresh('language', options.readLanguage ?? readDesktopLanguage, value => { desktopLanguage = value })
      }
      const onLanguageChange = () => { browserLanguage = browserLocale(navigator.languages ?? [navigator.language]); publish() }
      const onMedia = (event: MediaQueryListEvent) => { browserTheme = event.matches ? 'dark' : 'light'; publish() }
      const onStorage = (event: StorageEvent) => {
        if (event.key === options.storageKey || event.key === null) set(parsePreferences(event.key === null ? null : event.newValue), false)
      }
      media.addEventListener('change', onMedia)
      window.addEventListener('languagechange', onLanguageChange)
      window.addEventListener('focus', sync)
      window.addEventListener('storage', onStorage)
      document.addEventListener('visibilitychange', sync)
      const activeSync = sync
      const interval = setInterval(sync, options.syncIntervalMs ?? 30000)
      publish()
      sync()
      const cleanup = () => {
        if (disposed) return
        disposed = true
        for (const key of [...requests.keys()]) cancelRequest(key)
        clearInterval(interval)
        media.removeEventListener('change', onMedia)
        window.removeEventListener('languagechange', onLanguageChange)
        window.removeEventListener('focus', activeSync)
        window.removeEventListener('storage', onStorage)
        document.removeEventListener('visibilitychange', activeSync)
        sync = () => {}
        cancelRequest = () => {}
      }
      stop = cleanup
      return cleanup
    },
    stop() { stop() },
  }
}
export type PreferenceManager = ReturnType<typeof createPreferences>
