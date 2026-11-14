# 可选 NAS 文件服务

`github.com/LuYifei2011/tos-app-kit/go/files` 是 Go module 内的独立子包，为文件对话框和路径输入提供目录与元数据查询。根包不导入它；应用显式调用 `Register` 才启用接口，服务不创建监听器、不修改全局 mux、不启动后台任务。从 v0.3.0 开始提供，安装：`go get github.com/LuYifei2011/tos-app-kit/go@v0.3.1`。

TOS 接口使用当前登录用户的权限，与应用后端服务账号的文件访问权限可能不同，因此前端能选中路径并不保证后端能读取或处理。若所选文件需要交给应用后端处理，通常建议使用按后端实际运行身份检查权限的自定义文件服务/provider，而不是直接使用 TOS 目录接口。

## 接入已有 Go 应用

```go
import (
    "net/http"
    nasfiles "github.com/LuYifei2011/tos-app-kit/go/files"
)

func registerFiles(mux *http.ServeMux) (*nasfiles.Handler, error) {
    handler, err := nasfiles.NewHandler(nasfiles.Options{
        AppID: "my-app",
        // 可选：进一步限制可访问目录，不能扩大 TOS 用户权限。
        // AllowedRoots: []string{"/Volume1/documents"},
    })
    if err != nil {
        return nil, err
    }
    handler.Register(mux)
    return handler, nil
}
```

将 mux 交给应用已有的 HTTP server 和 TOS socket 生命周期管理；关闭应用时调用 `handler.Close()` 释放空闲上游连接。应用可根据自己的配置决定是否调用上述函数，不需要该功能时直接省略导入和注册。可编译的示例见 [example_test.go](example_test.go)。

对应前端：

```ts
import { createTosApp } from 'tos-app-core'
import { createTosAppVue } from 'tos-app-core/vue'

const core = createTosApp({ id: 'my-app', files: true })
const tos = createTosAppVue(core)
// 使用现有 Vue 初始化：createApp(App).use(tos).mount('#app')
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { TosPathInput } from 'tos-app-ui-kit'
import 'tos-app-ui-kit/tokens.css'
import 'tos-app-ui-kit/base.css'
import 'tos-app-ui-kit/style.css'
const output = ref('')
</script>

<template>
  <label for="output">输出目录</label>
  <TosPathInput id="output" v-model="output" kind="directory" :editable="false" />
</template>
```

浏览器仍需使用 core 和 UI kit 包，Go module 提供后端接口。前端可选项详见 [core 文档](../../packages/tos-app-core/README.md#nas-文件服务)。已有后端可以实现下述契约或传入自定义 provider，无需使用此子包。

## 配置

| 选项 | 默认及含义 |
| --- | --- |
| `AppID` | 必填，必须与前端和网关应用 ID 一致 |
| `PathPrefix` | `/api/files`；例如 `/api/picker` 对应前端 `files: { base: '/picker' }` |
| `AllowedRoots` | `nil` 使用当前用户共享目录；非 nil 空切片禁用全部目录；否则与 TOS 共享目录取交集，可限制到某个子目录 |
| `PlatformURL` | `http://127.0.0.1:8181`，只接受字面量 loopback IP 的 HTTP(S) origin；由应用配置，不能取自用户请求 |
| `RequestTimeout` | 25 秒，覆盖一次请求的认证、祖先目录复核及全部分页 |
| `MaxEntries` | 100,000；可设为 1–100,000，超限返回错误，不返回不完整列表 |

只通过 TOS 本机 API 获取数据，继承当前请求的 `TMSESSNAME`、CSRF，以及存在时的 `userName` Cookie。每次请求验证来源、会话、可访问共享目录和目标路径，不缓存用户凭据或跨用户共享目录结果；忽略系统目录和平台标记的链接，逐级检查祖先目录。禁止上游重定向和环境代理，单次上游响应最大 8 MiB。

允许规范的 `/VolumeN/<share>/...` 绝对路径，以及 TOS 返回的 `/VolumeN/homes/<user>`；不提供卷根、聚合 homes 根、`@` 系统目录或 `#recycle`。路径必须来自当前用户共享目录，并满足应用限制。共享根的 `parentPath` 为 `null`，用户不能通过上一级按钮越过允许范围。

## HTTP 契约

注册路径同时支持应用后端直连、`/<AppID>` 和 `/v2/proxy/<AppID>` 网关前缀。仅支持 GET 和同源 OPTIONS；GET 要求有效的 TOS 会话和匹配 CSRF。

| 请求 | 成功响应 |
| --- | --- |
| `GET /api/files/list` | `{ "directory": null, "parentPath": null, "entries": [...] }`，可访问共享根 |
| `GET /api/files/list?path=...` | `{ "directory": {...}, "parentPath": "..." 或 null, "entries": [...] }`，聚合全部分页，文件夹优先 |
| `GET /api/files/stat?path=...` | `{ "entry": {...} }`；仅明确缺失的叶子目标返回 `{ "entry": null }` |

条目为 `{ path, name, kind: "file" | "directory", size?, modifiedAt? }`。`size` 为字节数，`modifiedAt` 为 UTC RFC3339，平台缺省字段时省略。目录为空时 `entries` 是空数组。

错误返回 `{ "code": "FILE_...", "error": "..." }`，不透传上游正文或凭据：400 路径/查询不合法，401 会话无效，403 来源不符，404 目录不存在，409 文件权限不足或分页期间目录变化，413 条目超限，502 无效上游响应，503 上游不可用，504 超时。文件权限错误采用 409，避免触发 core 的应用级 403 访问阻断；用户可返回共享根选择其他目录。

保存模式只选择路径。权限拒绝、父目录缺失、网络失败或格式错误均不会被当成新文件；服务只在 TOS 明确报告叶子不存在（错误码 104）时返回 `entry: null`。选择结果不代表写入权限：应用执行实际读取、创建或覆盖时，应再次依据当前用户检查路径和权限，并原子处理同名冲突。`overwrite: true` 表示用户确认，不是服务端授权。

平台协议依据 TOS 7 官方 [文件 API](https://help.terra-master.com/cn/developer/api/details) 与 [通用响应和错误码](https://help.terra-master.com/cn/developer/api/general)。使用 `homeList`、`list`、`folderInfoAll`；测试使用模拟平台，目前仍需在目标 NAS 固件上验证真实响应和权限行为。
