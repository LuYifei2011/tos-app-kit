# tos-app-core

同仓库的 [Go module](https://github.com/LuYifei2011/tos-app-kit/tree/main/go) 负责后端请求、认证接入与服务运行。以下为浏览器包的使用方式。

TOS 浏览器应用的平台集成。每个 `createTosApp` 创建独立 API 状态、偏好和存储命名空间。包提供编译后的 ESM 与类型声明，主入口不导入 Vue，也不会在导入时访问浏览器全局对象。

```ts
import { createTosApp } from 'tos-app-core'

const core = createTosApp({ id: 'my-app', version: '0.1.0' })
const config = await core.api.request('/config')
await core.api.request('/config', { method: 'PUT', body: config })

const controller = new AbortController()
await core.api.request('/status', { signal: controller.signal, timeoutMs: 5000 })
```

默认代理前缀为 `/v2/proxy/<id>/api`。请求携带浏览器 Cookie，并在可读时设置 CSRF 请求头，不手动设置 Cookie 请求头，不跟随重定向。仅 GET 对 502/503/504 最多重试三次；写请求不重试。默认请求超时 30 秒。调用方取消保留 AbortSignal 的 reason，取消不创建诊断。`TosApiError.kind` 区分会话、授权、来源、网络、超时、HTTP 和格式错误。

成功的 HEAD、204 和 205 响应返回 `undefined`；其余成功响应需要有效且非 null 的 JSON。

`api.onAccessFailure` 由应用处理跳转和业务状态；core 自身不跳转。可设 `blockOnAccessFailure: true` 阻止后续请求，`core.api.reset()` 清除本地状态，供应用明确重连使用。前端分类不构成服务端身份或文件权限验证。

通过 `core.api.snapshot` / `subscribe()` 读取版本、诊断和访问失败。默认版本头为 `X-TOS-App-Version`，可配置。诊断不记录响应正文、请求正文、Cookie 或令牌值、查询参数值。默认隐藏全部端点路径，页面路径使用应用 ID；`diagnosticPath` 可把已知静态路由加入报告，调用方必须隐藏动态文件名和 ID。`fetch` 可注入演示或测试实现。

偏好通过 `core.preferences.start()` 启动，返回清理函数。默认 `<id>.preferences` 存储键兼容原有主题/语言设置。支持跟随 TOS、浏览器和手动选择；来源分别标记为 `tos` / `browser` / `manual`。TOS 偏好读取默认 2 秒超时、可见时每 30 秒同步；失败回退浏览器，不影响应用认证与诊断。通过 `setTheme` / `setLanguage` 更新；`subscribe()` 订阅，返回取消订阅函数。可以注入 `readTheme` / `readLanguage`。

Vue 接入：

```ts
import { createApp } from 'vue'
import { createTosAppVue } from 'tos-app-core/vue'

const tos = createTosAppVue(core)
tos.start({ title: locale => locale === 'en-US' ? 'My app' : '我的应用' })
createApp(App).use(tos).mount('#app')
```

`start()` 默认更新文档语言、主题和 color-scheme，可用 `applyDocument: false` 仅同步状态。一个文档应由一个上下文负责文档属性。组件内 `useTosApp()` 获取同一实例及响应式状态；插件在应用卸载时清理。HMR 时调用 `tos.dispose()`。普通 TS 使用者自行更新 DOM。

`createTranslator(getLocale, english?, singular?)` 提供公共中英文文案、参数插值和可选英文单数词典；应用词典可覆盖公共词条。Vue 适配器也接受词典选项。
