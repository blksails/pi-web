# 05 · 配置参考

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

   **预期结果**：Next.js 监听 http://localhost:3000（`next dev` 默认端口），浏览器打开后进入选源页。

若你已用 `pi` 登录过，`~/.pi/agent/auth.json` 中已有 API key，**无需再设任何 provider key**，第 2 步可整段跳过直接启动。若启动后页面报认证错误，参见 [18 · 故障排查 FAQ](./18-troubleshooting-faq.md)。

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

认证来源优先级：`env key`（additive）> `~/.pi/agent/auth.json`（由 agent 进程读取）。

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

实现见 `packages/server/src/config/model-options-filter.ts`(导出 `parseHiddenProviders` / `excludeProviders`)与 `lib/app/pi-handler.ts:338`(`/config/models` 路由内调用 `parseHiddenProviders` + `excludeProviders`);会话内 `get_available_models` RPC 也应用同一过滤(`packages/server/src/http/routes/query-routes.ts:113`),保证下拉与运行时可选集一致。前端经 `GET /api/config/models` 取数。详见 [06 · Provider 与模型](06-providers-and-models.md#42-隐藏指定-provider)。

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
| `PI_WEB_AUTOSTART=1` | 关闭 | 首页自动创建会话并跳过选源页；CLI（`bin/pi-web.mjs`）启动时自动注入 |
| `PI_WEB_WATCH=1` | 关闭 | CLI `--watch` 模式写入；在 production standalone 下也启用热重载（不受 `NODE_ENV` 门控） |
| `NEXT_DIST_DIR` | `.next` | 指定 Next.js 构建输出目录；CLI 构建用 `.next-cli`，e2e 构建用 `.next-e2e`，避免污染共享 `.next` |

```bash
# 离线 e2e 跑法
PI_WEB_STUB_AGENT=1 NEXT_DIST_DIR=.next-e2e pnpm build
PI_WEB_STUB_AGENT=1 NEXT_DIST_DIR=.next-e2e next start -p 3100

# dev 期热重载（改 tool-kit/src 免重开会话）
PI_RUNNER_HOT_RELOAD=1 pnpm dev
```

> **注意**：dev 运行期间不要执行 `pnpm build`，会污染共享 `.next` 导致路由 webpack 500。CLI / e2e 构建通过 `NEXT_DIST_DIR` 隔离。遇到此类 500，见 [18 · 故障排查 FAQ](./18-troubleshooting-faq.md)。

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

会话列表面板的可见性与展示位置由两个 `NEXT_PUBLIC_*` 变量控制。`NEXT_PUBLIC_*` 在构建期内联进客户端 bundle，**两端可读**（前端读以决定渲染，后端读以门控 `scope=all` 请求），务必让两端取值一致。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` | （未设，关闭） | 取 `true` / `1` 时显示「全部」（系统 / 全机器）会话 Tab；关闭时后端对 `scope=all` 直接返回 `403 SESSIONS_GLOBAL_DISABLED`、不触达存储 |
| `NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT` | `sidebar` | 会话列表面板的宿主插槽：`sidebar` / `header` / `footer` / `empty`；非法值回落 `sidebar` |

> 前端读取逻辑见 `components/chat-app.tsx:172`（`SESSIONS_GLOBAL_ENABLED`）与 `components/chat-app.tsx:184`（`SESSIONS_SLOT`）；后端门控见 `packages/server/src/session-list/session-list-routes.ts:136`（`scope=all && !globalEnabled` → 403）。完整说明见 [21 · 会话列表](./21-sessions-list.md)。

```bash
# 启用系统会话视图并把列表移到顶栏
NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL=1
NEXT_PUBLIC_PI_WEB_SESSIONS_SLOT=header
```

---

### 十、日志

日志由同构包 `packages/logger` 解析以下 env 配置（解析逻辑见 `packages/logger/src/config.ts:48`），客户端与服务端共用同一套变量名。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_WEB_LOG_ENABLED` | （启用） | 取 `false` 时禁用日志输出；其余任何值视为启用 |
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

> 日志系统的级别语义、命名空间分层与 Node/浏览器双端差异详见 [16 · 日志](./16-logging.md)。

---

## `~/.pi/agent` 目录结构与优先级

```
~/.pi/agent/
├── auth.json        # API key / OAuth token（pi login 写入）
├── settings.json    # 默认 provider / model、已安装包、主题
├── models.json      # 自定义 provider 模型列表（非内置 provider 走此文件）
├── attachments/     # 附件默认落盘目录（PI_WEB_ATTACHMENT_DIR 未设时）
└── sessions/        # 会话历史（SESSION_STORE=fs 时）
```

**优先级规则：**

1. `auth.json` — agent 进程直接读取，env key（`ANTHROPIC_API_KEY` 等）叠加在其上。
2. `settings.json` — agent 进程读取，`PI_WEB_DEFAULT_PROVIDER` / `PI_WEB_DEFAULT_MODEL` 可在 env 层覆盖。
3. `models.json` — 非内置 provider 的模型注册；格式需含 `baseUrl` + `apiKey`，`api` 字段设为 `openai-completions` 可对接 NewAPI 等网关。
4. `PI_WEB_AGENT_DIR` / `PI_CODING_AGENT_DIR` — 指向不同目录可实现多租户隔离。

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

- [06 · Provider 与模型](06-providers-and-models.md) — 自定义 provider 与 models.json 格式
- [12 · 配置 UI](12-config-ui.md) — 前端设置页与 provider/model 下拉的渲染机制
- [14 · CLI](14-cli.md) — `pi-web` 命令行参数与 `--watch` 热重载
- [16 · 日志](16-logging.md) — 日志级别环境变量
- [17 · 开发与测试](17-development-and-testing.md) — e2e 隔离构建约定
- [21 · 会话列表](21-sessions-list.md) — 系统会话视图开关与展示位置
