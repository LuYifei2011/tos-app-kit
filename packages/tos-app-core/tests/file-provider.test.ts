import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTosApp, createFileProvider, createApiClient, TosApiError } from '../src/index.ts'
import type { TosFileProvider } from '../src/index.ts'
import './browser-fixture.ts'

const signal = () => ({ signal: new AbortController().signal })
const dir = { path: '/Volume1/文档', name: '文档', kind: 'directory' }
const file = { path: '/Volume1/文档/a #?.txt', name: 'a #?.txt', kind: 'file', size: 10 }
const listing = { directory: dir, parentPath: null, entries: [file] }

test('file service is optional and creates no eager requests', () => {
  const fetch = async () => { throw new Error('unexpected request') }
  assert.equal(createTosApp({ id: 'example', api: { fetch } }).files, undefined)
  assert.equal(createTosApp({ id: 'example', files: false, api: { fetch } }).files, undefined)
  assert.ok(createTosApp({ id: 'example', files: true, api: { fetch } }).files)
  const provider: TosFileProvider = { async list() { throw new Error() }, async stat() { return null } }
  assert.equal(createTosApp({ id: 'example', files: provider }).files, provider)
})

test('default provider uses app API credentials, encoded paths and gateway base', async () => {
  const urls: string[] = []
  const app = createTosApp({ id: 'example', files: true, api: { fetch: async (url, init) => {
    urls.push(String(url))
    assert.equal(init?.credentials, 'include')
    assert.equal(new Headers(init?.headers).get('X-Csrf-Token'), 'secret-csrf')
    assert.equal(init?.method, 'GET')
    return Response.json(String(url).includes('/stat?') ? { entry: file } : String(url).includes('?') ? listing : { directory: null, parentPath: null, entries: [dir] })
  } } })
  assert.deepEqual((await app.files!.list(null, signal())).entries, [dir])
  assert.deepEqual(await app.files!.list(dir.path, signal()), listing)
  assert.deepEqual(await app.files!.stat(file.path, signal()), file)
  assert.deepEqual(urls, ['/v2/proxy/example/api/files/list', `/v2/proxy/example/api/files/list?path=${encodeURIComponent(dir.path)}`, `/v2/proxy/example/api/files/stat?path=${encodeURIComponent(file.path)}`])
})

test('custom base supports optional non-Go servers implementing the same contract', async () => {
  const app = createTosApp({ id: 'example', files: { base: '/picker' }, api: { base: '/custom', fetch: async url => {
    assert.equal(url, `/custom/picker/stat?path=${encodeURIComponent(file.path)}`)
    return Response.json({ entry: null })
  } } })
  assert.equal(await app.files!.stat(file.path, signal()), null)
  for (const base of ['https://evil', '//evil', '/files/../secret', '/files?x=1']) assert.throws(() => createFileProvider(app.api, { base }))
})

test('only explicit entry:null indicates missing; malformed successes reject', async () => {
  for (const data of [{}, { entry: false }, { entry: { ...file, path: '/different' } }, { entry: { ...file, size: -1 } }, { entry: { ...file, modifiedAt: 'invalid' } }]) {
    const app = createTosApp({ id: 'example', files: true, api: { fetch: async () => Response.json(data) } })
    await assert.rejects(app.files!.stat(file.path, signal()), error => error instanceof TosApiError && error.kind === 'invalid-response')
  }
  for (const data of [{}, { ...listing, entries: null }, { ...listing, directory: null }, { ...listing, parentPath: '/escape' }, { ...listing, entries: [file, file] }, { ...listing, entries: [{ ...file, path: '/elsewhere/a.txt' }] }]) {
    const app = createTosApp({ id: 'example', files: true, api: { fetch: async () => Response.json(data) } })
    await assert.rejects(app.files!.list(dir.path, signal()), TosApiError)
  }
})

test('file permission failures stay local while session failures use shared app state', async () => {
  let status = 409
  const app = createTosApp({ id: 'example', files: true, api: { blockOnAccessFailure: true, getRetries: 0, fetch: async () => Response.json({ code: status === 409 ? 'FILE_ACCESS_DENIED' : 'TOS_SESSION_EXPIRED' }, { status }) } })
  await assert.rejects(app.files!.stat(file.path, signal()), error => error instanceof TosApiError && error.code === 'FILE_ACCESS_DENIED')
  assert.equal(!!app.api.snapshot.accessFailure, false)
  status = 401
  await assert.rejects(app.files!.stat(file.path, signal()), TosApiError)
  assert.equal(app.api.snapshot.accessFailure?.kind, 'session')
  for (const status of [404, 502, 503]) {
    const provider = createFileProvider(createApiClient({ appId: 'example', getRetries: 0, fetch: async () => Response.json({ error: 'failed' }, { status }) }))
    await assert.rejects(provider.stat(file.path, signal()), TosApiError)
  }
})

test('abort propagates through the provider and invalid paths never reach fetch', async () => {
  const controller = new AbortController()
  const reason = new Error('cancelled')
  const app = createTosApp({ id: 'example', files: true, api: { fetch: async (_, init) => {
    controller.abort(reason)
    init?.signal?.throwIfAborted()
    throw new Error('not aborted')
  } } })
  await assert.rejects(app.files!.stat(file.path, { signal: controller.signal }), error => error === reason)
  for (const path of ['relative', '//evil', '/a/../b', '/a\\b', '/a/']) await assert.rejects(app.files!.stat(path, signal()), /Invalid NAS path/)
})
