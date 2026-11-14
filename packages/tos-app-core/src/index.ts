import type { TosFileProvider } from './files.ts'
import { createFileProvider } from './file-provider.ts'
import type { TosFileServiceOptions } from './file-provider.ts'
import { createApiClient } from './api.ts'
import type { ApiOptions } from './api.ts'
import { createPreferences } from './preferences.ts'
import type { PreferenceOptions } from './preferences.ts'
export * from './api.ts'
export * from './preferences.ts'
export * from './i18n.ts'
export * from './files.ts'
export * from './file-provider.ts'

export interface TosAppOptions {
  id: string
  version?: string
  api?: Omit<ApiOptions, 'appId' | 'version'>
  preferences?: Partial<PreferenceOptions>
  files?: boolean | TosFileServiceOptions | TosFileProvider
}
export function createTosApp(options: TosAppOptions) {
  if (!/^[a-z][a-z0-9-]*$/.test(options.id)) throw new Error('Invalid TOS application ID')
  const api = createApiClient({ ...options.api, appId: options.id, version: options.version })
  const config = options.files
  const files: TosFileProvider | undefined = !config ? undefined :
    typeof config === 'object' && 'list' in config && 'stat' in config ? config :
      createFileProvider(api, config === true ? {} : config)
  return {
    id: options.id,
    files,
    version: options.version ?? 'dev',
    api,
    preferences: createPreferences({ storageKey: `${options.id}.preferences`, ...options.preferences }),
  }
}
export type TosApp = ReturnType<typeof createTosApp>
