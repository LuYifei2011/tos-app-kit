import { computed, inject, shallowRef, watch } from 'vue'
import type { App, InjectionKey } from 'vue'
import { createTranslator } from './i18n.ts'
import type { Locale, LanguagePreference, ThemePreference } from './preferences.ts'
import type { TosApp } from './index.ts'
import type { Translator } from './i18n.ts'

export function createTosAppVue(core: TosApp, options: { english?: Record<string, string>; singular?: Record<string, string> } = {}) {
  const preferenceState = shallowRef(core.preferences.snapshot)
  const apiState = shallowRef(core.api.snapshot)
  const unsubscribePreferences = core.preferences.subscribe(value => { preferenceState.value = value })
  const unsubscribeApi = core.api.subscribe(value => { apiState.value = value })
  const language = computed({ get: () => preferenceState.value.language, set: (value: Locale) => core.preferences.setLanguage(value) })
  const theme = computed(() => preferenceState.value.theme)
  const translate: Translator = createTranslator(() => language.value, options.english, options.singular)
  let stop = () => {}
  const context = {
    core, translate, language, theme,
    themePreference: computed({ get: () => preferenceState.value.preferences.theme, set: (value: ThemePreference) => core.preferences.setTheme(value) }),
    languagePreference: computed({ get: () => preferenceState.value.preferences.language, set: (value: LanguagePreference) => core.preferences.setLanguage(value) }),
    themeSource: computed(() => preferenceState.value.themeSource),
    languageSource: computed(() => preferenceState.value.languageSource),
    connectionDiagnostic: computed(() => apiState.value.diagnostic),
    backendVersion: computed(() => apiState.value.serverVersion),
    accessFailure: computed(() => apiState.value.accessFailure),
    start(options: { title?: (locale: Locale) => string; applyDocument?: boolean } = {}) {
      stop()
      const stopCore = core.preferences.start()
      const apply = () => {
        if (options.applyDocument === false) return
        document.documentElement.lang = language.value
        document.documentElement.dataset.theme = theme.value
        document.documentElement.style.colorScheme = theme.value
        if (options.title) document.title = options.title(language.value)
      }
      const stopWatch = watch([language, theme], apply, { immediate: true, flush: 'sync' })
      stop = () => { stopWatch(); stopCore() }
      return stop
    },
    dispose() { stop(); unsubscribePreferences(); unsubscribeApi() },
    install(app: App) {
      app.provide(tosAppKey, context)
      app.onUnmount(context.dispose)
    },
  }
  return context
}
export type TosAppVue = ReturnType<typeof createTosAppVue>
const tosAppKey: InjectionKey<TosAppVue> = Symbol('tos-app')
export function useTosApp(): TosAppVue {
  const context = inject(tosAppKey)
  if (!context) throw new Error('Install createTosAppVue(core) before using TOS components')
  return context
}
