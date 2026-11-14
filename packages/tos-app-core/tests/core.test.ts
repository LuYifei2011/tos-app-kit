import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createApiClient, createTosApp, createTranslator, TosApiError } from '../src/index.ts'
import type { ApiOptions } from '../src/index.ts'
import { createTosAppVue, useTosApp } from '../src/vue.ts'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'

const keys = ['document', 'window', 'localStorage', 'navigator', 'matchMedia'] as const
const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const cleanups: Array<() => void> = []
let storage: Map<string, string>
let page: EventTarget & { cookie: string; visibilityState: string }
const tick = () => new Promise(resolve => setImmediate(resolve))
beforeEach(() => {
  storage = new Map()
  page = Object.assign(new EventTarget(), { cookie: 'TMSESSNAME=secret-session; X-Csrf-Token=secret-csrf', visibilityState: 'visible' })
  const mocks = {
    document: page, window: new EventTarget(), navigator: { languages: ['zh-CN'] },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
  }
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: mocks[key] })
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  for (const key of keys) {
    const descriptor = originals.get(key)
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
const client = (options: Partial<ApiOptions> = {}) => createApiClient({ appId: 'example', getRetries: 0, ...options })

test('explicit methods, signals and CSRF work for a second application', async () => {
  const api = client({ fetch: async (url, init) => {
    assert.equal(url, '/v2/proxy/example/api/config')
    assert.equal(init?.method, 'PUT')
    assert.equal(init?.credentials, 'include')
    assert.equal(init?.redirect, 'error')
    assert.equal(new Headers(init?.headers).get('X-Csrf-Token'), 'secret-csrf')
    assert.equal(new Headers(init?.headers).has('Cookie'), false)
    assert.ok(init?.signal instanceof AbortSignal)
    assert.equal(init?.body, '{"enabled":true}')
    return Response.json({ saved: true })
  } })
  assert.deepEqual(await api.request('/config', { method: 'PUT', body: { enabled: true } }), { saved: true })
})
test('only GET retries transient gateway responses', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    let calls = 0
    const api = client({ getRetries: 2, retryDelayMs: 0, fetch: async () => { calls++; return new Response(null, { status: 503 }) } })
    await assert.rejects(api.request('/operation', { method }), error => error instanceof TosApiError && error.status === 503)
    assert.equal(calls, method === 'GET' ? 3 : 1)
  }
})
test('cancellation during retry stops requests and does not create an error report', async () => {
  const controller = new AbortController()
  let calls = 0
  const api = client({ getRetries: 3, retryDelayMs: 1000, fetch: async () => { calls++; return new Response(null, { status: 503 }) } })
  const pending = api.request('/status', { signal: controller.signal })
  await tick()
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(calls, 1)
  assert.equal(api.snapshot.diagnostic, null)
})
test('a concurrent access denial stops a GET waiting to retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const api = client({ blockOnAccessFailure: true, getRetries: 2, retryDelayMs: 10, fetch: async url => {
    calls++
    return new Response(null, { status: String(url).endsWith('/status') ? 503 : 403 })
  } })
  const pending = api.request('/status')
  await tick()
  await assert.rejects(api.request('/private'))
  const rejected = assert.rejects(pending, error => error instanceof TosApiError && error.kind === 'denied')
  t.mock.timers.tick(10)
  await rejected
  assert.equal(calls, 2)
})
test('successful HEAD and no-content responses do not create format errors', async () => {
  for (const [method, status] of [['HEAD', 200], ['DELETE', 204], ['PUT', 205]] as const) {
    const api = client({ fetch: async () => new Response(null, { status }) })
    assert.equal(await api.request('/config', { method }), undefined)
    assert.equal(api.snapshot.diagnostic, null)
  }
})
test('timeouts have a distinct error kind and release the request', async () => {
  const api = client({ timeoutMs: 10, fetch: async (_, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  }) })
  await assert.rejects(api.request('/status'), error => error instanceof TosApiError && error.kind === 'timeout')
  assert.equal(api.snapshot.diagnostic?.failure, 'network')
})
test('clients isolate authorization state, versions and diagnostics', async () => {
  let notified = 0
  const a = client({ blockOnAccessFailure: true, onAccessFailure: () => { notified++ }, fetch: async () => new Response(null, { status: 401 }) })
  const b = client({ appId: 'other', fetch: async () => Response.json({ ok: true }, { headers: { 'X-TOS-App-Version': '2.0.0' } }) })
  await assert.rejects(a.request('/private'), error => error instanceof TosApiError && error.kind === 'session')
  await assert.rejects(a.request('/status'))
  assert.equal(notified, 1)
  assert.deepEqual(await b.request('/status'), { ok: true })
  assert.equal(b.snapshot.serverVersion, '2.0.0')
  assert.equal(b.snapshot.accessFailure, null)
  assert.equal(b.snapshot.diagnostic, null)
  a.reset()
  assert.equal(a.snapshot.accessFailure, null)
})
test('nonblocking clients can recover from an authorization failure', async () => {
  let calls = 0
  const api = client({ fetch: async () => ++calls === 1 ? new Response(null, { status: 403 }) : Response.json({ ok: true }) })
  await assert.rejects(api.request('/status'))
  await api.request('/status')
  assert.equal(api.snapshot.accessFailure, null)
  assert.equal(api.snapshot.diagnostic, null)
})
test('default diagnostics redact arbitrary endpoint names, query values and raw responses', async () => {
  const api = client({ fetch: async () => Response.json({ code: 'secret-response-code', error: 'secret-body' }, { status: 500, headers: { 'X-TOS-App-Version': 'bad version secret' } }) })
  await assert.rejects(api.request('/files/secret-filename?token=secret-token'))
  const diagnostic = api.snapshot.diagnostic!
  assert.equal(diagnostic.requestPath, '/v2/proxy/example/api/:endpoint')
  assert.equal(diagnostic.serverVersion, null)
  assert.equal(diagnostic.responseCode, null)
  assert.doesNotMatch(JSON.stringify(diagnostic), /secret/)
})
test('API paths cannot traverse or redirect credentials outside the application', async () => {
  let calls = 0
  const api = client({ fetch: async () => { calls++; return Response.json({}) } })
  for (const path of ['https://other/', '//other/', '/../status', '/%2e%2e/status', '/..%2fstatus', '/%252e%252e/status', '/a\\b', '/%00']) {
    await assert.rejects(api.request(path), /within the application API/)
  }
  assert.equal(calls, 0)
  assert.throws(() => client({ base: '//other/api' }), /same-origin/)
  assert.throws(() => createTosApp({ id: '../other' }), /application ID/)
})
test('preferences and translations are isolated between applications', async () => {
  const a = createTosApp({ id: 'first' })
  const b = createTosApp({ id: 'second' })
  storage.set('first.preferences', '{"theme":"dark","language":"en-US"}')
  storage.set('second.preferences', '{"theme":"light","language":"zh-CN"}')
  cleanups.push(a.preferences.start(), b.preferences.start())
  a.preferences.setTheme('light')
  assert.equal(a.preferences.snapshot.themeSource, 'manual')
  assert.equal(b.preferences.snapshot.language, 'zh-CN')
  assert.equal(createTranslator(() => a.preferences.snapshot.language)('主题'), 'Theme')
  assert.equal(createTranslator(() => b.preferences.snapshot.language)('主题'), '主题')
  assert.equal(JSON.parse(storage.get('first.preferences')!).theme, 'light')
  assert.equal(JSON.parse(storage.get('second.preferences')!).language, 'zh-CN')
  await tick()
})
test('storage events update only their application and clearing storage resets preferences', () => {
  storage.set('first.preferences', '{"theme":"light","language":"en-US"}')
  const a = createTosApp({ id: 'first' })
  cleanups.push(a.preferences.start())
  const event = (key: string | null, newValue: string | null) => window.dispatchEvent(Object.assign(new Event('storage'), { key, newValue }))
  event('other.preferences', '{"theme":"dark","language":"zh-CN"}')
  assert.equal(a.preferences.snapshot.theme, 'light')
  event('first.preferences', '{"theme":"dark","language":"zh-CN"}')
  assert.equal(a.preferences.snapshot.theme, 'dark')
  event(null, null)
  assert.deepEqual(a.preferences.snapshot.preferences, { theme: 'tos', language: 'tos' })
  assert.equal(JSON.parse(storage.get('first.preferences')!).theme, 'light', 'external updates must not echo storage writes')
})
test('a preference reader that ignores abort cannot prevent timeout fallback or disposal', async () => {
  const app = createTosApp({ id: 'example', preferences: { timeoutMs: 10, readTheme: () => new Promise(() => {}), readLanguage: () => new Promise(() => {}) } })
  const stop = app.preferences.start()
  cleanups.push(stop)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(app.preferences.snapshot.themeSource, 'browser')
  stop()
})
test('disposal and restart ignore results from earlier preference requests', async () => {
  const finishes: Array<(value: 'dark' | 'light') => void> = []
  const app = createTosApp({ id: 'example', preferences: { readTheme: () => new Promise(resolve => finishes.push(resolve)), readLanguage: async () => null } })
  const oldStop = app.preferences.start()
  oldStop()
  const stop = app.preferences.start()
  cleanups.push(stop)
  oldStop()
  finishes[0]!('dark')
  await tick()
  assert.equal(app.preferences.snapshot.theme, 'light')
  finishes[1]!('dark')
  await tick()
  assert.equal(app.preferences.snapshot.theme, 'dark')
})
test('Vue injection supplies the matching application context to independent roots', async () => {
  for (const [id, language] of [['first', 'en-US'], ['second', 'zh-CN']] as const) {
    const core = createTosApp({ id })
    const tos = createTosAppVue(core)
    cleanups.push(tos.dispose)
    core.preferences.setLanguage(language)
    const app = createSSRApp({ setup() { const context = useTosApp(); return () => h('p', context.core.id + ':' + context.translate('主题')) } })
    app.use(tos)
    assert.equal(await renderToString(app), `<p>${id}:${language === 'en-US' ? 'Theme' : '主题'}</p>`)
  }
})
