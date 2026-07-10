# 06 · 配置参考

pi-web 通过 `.env.local` + `~/.pi/agent` 目录两条路径完成全部配置，本章给出每个变量的用途、默认值与示例。

---

## 快速上手

1. 复制示例文件：

   ```bash
   cp .env.local.example .env.local
   ```

2. 按需填写变量。`.env.local.example` 默认只列出凭证与会话默认项，其余变量（附件、会话存储、热重载等）按需手动追加，全量清单见下文「[变量全表](#变量全表)」。

3. 启动开发服务：

   ```bash
   pnpm dev
   ```

   **预期结果**：`pnpm dev` 是 `node scripts/dev-all.mjs`（`package.json:17`），它并发拉起两个进程 —— 后端 API 宿主 `server/index.ts` 监听 `127.0.0.1:3000`，Vite dev server 监听 `http://localhost:5173`（`vite.config.ts:73`）。**浏览器要打开的是 5173**，`/api` 请求由 Vite 反向代理到 3000（`vite.config.ts:76-81`）。若误开 3000，看到的是裸 API 宿主而非选源页。

若你已用 `pi` 登录过，`~/.pi/agent/auth.json` 中已有 API key，**无需再设任何 provider key**，第 2 步可整段跳过直接启动。若启动后页面报认证错误，参见 [23 · 故障排查 FAQ](./23-troubleshooting-faq.md)。

---

## 运行时门控与 `GET /api/bootstrap`

pi-web 已脱离 Next.js（前端为 Vite + SPA，后端为 Hono 宿主，服务端由 esbuild 打成单文件 `dist/server.mjs`）。这带来一处**语义反转**，配置时必须理解：

以 `NEXT_PUBLIC_` 为前缀的变量名**全部保留**，但它们**不再是构建期内联**。旧宿主（Next）会把客户端组件里的 `NEXT_PUBLIC_*` 在 `next build` 时**烧进 bundle**，导致 CLI 用户在运行时设置它们其实**不生效**。SPA 化后：

1. 服务端在 `server/bootstrap.ts:buildBootstrap` 读取这些 env（`server/bootstrap.ts:92-107`）。
2. 前端启动时向 `GET /api/bootstrap` 拉取一次（`server/index.ts:67`），把结果经 `setRuntimeFeatures()` 注入 `lib/app/runtime-features.ts`，`src/bootstrap.tsx` 的 `<BootstrapGate>` 在配置到达前**不渲染**依赖门控的子树（避免闪烁）。

**结果**：`pi-web --canvas`、`NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1 node dist/server.mjs` 这类**运行时**开关现在才真正生效 —— 你改环境变量后重启进程即可，无需重新构建。

下表是 `/api/bootstrap` 下发的前端门控字段与其 env 来源（`server/bootstrap.ts:92-107`）：

| env 变量 | 门控字段 | 默认 | 作用 |
|---|---|---|---|
| `NEXT_PUBLIC_PI_WEB_CANVAS` | `canvas` | 关 | Canvas 工作台面板（见下「Canvas 门控」的弃用说明） |
| `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER` | `sourcePicker` | 关 | 选源页展示可浏览的源列表 |
| `NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL` | `launcherRail` | 关 | 侧栏启动导航区 |
| `NEXT_PUBLIC_PI_WEB_BASH_ENABLED` | `bashEnabled` | 关 | 前端识别 `!`/`!!` bash 前缀（体验开关） |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` | `sessionsGlobal` | 关 | 显示「全部」系统会话 Tab |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE` | `sessionsManage` | **开** | 会话写操作（删除/重命名/收藏）；`false`/`0` 关闭 |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` | `sessionsSlot` | `sidebar` | 会话列表宿主插槽 |
| `NEXT_PUBLIC_PI_WEB_DISABLE_READINESS_HANDSHAKE` | — | 关 | 关闭会话就绪握手（调试用） |
| `NEXT_PUBLIC_PI_WEB_KIT_VERSION` | `hostApiVersion` | `0.1.0` | 下发给 webext 的宿主 API 版本 |

> **两端一致仍然重要**：前端门控现在走 `/api/bootstrap`，但**后端**对同名变量仍**直接读 `process.env`** 做权威门控（例如 `scope=all` 请求在 `lib/app/pi-handler.ts:464-465` 判定 `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL`）。两端读同一个变量名、同一进程 env，故只需在启动进程时设一次即可对齐；不再存在「构建期烧进前端、运行时改后端」的错位。

---

## 变量全表

### 一、pi agent 目录

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_WEB_AGENT_DIR` | `~/.pi/agent` | pi 配置目录，agent 进程读取 `auth.json` / `settings.json`；优先于 `PI_CODING_AGENT_DIR` |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` | 与 `pi` CLI 自身的 env 变量一致，当 `PI_WEB_AGENT_DIR` 未设时回落 |

> 解析逻辑（`lib/app/config.ts:resolveAgentDir`）：`PI_WEB_AGENT_DIR` → `PI_CODING_AGENT_DIR` → `~/.pi/agent`。

```bash
# 多租户场景：为每个用户隔离 config
PI_WEB_AGENT_DIR=/srv/tenants/acme/.pi/agent
```

---

### 二、Provider API Key（可选透传）

这些 key 仅在你需要**覆盖或补充** `~/.pi/agent/auth.json` 时才需要填写。它们由服务端读取后经 spawn env 传给 agent 子进程，**绝不**写入响应体、日志或客户端。

| 变量 | 说明 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude 系列 |
| `OPENAI_API_KEY` | OpenAI / 兼容网关 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini（AI SDK） |
| `GEMINI_API_KEY` | Google Gemini（原生） |
| `MISTRAL_API_KEY` | Mistral |
| `OPENROUTER_API_KEY` | OpenRouter 网关 |

> 上表 6 个文本对话 key 的白名单见 `lib/app/config.ts:52-58`（`PROVIDER_KEY_NAMES`）。认证来源优先级：`env key`（additive）> `~/.pi/agent/auth.json`（由 agent 进程读取）。

**AIGC 图像 / 视觉专用 key**（由 tool-kit 运行时 var-resolver 在调用端点时展开，同样走 spawn env）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NEWAPI_API_KEY` | （未设） | NewAPI 网关（gpt-image 生成/编辑），见 `packages/tool-kit/src/aigc/providers/newapi.ts:33` |
| `SUFY_API_KEY` | （未设） | sufy（七牛云）网关（gpt-image / Gemini 3.1 Flash Lite），见 `providers/sufy.ts:37` |
| `DASHSCOPE_API_KEY` | （未设） | 阿里云 DashScope（Qwen-Image 编辑、token plan），见 `providers/dashscope.ts:40` |
| `DASHSCOPE_TOKENPLAN_BASE_URL` | `https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1` | token plan 端点覆盖，见 `tools/image-generation.ts:40`（占位默认值，形如 `${VAR:-default}`） |

> AIGC 工具的模型路由、成本与网关坑详见 [11 · AIGC 与视觉工具](./11-aigc-and-vision-tools.md)。

---

### 三、会话默认 provider / model

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_WEB_DEFAULT_PROVIDER` | （未设，从 `settings.json` 读） | 强制指定 provider，如 `openrouter` |
| `PI_WEB_DEFAULT_MODEL` | （未设，从 `settings.json` 读） | 强制指定模型，如 `anthropic/claude-sonnet-4.6` |

> 不填时，`~/.pi/agent/settings.json` 的 `defaultModel` / `defaultProvider` 生效，UI 尊重你的 `pi` 本地配置。

```bash
PI_WEB_DEFAULT_PROVIDER=openrouter
PI_WEB_DEFAULT_MODEL=anthropic/claude-opus-4-5
```

---

### 四、隐藏 provider（部署管控）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_WEB_HIDE_PROVIDERS` | （未设，全部可见） | 逗号分隔的 provider 名，从 `GET /config/models` 响应与设置下拉中剔除 |

```bash
# 部署到只允许 OpenRouter 路由的环境，隐藏直连 provider
PI_WEB_HIDE_PROVIDERS=anthropic,openai,google
```

实现见 `packages/server/src/config/model-options-filter.ts`（导出 `parseHiddenProviders` / `excludeProviders`）与 `lib/app/pi-handler.ts:448-449`（`/config/models` 路由内调用 `parseHiddenProviders` + `excludeProviders`）；会话内 `get_available_models` RPC 也应用同一过滤（`packages/server/src/http/routes/query-routes.ts`），保证下拉与运行时可选集一致。前端经 `GET /api/config/models` 取数。详见 [07 · Provider 与模型](./07-providers-and-models.md)。

---

### 五、默认 agent source / 工作目录

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_WEB_DEFAULT_SOURCE` | （未设） | 选源页的默认值；本地目录、git URL 均可 |
| `PI_WEB_DEFAULT_CWD` | 服务进程的 `process.cwd()` | 会话工作目录，影响 agent 能看到的文件树 |

```bash
PI_WEB_DEFAULT_SOURCE=./examples/hello-agent
PI_WEB_DEFAULT_CWD=/workspace/myproject
```

---

### 六、附件系统

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_WEB_ATTACHMENT_DIR` | `~/.pi/agent/attachments` | 附件落盘根目录（本地后端唯一来源）；主进程经 spawn env 下发给子进程，两端必须一致 |
| `PI_WEB_ATTACHMENT_SECRET` | （未设时单进程随机） | HMAC 签名 secret；**子进程共享场景必须显式设置**，否则子进程产出的签名 URL 在主进程校验时 401 |
| `PI_WEB_ATTACHMENT_URL_BASE` | `/api`（由 pi-handler 注入） | 附件签名 URL 前缀，通常无需手动设置 |

> 默认目录解析逻辑见 `packages/server/src/attachment/config.ts:resolveAttachmentDir`。

```bash
PI_WEB_ATTACHMENT_DIR=/data/pi-attachments
PI_WEB_ATTACHMENT_SECRET=your-stable-hmac-secret-min-32-chars
```

---

### 七、开发 / e2e 专用

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_WEB_STUB_AGENT=1` | 关闭 | 每个会话改用确定性本地 stub agent（不消耗 API key），Playwright e2e 默认开启 |
| `PI_RUNNER_HOT_RELOAD=1` | 关闭 | dev 模式下监视 `packages/tool-kit/src`，源码变更自动重启空闲 runner（无需开新会话） |
| `PI_RUNNER_HOT_RELOAD_PATHS` | `packages/tool-kit/src`（绝对路径） | 逗号分隔的监视目录列表，覆盖默认路径 |
| `PI_WEB_AUTOSTART=1` | 关闭 | 首页自动创建会话并跳过选源页；CLI（`bin/pi-web.mjs`）与桌面壳（`server_supervisor.rs:88`）启动时均自动注入 |
| `PI_WEB_WATCH=1` | 关闭 | CLI `--watch` 模式写入；在生产单文件产物下也启用热重载（不受 `NODE_ENV` 门控） |
| `PI_WEB_DEV_CLIENT_PORT` | `5173` | Vite dev server 端口（`vite.config.ts:73`） |
| `PI_WEB_DEV_API_PORT` | `3000` | dev 期 Vite 代理 `/api` 指向的后端端口（`vite.config.ts:78`） |
| `PI_WEB_DIST_DIR` | `dist` | CLI 拉起的 dist 目录覆盖（`bin/pi-web.mjs:226`）；设置后 `resolveRuntime` 直接用该目录、**跳过随包载荷首启解包**（隔离构建 / e2e 用），详见 [18 · CLI](./18-cli.md) |

> 构建产物是 Vite（`dist/client`）+ esbuild 单文件（`dist/server.mjs`），无 `.next` 目录、无 `NEXT_DIST_DIR`（该变量已从 main 删除）。e2e 隔离靠 `PI_WEB_STUB_AGENT=1` + 独立产物目录，不再靠改构建输出目录。

```bash
# 离线跑（stub agent，不消耗 key）：直接开发服务
PI_WEB_STUB_AGENT=1 pnpm dev

# 或跑生产单文件产物
pnpm build:dist
PI_WEB_STUB_AGENT=1 node dist/server.mjs

# dev 期热重载（改 tool-kit/src 免重开会话）
PI_RUNNER_HOT_RELOAD=1 pnpm dev
```

> 与 Next 时代不同，Vite + esbuild 管线**不存在共享 `.next` 污染**问题，dev 运行期间执行 `pnpm build:dist` 写的是独立的 `dist/`，不会打断开发服务。构建管线细节见 [22 · 开发与测试](./22-development-and-testing.md)。

---

### 八、会话存储

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SESSION_STORE` | `fs` | 会话持久化后端：`fs`（文件）/ `sqlite` / `postgres`（未设或空回落 `fs`） |
| `SESSION_STORE_ROOT` | `~/.pi/agent/sessions` | `fs` 模式的存储根目录（默认值由 `defaultSessionsRoot()` 给出）；会话文件在根目录下按工作目录 `cwd` 分桶存放 |
| `SESSION_STORE_PATH` | `:memory:` | `sqlite` 模式的数据库路径 |
| `DATABASE_URL` | （未设） | `postgres` 模式的连接串（`SESSION_STORE=postgres` 时必填） |

```bash
SESSION_STORE=sqlite
SESSION_STORE_PATH=/data/pi-web-sessions.db
```

---

### 九、会话列表视图（sessions-list）

会话列表面板的可见性与展示位置由 `NEXT_PUBLIC_PI_WEB_SESSIONS_*` 变量控制。如上文「运行时门控」所述，它们**不再构建期内联**：前端经 `GET /api/bootstrap` 拿到门控，后端对同名变量直接读 `process.env` 做权威判定，两端读同一进程 env。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` | （未设，关闭） | 取 `true` / `1` 时显示「全部」（系统 / 全机器）会话 Tab；关闭时后端对 `scope=all` 直接返回 `403 SESSIONS_GLOBAL_DISABLED`、不触达存储 |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE` | （未设，**默认开**） | 会话写操作（删除 / 重命名 / 收藏）门控；取 `false` / `0` 时写端点 `403`、不触达存储，前端亦隐藏写入口 |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` | `sidebar` | 会话列表面板的宿主插槽：`sidebar` / `header` / `footer` / `empty`；非法值回落 `sidebar` |

> 后端门控见 `lib/app/pi-handler.ts:464-478`（`scope=all` 与写操作判定）；前端门控字段见 `lib/app/runtime-features.ts:59-64`。完整说明见 [14 · 会话列表](./14-sessions-list.md)。

```bash
# 启用系统会话视图并把列表移到顶栏
NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL=1
NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT=header
```

---

### 九之二、Agent Source 列表（agent-sources-list）

新建会话选择器（`AgentSourcePicker`）除手输 source 外，可展示一份**可浏览的可用 agent source 列表**（`GET /agent-sources`）。数据来源为「目录扫描 ∪ 注册表文件」两路合并去重（详见 [24 · HTTP API](./24-http-api-reference.md) 与实现 `packages/server/src/agent-source-list/`）。端点严格只读：不写、不 clone、不 resolve/spawn。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER` | （未设，关闭） | **前端门控**（经 `/api/bootstrap` 下发）。取 `true` / `1` 时选择器展示源列表；关闭时仅显示手输框 |
| `PI_WEB_SOURCES_ROOT` | （未设，不扫描） | 目录扫描根，`path.delimiter`（`:` / `;`）分隔多个；相对路径以 `PI_WEB_DEFAULT_CWD` 解析为绝对。扫描每个根的一级子目录，含 `index.[jt]s` 入口→`custom`、否则→`cli` |
| `PI_WEB_SOURCES_REGISTRY` | `<agentDir>/sources.json` | 注册表 JSON 路径（存在才读）。形态：`{ "sources": [ { "source", "name?", "description?" } ] }`。缺失或损坏均容错（返回其余可用来源） |

> 两端一致：前端未开 `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER` → 不渲染列表；后端未配 `PI_WEB_SOURCES_ROOT` 且注册表不存在 → 端点返回空列表。二者共同表现为「无列表可浏览」，手输框始终作为兜底入口。装配见 `lib/app/pi-handler.ts`（`createAgentSourcesRoutes`）。

```bash
# 启用源列表并把 examples 目录作为扫描根
NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1
PI_WEB_SOURCES_ROOT=/abs/path/to/examples
PI_WEB_SOURCES_REGISTRY=/abs/path/to/sources.json
```

---

### 九之三、侧栏启动导航区（sidebar-launcher-rail）

在侧栏会话列表之上渲染一个固定「启动导航区」：搜索历史会话、固定的新建聊天、收藏 agent source 的一键启动锚点、以及一个 webext 贡献槽（`launcherRail` SlotKey，详见 [12 · Web UI 扩展](./12-web-ui-extension.md)）。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL` | （未设，关闭） | **前端门控**（经 `/api/bootstrap` 下发）。取 `true` / `1` 时侧栏渲染启动导航区 |

> **注意门控并非唯一触发条件**：当加载的 source 声明了 `launcherRail` 贡献时，即便此全局门控关闭，启动导航区（含该贡献槽）仍会渲染（`components/chat-app.tsx:787-790`，「source 声明即意图，免全局门控」）。收藏经 `GET·PUT /api/agent-sources/favorites` 读写（持久化 `<agentDir>/agent-source-favorites.json`）。搜索复用 `GET /sessions?q=`（名称子串）。

```bash
# 启用侧栏启动导航区（通常与源列表同开）
NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL=1
NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1
PI_WEB_SOURCES_ROOT=/abs/path/to/examples
```

---

### 九之四、Canvas 门控（canvas）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_PI_WEB_CANVAS` | （未设，关闭） | **已弃用的强制覆盖**。取 `true` / `1` 时强制启用 Canvas 工作台面板 |

> **弃用说明**（`packages/canvas-ui/src/canvas-launcher.tsx:30-38`）：Canvas 面板显示现已改为**由 source 声明驱动** —— agent source 挂载 canvas slot 贡献即显示，不再依赖此 env 门控。`isCanvasEnabled()` 与 `NEXT_PUBLIC_PI_WEB_CANVAS` 仅作向后兼容 / 可选的强制覆盖读取保留。Canvas 工作台的编辑器、生成动作与画廊详见 [16 · Canvas 工作台](./16-canvas-workbench.md)。

---

### 十、视觉识别模型

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_WEB_VISION_MODEL` | （未设，运行时按 modelRegistry 选） | `image_vision` 工具 / `/img_vision` 命令的默认视觉模型，**格式为 `provider/modelId`**（如 `openrouter/google/gemini-2.5-flash`）。注意与图像生成模型的裸 id 格式不同，不可混用 |

> 定义见 `packages/tool-kit/src/vision/types.ts:104-109`（`VISION_MODEL_ENV = "PI_WEB_VISION_MODEL"`）。视觉工具语义详见 [11 · AIGC 与视觉工具](./11-aigc-and-vision-tools.md)。

---

### 十一、日志

日志由同构包 `packages/logger` 解析以下 env 配置（解析逻辑见 `packages/logger/src/config.ts`），客户端与服务端共用同一套变量名。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_WEB_LOG_ENABLED` | （未设 = 关闭） | **日志默认关闭**；设为非 `false` 值（如 `1`/`true`）强制开启服务端日志门控（无需经 Settings），取 `false` 显式禁用 |
| `PI_WEB_LOG_LEVEL` | `info` | 日志级别：`debug` / `info` / `warn` / `error` |
| `PI_WEB_LOG_NAMESPACES` | （全部） | 逗号分隔的命名空间白名单（如 `agent,ext`），仅启用列出的命名空间 |
| `PI_WEB_LOG_FILE` | （未设，不写文件） | 日志文件绝对路径；设置后启用文件输出 |
| `PI_WEB_LOG_FILE_MAXSIZE` | `10` | 单文件滚动阈值（MB） |
| `PI_WEB_LOG_FILE_MAXFILES` | `5` | 滚动备份文件最大数量 |

```bash
PI_WEB_LOG_LEVEL=debug
PI_WEB_LOG_NAMESPACES=agent,ext
PI_WEB_LOG_FILE=/var/log/pi-web/app.log
```

> 日志系统的级别语义、命名空间分层与 Node/浏览器双端差异详见 [21 · 日志](./21-logging.md)。

---

### 十二、Bang Shell 命令（默认关闭）

Bang(`!`)shell 命令允许在聊天输入框直接执行 shell 命令：`!cmd` 执行并将输出送入 LLM 上下文，`!!cmd` 执行但输出不进上下文。**此功能等同于在服务器宿主上执行任意命令（RCE），默认关闭，仅应在可信单人/受控环境启用。** 启用需同时设置以下两个变量（故意分离：服务端为权威安全门控，前端仅为体验联动）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_WEB_BASH_ENABLED` | （未设 = 关闭） | **服务端权威门控**（server-only）。设为非 `false`/`0` 值（如 `1`/`true`）启用 `POST /sessions/:id/bash` 端点；关闭时该端点返回 404（不泄露端点存在）。即使前端开关被绕过，此项关闭则一律拒绝执行 |
| `NEXT_PUBLIC_PI_WEB_BASH_ENABLED` | （未设 = 关闭） | **前端体验开关**（经 `/api/bootstrap` 下发）。设为 `1`/`true` 时聊天输入识别 `!`/`!!` 前缀并显示 bash 模式提示；关闭时 `!` 文本按普通消息发送给 LLM |

> 两者都开才完整可用；前开后关 → 端点 404（前端显示错误反馈）；前关 → `!` 退化为普通消息。该开关**不在 Settings 界面提供**（部署级安全开关，仅由 env 控制）。安全风险与硬化建议详见 [19 · 部署](./19-deployment.md)。

---

## 桌面版（Tauri）专属环境变量

桌面壳（`desktop/src-tauri`，Tauri v2）是 pi-web 的第二种交付形态，它 spawn **同一个** `dist/server.mjs` 后端。桌面场景下有一组壳自身读取或注入的 env（详见 [20 · 桌面版（Tauri）](./20-desktop-tauri.md)）。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_WEB_DESKTOP_PORT` | 内置起始端口 | 后端起始端口（`desktop/src-tauri/src/main.rs:47-52`，占用则递增） |
| `PI_WEB_DESKTOP_DEV_URL` | （未设） | 非空且未打包时加载该开发地址、**不拉起后端**（dev 模式）；打包态即便设置也强制忽略（`runtime_mode.rs:13`） |
| `PI_WEB_DESKTOP_SERVER_JS` | 随包解包出的 `server.mjs` | 覆盖后端入口（`resolve_artifact.rs:22`） |
| `PI_WEB_DESKTOP_STUB_PICK_DIR` | （未设） | e2e 桩：非空时目录选择对话框直接返回该路径、不弹窗（`dialog.rs:21`） |
| `PI_WEB_RUNTIME_ROOT` | `~/.pi/web/runtime` | 共享运行时首启解包根目录（`src/runtime/unpack.src.mjs:144-148`），实际落 `<root>/<version>-<digest>/` |

**壳向后端子进程注入的 env**（`desktop/src-tauri/src/server_supervisor.rs:75-95`）：

- 注入 `PORT` / `HOSTNAME` / `PI_WEB_AUTOSTART=1` / `PI_WEB_NODE_BIN`（随包 node 绝对路径，供 pi runner 孙进程复用）。
- **刻意不注入 `PI_WEB_AGENT_DIR`**（Req 5.5）：使桌面版会话默认落 `~/.pi/agent`，与 CLI 共享同一 agent 目录；仅当用户已在外层 env 显式设置时才透传。

---

## `~/.pi/agent` 目录结构与优先级

```
~/.pi/agent/
├── auth.json        # API key / OAuth token（pi login 写入）
├── settings.json    # 默认 provider / model、已安装包、主题
├── models.json      # 自定义 provider 模型列表（非内置 provider 走此文件）
├── aigc.json        # AIGC 图像工具设置（disabledModels / enablePromptOptimization）
├── attachments/     # 附件默认落盘目录（PI_WEB_ATTACHMENT_DIR 未设时）
└── sessions/        # 会话历史（SESSION_STORE=fs 时）
```

**优先级规则：**

1. `auth.json` — agent 进程直接读取，env key（`ANTHROPIC_API_KEY` 等）叠加在其上。
2. `settings.json` — agent 进程读取，`PI_WEB_DEFAULT_PROVIDER` / `PI_WEB_DEFAULT_MODEL` 可在 env 层覆盖。
3. `models.json` — 非内置 provider 的模型注册；格式需含 `baseUrl` + `apiKey`，`api` 字段设为 `openai-completions` 可对接 NewAPI 等网关。
4. `PI_WEB_AGENT_DIR` / `PI_CODING_AGENT_DIR` — 指向不同目录可实现多租户隔离。

### aigc 配置域（`aigc.json`）

AIGC 图像工具设置落 `~/.pi/agent/aigc.json`，由 `aigcExtension` 在装配期读取（schema 见 `packages/protocol/src/config/domains/aigc.ts:19-45`）：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `disabledModels` | `string[]` | `[]` | 被禁用的图像模型 id 列表。通过设置页的自定义 widget `aigcModelToggles` 勾选：**取消勾选即禁用** —— 被禁模型不再暴露给 LLM 枚举、也不在选择器出现。变更在**下一次会话 / 重载后**生效 |
| `enablePromptOptimization` | `boolean` | `false` | 生成前对描述做提示词优化（**当前为占位接缝，不改写**） |

```jsonc
// ~/.pi/agent/aigc.json — 禁用两个模型、关闭提示词优化
{
  "disabledModels": ["gpt-5-image-mini", "gemini-2.5-flash-image"],
  "enablePromptOptimization": false
}
```

> 该配置域的 schema 驱动设置界面（`aigcModelToggles` widget + `GET /api/aigc/models` 数据端点）详见 [13 · 配置 UI](./13-config-ui.md)；被禁模型如何从 LLM 枚举与下发清单同源移除详见 [11 · AIGC 与视觉工具](./11-aigc-and-vision-tools.md)。

---

## `.env.local` 最小示例

```dotenv
# 最简：依赖 ~/.pi/agent/auth.json 已有 key
# 不需要设任何 ANTHROPIC_API_KEY 等

# 若需强制模型（可选）
PI_WEB_DEFAULT_PROVIDER=openrouter
PI_WEB_DEFAULT_MODEL=anthropic/claude-sonnet-4.6

# 附件系统（启用附件功能时建议显式设置）
PI_WEB_ATTACHMENT_DIR=/data/my-attachments
PI_WEB_ATTACHMENT_SECRET=stable-secret-at-least-32-chars-here
```

---

## 下一步 / 相关

- [01 · 快速开始](./01-quickstart.md) — `pnpm dev` 双进程编排与端口
- [07 · Provider 与模型](./07-providers-and-models.md) — 自定义 provider 与 models.json 格式
- [11 · AIGC 与视觉工具](./11-aigc-and-vision-tools.md) — AIGC provider key、`PI_WEB_VISION_MODEL`、aigc 配置域语义
- [13 · 配置 UI](./13-config-ui.md) — 前端设置页与 aigc/logging schema 驱动界面
- [14 · 会话列表](./14-sessions-list.md) — 系统会话视图开关与展示位置
- [18 · CLI](./18-cli.md) — `pi-web` 命令行参数、`PI_WEB_DIST_DIR` 与首启解包
- [19 · 部署](./19-deployment.md) — 生产单文件产物、CSP 硬化与 Bang 安全
- [20 · 桌面版（Tauri）](./20-desktop-tauri.md) — 桌面专属 env 与共享运行时
- [21 · 日志](./21-logging.md) — 日志级别环境变量
- [22 · 开发与测试](./22-development-and-testing.md) — 构建管线与 e2e 隔离
