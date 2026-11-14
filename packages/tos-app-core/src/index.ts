import { createApiClient } from './api.ts'
import type { ApiOptions } from './api.ts'
import { createPreferences } from './preferences.ts'
import type { PreferenceOptions } from './preferences.ts'
export * from './api.ts'
export * from './preferences.ts'
export * from './i18n.ts'

export interface TosAppOptions {
  id: string
  version?: string
  api?: Omit<ApiOptions, 'appId' | 'version'>
  preferences?: Partial<PreferenceOptions>
}
export function createTosApp(options: TosAppOptions) {
  if (!/^[a-z][a-z0-9-]*$/.test(options.id)) throw new Error('Invalid TOS application ID')
  return {
    id: options.id,
    version: options.version ?? 'dev',
    api: createApiClient({ ...options.api, appId: options.id, version: options.version }),
    preferences: createPreferences({ storageKey: `${options.id}.preferences`, ...options.preferences }),
  }
}
export type TosApp = ReturnType<typeof createTosApp>
