import { createState } from './state.ts'

export type TosFileKind = 'file' | 'directory'
export interface TosFileEntry {
  /** Absolute NAS path. The provider must enforce the user's access rights. */
  path: string
  name: string
  kind: TosFileKind
  size?: number
  modifiedAt?: string
}
export interface TosDirectory {
  /** null represents the virtual shared-folder root, which cannot be selected. */
  directory: TosFileEntry | null
  parentPath: string | null
  entries: TosFileEntry[]
}
export interface TosFileProvider {
  /** Return the complete directory listing; null requests the allowed shared folders. */
  list(path: string | null, options: { signal: AbortSignal }): Promise<TosDirectory>
  /** Return null only for a missing path; permission and network errors must reject. */
  stat(path: string, options: { signal: AbortSignal }): Promise<TosFileEntry | null>
}
export interface TosFileFilter {
  label: string
  /** Extensions including the dot, e.g. ['.txt', '.tar.gz']; empty accepts all files. */
  extensions: string[]
}
export interface TosFileDialogOptions {
  mode?: 'open' | 'save'
  kind?: TosFileKind
  multiple?: boolean
  initialPath?: string | null
  defaultName?: string
  filters?: TosFileFilter[]
}
export interface TosFileDialogResult {
  mode: 'open' | 'save'
  kind: TosFileKind
  paths: string[]
  /** Explicit permission from the dialog; the backend must still check atomically. */
  overwrite: boolean
}
export interface TosFileDialogState {
  location: TosDirectory | null
  loading: boolean
  checking: boolean
  error: string | null
  selectedPaths: string[]
  filename: string
  filterIndex: number
  overwritePath: string | null
}

export function validTosFilename(name: string): boolean {
  return name.trim().length > 0 && name !== '.' && name !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(name)
}
export function matchesTosFileFilter(entry: TosFileEntry, filter?: TosFileFilter): boolean {
  return entry.kind === 'directory' || !filter?.extensions.length || filter.extensions.some(extension =>
    extension.startsWith('.') && entry.name.toLowerCase().endsWith(extension.toLowerCase()))
}

