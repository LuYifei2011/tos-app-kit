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


## NAS 文件服务

TOS 接口使用当前登录用户的权限，与应用后端服务账号的文件访问权限可能不同，因此前端能选中路径并不保证后端能读取或处理。若所选文件需要交给应用后端处理，通常建议使用按后端实际运行身份检查权限的自定义文件服务/provider，而不是直接使用 TOS 目录接口。

`files` 默认关闭。使用可选的 [Go 文件服务](../../go/files/README.md) 时，在已有应用初始化中启用默认适配器即可：

```ts
import { createTosApp } from 'tos-app-core'

const core = createTosApp({ id: 'my-app', files: true })
```

默认使用同一个 `core.api` 请求 `/files/list` 与 `/files/stat`，完整地址为 `/v2/proxy/my-app/api/files/...`，沿用 CSRF、会话、取消、超时、重试与诊断配置。Vue 上下文中的 `TosFileDialog` 和 `TosPathInput` 自动使用 `core.files`。后端需显式注册服务；`files: true` 只启用浏览器适配器。此功能从 v0.3.0 开始提供。

- `files` 省略或 `false`：没有文件 provider，也不会产生文件请求。
- `files: true`：使用默认路由。
- `files: { base: '/picker' }`：路由相对 `api.base`，对应后端 `PathPrefix: "/api/picker"`（API base 为默认值时）。
- `files: customProvider`：直接使用应用实现的 `TosFileProvider`，不依赖 Go。
- `createFileProvider(core.api, { base: '/files' })`：单独创建适配器，例如用于组件的 `provider` 属性。

非 Go 后端也可实现相同 HTTP 契约：`GET /list` 返回下述目录对象，`GET /stat?path=...` 返回 `{ entry: TosFileEntry | null }`；注意 HTTP 层的 stat 包含 `entry` 外层，provider 解包后返回目录项或 `null`。省略 list 的 `path` 参数代表共享根；非空路径作为查询参数编码。错误使用非 2xx 状态及 `{ code, error }`。适配器校验响应结构、路径、条目唯一性与元数据，错误响应不会转换为“文件不存在”。

- `TosFileEntry`：`{ path, name, kind: 'file' | 'directory', size?: number, modifiedAt?: string }`；`path` 为规范的 NAS 绝对路径，`name` 为单个文件名，同目录路径唯一。可选 `size` 为字节数，`modifiedAt` 建议使用带时区的 ISO 8601 日期字符串；UI 按当前语言显示大小和日期，缺少或不可解析的元数据使用占位符，目录大小也使用占位符。
- `list(null, { signal })`：返回 `{ directory: null, parentPath: null, entries }`，`entries` 为当前用户允许访问的共享文件夹。
- `list(path, { signal })`：返回当前 `directory`（目录项）、`parentPath`（到共享根时为 `null`）和完整 `entries`。分页后端需由适配器聚合，不能把部分列表当完整列表返回。
- `stat(path, { signal })`：返回与请求路径对应的最新目录项；只有确定不存在才返回 `null`。权限、会话、网络错误应抛出，不能伪装成不存在。符号链接和实际类型由后端按应用策略解析。

后端负责会话认证、目录范围、读取/写入权限与符号链接检查。对话框的 `stat` 用于确认前复核，无法消除检查与写入之间的竞争；实际写入必须再次检查权限并原子处理冲突。未获覆盖确认时应使用拒绝覆盖的写入方式；不要让 UI 选择路径成为任意系统路径的授权。

非 Vue 应用也可使用 `createFileDialog(provider, options)`。它提供只读 `snapshot`、`subscribe`、`canConfirm`、`navigate`、`retry`、`select`、`setSelection`、`setFilename`、`setFilter`、`confirm`、`cancelOverwrite` 和 `dispose`。调用方负责首次 `navigate(options.initialPath ?? null)`；`confirm()` 返回结果或 `null`，已有目标通过 `snapshot.overwritePath` 请求 UI 确认后，再调用 `confirm(true)`。名称、目录或类型筛选改变会撤销旧确认；关闭时调用 `dispose()` 终止请求。即使 provider 忽略 AbortSignal，迟到的结果也不会覆盖当前会话。

`setSelection(paths)` 批量替换选择，用于行选择、键盘选择和连续范围选择；路径会去重，并只保留当前目录中符合目标类型与扩展名筛选的项目。单选模式只保留首个有效路径，保存模式还会以该项目名称更新 `filename`。`setSelection([])` 清空选择并保留保存名称；`setFilter(index)` 同样清空选择并保留名称。`cancelOverwrite()` 撤销同名确认而保留名称与选择，界面负责关闭确认层及恢复焦点。
