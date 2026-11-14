import { afterEach, beforeEach } from 'node:test'

const keys = ['fetch', 'document', 'window', 'location', 'localStorage', 'navigator', 'matchMedia'] as const
const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
export const cleanups: Array<() => void> = []
export let storage: Map<string, string>
export let page: EventTarget & { cookie: string; visibilityState: string }
export let media: EventTarget & { matches: boolean }
export const tick = () => new Promise<void>(resolve => setImmediate(resolve))
beforeEach(() => {
  storage = new Map()
  page = Object.assign(new EventTarget(), { cookie: 'TMSESSNAME=secret-session; X-Csrf-Token=secret-csrf', visibilityState: 'visible' })
  media = Object.assign(new EventTarget(), { matches: false })
  const mocks = {
    fetch: async () => new Response(null, { status: 404 }),
    document: page, window: new EventTarget(), navigator: { languages: ['zh-CN'] },
    location: { origin: 'http://nas:8181', pathname: '/example/', search: '' },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    matchMedia: () => media,
  }
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: mocks[key] })
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  for (const key of keys) {
    const descriptor = originals.get(key)
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
