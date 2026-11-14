import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApiClient, createTosApp, TosApiError } from '../src/index.ts'
import type { ApiOptions } from '../src/index.ts'
import { tick } from './browser-fixture.ts'

const client = (options: Partial<ApiOptions> = {}) => createApiClient({ appId: 'example', getRetries: 0, ...options })

test('in-band session failures produce access errors instead of application data', async () => {
  const api = client({ fetch: async () => Response.json({ is_login: false, code: false, code_num: 117 }) })
  await assert.rejects(api.request('/status'), error => error instanceof TosApiError && error.kind === 'session')
  assert.equal(api.snapshot.accessFailure?.kind, 'session')
  assert.equal(api.snapshot.diagnostic?.status, 200)
  assert.equal(api.snapshot.diagnostic?.failure, 'platform-session')
  assert.equal(api.snapshot.diagnostic?.responseCode, '117')
})

test('empty gateway diagnostics report request flags and redact credential values', async () => {
  Object.defineProperty(globalThis, 'location', { configurable: true, value: {
    origin: 'http://nas:8181', pathname: '/example/', search: '?token=secret-query&source=mobile',
  } })
  const api = client({ diagnosticPath: () => '/list', fetch: async () => new Response(null, { status: 403 }) })
  await assert.rejects(api.request('/list?root=secret-root&path=secret-path'))
  const report = api.snapshot.diagnostic!
  assert.equal(report.clientVersion, 'dev')
  assert.equal(report.serverVersion, null)
  assert.equal(report.responseFormat, 'empty')
  assert.equal(report.responseBytes, 0)
  assert.equal(report.csrfCookieAvailable, true)
  assert.equal(report.csrfHeaderConfigured, true)
  assert.equal(report.sessionCookieReadable, true)
  assert.equal(report.pageOrigin, 'http://nas:8181')
  assert.deepEqual(report.queryKeys, ['token', 'source'])
  assert.equal(report.requestPath, '/v2/proxy/example/api/list')
  assert.doesNotMatch(JSON.stringify(report), /secret-session|secret-csrf|secret-query|secret-root|secret-path/)
})

test('unreadable CSRF omits its header and preserves gateway denial', async () => {
  for (const blocked of [false, true]) {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: blocked
      ? { get cookie() { throw new Error('blocked') } } : { cookie: '' } })
    const api = client({ fetch: async (_, options) => {
      assert.equal(new Headers(options?.headers).has('X-Csrf-Token'), false)
      assert.equal(options?.credentials, 'include')
      return new Response(null, { status: 403 })
    } })
    await assert.rejects(api.request('/status'), error => error instanceof TosApiError && error.kind === 'denied')
    assert.equal(api.snapshot.diagnostic?.cookieAccess, blocked ? 'blocked' : 'readable')
    assert.equal(api.snapshot.diagnostic?.csrfHeaderConfigured, false)
    assert.equal(api.snapshot.diagnostic?.csrfCookieAvailable, false)
  }
})

test('network diagnostics record request flags without exception secrets', async () => {
  const api = client({ fetch: async () => { throw new Error('secret-network-detail') } })
  await assert.rejects(api.request('/status'), error => error instanceof TosApiError && error.kind === 'network')
  assert.equal(api.snapshot.diagnostic?.status, null)
  assert.equal(api.snapshot.diagnostic?.responseFormat, 'unavailable')
  assert.equal(api.snapshot.diagnostic?.failure, 'network')
  assert.doesNotMatch(JSON.stringify(api.snapshot.diagnostic), /secret-network-detail/)
})

test('a concurrent success preserves a blocked access-denial diagnostic', async () => {
  let finish!: (value: Response) => void
  const api = client({ blockOnAccessFailure: true, diagnosticPath: path => path,
    fetch: async input => String(input).endsWith('/pending')
      ? new Promise(resolve => { finish = resolve }) : new Response(null, { status: 403 }),
  })
  const pending = api.request('/pending')
  await assert.rejects(api.request('/private'))
  finish(Response.json([]))
  await pending
  assert.equal(api.snapshot.diagnostic?.status, 403)
  assert.equal(api.snapshot.diagnostic?.requestPath, '/v2/proxy/example/api/private')
})

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
