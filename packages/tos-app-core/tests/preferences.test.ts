import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { browserLocale, createPreferences, createTosApp, parseDesktopLanguage, parseDesktopTheme, parsePreferences, readDesktopLanguage, readDesktopTheme, readDesktopThemeCookie } from '../src/index.ts'
import { cleanups, media, page, storage, tick } from './browser-fixture.ts'

let preferences: ReturnType<typeof createPreferences>
let dispose: (() => void) | undefined
beforeEach(() => { preferences = createPreferences({ storageKey: 'example.preferences' }); dispose = undefined })
function start() {
  const stop = preferences.start()
  cleanups.push(stop)
  return stop
}

test('browser language negotiation and stored preference validation', () => {
  assert.equal(browserLocale(['de-DE', 'en-GB', 'zh-CN']), 'en-US')
  assert.equal(browserLocale(['zh-TW', 'en-US']), 'zh-CN')
  assert.equal(browserLocale(['fr-FR']), 'en-US')
  for (const raw of [null, '{', 'null', 'true', '[]', '{"theme":"purple","language":"fr"}']) assert.deepEqual(parsePreferences(raw), { theme: 'tos', language: 'tos' })
  assert.deepEqual(parsePreferences('{"theme":"light","language":"en-US"}'), { theme: 'light', language: 'en-US' })
  assert.deepEqual(parsePreferences('{"theme":"auto","language":"auto"}'), { theme: 'tos', language: 'browser' })
  assert.deepEqual(parsePreferences('{"theme":"browser","language":"tos"}'), { theme: 'browser', language: 'tos' })
})

test('only successful TOS envelopes with recognized modes select a desktop theme', () => {
  assert.equal(parseDesktopTheme({ is_login: true, code: true, data: { display_mode: 'dark', color: '#3491FA' } }), 'dark')
  assert.equal(parseDesktopTheme({ code: true, data: { display_mode: 'light' } }), 'light')
  for (const payload of [null, {}, { code: false, data: { display_mode: 'dark' } }, { code: true, is_login: false, data: { display_mode: 'dark' } }, { code: true, data: { display_mode: 'unknown' } }]) assert.equal(parseDesktopTheme(payload), null)
})

test('TOS language uses tos_lang and maps unsupported locales to English', () => {
  assert.equal(parseDesktopLanguage({ is_login: true, code: true, data: { tos_lang: 'zh-cn', notify_lang: 'en-us' } }), 'zh-CN')
  assert.equal(parseDesktopLanguage({ code: true, data: { tos_lang: 'zh-hk' } }), 'zh-CN')
  assert.equal(parseDesktopLanguage({ code: true, data: { tos_lang: 'en-us' } }), 'en-US')
  assert.equal(parseDesktopLanguage({ code: true, data: { tos_lang: 'de-de' } }), 'en-US')
  for (const payload of [null, {}, { code: false, data: { tos_lang: 'zh-cn' } }, { code: true, is_login: false, data: { tos_lang: 'zh-cn' } }, { code: true, data: { notify_lang: 'zh-cn' } }, { code: true, data: { tos_lang: '' } }, { code: true, data: { tos_lang: 1 } }]) assert.equal(parseDesktopLanguage(payload), null)
})

test('language request uses the same-origin TOS session and ignores rejected responses', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/v2/timesetting/getlang')
    assert.equal(options?.credentials, 'include')
    assert.equal(options?.redirect, 'error')
    assert.equal(new Headers(options?.headers).get('X-Csrf-Token'), 'secret-csrf')
    return Response.json({ is_login: true, code: true, data: { tos_lang: 'en-us' } })
  }
  assert.equal(await readDesktopLanguage(new AbortController().signal), 'en-US')
  globalThis.fetch = async () => new Response(null, { status: 403 })
  assert.equal(await readDesktopLanguage(new AbortController().signal), null)
})

