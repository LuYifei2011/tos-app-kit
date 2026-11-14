import { createState } from './state.ts'

export interface ConnectionDiagnostic {
  clientVersion: string
  serverVersion: string | null
  pageOrigin: string
  pagePath: string
  queryKeys: string[]
  requestPath: string
  method: string
  credentials: 'include'
  cookieAccess: 'readable' | 'blocked'
  sessionCookieReadable: boolean
  csrfCookieAvailable: boolean
  csrfHeaderConfigured: boolean
  status: number | null
  responseFormat: 'empty' | 'json' | 'html' | 'text' | 'unavailable'
  responseBytes: number
  responseCode: string | null
  failure: 'http' | 'network' | 'invalid-response' | 'platform-session' | 'platform-denied'
}
export type ApiErrorKind = 'network' | 'response-read' | 'session' | 'denied' | 'origin' | 'http' | 'invalid-response' | 'timeout'
export class TosApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  readonly code: string | null
  readonly serverMessage: string | null
  constructor(kind: ApiErrorKind, status: number | null = null, code: string | null = null, serverMessage: string | null = null) {
    super(serverMessage ?? `TOS request failed: ${kind}${status === null ? '' : ` (${status})`}`)
    this.name = 'TosApiError'
    this.kind = kind; this.status = status; this.code = code; this.serverMessage = serverMessage
  }
}
export interface ApiState {
  diagnostic: ConnectionDiagnostic | null
  serverVersion: string
  accessFailure: TosApiError | null
}
export interface ApiOptions {
  appId: string
  version?: string
  base?: string
  versionHeader?: string
  timeoutMs?: number
  getRetries?: number
  retryDelayMs?: number
  blockOnAccessFailure?: boolean
  diagnosticPath?: (pathname: string) => string
  fetch?: typeof fetch
  onAccessFailure?: (error: TosApiError) => void
}
export interface RequestOptions {
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
}
const object = (data: unknown): Record<string, unknown> => data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
const safeVersion = (value: string | null) => value && /^[\w.+-]{1,64}$/.test(value) ? value : null
function safeCode(data: Record<string, unknown>): string | null {
  const code = data.code ?? data.code_num
  return typeof code === 'number' ? String(code) : typeof code === 'string' && /^[A-Z][A-Z0-9_-]{0,63}$/.test(code) ? code : typeof data.code_num === 'number' ? String(data.code_num) : null
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const cancel = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, ms)
    signal.addEventListener('abort', cancel, { once: true })
  })
}