/** One controller per dialog session. No filesystem writes are performed here. */
export function createFileDialog(provider: TosFileProvider, options: TosFileDialogOptions = {}) {
  const mode = options.mode ?? 'open'
  const kind = options.kind ?? 'file'
  const multiple = mode === 'open' && !!options.multiple
  const filters = options.filters?.map(filter => ({ ...filter, extensions: [...filter.extensions] })) ?? []
  const state = createState<TosFileDialogState>({
    location: null, loading: false, checking: false, error: null, selectedPaths: [],
    filename: options.defaultName ?? '', filterIndex: 0, overwritePath: null,
  })
  let revision = 0
  let disposed = false
  let request: AbortController | undefined
  let requestedPath = options.initialPath ?? null
  const update = (patch: Partial<TosFileDialogState>) => state.update({ ...state.snapshot, ...patch })
  function invalidate() {
    revision++
    request?.abort()
    update({ checking: false, overwritePath: null, error: null })
  }
  function eligible(entry: TosFileEntry) {
    return entry.kind === kind && matchesTosFileFilter(entry, filters[state.snapshot.filterIndex])
  }
  function savePath(): string | null {
    const directory = state.snapshot.location?.directory
    const filename = state.snapshot.filename
    if (!directory || !validTosFilename(filename)) return null
    if (kind === 'file' && !matchesTosFileFilter({ name: filename, path: '', kind }, filters[state.snapshot.filterIndex])) return null
    return `${directory.path.replace(/\/$/, '')}/${filename}`
  }
  function paths(): string[] {
    if (mode === 'save') { const path = savePath(); return path ? [path] : [] }
    if (state.snapshot.selectedPaths.length) return [...state.snapshot.selectedPaths]
    const current = state.snapshot.location?.directory
    return kind === 'directory' && current ? [current.path] : []
  }
  const controller = {
    mode, kind, multiple, filters,
    get snapshot() { return state.snapshot },
    subscribe: state.subscribe,
    get canConfirm() {
      return !disposed && !state.snapshot.loading && !state.snapshot.checking && !!state.snapshot.location && paths().length > 0
    },
    async navigate(path: string | null) {
      if (disposed) return
      invalidate()
      const currentRevision = revision
      requestedPath = path
      const abort = request = new AbortController()
      update({ loading: true, location: null, selectedPaths: [] })
      try {
        const location = await provider.list(path, { signal: abort.signal })
        if (disposed || currentRevision !== revision) return
        update({ location, loading: false })
      } catch {
        if (disposed || currentRevision !== revision) return
        update({ loading: false, error: '无法读取目录，请重试。' })
      }
    },
    retry() { return controller.navigate(requestedPath) },
    select(path: string) {
      if (disposed || state.snapshot.loading || state.snapshot.checking) return
      const entry = state.snapshot.location?.entries.find(entry => entry.path === path)
      if (!entry || !eligible(entry)) return
      invalidate()
      if (mode === 'save') { update({ filename: entry.name, selectedPaths: [path] }); return }
      const selected = state.snapshot.selectedPaths
      update({ selectedPaths: multiple ? selected.includes(path) ? selected.filter(value => value !== path) : [...selected, path] : [path] })
    },
    setSelection(paths: string[]) {
      if (disposed || state.snapshot.loading || state.snapshot.checking) return
      const entries = state.snapshot.location?.entries ?? []
      const selected = [...new Set(paths)].filter(path => entries.some(entry => entry.path === path && eligible(entry)))
      invalidate()
      update({ selectedPaths: multiple ? selected : selected.slice(0, 1) })
      if (mode === 'save' && selected.length) update({ filename: entries.find(entry => entry.path === selected[0])!.name })
    },
    setFilename(filename: string) {
      if (disposed || state.snapshot.loading) return
      invalidate()
      update({ filename, selectedPaths: [] })
    },
    setFilter(index: number) {
      if (disposed || state.snapshot.loading || !Number.isInteger(index) || index < 0 || index >= filters.length) return
      invalidate()
      update({ filterIndex: index, selectedPaths: [] })
    },
    cancelOverwrite() { if (!disposed && !state.snapshot.loading && (state.snapshot.overwritePath || state.snapshot.checking)) invalidate() },
    async confirm(overwrite = false): Promise<TosFileDialogResult | null> {
      if (!controller.canConfirm) return null
      const targets = paths()
      const approvedPath = state.snapshot.overwritePath
      invalidate()
      const currentRevision = revision
      const abort = request = new AbortController()
      update({ checking: true })
      try {
        const entries = await Promise.all(targets.map(path => provider.stat(path, { signal: abort.signal })))
        if (disposed || currentRevision !== revision) return null
        if (mode === 'open') {
          if (entries.some(entry => !entry || !eligible(entry))) {
            update({ error: '所选项目已不存在或类型已更改，请刷新目录。' })
            return null
          }
        } else {
          const existing = entries[0]
          if (existing && existing.kind !== kind) {
            update({ error: '此名称已被另一类型的项目占用。' })
            return null
          }
          if (existing && (!overwrite || approvedPath !== targets[0])) {
            update({ overwritePath: targets[0]! })
            return null
          }
        }
        return { mode, kind, paths: targets, overwrite: mode === 'save' && !!entries[0] }
      } catch {
        if (!disposed && currentRevision === revision) update({ error: '无法检查所选路径，请重试。' })
        return null
      } finally {
        if (!disposed && currentRevision === revision) update({ checking: false })
      }
    },
    dispose() { disposed = true; revision++; request?.abort() },
  }
  return controller
}
export type TosFileDialogController = ReturnType<typeof createFileDialog>
