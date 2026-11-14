# TOS App Kit

TOS 应用公共库，在一个仓库中维护浏览器 core、Vue UI kit 和独立 Go module。以 MIT 许可证发布，应用将浏览器代码打进静态页面、Go 代码编译进后端二进制。

| 包 | 内容 |
| --- | --- |
| [tos-app-core](packages/tos-app-core/README.md) | API、CSRF、诊断、主题与语言偏好、国际化及 Vue 上下文 |
| [tos-app-ui-kit](packages/tos-app-ui-kit/README.md) | 主题变量、文档基础样式、设置与诊断组件 |
| [Go module](go/README.md) | HTTP、认证接入、平台客户端、数据目录和服务生命周期 |

## 安装

浏览器包提供编译后的 ESM 和 `.d.ts`，使用 GitHub Release 中的固定版本附件：

```sh
npm install --save-exact \
  https://github.com/LuYifei2011/tos-app-kit/releases/download/v0.1.0/tos-app-core-0.1.0.tgz \
  https://github.com/LuYifei2011/tos-app-kit/releases/download/v0.1.0/tos-app-ui-kit-0.1.0.tgz
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
go get github.com/LuYifei2011/tos-app-kit/go@v0.1.0
```

应用使用正常版本依赖即可构建，部署到 NAS 时无需 npm、Go 工具链或互联网。

## 开发

需要 Node.js 24 和 `.go-version` 指定的 Go。运行：

```sh
npm ci
npm run build
npm test
npm run dev
```

`npm run build` 构建两个库及 `examples/ui-kit`，`npm run dev` 打开独立示例。修改库后重新运行 `npm run build:packages`，示例会使用新的编译产物。Go 在 `go/` 中独立验证：

```sh
cd go
go test -race -count=1 ./...
go vet ./...
```

库的浏览器主入口不导入 Vue，Vue 适配器通过 `tos-app-core/vue` 提供。UI 组件使用上下文实例共享偏好、请求和诊断状态。主题变量、可选的全局基础样式及组件样式均显式导入。

## 发布

1. 更新根 package.json、两个包和锁文件的版本，更新发布说明。
2. 运行构建、测试及 `npm run pack:release`；附件位于 `build/release/`。
3. 提交并推送，通过 CI 后为同一提交创建并推送签名标签 `v<版本>` 和 `go/v<版本>`。
4. 标签 CI 验证 JS 与 Go，再创建 GitHub Release，包含两个 npm tarball 和 SHA-256 校验和。

根标签对应浏览器包，`go/` 子目录标签对应 Go module。已发布版本应递增版本号，发布附件不覆盖。安装使用 Release 附件，不需要 npm registry 发布账号。