test('TOS language and browser language can be selected independently of the theme', async () => {
  storage.set('example.preferences', JSON.stringify({ theme: 'browser', language: 'tos' }))
  let requests = 0
  let tosLanguage = 'en-us'
  globalThis.fetch = async url => {
    requests++
    assert.equal(url, '/v2/timesetting/getlang')
    return Response.json({ code: true, data: { tos_lang: tosLanguage } })
  }
  dispose = start()
  await tick()
  assert.equal(preferences.snapshot.language, 'en-US')
  assert.equal(preferences.snapshot.languageSource, 'tos')
  assert.equal(preferences.snapshot.theme, 'light')
  tosLanguage = 'zh-cn'
  window.dispatchEvent(new Event('focus'))
  await tick()
  assert.equal(preferences.snapshot.language, 'zh-CN')
  preferences.setLanguage('browser')
  await tick()
  assert.equal(preferences.snapshot.languageSource, 'browser')
  const before = requests
  window.dispatchEvent(new Event('focus'))
  await tick()
  assert.equal(requests, before)
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['en-GB'] } })
  window.dispatchEvent(new Event('languagechange'))
  assert.equal(preferences.snapshot.language, 'en-US')
})

test('browser preferences do not request either TOS endpoint', async () => {
  storage.set('example.preferences', JSON.stringify({ theme: 'browser', language: 'browser' }))
  let requests = 0
  globalThis.fetch = async () => { requests++; return new Response(null, { status: 500 }) }
  dispose = start()
  await tick()
  window.dispatchEvent(new Event('focus'))
  await tick()
  assert.equal(requests, 0)
  assert.equal(preferences.snapshot.language, 'zh-CN')
  assert.equal(preferences.snapshot.theme, 'light')
})

test('a valid TOS theme cookie applies synchronously and avoids the display request', async () => {
  storage.set('example.preferences', JSON.stringify({ theme: 'tos', language: 'browser' }))
  page.cookie = 'X-Csrf-Token=test-csrf; themeMode=dark; themeColor=blue'
  let requests = 0
  globalThis.fetch = async () => { requests++; return new Response(null, { status: 500 }) }
  dispose = start()
  assert.equal(preferences.snapshot.theme, 'dark')
  await tick()
  assert.equal(preferences.snapshot.themeSource, 'tos')
  assert.equal(requests, 0)
  page.cookie = 'themeMode=light'
  window.dispatchEvent(new Event('focus'))
  await tick()
  assert.equal(preferences.snapshot.theme, 'light')
  preferences.setTheme('browser')
  await tick()
  page.cookie = 'themeMode=dark'
  window.dispatchEvent(new Event('focus'))
  await tick()
  assert.equal(preferences.snapshot.theme, 'light')
  assert.equal(preferences.snapshot.themeSource, 'browser')
  assert.equal(requests, 0)
})

test('missing, malformed and inaccessible theme cookies fall back to the display API', async () => {
  let requests = 0
  globalThis.fetch = async url => {
    requests++
    assert.equal(url, '/v2/person/desktopDisplay')
    return Response.json({ code: true, data: { display_mode: 'light' } })
  }
  for (const cookie of ['', 'themeMode=unknown', 'other=themeMode=dark', 'themeMode=', 'themeMode=dark-extra']) {
    page.cookie = cookie
    assert.equal(readDesktopThemeCookie(), null)
    assert.equal(await readDesktopTheme(new AbortController().signal), 'light')
  }
  Object.defineProperty(page, 'cookie', { get() { throw new Error('blocked') } })
  assert.equal(await readDesktopTheme(new AbortController().signal), 'light')
  assert.equal(requests, 6)
})

test('a language response cannot override an explicit choice made while it was pending', async () => {
  storage.set('example.preferences', JSON.stringify({ theme: 'light', language: 'tos' }))
  let finish!: (response: Response) => void
  globalThis.fetch = async () => new Promise(resolve => { finish = resolve })
  dispose = start()
  preferences.setLanguage('zh-CN')
  finish(Response.json({ code: true, data: { tos_lang: 'en-us' } }))
  await tick()
  assert.equal(preferences.snapshot.language, 'zh-CN')
  preferences.setLanguage('browser')
  assert.equal(preferences.snapshot.language, 'zh-CN')
})

test('display request stays same-origin with the existing CSRF session', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/v2/person/desktopDisplay')
    assert.equal(options?.credentials, 'include')
    assert.equal(options?.redirect, 'error')
    assert.equal(options?.cache, 'no-store')
    assert.equal(new Headers(options?.headers).get('X-Csrf-Token'), 'secret-csrf')
    return Response.json({ code: true, data: { display_mode: 'dark' } })
  }
  assert.equal(await readDesktopTheme(new AbortController().signal), 'dark')
})

