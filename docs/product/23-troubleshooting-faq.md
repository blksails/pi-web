# 23 · 故障排查 / FAQ

本章收录 pi-web 开发、构建、分发与运维过程中已知的高频问题，按「症状 → 原因 → 对策」三段式展开。急用时可直接跳到末尾的 [8. 诊断速查](#8-诊断速查) 按关键词定位。

> 架构前提：前端是 **Vite 驱动的 SPA**（根 `index.html` 静态入口 + `src/main.tsx`，产物 `dist/client`），服务端宿主是 **Hono**（`server/index.ts` 一条 `app.all('/api/*')` 转发到 `createPiWebHandler` 单例），服务端由 **esbuild 打成单文件** `dist/server.mjs`。Next.js 已从代码库删除——若你在其它文档里看到 `next dev` / `next build` / `.next` / `NEXT_DIST_DIR` / webpack 500，那些均为历史残留，本章按当前架构给出真实故障模型。

---

## 1. 开发服务器问题

### 1.1 `pnpm dev` 后浏览器打开 3000 是一片裸 API / 看不到聊天 UI

**症状**：执行 `pnpm dev`，照旧习惯打开 `http://localhost:3000`，看到的是 JSON 或 404，而不是聊天界面。

**原因**：`pnpm dev` = `node scripts/dev-all.mjs`（`package.json:17`），它**并发拉起两个进程**：Hono API server 监听 `:3000`，Vite dev server 监听 `:5173`（`scripts/dev-all.mjs:2`）。开发期的 SPA 前端由 **Vite（5173）** 提供，`3000` 只是被代理的 API 宿主，本身不吐 HTML。

**对策**：
1. 开发期浏览器**打开 `http://localhost:5173`**。Vite 会把 `/api` 请求反向代理到 `127.0.0.1:3000`（`vite.config.ts:76-78`），前后端在同源下协作。
2. 端口可覆盖：`PI_WEB_DEV_CLIENT_PORT`（前端，默认 5173）、`PI_WEB_DEV_API_PORT`（API，默认 3000），见 `vite.config.ts:73,78`。
3. 只想跑单侧时：`pnpm dev:client`（仅 Vite）或 `pnpm dev:server`（仅 API）。
4. 离线冒烟同理，浏览器仍开 5173：
   ```bash
   PI_WEB_STUB_AGENT=1 pnpm dev   # 桩 agent，无需真实模型
   # 打开 http://localhost:5173
   ```

> 生产模式没有这个落差：`node dist/server.mjs` 是单进程，前端静态资源与 `/api` 同端口由 Hono 一并提供。

---

### 1.2 改了注入路由或配置域，热重载后不生效

**症状**：修改了 `lib/app/pi-handler.ts` 装配的注入路由、或某个配置域相关代码，保存后进程没报错，但新行为不出现（404 或行为不变）。

**原因**：`createPiWebHandler` 实例**首次装配后被 pin 在 `globalThis`**（`lib/app/pi-handler.ts:232` 的 `GLOBAL_KEY = Symbol.for("pi-web.app.handler")`，读写在 `:540-543`）。API server 进程内该单例只构造一次，改动模块不会重建它。

**对策**：
1. 手动重启 API 进程：`Ctrl-C` 结束 `pnpm dev`，再 `pnpm dev`（dev-all 会同时收尾并重拉两个进程）。
2. 若只想重启后端，`pnpm dev:server` 单独重跑即可，前端 Vite 无需动。
3. 重启后若改动涉及 session 装配，建议**新建会话**测试，不要复用旧 session URL。

---

### 1.3 会话内报 `node:fs` / pi SDK 相关解析错误

**症状**：某条路由或工具调用失败，堆栈里出现 `node:fs` / `node:os` / 动态 `require` 无法解析，或前端 bundle 里意外打进了 `@earendil-works/pi-coding-agent`。

**原因**：pi SDK 两包（`@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`）含 `node:*` 内建与动态 `require`，只能在 Node 运行时里跑，不能被打进前端 bundle。当前架构由两道机制隔离它：
- 前端 Vite **不打包** pi SDK——它只在 Hono/Node 侧的 API server 里运行，dev 期天然分离在 `:3000` 进程。
- 生产服务端由 `scripts/build-server.mjs` 用 esbuild 打单文件，`external` 清单显式外置 **pi SDK 两包 + `jiti` + `pg`**（`scripts/build-server.mjs`），不内联进 `dist/server.mjs`。

**对策**：
1. 任何在主进程（handler / server）中用到 pi SDK 的代码，必须走 **`@blksails/pi-web-tool-kit/runtime`** 或明确的子路径导入，不要经会牵连前端的 barrel 引入。
2. 若你新增了服务端依赖且它含 `node:*` 或原生模块，把它加进 `scripts/build-server.mjs` 的 esbuild `external`，否则单文件构建会尝试内联并失败。
3. 确认没有从前端 `src/` 里 `import` 任何 `@blksails/pi-web-server` 或 pi SDK 值导出（类型导入除外）。

---

### 1.4 发消息后需手动刷新才看到回复（回复不实时）

**症状**：发一条消息后助手气泡不出现、流式文字不滚动；手动刷新页面后那轮回复却完整出现。现象**间歇性**，多在 dev 首次访问、或机器高负载时复现。

**原因**：pi-web 的回复流是**每轮（per-turn）一条 `/stream` SSE 订阅**，不是会话级持久连接。客户端先 `openChunkStream()` 打开 `GET /sessions/:id/stream`，再 `POST /sessions/:id/messages` 提交本轮 prompt，回复帧经这条流回来。竞态在于：若 `/stream` 尚未在服务端建立订阅，agent 就已广播首帧，而服务端对回复帧 `uiMessageChunk` **无缓冲、无回放**（迟到订阅者只能拿到日志 ring-buffer 与 `session-status`/`session-state` 两类粘性帧），这一窗口内的帧会永久丢失。刷新能恢复，是因为刷新走历史接口 `GET /sessions/:id/messages`（从落库消息重建）。

**触发条件**：dev 冷编译或高负载放大该竞态——首次访问某路由的即时编译使 `/stream` 建连变慢，落在 agent 首帧之后。生产热态下 `/stream` 通常抢在首帧前连上，很少复现。

**对策**：
1. **已从框架侧修复**：`sendMessages` 现在在 `POST /messages` 之前 `await connection.whenSubscribed()`——收到 `GET /stream` 响应即证明订阅已在服务端建立（SSE 响应的 `ReadableStream.start()` 在 handler `return` 前同步执行 `subscribe()`），从根上消除竞态。以下为兜底。
2. **预热 `/stream`**：dev 下先访问一次会话页把路由编译好，或 `curl -N http://localhost:3000/api/sessions/<id>/stream` 提前触发编译（注意打的是 API 宿主 3000），再发消息。
3. **临时恢复**：已丢帧的那轮，刷新页面即可从历史接口补回。

---

### 1.5 会话一直卡在「正在连接 agent…」

**症状**：新建或打开会话后，输入框禁用、界面停在「正在连接 agent…」不进入就绪态，怎么等都不动。

**原因**：会话就绪握手（spec `session-readiness-handshake`）以只读探针 `channel.getCommands()` 的首条响应为就绪锚点，服务端广播粘性 `control:session-status` 帧（`SessionLifecycleState`：initializing/ready/error/ended），前端据此门控输入（`packages/ui/src/chat/pi-chat.tsx:704-707`，文案见 `packages/ui/src/i18n/messages.ts:71`）。若 **dev 期前后端代码新旧不一致**（例如只重启了 Vite 没重启 API，或反之），握手协议对不上，就绪帧收不到，会话死锁在连接态。

**对策**：
1. **完整重启 dev**：`Ctrl-C` 结束 `pnpm dev` 再重跑，让 API（3000）与 Vite（5173）两侧一起用同一版本代码起来。
2. 若只改了后端，`pnpm dev:server` 重启后端即可；只改前端则 Vite HMR 通常自动生效，无需动后端。
3. 复现后可用 `curl -N http://localhost:3000/api/sessions/<id>/stream` 观察是否收到 `control: session-status` 帧，判断卡点在服务端握手还是前端渲染。

---

## 2. 构建与生产上线问题

### 2.1 生产环境白屏 / 代码 webext 静默不加载（CSP 拦截）

**症状**：`node dist/server.mjs` 生产模式下页面白屏，或聊天能用但代码 webext（同源动态 import 加载的扩展）不挂载；浏览器控制台报 Content-Security-Policy 违规，涉及 `eval` 或内联 `<script>`。

**原因**：生产 CSP 由 `productionCsp()` 生成，仅在 `NODE_ENV=production` 时经 Hono 中间件注入（`server/index.ts:51`），相较开发态收紧两处（`server/static.ts:171-184`）：
- **禁 `unsafe-eval`**——`eval` / `new Function` 被拦。运行时构造代码的写法（如某些扩展的动态编译）在生产不可用。
- **去掉 `script-src 'unsafe-inline'`**——改为对**内联单例 import map** 做 sha256 hash 精确放行（`server/static.ts:124-146`）。若产物里 import map 的文本与计算的 hash 不匹配（例如被中间件改写、被代理注入了额外内联脚本），浏览器会拒绝执行 import map，导致所有代码 webext 加载失败。

**对策**：
1. 代码 webext 应经**同源原生动态 import** 加载（不需要 `eval`）；不要在扩展里用 `new Function` / `eval` 构造逻辑，否则生产 CSP 必拦。
2. 不要在服务端与浏览器之间插入会改写 HTML 或注入内联脚本的代理/中间件——任何对内联 import map 文本的改动都会使其 sha256 失配。
3. 若构建产物**缺少内联 script**，`productionCsp()` 会**吵闹告警**而非静默降级（`server/static.ts:154-159`）：留意服务端启动日志里「生产 CSP 将禁止 import map」这类警告，它意味着放行 hash 没生成、页面将无法加载代码。
4. 排查时先在 dev（无生产 CSP）确认功能正常，再切生产复现，即可定位是否 CSP 造成。详见 [19-deployment.md](19-deployment.md) 的生产 CSP 小节。

---

### 2.2 CLI 启动报「未找到自包含产物」

**症状**：本地 `git clone` 后直接 `node bin/pi-web.mjs` 或 `pi-web`，报：

```
[pi-web] 未找到自包含产物 <...>/dist/server.mjs
  请先构建: `pnpm build:dist`(或 `npm run build:dist`)。
```

**原因**：CLI 用三级 `resolveRuntime()` 定位后端入口（`bin/pi-web.mjs:263`）：① `PI_WEB_DIST_DIR` 覆盖（隔离/e2e，不解包）→ ② 仓库内 `dist/server.mjs`（开发态，不解包）→ ③ 随包压缩载荷首启解包。源码克隆态走②，但 `dist/` 尚未构建，故报错（`bin/pi-web.mjs:303-304`）。

**对策**：
```bash
pnpm build:dist   # = build:client(vite) + build:server(esbuild) + pack-dist + build:unpacker + build:payload
node bin/pi-web.mjs <source>
```
构建完成后 `dist/server.mjs`（必须在产物根）就位，CLI 即可拉起。若要用隔离目录，设 `PI_WEB_DIST_DIR=<其它目录>` 覆盖（该目录里也需有 `server.mjs`）。CLI 详解见 [18-cli.md](18-cli.md)。

---

### 2.3 npm 安装态首启共享运行时解包失败

**症状**：`npm i -g @blksails/pi-web` 后首次运行报类似 `[pi-web] 无法准备运行时(<code>): ...`，随后一行给出中文处置提示。

**原因**：npm 安装态走 `resolveRuntime()` 的第③级——把随包压缩载荷（`payload/dist.tar.zst`）首启解包到共享运行时目录 `~/.pi/web/runtime/<version>-<digest>/`（可经 `PI_WEB_RUNTIME_ROOT` 覆盖），带并发锁/心跳，`scheduleRuntimeGc` 保留最近 N 个旧运行时（`bin/pi-web.mjs:284,451`）。解包失败时会抛出**判别式错误码**，`RUNTIME_ERROR_HINTS`（`bin/pi-web.mjs:392-401`）翻成用户可读文案。

**错误码 → 含义 → 处置**：

| code | 含义 | 处置 |
|---|---|---|
| `runtime-root-unwritable` | 运行时目录不可写 | 检查路径权限，或设 `PI_WEB_RUNTIME_ROOT` 指向可写目录 |
| `disk-full` | 磁盘空间不足 | 清理磁盘后重试 |
| `payload-missing` | 随包载荷缺失 | 重新安装 `@blksails/pi-web` |
| `payload-corrupt` | 随包载荷已损坏 | 重新安装 `@blksails/pi-web` |
| `zstd-unsupported` | Node 版本过低不支持 zstd 解压 | 升级到 **Node >= 22.15.0** |
| `lock-timeout` | 等待其它进程解包超时 | 确认无其它实例卡住，清 `~/.pi/web/runtime` 下的锁后重试 |
| `extract-failed` | 解包器无有效输出（兜底） | 重新安装；仍失败请附完整错误上报 |

**自救速查**：
```bash
# 1) 确认 Node 版本(zstd 需 >= 22.15.0)
node -v
# 2) 换一个可写的运行时根重试
PI_WEB_RUNTIME_ROOT="$HOME/.pi-web-runtime" pi-web <source>
# 3) 清掉可能陈旧的解包目录后重试
rm -rf ~/.pi/web/runtime && pi-web <source>
```

---

## 3. 桌面版（Tauri）首启解包问题

### 3.1 桌面 App 首次启动报解包错误

**症状**：安装 dmg/nsis/appimage 后首次启动，App 弹出解包失败提示；后台日志含判别式错误码。

**原因**：桌面壳（Tauri v2）打包态从随包资源解包共享运行时——Rust 侧 `unpack_runtime.rs` spawn 随包 Node 执行 `unpack.mjs`，消费单行 JSON 的判别式 `code`，并翻成用户文案（`desktop/src-tauri/src/unpack_runtime.rs:147-154`）。其错误码集合与 CLI 同源。

**错误码 → 含义 → 处置**：

| code | 含义 | 处置 |
|---|---|---|
| `runtime-root-unwritable` | 运行时目录不可写 | 检查 `~/.pi/web/runtime` 权限，或设 `PI_WEB_RUNTIME_ROOT` |
| `disk-full` | 磁盘空间不足 | 清理磁盘后重启 App |
| `payload-missing` / `payload-corrupt` | 随包运行时载荷缺失或损坏 | 重新安装应用 |
| `zstd-unsupported` | 随包 Node 不支持 zstd 解压 | 应用可能已损坏，重新安装 |
| `lock-timeout` | 等待其它进程解包超时 | 确认没有另一个实例卡住，然后重试 |
| `extract-failed` | 解包器输出无效/缺字段（兜底） | 重新安装应用 |

**对策**：多数码指向「重新安装」或「换可写运行时根」。桌面壳会向后端子进程注入 `PI_WEB_NODE_BIN`（随包 node 绝对路径），并刻意**不注入** `PI_WEB_AGENT_DIR`（使会话默认落 `~/.pi/agent`，与 CLI 共享）。桌面版打包/分发与运行模式详见 [20-desktop-tauri.md](20-desktop-tauri.md)。

> 注：`desktop/` 及其载荷线对应的两个 spec（electron-to-tauri、shared-runtime-payload）状态为 **implemented-partial**，跨平台尚未全验；遇到平台特异问题时以本表错误码为排查起点。

---

## 4. Provider / 模型问题

### 4.1 自定义 provider 鉴权 401

**症状**：在 `~/.pi/agent/models.json` 配了自定义 provider，调用返回 HTTP 401，或日志显示「渠道不存在」「This token has no access to model（model 名为空）」。

**可能原因**：
- **A — 配置文件写错位置**：自定义 provider 必须写在 `~/.pi/agent/models.json`，**不能**写在 `auth.json`（后者由 pi CLI 登录流程管理，手写会被覆盖且不被 `ModelRegistry` 识别）。
- **B — 必填字段缺失**：`baseUrl` 与 `apiKey` 任一缺失都无法构造请求。
- **C — DashScope / MAAS key 与端点不匹配**：DashScope 的 MAAS token（通义千问主账号 API key）**不能**用于图像生成端点，两者是独立 key 体系，互打对方端点均 401。

**对策**：

**步骤 1** — 确认 `models.json` 位置与格式：
```bash
cat ~/.pi/agent/models.json
jq . ~/.pi/agent/models.json   # 校验是合法 JSON
```
最小合法结构：
```json
{
  "providers": {
    "my-gateway": {
      "name": "My Gateway",
      "baseUrl": "https://example.com/v1",
      "apiKey": "sk-...",
      "api": "openai-completions",
      "models": [
        {
          "id": "some-model",
          "name": "Some Model",
          "input": ["text"],
          "contextWindow": 131072,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

**步骤 2** — 校验模型出现在列表中（需全局 `pi` CLI 在 PATH 上；`--list-models` 与 pi-web 进程内模型枚举同源，见 `packages/server/src/config/model-options.ts:7`）：
```bash
pi --list-models             # 列全部可用模型
pi --list-models my-gateway  # 模糊搜索,只看该 provider
```
预期结果：输出中出现 `my-gateway` 下的 `some-model`。若看不到，回步骤 1 核对 JSON。

**步骤 3**（DashScope 场景）：文本对话与图像生成分两个 provider 条目，各配对应 key 与端点。

> 边界提醒：`models.json` / `ModelRegistry` **只管文本对话模型**。AIGC 图像工具（`image_generation` / `image_edit`）与视觉工具（`image_vision`）的模型不走 `ModelRegistry`，而是各自模块级路由表——详见 [11-aigc-and-vision-tools.md](11-aigc-and-vision-tools.md)。

---

### 4.2 iPhone 多图 JPEG 上传致网关报「空 model 名」或「渠道不存在」

**症状**：iPhone 拍摄的多张照片（HEIC 转 JPEG 或直接 JPEG）上传后，图像编辑请求返回「可用渠道不存在」或「This token has no access to model」，且 model 名为空字符串；同一图用普通截图则正常。

**原因**：iPhone 多图 JPEG 含 MPF（Multi-Picture Format，`APP2` 段）索引，以及主图 `EOI` 之后追加的第二张 JPEG（HDR gain map）。NewAPI 类网关解析这类文件时上游渠道匹配失败，返回误导性错误。

**已修状态**：`packages/tool-kit/src/engine/normalize-image.ts` 的 `normalizeImageDataUri()` 已实现**纯 JS、零依赖**的 MPF 剥离与尾部截断（剥除 `MPF` 类 `APP2` 段并在主图首个 `EOI` 处截断；保留 `ICC_PROFILE`、EXIF 方向与其它元数据，无损不重编码），由图像工具在上传网关前自动调用——调用点在 `packages/tool-kit/src/aigc/run-image-tool.ts:204`（经 `run-image-tool.ts:29` 从 `../engine/normalize-image.js` 引入）。用户无需手动干预。

**若仍遇到**（例如自定义工具未经过 `normalizeImageDataUri`），手动预处理：
```bash
# 用 ImageMagick 只取多图 JPEG 的第一帧(主图),丢弃 MPF 索引与尾部 gain map
convert 'input.jpg[0]' output.jpg
```

---

## 5. Web Extension / UI 问题

### 5.1 webext artifact 区域空白、没有 iframe

**症状**：配置了 `.pi/web/web.config.tsx` 并期望在 artifact 区域渲染内容，但右侧完全空白，DOM 里找不到 `<iframe>`。

**原因**：`ArtifactSurface` 仅在拿到扩展 base URL 时才挂载 iframe（无 base URL 不挂载是**正确的安全门控**，而非 bug）。该值来自环境变量 `NEXT_PUBLIC_PI_EXTENSION_BASE_URL`。**注意语义已变**：它不再是构建期内联，而是由 `GET /api/bootstrap` 在服务端**运行时**读 env 后下发前端（`server/bootstrap.ts:105`、`lib/app/runtime-features.ts:67`）。

**对策**：
```bash
# dev 模式(webext 与主 app 同源时用 API 地址)
NEXT_PUBLIC_PI_EXTENSION_BASE_URL=http://localhost:3000 pnpm dev
# 浏览器仍打开 http://localhost:5173

# 或写进 .env.local 持久化
echo 'NEXT_PUBLIC_PI_EXTENSION_BASE_URL=http://localhost:3000' >> .env.local
```
因为该值现在运行时下发，**改 env 后重启服务端即生效，无需重新构建**（前端不再内联该变量）。artifact / Tier4 表面详见 [12-web-ui-extension.md](12-web-ui-extension.md)。

---

### 5.2 Canvas 工作台面板不显示

**症状**：期望看到 Canvas 二创画布/画廊，但侧栏或面板里根本没有入口。

**原因**：Canvas 面板由环境变量 `NEXT_PUBLIC_PI_WEB_CANVAS` **门控，默认关闭**（`bool(env.NEXT_PUBLIC_PI_WEB_CANVAS)`，见 `server/bootstrap.ts:93`、`lib/app/runtime-features.ts:55`）。未启用时画布/画廊不挂载是正确门控而非故障。与 5.1 同族——该门控现由 `GET /api/bootstrap` 运行时读取下发。

**对策**：
```bash
NEXT_PUBLIC_PI_WEB_CANVAS=1 pnpm dev   # 浏览器开 5173
# 生产: 给服务端进程设该 env 后重启,无需重新构建
NEXT_PUBLIC_PI_WEB_CANVAS=1 node dist/server.mjs
```
Canvas 工作台的编辑器交互、生成动作、画廊与「解读」按钮详见 [16-canvas-workbench.md](16-canvas-workbench.md)。

---

### 5.3 `split` 布局右侧为空

**症状**：在 `web.config.tsx` 设了 `config.layout = "split"`，却看不到右侧内容。

**原因**：`layout: "split"` 标记 `hasAside: true`。早期实现无条件渲染让位区，`panelRight` 与 artifact 都为空时会在 lg 视口下留出约 384px 的空白浮动列。

**已修状态**：`packages/ui/src/chat/pi-chat.tsx:1094`（`showAside` 判定）起，仅在让位区有实际内容时才渲染 `<aside>`（`pi-chat.tsx:1715`）；无内容时**优雅退化为居中版面**，不再留空白（修复见 `72394b6`）。

**对策**：真要分栏就把内容放进 `panelRight` 插槽。可运行参考 `examples/webext-layout-agent/.pi/web/web.config.tsx`（用 `config.panelRatio: "3:7"` + `slots.panelRight`）。带 `layout: "split"` 的等价写法：
```tsx
// .pi/web/web.config.tsx
import { defineWebExtension } from "@blksails/pi-web-kit";

export default defineWebExtension({
  manifestId: "my-ext",
  capabilities: ["slots", "config"],
  config: { layout: "split", panelRatio: "2:1" },
  slots: { panelRight: <MyPanel /> },
});
```

---

### 5.4 背景插槽被壳底遮挡（`backgroundLayer` 不可见）

**症状**：向 `backgroundLayer` 插槽注入了内容（如背景图），浏览器里看不到，仍是默认背景。

**原因**：负 `z-index` 元素在没有独立 stacking context 的父容器里会逃逸到 `<body>` 根上下文，被不透明的 app-shell 覆盖。

**已修状态**：`packages/ui/src/chat/pi-chat.tsx:1645` 已在 wrapper 加 `isolate`（CSS `isolation: isolate`），把 `backgroundLayer` 的 `z-index: -10` 限定在该列内。

**若自行实现 slot 遇到类似问题**，为含负 `z-index` 子元素的容器建立独立 stacking context：
```css
.my-container {
  isolation: isolate; /* 或 position: relative + z-index: 0 */
}
```

---

### 5.5 对话回合失败但助手气泡空白（看不到错误原因）

**症状**：一次回合因 provider / 流式错误失败（如 `Connection error.`、鉴权失败），但助手气泡是空的，无法判断是没回应还是出错了。

**原因**：会话翻译层早期把承载真实错误的运行时事件（`message_end` 的 `stopReason:"error"` + `errorMessage`、`agent_end` 的 `willRetry`、`auto_retry_end` 的 `finalError`）丢弃或翻成正常结束。

**已修状态**（spec `stream-error-surfacing`，已实现）：
- 翻译层 `packages/server/src/session/translate/translate-event.ts` 在重试耗尽或不可重试时把终态错误翻为可见错误信号，透传真实 `errorMessage`。
- 实时流由 `<ChatError>` 元件呈现（`role="alert"`、destructive 配色）；历史回放为 `stopReason === "error"` 的消息追加 `data-pi-error` part 内联渲染红块。
- 用户主动中止（abort）不会被误报为错误。

**若仍看到空气泡**：确认运行版本已含该 spec；用开发者工具检查失败回合的消息节点是否带 `data-pi-error`，并查服务端日志中的原始 `agent_end` / `message_end` 事件核对 `errorMessage`。

---

## 6. 测试与工具链问题

### 6.1 jsdom 下工具调用 JSON 代码块 `textContent` 为空

**症状**：在 vitest（`environment: "jsdom"`）里用 `textContent` 断言工具入参 JSON，结果为空，但真实浏览器正常。

**原因**：`<Response>` 组件底层用 `streamdown`（`packages/ui/src/ui/response.tsx:14` 导入 `Streamdown`），代码块高亮是**异步**（Shiki）。jsdom 无真实布局引擎，异步渲染未完成时 `textContent` 为空。

**已修状态（工具/数据 JSON）**：`packages/ui/src/parts/pi-tool-part.tsx` 的 `<ToolInput>` 用**同步** `<pre><code className="language-json">` + `highlightJson()` 渲染，保证 jsdom 下可同步读取（`pi-tool-part.tsx:314`，`highlightJson` 定义在 `:137`）。

**对策（自定义组件）**：
- 工具入参、数据类 JSON 展示用同步 `<pre><code className="language-json">`，不用 `<Response>`。
- 若必须用 `<Response>`，在测试中 `await act(async () => { ... })` 等待 shiki，或 mock `streamdown`。

---

### 6.2 `--no-skills` 参数被丢弃（已修）

**症状**（历史问题）：传入 `--no-skills` 后系统 skills 仍被加载；设置页「系统资源」开关切换后无效果。

**已修状态**：`packages/server/src/runner/runner.ts:115-134` 已正确解析该标志并写入 `RunnerArgs.noSkills`，`option-mapper.ts:184` 下游用空 `skills` 覆盖。

**若仍遇到开关无效**：确认版本已含修复。注意 `--no-skills` 是会话激活时由 runner 解析的**运行时参数**（来自 URL 参数 / 会话配置），**不**落在 `settings.json`，因此 `GET /api/config/extensions/global`（返回 `settings.json` 扩展配置）不会反映它。

---

## 7. 并发与工作树问题

### 7.1 并发会话重置主工作树分支、毁提交

**症状**：多个 AI agent 会话并行运行时，`git` 操作互相干扰——某会话切分支后另一会话文件状态错乱，或 commit 丢失。

**原因**：多个进程在同一 git 工作树（`agents/pi-web/`）上并发 `git checkout / reset`，互相覆盖 `HEAD`。

**对策**：长任务（超过几分钟的实现类任务）在**隔离 git worktree** 中运行，不在主工作树操作：
```bash
# 创建隔离 worktree(相对于 repo 根一级)
git worktree add ../pi-web-attach -b feat/my-feature HEAD

cd ../pi-web-attach
# ... 编辑、提交 ...

# 完成后合并回主分支,删除 worktree
cd ../pi-web
git merge feat/my-feature
git worktree remove ../pi-web-attach
```

---

## 8. 诊断速查

| 问题关键词 | 优先检查 |
|---|---|
| dev 打开 3000 是裸 API | 开发期浏览器该开 **5173**（Vite），3000 是被代理的 API 宿主 |
| 路由/配置域改动不生效 | handler 单例 pin 在 `globalThis`；重启 dev（或 `dev:server`） |
| `node:fs` / pi SDK 解析失败 | pi SDK 只跑 Node 侧；esbuild `external` 外置（`build-server.mjs`），别打进前端 |
| 发消息后需刷新才见回复 | 每轮 `/stream` 未抢在 agent 首帧前订阅 + 服务端无回放；已由 `whenSubscribed` 修复，兜底预热路由 |
| 会话卡「正在连接 agent…」 | dev 前后端新旧不一致致就绪握手死锁；完整重启 dev |
| 生产白屏 / webext 不加载 | 生产 CSP 禁 `unsafe-eval` + import map sha256 放行；勿用 eval、勿改写内联脚本 |
| CLI 报「未找到 dist/server.mjs」 | 先 `pnpm build:dist`；或设 `PI_WEB_DIST_DIR` |
| npm 首启解包失败 | 看错误码（zstd→升 Node 22.15+ / disk-full / lock-timeout / 换 `PI_WEB_RUNTIME_ROOT`） |
| 桌面 App 首启解包失败 | 同一套判别码；多为重装或换可写运行时根，见 [20](20-desktop-tauri.md) |
| 自定义 provider 401 | `models.json` 位置（`~/.pi/agent/`）、`baseUrl`+`apiKey` 必填、DashScope key 走对端点 |
| iPhone JPEG「空 model 名」 | `normalizeImageDataUri`（`run-image-tool.ts:204`）是否在链上；自定义工具需显式调 |
| webext 无 iframe | `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` 未设；现运行时下发，重启服务端即生效 |
| Canvas 面板不显示 | `NEXT_PUBLIC_PI_WEB_CANVAS` 默认关；设为 1 后重启服务端 |
| split 右侧无内容 | `slots.panelRight` 未配置；新版无内容退化为居中，非空白 |
| 助手气泡空白看不到错误 | 终态错误翻译；查 `data-pi-error` / 服务端 `agent_end` 事件 |
| 背景插槽被遮挡 | 外层容器缺 `isolation: isolate` |
| jsdom textContent 空 | streamdown 异步高亮；工具 JSON 改用同步 `pre + language-json` |
| `--no-skills` 无效 | 是运行时参数不落 `settings.json`；确认版本已含修复 |
| 并发会话 commit 丢失 | 长任务放隔离 worktree（`git worktree add`） |

---

## 相关链接

- [06-configuration.md](06-configuration.md) — env 变量完整表（`PI_WEB_DIST_DIR` / `PI_WEB_RUNTIME_ROOT` / `NEXT_PUBLIC_PI_WEB_CANVAS` / `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` 等）
- [07-providers-and-models.md](07-providers-and-models.md) — `models.json` 格式与 DashScope key
- [11-aigc-and-vision-tools.md](11-aigc-and-vision-tools.md) — AIGC 图像/视觉工具、`normalizeImageDataUri`、模型路由边界
- [12-web-ui-extension.md](12-web-ui-extension.md) — webext 五层模型、artifact/slot 与门控
- [13-config-ui.md](13-config-ui.md) — schema 驱动的设置界面
- [16-canvas-workbench.md](16-canvas-workbench.md) — Canvas 工作台与门控
- [18-cli.md](18-cli.md) — CLI 启动、三级 `resolveRuntime`、首启解包
- [19-deployment.md](19-deployment.md) — esbuild 单文件产物、随包载荷、生产 CSP 硬化
- [20-desktop-tauri.md](20-desktop-tauri.md) — 桌面版打包分发、运行模式、首启解包错误码
- [22-development-and-testing.md](22-development-and-testing.md) — `pnpm dev` 双进程编排、`build:dist` 管线、隔离构建
- [24-http-api-reference.md](24-http-api-reference.md) — HTTP/SSE API、`GET /api/bootstrap`、SSE control 帧
