# TOS App Kit

TOS 应用公共库，在一个仓库中维护浏览器 core、Vue UI kit 和独立 Go module。以 MIT 许可证发布，应用将浏览器代码打进静态页面、Go 代码编译进后端二进制。

| 包 | 内容 |
| --- | --- |
| [tos-app-core](packages/tos-app-core/README.md) | API、CSRF、诊断、主题与语言偏好、国际化、文件服务及 Vue 上下文 |
| [tos-app-ui-kit](packages/tos-app-ui-kit/README.md) | 主题变量、文档基础样式、两区应用框架、设置、诊断及 NAS 文件对话框 |
| [Go module](go/README.md) | HTTP、认证接入、平台客户端、数据目录、服务生命周期和可选 NAS 文件服务 |

## 安装

浏览器包提供编译后的 ESM 和 `.d.ts`，使用 GitHub Release 中的固定版本附件：

```sh
npm install --save-exact \
  https://github.com/LuYifei2011/tos-app-kit/releases/download/v0.3.1/tos-app-core-0.3.1.tgz \
  https://github.com/LuYifei2011/tos-app-kit/releases/download/v0.3.1/tos-app-ui-kit-0.3.1.tgz
```

应用需要 Vue 3.5。UI kit 将 core 和 Vue 声明为 peer dependency，以复用应用中同一份上下文。提交生成的 `package-lock.json`，后续使用 `npm ci` 安装锁定内容。

```ts
import { createTosApp } from 'tos-app-core'
import { createTosAppVue } from 'tos-app-core/vue'
import 'tos-app-ui-kit/tokens.css'
import 'tos-app-ui-kit/base.css'
import 'tos-app-ui-kit/style.css'

const core = createTosApp({ id: 'my-app', version: '0.1.0' })
const tos = createTosAppVue(core)
tos.start()
// Vue 应用创建后执行 app.use(tos)，组件中通过 useTosApp() 获取该实例。
```

Go module 独立安装：

```sh
go get github.com/LuYifei2011/tos-app-kit/go@v0.3.1
```

应用使用正常版本依赖即可构建，部署到 NAS 时无需 npm、Go 工具链或互联网。

## NAS 文件选择

TOS 接口使用当前登录用户的权限，与应用后端服务账号的文件访问权限可能不同，因此前端能选中路径并不保证后端能读取或处理。若所选文件需要交给应用后端处理，通常建议使用按后端实际运行身份检查权限的自定义文件服务/provider，而不是直接使用 TOS 目录接口。

前端在 `createTosApp({ id: 'my-app', files: true })` 中启用默认适配器，即可让 `TosFileDialog` 与 `TosPathInput` 浏览 NAS 目录。Go 后端按 [接入说明](go/files/README.md)导入独立子包 `github.com/LuYifei2011/tos-app-kit/go/files`，创建 handler 并显式注册到应用 mux。

Go 文件服务是可选能力：不导入、不注册就不会启用；已有后端或非 Go 应用可实现 HTTP 契约或传入自定义 `TosFileProvider`。组件与服务负责路径选择和元数据查询，实际文件读写由应用执行。这些能力从 v0.3.0 开始提供。

## 开发

需要 Node.js 24 和 `.go-version` 指定的 Go。运行：

```sh
npm ci
npm run build
npm test
npm run dev
```

`npm run build` 构建两个库及 `examples/ui-kit`，`npm run dev` 打开独立示例。修改库后重新运行 `npm run build:packages`，示例会使用新的编译产物。

| 命令 | 覆盖范围 |
| --- | --- |
| `npm test` | 浏览器 core 和 Go module 的全部单元测试 |
| `npm run test:core` | API、偏好设置、应用隔离和 Vue 上下文接入 |
| `npm run test:go` | Go module 测试，包含竞态检测 |

浏览器 core 的测试按逻辑归属维护：

| 测试文件 | 负责行为 |
| --- | --- |
| `packages/tos-app-core/tests/api.test.ts` | 请求方法、重试、取消、超时、会话响应、CSRF、凭据脱敏及并发诊断 |
| `packages/tos-app-core/tests/preferences.test.ts` | TOS 响应解析、Cookie、偏好读取与存储、浏览器回退和生命周期；超时用例使用模拟时钟 |
| `packages/tos-app-core/tests/file-provider.test.ts` | 默认文件服务适配器、可选配置、HTTP 契约、取消和错误隔离 |
| `go/files/handler_test.go` | NAS 权限、会话隔离、目录边界、分页、缺失目标、超时和凭据转发 |
| `packages/tos-app-core/tests/files.test.ts` | NAS 文件选择、保存目标校验、覆盖确认、错误恢复及请求竞态 |
| `packages/tos-app-core/tests/app.test.ts` | 应用间状态隔离、翻译上下文和 Vue 依赖注入 |

应用仓库测试自身的配置和接入：专用路由、登录处理、错误映射、诊断路径规则、偏好存储命名空间及业务翻译。应用继续使用固定版本的发布包运行这些集成检查。

CI 的 web 和 go 任务分别运行对应测试集。Go 静态检查可在本地执行：

```sh
cd go
go vet ./...
```

库的浏览器主入口不导入 Vue，Vue 适配器通过 `tos-app-core/vue` 提供。UI 组件使用上下文实例共享偏好、请求和诊断状态。主题变量、可选的全局基础样式及组件样式均显式导入。

界面由人工审核。运行 `npm run dev` 打开独立示例，按[界面规范](docs/DESIGN.md)检查标题栏和窗口控件留白、长标题、桌面与窄屏布局、主题语言切换、设置与诊断组件、键盘焦点及滚动。发布前在使用该库的应用中复核组件接入效果。

## 发布

1. 更新根 package.json、两个包和锁文件的版本，更新发布说明。
2. 运行构建、测试及 `npm run pack:release`；附件位于 `build/release/`。
3. 提交并推送，通过 CI 后为同一提交创建并推送签名标签 `v<版本>` 和 `go/v<版本>`。
4. 标签 CI 验证 JS 与 Go，再创建 GitHub Release，包含两个 npm tarball 和 SHA-256 校验和。

根标签对应浏览器包，`go/` 子目录标签对应 Go module。已发布版本应递增版本号，发布附件不覆盖。安装使用 Release 附件，不需要 npm registry 发布账号。
