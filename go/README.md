# tos-app-core Go module

模块路径：`github.com/LuYifei2011/tos-app-kit/go`，包名 `tosapp`。支持 TOS 的 Linux 运行环境，并在 macOS 上运行开发测试；Go 最低版本 1.26。该模块与浏览器包在同一仓库维护，具有独立 go.mod、go.sum、测试和 MIT LICENSE。

安装固定版本：

```sh
go get github.com/LuYifei2011/tos-app-kit/go@v0.3.1
```

模块由仓库的 `go/v0.3.1` 标签发布，应用按 Go 版本依赖下载，无需检出库仓库。Go 代码不包含在 npm 包中。导入时可使用 `tosapp` 别名：

```go
import tosapp "github.com/LuYifei2011/tos-app-kit/go"
```

| 能力 | 接口 |
| --- | --- |
| 单个 JSON 请求、未知字段与体积限制 | `DecodeJSON`，调用方提供字节限制，返回 `ErrInvalidJSON` 或 `ErrTrailingJSON` |
| JSON 响应 | `WriteJSON`，设置 JSON 类型与 no-store |
| 应用代理路径 | `StripAppPrefix`，识别 `/v2/proxy/<id>/` 或 `/<id>/`，按完整路径段匹配 |
| 本地凭据检查 | `ReadCredentials`，要求唯一且非空的会话 Cookie、CSRF Cookie 与匹配的 CSRF 请求头 |
| 来源与预检 | `SameOrigin`、`WritePreflight`，兼容 TOS 网关省略 Host 端口，保留 8181/8443 和 HTTPS 5443 的规则 |
| 平台验证入口 | `Authenticate`，要求应用提供 `SessionVerifier` 回调 |
| 凭据转发与隔离 | `Credentials.Apply` 仅转发会话与 CSRF；`SessionHash` 提供会话隔离键 |
| 平台 HTTP 客户端 | `NewPlatformClient`，禁止环境代理与重定向，提供连接和请求超时 |
| 运行账号与数据目录 | `RequireNonRoot`、`PrepareAppData`、`PrepareDataDirectory`、`CheckDataDirectory` |
| 服务监听 | `SystemdListener` 消费一个继承的 Unix stream socket；`ListenLoopback` 用于本机开发 |
| HTTP 生命周期 | `NewHTTPServer`、`Serve`，context 取消后停止生产者、等待 HTTP 请求，超时则关闭连接 |

认证分两步。`ReadCredentials` 只检查请求携带的凭据；`Authenticate` 还检查来源，并调用应用提供的平台验证回调。回调必须向平台确认会话有效，同时正确处理平台拒绝、登录过期和响应格式错误。缺少回调会返回 `ErrVerifierRequired`；回调错误保持原样返回，应用负责映射到 HTTP 状态和本地化文案。

`batch-rename` 的回调仍调用固定本机文件服务的共享目录接口，目录权限判断保留在应用中。`Credentials.Apply` 的目标必须由应用配置为可信固定平台地址，不能使用请求参数指定目标。凭据只保留在请求或运行任务内存中；常规 fmt 输出和 JSON 序列化不包含其值。`SessionHash` 是会话隔离键，每次登录可能变化。

来源检查允许网关/原生请求缺省 Origin，仍要求 CSRF 和平台验证；跨站来源及多重 Origin 被拒绝。预检不要求登录凭据，也不会授权后续业务请求。应用自行提供允许的方法列表。

生产服务应先通过 `RequireNonRoot` 检查，然后接入 systemd 的 fd 3。`SystemdListener` 校验 `LISTEN_PID` 与单个 `LISTEN_FDS`，只接受 Unix stream listener，拒绝 TCP 和 Unix datagram socket。socket 路径、所有者、0660 权限和 service 单元仍由打包层配置。

`PrepareAppData` 只用于 systemd 的特权启动前步骤，应用 ID 必须是代码常量；它查找应用账号并初始化固定 `/usr/local/<id>/data`。低层 `PrepareDataDirectory` 的安装路径也必须可信：先打开并固定安装目录目标，再相对打开 data，拒绝 data 自身的符号链接。它只设置目录本身为 0700 和指定所有者，保留子项。应用安装路径的受信任符号链接保持可用。

`Serve` 不注册全局信号，应用使用 `signal.NotifyContext` 决定信号。默认 HTTP 读取头部/读取/写入/空闲超时为 5/30/60/30 秒，退出超时默认 30 秒。应用通过 `BeforeShutdown` 标记任务停止，该回调应迅速返回；任务日志、撤销和最终任务收尾由应用实现。退出超时会返回错误，调用方可以记录并决定退出状态。

在本目录独立验证：

```sh
go test -race -count=1 ./...
go vet ./...
```

测试包含真实本机 HTTP/Unix socket、子进程 fd 继承、在途请求排空和超时关闭连接，需要允许创建本机监听 socket。

## 可选 NAS 文件服务

独立子包 [`files`](files/README.md) 提供经过当前 TOS 用户认证的共享目录、目录列表和路径详情接口，可直接配合前端 `files: true` 使用。应用显式导入并注册后才启用，根包不依赖它；可继续只使用原有 Go 工具或自建文件后端。服务不执行文件内容读写，应用仍负责实际操作的授权与冲突处理。该子包从 v0.3.0 开始提供。