export function createApiClient(options: ApiOptions) {
  if (!/^[a-z][a-z0-9-]*$/.test(options.appId)) throw new Error('Invalid TOS application ID')
  const base = options.base ?? `/v2/proxy/${options.appId}/api`
  if (!/^\/(?:[a-z0-9_~-]+\/)*[a-z0-9_~-]+$/i.test(base)) throw new Error('API base must be a same-origin absolute path')
  if (!Number.isInteger(options.getRetries ?? 3) || (options.getRetries ?? 3) < 0) throw new Error('GET retries must be a nonnegative integer')
  if (!Number.isFinite(options.retryDelayMs ?? 500) || (options.retryDelayMs ?? 500) < 0) throw new Error('Retry delay must be nonnegative')
  const state = createState<ApiState>({ diagnostic: null, serverVersion: '', accessFailure: null })
  const update = (patch: Partial<ApiState>) => state.update({ ...state.snapshot, ...patch })
  const blocked = () => !!options.blockOnAccessFailure && !!state.snapshot.accessFailure
  return {
    get snapshot() { return state.snapshot },
    subscribe: state.subscribe,
    reset() { state.update({ diagnostic: null, serverVersion: '', accessFailure: null }) },
    async request<T>(path: string, request: RequestOptions = {}): Promise<T> {
      const segments = path.split('?')[0]!.split('/').slice(1)
      if (!path.startsWith('/') || path.startsWith('//') || /[\\#]/.test(path) || segments.some(part => {
        try { const decoded = decodeURIComponent(part); return decoded === '.' || decoded === '..' || /[\\/%\x00-\x20]/.test(decoded) } catch { return true }
      })) throw new Error('Request path must stay within the application API')
      if (options.blockOnAccessFailure && state.snapshot.accessFailure) throw state.snapshot.accessFailure
      const method = request.method ?? (request.body === undefined ? 'GET' : 'POST')
      if ((method === 'GET' || method === 'HEAD') && request.body !== undefined) throw new Error('GET and HEAD cannot have a body')
      const timeoutMs = request.timeoutMs ?? options.timeoutMs ?? 30000
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Request timeout must be positive')
      const controller = new AbortController()
      let timedOut = false
      const cancel = () => controller.abort(request.signal?.reason)
      if (request.signal?.aborted) cancel()
      else request.signal?.addEventListener('abort', cancel, { once: true })
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
      let cookies = ''
      let cookieAccess: ConnectionDiagnostic['cookieAccess'] = 'readable'
      try { cookies = document.cookie } catch { cookieAccess = 'blocked' }
      const parts = cookies.split(';').map(part => part.trim())
      const csrf = parts.find(part => part.startsWith('X-Csrf-Token='))?.slice(13) ?? ''
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (csrf) headers['X-Csrf-Token'] = csrf
      const report = (failure: ConnectionDiagnostic['failure'], response?: Response, text = '', data?: unknown) => {
        if (blocked()) return
        const pathname = path.split('?')[0]!
        update({ diagnostic: {
          clientVersion: options.version ?? 'dev', serverVersion: safeVersion(response?.headers.get(options.versionHeader ?? 'X-TOS-App-Version') ?? null),
          pageOrigin: typeof location === 'undefined' ? '' : location.origin ?? '',
          pagePath: `/${options.appId}/`,
          queryKeys: typeof location === 'undefined' ? [] : [...new URLSearchParams(location.search ?? '').keys()].filter(key => /^[a-z][a-z0-9_-]{0,40}$/i.test(key)).slice(0, 20),
          requestPath: base + (options.diagnosticPath?.(pathname) ?? '/:endpoint'), method, credentials: 'include', cookieAccess,
          sessionCookieReadable: parts.some(part => /^TMSESSNAME=.+/.test(part)), csrfCookieAvailable: !!csrf, csrfHeaderConfigured: !!headers['X-Csrf-Token'],
          status: response?.status ?? null,
          responseFormat: !response ? 'unavailable' : !text.trim() ? 'empty' : data !== undefined ? 'json' : text.trimStart().startsWith('<') ? 'html' : 'text',
          responseBytes: new TextEncoder().encode(text).length, responseCode: safeCode(object(data)), failure,
        } })
      }
      try {
        controller.signal.throwIfAborted()
        const init: RequestInit = { method, credentials: 'include', redirect: 'error', headers, signal: controller.signal, body: request.body === undefined ? undefined : JSON.stringify(request.body) }
        const send = () => (options.fetch ?? globalThis.fetch)(base + path, init)
        let response = await send()
        for (let attempt = 0; method === 'GET' && !blocked() && [502, 503, 504].includes(response.status) && attempt < (options.getRetries ?? 3); attempt++) {
          await response.body?.cancel()
          await delay((options.retryDelayMs ?? 500) * 2 ** attempt, controller.signal)
          if (blocked()) throw state.snapshot.accessFailure
          response = await send()
        }
        const version = safeVersion(response.headers.get(options.versionHeader ?? 'X-TOS-App-Version'))
        if (version) update({ serverVersion: version })
        let text: string
        try { text = await response.text() } catch (error) {
          if (controller.signal.aborted) throw error
          report('network', response)
          throw new TosApiError('response-read', response.status)
        }
        controller.signal.throwIfAborted()
        let data: unknown
        try { data = JSON.parse(text) } catch { /* Gateways may return HTML or empty bodies. */ }
        const payload = object(data)
        const serverMessage = typeof payload.error === 'string' && payload.error.trim() ? payload.error : null
        let error: TosApiError | undefined
        if (response.status === 401 || payload.is_login === false) {
          report(payload.is_login === false ? 'platform-session' : 'http', response, text, data)
          error = new TosApiError('session', response.status, safeCode(payload))
        } else if (response.status === 403 || (payload.is_login === true && payload.code === false)) {
          report(response.status === 403 ? 'http' : 'platform-denied', response, text, data)
          error = new TosApiError(safeCode(payload) === 'ORIGIN_MISMATCH' ? 'origin' : 'denied', response.status, safeCode(payload), serverMessage)
        }
        if (error) {
          update({ accessFailure: state.snapshot.accessFailure ?? error })
          options.onAccessFailure?.(error)
          throw error
        }
        if (!response.ok) {
          report('http', response, text, data)
          throw new TosApiError('http', response.status, safeCode(payload), serverMessage)
        }
        if (method === 'HEAD' || response.status === 204 || response.status === 205) {
          if (!blocked()) update({ diagnostic: null, accessFailure: null })
          return undefined as T
        }
        if (data === undefined || data === null) {
          report('invalid-response', response, text, data)
          throw new TosApiError('invalid-response', response.status)
        }
        if (!blocked()) update({ diagnostic: null, accessFailure: null })
        return data as T
      } catch (error) {
        if (request.signal?.aborted) throw request.signal.reason
        if (error instanceof TosApiError) throw error
        report('network')
        throw new TosApiError(timedOut ? 'timeout' : 'network')
      } finally {
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', cancel)
      }
    },
  }
}
export type ApiClient = ReturnType<typeof createApiClient>
