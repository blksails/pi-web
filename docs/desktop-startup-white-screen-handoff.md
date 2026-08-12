# 桌面端启动白屏原因与交接

> 日期：2026-08-12
>
> 范围：Tauri 打包版在新 Windows PC 首次启动超时、重开白屏，以及 macOS 直接白屏。

## 结论

当前证据指向一个复合故障：

1. **本地后端未在 60 秒内完成 HTTP 就绪**，所以 Windows 首次启动进入错误页。
2. **启动错误原先只通过一次事件发送**。快速失败时，错误事件可能早于 loading 页 listener 到达；重开或 macOS 便只剩白屏/空白态。
3. 代码另有一个真实的环境键错配：`server/index.ts` 读取 `HOST`，旧桌面壳只覆盖 `HOSTNAME`。若客户外层环境存在 `HOST`，后端可能绑定到非回环地址，桌面壳却仍探测 `127.0.0.1`，必然等到超时。

故，**最可能不是“聊天页面缺少 provider 环境变量”**。provider 配置缺失更可能影响后端已启动后的登录、模型或 API 请求；随包 loading 页本身与后端启动链不依赖客户预先配置这些变量。

## 打包与加载链

打包态并非直接 `loadUrl` 远程站点，链路如下：

```text
Tauri 本地 index.html
  → 解包随包 payload/ 内的 dist 与 node runtime
  → 用随包 node 拉起本地 server.mjs
  → GET http://127.0.0.1:<port>/ 返回 HTTP
  → WebView 导航到该回环地址，加载业务 SPA
```

静态依据：

- `desktop/src-tauri/tauri.conf.json` 的 `frontendDist` 为 `frontend`；`externalBin` 为随包 `binaries/node`；`resources` 为随包 `payload/`。
- `main.rs` 先打开 `WebviewUrl::App("index.html")`，只有 `ServerSupervisor::start` 成功后才导航到 `http://127.0.0.1:<port>`。
- `server/index.ts` 最终监听 `process.env.PORT` 与 `process.env.HOST`，默认 host 为 `127.0.0.1`。
- `ready_probe.rs` 对 `GET /` 等待 `READY_TIMEOUT_MS = 60_000`；任何 HTTP 响应才算就绪。

因此，截图中能看到“正在启动 pi-web”已证明随包本地壳页至少完成渲染；此阶段尚未证明业务 SPA 已加载，也不能据此判定 provider 环境变量缺失。

## 原因排序

| 假设 | 判断 | 依据与判别方式 |
| --- | --- | --- |
| 后端子进程未监听、导入卡住或未返回 HTTP | **高** | 与 Windows “约 60 秒后错误页”直接对应 `ReadyTimeout`；需看保留的启动错误及子进程 stderr。 |
| `HOST` 与探测地址不一致 | **中高（条件成立时高）** | 服务读 `HOST`，旧壳只写 `HOSTNAME`；若外层 `HOST` 已设，服务可绑定到别处。现已同时强制注入 `HOST` 与 `HOSTNAME`。 |
| 随包 Node 被杀软/系统策略拦截，或 macOS 运行时签名/执行异常 | **中** | 可表现为 Node 早退或就绪超时；须结合 `EarlyExit`、stderr、系统安全日志确认。 |
| 磁盘空间不足、内存/CPU 紧张 | **可能，非首嫌** | 解包阶段应出现 `disk-full`；运行时展开约需 89 MB，另需 staging 与系统余量。资源极紧时也可能拖慢导入，但目前无资源监控证据。 |
| 未以管理员安装 / 安装目录权限不足 | **单独导致的概率低** | 设计上资源只读即可，运行时写入用户目录 `~/.pi/web/runtime`；不要求管理员安装。若企业策略拦截 Program Files 子进程、写用户目录或执行随包 Node，仍可能间接造成早退/超时。 |
| 客户未配置 provider 环境变量 | **对本症状概率低** | 主要影响业务 API；若配置导入阶段确实抛异常，应显示 `本地服务器启动失败` 与 stderr，而非静默白屏。 |
| macOS 原生 child WebView 渲染问题 | **保留项** | 若修复后仍无 loading/error 页，设 `PI_WEB_NATIVE_CHILD_WEBVIEWS=0` 复测；结果可将“后端故障”与“原生 WebView 宿主渲染”分开。 |

## 已实施修复

- `unpack_runtime.rs`：解包由无限等待改为 60 秒有界等待，新增 `extract-timeout`。
- `main.rs`：保存最近一次启动错误，新增 `startup_status` 命令；重试前清除旧错误。
- `frontend/app.js`：先建立事件 listener，再补读 `startup_status`，避免快速失败丢错。
- `server_supervisor.rs`：强制注入 `HOST=127.0.0.1`，同时保留 `HOSTNAME` 兼容旧 runner；补回归测试。
- `permissions/lifecycle.toml`、`capabilities/default.json`：放行 `startup_status`。

这些改动首先保证“失败可见、可重试、可判因”；尚不能替代 Windows NSIS 与 macOS 产物在客户机器上的真机 smoke。

## 客户机验证顺序

1. 使用修复后安装包，以普通用户启动；不必先切管理员模式。
2. 关闭进程后清理对应用户目录下的旧运行时：Windows 为 `%USERPROFILE%\\.pi\\web\\runtime`，macOS 为 `~/.pi/web/runtime`，再做一次冷启动。
3. 若出现错误页，记录完整标题、详情及错误码：
   - `runtime-root-unwritable`：用户运行时目录不可写；
   - `disk-full`：磁盘余量不足；
   - `本地服务器启动失败`：优先看 stderr、Node 执行/签名/杀软拦截；
   - `启动超时`：优先查 `HOST`、端口、Node 导入卡顿及资源占用。
4. 若仍白屏：先确认是否连 loading 页都没有；Windows 检查 WebView2 安装/企业策略，macOS 临时设 `PI_WEB_NATIVE_CHILD_WEBVIEWS=0` 做宿主渲染隔离测试。
5. 仅当后端已能返回业务页面后，再检查 provider、登录凭据与远程 API；不要把该类配置作为首轮白屏根因。

## 交接判定

当前最合理的表述是：**Windows 的 60 秒错误页已把范围缩到“本地后端就绪失败”；重开与 macOS 白屏主要由启动错误展示竞态放大。资源与权限是需要排除的次级因素，管理员安装不是默认要求。** 修复包若仍报错，错误页现在应保留首个可判别信号，后续应以该信号而非白屏外观继续定位。
