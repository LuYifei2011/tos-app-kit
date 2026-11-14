import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFileDialog, createTosApp, matchesTosFileFilter, validTosFilename } from '../src/index.ts'
import type { TosDirectory, TosFileEntry, TosFileProvider } from '../src/index.ts'

const folder: TosFileEntry = { name: '共享', path: '/共享', kind: 'directory' }
const a: TosFileEntry = { name: 'a.txt', path: '/共享/a.txt', kind: 'file' }
const b: TosFileEntry = { name: 'b.md', path: '/共享/b.md', kind: 'file' }
const child: TosFileEntry = { name: '子目录', path: '/共享/子目录', kind: 'directory' }
const listing: TosDirectory = { directory: folder, parentPath: null, entries: [a, b, child] }
function fixture() {
  const files = new Map([folder, a, b, child].map(entry => [entry.path, entry]))
  const provider: TosFileProvider = {
    async list(path) { return path === null ? { directory: null, parentPath: null, entries: [folder] } : listing },
    async stat(path) { return files.get(path) ?? null },
  }
  return { files, provider }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('file provider belongs to its app and dialogs have isolated selections', async () => {
  const { provider } = fixture()
  const app = createTosApp({ id: 'files', files: provider })
  assert.equal(app.files, provider)
  assert.equal(createTosApp({ id: 'other' }).files, undefined)
  const first = createFileDialog(provider, { multiple: true })
  const second = createFileDialog(provider)
  await Promise.all([first.navigate(folder.path), second.navigate(folder.path)])
  first.select(a.path); first.select(b.path); first.select(a.path)
  assert.deepEqual((await first.confirm())?.paths, [b.path])
  assert.equal(second.canConfirm, false)
  second.select(a.path); second.select(b.path)
  assert.deepEqual((await second.confirm())?.paths, [b.path])
})

test('folder mode selects current or explicit folders, never virtual root or files', async () => {
  const { provider } = fixture()
  const dialog = createFileDialog(provider, { kind: 'directory', multiple: true })
  await dialog.navigate(null)
  assert.equal(dialog.canConfirm, false)
  dialog.select(folder.path)
  assert.deepEqual((await dialog.confirm())?.paths, [folder.path])
  await dialog.navigate(folder.path)
  assert.deepEqual((await dialog.confirm())?.paths, [folder.path])
  dialog.select(a.path)
  assert.deepEqual(dialog.snapshot.selectedPaths, [])
  dialog.select(child.path)
  assert.deepEqual((await dialog.confirm())?.paths, [child.path])
})

test('save validates leaf names and extension filters without creating anything', async () => {
  const { files, provider } = fixture()
  const dialog = createFileDialog(provider, { mode: 'save', filters: [{ label: 'Text', extensions: ['.txt'] }] })
  await dialog.navigate(null)
  dialog.setFilename('new.txt')
  assert.equal(dialog.canConfirm, false)
  await dialog.navigate(folder.path)
  for (const name of ['', ' ', '.', '..', '../new.txt', '/new.txt', 'a/b.txt', 'a\\b.txt', 'a\0.txt', 'a\n.txt', 'a.jpg']) {
    dialog.setFilename(name)
    assert.equal(dialog.canConfirm, false, name)
  }
  dialog.setFilename('新的记录.TXT')
  assert.deepEqual(await dialog.confirm(), { mode: 'save', kind: 'file', paths: ['/共享/新的记录.TXT'], overwrite: false })
  assert.equal(files.size, 4)
  assert.equal(validTosFilename('.hidden'), true)
  assert.equal(matchesTosFileFilter({ ...a, name: 'archive.TAR.GZ' }, { label: 'Archive', extensions: ['.tar.gz'] }), true)
})

test('filter changes clear previous selection and directories remain navigable', async () => {
  const { provider } = fixture()
  const dialog = createFileDialog(provider, { filters: [{ label: 'All', extensions: [] }, { label: 'Text', extensions: ['.txt'] }] })
  await dialog.navigate(folder.path)
  dialog.select(b.path)
  dialog.setFilter(1)
  assert.equal(dialog.canConfirm, false)
  dialog.select(b.path)
  assert.equal(dialog.canConfirm, false)
  assert.equal(matchesTosFileFilter(child, dialog.filters[1]), true)
  dialog.select(a.path)
  assert.deepEqual((await dialog.confirm())?.paths, [a.path])
})

test('existing save targets require explicit confirmation scoped to the current name', async () => {
  const { provider } = fixture()
  const dialog = createFileDialog(provider, { mode: 'save', defaultName: a.name })
  await dialog.navigate(folder.path)
  assert.equal(await dialog.confirm(true), null)
  assert.equal(dialog.snapshot.overwritePath, a.path)
  dialog.cancelOverwrite()
  assert.equal(dialog.snapshot.overwritePath, null)
  await dialog.confirm()
  dialog.setFilename(b.name)
  assert.equal(await dialog.confirm(true), null)
  assert.equal(dialog.snapshot.overwritePath, b.path)
  assert.deepEqual(await dialog.confirm(true), { mode: 'save', kind: 'file', paths: [b.path], overwrite: true })
})

test('save-folder supports new and existing destinations and rejects a file collision', async () => {
  const { provider } = fixture()
  const dialog = createFileDialog(provider, { mode: 'save', kind: 'directory' })
  await dialog.navigate(folder.path)
  dialog.setFilename('new')
  assert.deepEqual(await dialog.confirm(), { mode: 'save', kind: 'directory', paths: ['/共享/new'], overwrite: false })
  dialog.setFilename(a.name)
  assert.equal(await dialog.confirm(), null)
  assert.equal(dialog.snapshot.error, '此名称已被另一类型的项目占用。')
  dialog.select(child.path)
  assert.equal(dialog.snapshot.filename, child.name)
  assert.equal(await dialog.confirm(), null)
  assert.equal((await dialog.confirm(true))?.overwrite, true)
})

test('confirmation rechecks deletion, type changes and permission failures', async () => {
  const { provider, files } = fixture()
  const dialog = createFileDialog(provider)
  await dialog.navigate(folder.path)
  dialog.select(a.path)
  files.delete(a.path)
  assert.equal(await dialog.confirm(), null)
  assert.match(dialog.snapshot.error!, /已不存在/)
  files.set(a.path, { ...a, kind: 'directory' })
  assert.equal(await dialog.confirm(), null)
  provider.stat = async () => { throw new Error('denied') }
  assert.equal(await dialog.confirm(), null)
  assert.match(dialog.snapshot.error!, /无法检查/)
  const save = createFileDialog(provider, { mode: 'save', defaultName: 'new.txt' })
  await save.navigate(folder.path)
  assert.equal(await save.confirm(), null)
  assert.equal(save.snapshot.overwritePath, null)
})

test('navigation aborts previous request and ignores late responses even if provider ignores abort', async () => {
  const old = deferred<TosDirectory>()
  const current = deferred<TosDirectory>()
  const signals: AbortSignal[] = []
  const { provider } = fixture()
  provider.list = (path, { signal }) => { signals.push(signal); return path === '/old' ? old.promise : current.promise }
  const dialog = createFileDialog(provider)
  const first = dialog.navigate('/old')
  const second = dialog.navigate('/new')
  assert.equal(signals[0]!.aborted, true)
  current.resolve(listing)
  await second
  old.resolve({ directory: null, parentPath: null, entries: [] })
  await first
  assert.equal(dialog.snapshot.location, listing)
  assert.equal(dialog.snapshot.loading, false)
})

test('failed navigation clears stale selections, supports retry and root recovery', async () => {
  const { provider } = fixture()
  let fail = false
  provider.list = async path => { if (fail) throw new Error('denied'); return path === null ? { directory: null, parentPath: null, entries: [folder] } : listing }
  const dialog = createFileDialog(provider)
  await dialog.navigate(folder.path)
  dialog.select(a.path)
  fail = true
  await dialog.navigate('/denied')
  assert.equal(dialog.canConfirm, false)
  assert.deepEqual(dialog.snapshot.selectedPaths, [])
  assert.match(dialog.snapshot.error!, /无法读取/)
  fail = false
  await dialog.retry()
  assert.equal(dialog.snapshot.location, listing)
  await dialog.navigate(null)
  assert.equal(dialog.snapshot.location?.directory, null)
})

test('closing or changing destination discards in-flight confirmation and prevents duplicate confirms', async () => {
  const { provider } = fixture()
  const pending = deferred<TosFileEntry | null>()
  let signal!: AbortSignal
  provider.stat = (_, options) => { signal = options.signal; return pending.promise }
  const dialog = createFileDialog(provider, { mode: 'save', defaultName: 'a.txt' })
  await dialog.navigate(folder.path)
  const confirmation = dialog.confirm()
  assert.equal(await dialog.confirm(), null)
  dialog.setFilename('b.txt')
  assert.equal(signal.aborted, true)
  pending.resolve(a)
  assert.equal(await confirmation, null)
  assert.equal(dialog.snapshot.overwritePath, null)
  const next = deferred<TosFileEntry | null>()
  provider.stat = (_, options) => { signal = options.signal; return next.promise }
  const closing = dialog.confirm()
  dialog.dispose()
  assert.equal(signal.aborted, true)
  next.resolve(null)
  assert.equal(await closing, null)
  assert.equal(dialog.canConfirm, false)
})

test('closing during navigation aborts and ignores a late failure', async () => {
  const { provider } = fixture()
  const pending = deferred<TosDirectory>()
  let signal!: AbortSignal
  provider.list = (_, options) => { signal = options.signal; return pending.promise }
  const dialog = createFileDialog(provider)
  const navigation = dialog.navigate(null)
  dialog.dispose()
  pending.reject(new Error('late failure'))
  await navigation
  assert.equal(signal.aborted, true)
  assert.equal(dialog.snapshot.error, null)
  assert.equal(dialog.canConfirm, false)
})


test('editing disabled fields or dismissing an absent prompt cannot strand a directory load', async () => {
  const { provider } = fixture()
  const pending = deferred<TosDirectory>()
  let signal!: AbortSignal
  provider.list = (_, options) => { signal = options.signal; return pending.promise }
  const dialog = createFileDialog(provider, { mode: 'save', filters: [{ label: 'All', extensions: [] }] })
  const loading = dialog.navigate(folder.path)
  dialog.setFilename('ignored.txt')
  dialog.setFilter(0)
  dialog.cancelOverwrite()
  assert.equal(signal.aborted, false)
  pending.resolve(listing)
  await loading
  assert.equal(dialog.snapshot.loading, false)
  assert.equal(dialog.snapshot.location, listing)
})

test('desktop range selection replaces the selection and filters incompatible entries', async () => {
  const { provider } = fixture()
  const dialog = createFileDialog(provider, { multiple: true })
  await dialog.navigate(folder.path)
  dialog.setSelection([a.path, child.path, b.path, a.path, '/unknown'])
  assert.deepEqual((await dialog.confirm())?.paths, [a.path, b.path])
  dialog.setSelection([b.path])
  assert.deepEqual((await dialog.confirm())?.paths, [b.path])
  dialog.setSelection([])
  assert.equal(dialog.canConfirm, false)
  const single = createFileDialog(provider)
  await single.navigate(folder.path)
  single.setSelection([a.path, b.path])
  assert.deepEqual((await single.confirm())?.paths, [a.path])
})

test('selecting a save target fills its name and navigation-only selection preserves the typed name', async () => {
  const { provider } = fixture()
  const dialog = createFileDialog(provider, { mode: 'save', defaultName: 'draft.txt' })
  await dialog.navigate(folder.path)
  dialog.setSelection([a.path])
  assert.equal(dialog.snapshot.filename, a.name)
  await dialog.confirm()
  dialog.setSelection([child.path])
  assert.equal(dialog.snapshot.filename, a.name)
  assert.equal(dialog.snapshot.overwritePath, null)
  assert.deepEqual(dialog.snapshot.selectedPaths, [])
})

test('dismissing an overwrite modal cancels an in-flight recheck without submitting', async () => {
  const { provider } = fixture()
  const dialog = createFileDialog(provider, { mode: 'save', defaultName: a.name })
  await dialog.navigate(folder.path)
  await dialog.confirm()
  const pending = deferred<TosFileEntry | null>()
  let signal!: AbortSignal
  provider.stat = (_, options) => { signal = options.signal; return pending.promise }
  const result = dialog.confirm(true)
  dialog.cancelOverwrite()
  assert.equal(signal.aborted, true)
  pending.resolve(a)
  assert.equal(await result, null)
  assert.equal(dialog.snapshot.checking, false)
  assert.equal(dialog.snapshot.filename, a.name)
})