test('display failures quietly fall back even when cookies are blocked', async () => {
  Object.defineProperty(page, 'cookie', { get() { throw new Error('blocked') } })
  globalThis.fetch = async (_, options) => {
    assert.equal(new Headers(options?.headers).has('X-Csrf-Token'), false)
    return new Response('<html>forbidden</html>', { status: 403 })
  }
  assert.equal(await readDesktopTheme(new AbortController().signal), null)
  globalThis.fetch = async () => new Response('<html>login</html>')
  assert.equal(await readDesktopTheme(new AbortController().signal), null)
  globalThis.fetch = async () => { throw new Error('offline') }
  dispose = start()
  await tick()
  assert.equal(preferences.snapshot.theme, 'light')
  assert.equal(preferences.snapshot.themeSource, 'browser')
})

test('TOS theme wins in auto mode and explicit preferences survive reinitialization', async () => {
  globalThis.fetch = async () => Response.json({ code: true, data: { display_mode: 'dark' } })
  dispose = start()
  await tick()
  assert.equal(preferences.snapshot.theme, 'dark')
  assert.equal(preferences.snapshot.themeSource, 'tos')
  preferences.setTheme('light')
  preferences.setLanguage('en-US')
  await tick()
  assert.deepEqual(JSON.parse(storage.get('example.preferences')!), { theme: 'light', language: 'en-US' })
  dispose()
  dispose = start()
  await tick()
  assert.equal(preferences.snapshot.theme, 'light')
  assert.equal(preferences.snapshot.language, 'en-US')
})

test('browser appearance changes are applied when TOS is unavailable', async () => {
  dispose = start()
  await tick()
  media.dispatchEvent(Object.assign(new Event('change'), { matches: true }))
  await tick()
  assert.equal(preferences.snapshot.theme, 'dark')
  preferences.setTheme('light')
  await tick()
  media.dispatchEvent(Object.assign(new Event('change'), { matches: true }))
  await tick()
  assert.equal(preferences.snapshot.theme, 'light')
})

test('storage denial does not prevent language or theme changes', async () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
  dispose = start()
  await tick()
  preferences.setLanguage('en-US')
  preferences.setTheme('dark')
  await tick()
  assert.equal(preferences.snapshot.language, 'en-US')
  assert.equal(preferences.snapshot.theme, 'dark')
})

test('cleanup aborts a pending request and ignores its late result', async () => {
  const finishes: Array<(response: Response) => void> = []
  const signals: AbortSignal[] = []
  globalThis.fetch = async (_, options) => {
    if (options?.signal) signals.push(options.signal)
    return new Promise(resolve => { finishes.push(resolve) })
  }
  dispose = start()
  dispose()
  dispose = undefined
  assert.equal(signals.length, 2)
  assert.ok(signals.every(signal => signal.aborted))
  const before = preferences.snapshot.theme
  for (const finish of finishes) finish(Response.json({ code: true, data: { display_mode: 'dark', tos_lang: 'en-us' } }))
  await tick()
  assert.equal(preferences.snapshot.theme, before)
  assert.equal(preferences.snapshot.language, 'zh-CN')
})

test('a timed-out refresh falls back from the previous TOS theme', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  globalThis.fetch = async () => Response.json({ code: true, data: { display_mode: 'dark' } })
  dispose = start()
  await tick()
  assert.equal(preferences.snapshot.theme, 'dark')
  globalThis.fetch = async (_, options) => new Promise((_, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
  window.dispatchEvent(new Event('focus'))
  t.mock.timers.tick(2000)
  await tick()
  assert.equal(preferences.snapshot.theme, 'light')
  assert.equal(preferences.snapshot.themeSource, 'browser')
})

test('a timed-out language refresh falls back from TOS to the browser language', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  storage.set('example.preferences', JSON.stringify({ theme: 'light', language: 'tos' }))
  globalThis.fetch = async () => Response.json({ code: true, data: { tos_lang: 'en-us' } })
  dispose = start()
  await tick()
  assert.equal(preferences.snapshot.language, 'en-US')
  globalThis.fetch = async (_, options) => new Promise((_, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
  window.dispatchEvent(new Event('focus'))
  t.mock.timers.tick(2000)
  await tick()
  assert.equal(preferences.snapshot.language, 'zh-CN')
  assert.equal(preferences.snapshot.languageSource, 'browser')
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
test('a preference reader that ignores abort cannot prevent timeout fallback or disposal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const app = createTosApp({ id: 'example', preferences: { timeoutMs: 10, readTheme: () => new Promise(() => {}), readLanguage: () => new Promise(() => {}) } })
  const stop = app.preferences.start()
  cleanups.push(stop)
  t.mock.timers.tick(10)
  await tick()
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
