import { TosApiError } from './api.ts'
import type { ApiClient } from './api.ts'
import type { TosDirectory, TosFileEntry, TosFileProvider } from './files.ts'

export interface TosFileServiceOptions {
  /** Relative to the application's API base; defaults to /files. */
  base?: string
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const pathValid = (value: unknown): value is string => typeof value === 'string' && value.startsWith('/') && value.length > 1 && !/[\\\u0000-\u001f\u007f]/.test(value) && value.slice(1).split('/').every(part => !!part && part !== '.' && part !== '..')
const parent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'
const invalid = () => new TosApiError('invalid-response', 200, 'FILE_RESPONSE_INVALID')
function entry(value: unknown): value is TosFileEntry {
  return record(value) && pathValid(value.path) && typeof value.name === 'string' && !!value.name &&
    (value.kind === 'file' || value.kind === 'directory') &&
    (value.size === undefined || (Number.isSafeInteger(value.size) && (value.size as number) >= 0)) &&
    (value.modifiedAt === undefined || (typeof value.modifiedAt === 'string' && Number.isFinite(Date.parse(value.modifiedAt))))
}

/** Uses the app's existing authenticated API client. Creates no requests until used. */
export function createFileProvider(api: ApiClient, options: TosFileServiceOptions = {}): TosFileProvider {
  const base = options.base ?? '/files'
  if (!/^\/(?:[a-z0-9_~-]+\/)*[a-z0-9_~-]+$/i.test(base)) throw new Error('File service base must be an API-relative absolute path')
  return {
    async list(path, { signal }) {
      if (path !== null && !pathValid(path)) throw new Error('Invalid NAS path')
      const data = await api.request<unknown>(`${base}/list${path === null ? '' : `?path=${encodeURIComponent(path)}`}`, { signal })
      if (!record(data) || !Array.isArray(data.entries) || !data.entries.every(entry)) throw invalid()
      if (path === null) {
        if (data.directory !== null || data.parentPath !== null || data.entries.some(item => item.kind !== 'directory')) throw invalid()
      } else {
        if (!entry(data.directory) || data.directory.kind !== 'directory' || data.directory.path !== path ||
          (data.parentPath !== null && data.parentPath !== parent(path)) ||
          data.entries.some(item => parent(item.path) !== path || item.name !== item.path.slice(path.length + 1))) throw invalid()
      }
      if (new Set(data.entries.map(item => item.path)).size !== data.entries.length) throw invalid()
      return data as unknown as TosDirectory
    },
    async stat(path, { signal }) {
      if (!pathValid(path)) throw new Error('Invalid NAS path')
      const data = await api.request<unknown>(`${base}/stat?path=${encodeURIComponent(path)}`, { signal })
      if (!record(data) || (data.entry !== null && (!entry(data.entry) || data.entry.path !== path))) throw invalid()
      return data.entry as TosFileEntry | null
    },
  }
}
