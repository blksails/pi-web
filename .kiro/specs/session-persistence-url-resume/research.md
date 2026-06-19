# Research & Design Decisions

## Summary
- **Feature**: `session-persistence-url-resume`
- **Discovery Scope**: Extension(扩展既有 pi-web 会话 / 存储 / 前端链路)
- **Key Findings**:
  - pi `SessionManager` 原生支持恢复(`create(cwd, dir, {id})` 可指定 id、`open(path)`、`continueRecent`),`createAgentSessionRuntime({sessionManager})` 接受已加载历史的 SM。
  - 持久化后端(fs/sqlite/postgres)与 `SessionEntryStore` 接口已存在,可直接复用;`MessageEntry.message` 与 `GetMessagesResponse.messages[]` 同构。
  - 三处缺口:主进程 id 与 agent 持久化 id 不一致、`SessionHeader` 无 source/model、无冷恢复编排与前端路由。

## Research Log

### pi SessionManager 恢复能力
- **Context**:续聊需 agent 重新加载历史上下文。
- **Sources**:`node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts`、`cli/args.d.ts`、`main.js`。
- **Findings**:`create(cwd, sessionDir?, {id?, parentSession?})`、`open(path, sessionDir?, cwdOverride?)`、`continueRecent`、`list/listAll()→SessionInfo{path,id}`、`appendCustomEntry(customType, data?)`;CLI 有 `--resume/--continue/--session/--session-id`。
- **Implications**:真实模式经 `--session-id`(create 新建)/`--resume <path>`(open 恢复)注入;主进程 id 经 `{id}` 对齐到持久化文件 id。

### 持久化数据形状与前端历史
- **Context**:历史渲染的格式桥。
- **Findings**:`MessageEntry.message`≡`AgentMessage`≡`GetMessagesResponse.messages[]`(存读无需转换);但 `useChat` 用 `UIMessage`(parts-based),无现成转换。SSE 流不重放历史,`useChat` 支持初始 `messages`。
- **Implications**:新建 `agentMessagesToUiMessages`;恢复后经 `GET /sessions/:id/messages` 拉历史 → 转换 → `useChat({messages})` 初始化。

### 冷恢复路由与进程模型
- **Context**:恢复请求如何不被 404 拦截;stub 不落盘问题。
- **Findings**:`router.ts:168` 对含 `:id` 端点先 `store.get(id)`→未命中 404;`@pi-web/server` exports 指向 `src/index.ts`(纯 TS,无 dist),stub 是裸 node `.mjs` 无 TS loader。
- **Implications**:恢复复用 `POST /sessions {resumeId}`(无 `:id` 段);stub 复用 `SessionEntryStore` 需注入 `--import jiti/register`,否则内联。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 主进程读 + agent 写(选定) | 写在 runner/stub,读在主进程 ResumeMetaLoader,同后端配置 | 复用既有 store;真实/stub 对称;无新存储格式 | 真实模式 sqlite agent 不读(Non-Goal) | 与 SESSION_STORE 一致 |
| 主进程持久化 SSE 帧 | 在 PiSession 帧接缝镜像帧,恢复重放 | 前端零转换 | 新建帧存储;偏离既有 SessionEntryStore | 否决 |
| 仅依赖 agent 子进程持久化 | 不动主进程,GET 读 agent fs | 改动小 | stub 不落盘,e2e 无法测 | 否决 |

## Design Decisions

### Decision: 持久化"写在 agent、读在主进程",复用 SessionEntryStore
- **Alternatives**:新建 SSE 帧存储;仅靠 agent 子进程。
- **Selected**:agent(runner/stub)写,主进程 `ResumeMetaLoader` 按 id 读;两侧同 `sessionStoreConfigFromEnv()`。
- **Rationale**:复用既有 fs/sqlite adapters;stub 与真实路径对称,使 e2e 双后端可行;与目标"文件/sqlite存储"对齐。
- **Trade-offs**:真实模式 sqlite 续聊需 agent 读 sqlite(pi 不支持)→ 列 Non-Goal。

### Decision: 续聊元数据作为 `piweb.session` custom entry
- **Selected**:`appendCustomEntry("piweb.session", {source, cwd, model})` 随会话落盘。
- **Rationale**:复用既有 entry 类型,fs/sqlite 都支持,pi 原生忽略未知 custom;随会话天然持久化。
- **Follow-up**:🔴 SPIKE 验证真实 fs JSONL 的 custom entry 字段与 `CustomEntry` 一致。

### Decision: 冷恢复复用 `POST /sessions {resumeId}`
- **Rationale**:绕过 `router.ts:168` 的 `:id` 存在性 404;复用既有创建链路(resolve+createChannel+createSession)。

### Decision: stub 注入 jiti 复用 server store
- **Rationale**:避免内联重复存储逻辑,fs/sqlite 对称;依赖已随 runner 存在。
- **Follow-up**:导入失败则回退内联极简 JSONL+sqlite。

### Decision: 恢复用的 source 取 header.cwd(而非相对 piweb.session.source)
- **Context**:真实模式浏览器冷恢复实测发现 re-spawn 的 agent 立即崩溃(`POST /sessions {resumeId}` 返回 201 但随后 `GET .../messages` 404)。
- **Root cause**:`header.cwd` 是 resolve 后的绝对 agent 目录(如 `…/examples/hello-agent`),而 `piweb.session.source` 是相对路径(`./examples/hello-agent`)。恢复时 `resolve(相对source, {cwd: header.cwd})` 把相对 source 二次拼接成 `…/examples/hello-agent/examples/hello-agent`(不存在)→ runner crash → onClosed 删会话 → 404。
- **Selected**:`ResumeMetaLoader` 的 `source` 返回 `header.cwd`(绝对目录),resolve(absDir,{cwd:absDir}) 复现会话;`model` 仍取自 `piweb.session`。
- **e2e gap 提示**:node-e2e / browser-e2e 用 stub,stub 不经 `AgentSourceResolver`(直接用 store),故未覆盖此 resolver 二次拼接路径——该 bug 仅在真实 agent 浏览器实测中暴露并修复。

## Risks & Mitigations
- fs custom entry 读回兼容性 — 阶段2 SPIKE 先验证,不一致则调整字段映射。
- 真实模式 sqlite 续聊缺口 — 列 Non-Goal + 代码注释;e2e 双后端由 stub 覆盖。
- stub `.mjs` import TS 包 — 注入 jiti loader;失败回退内联。
- AgentMessage→UIMessage 富渲染对齐 — 与 part-renderer 现有 part 类型逐一对齐。
- e2e 冷恢复触发 — webServer 常驻,须显式 `DELETE` 内存会话。
- mirror flush 时序 — stub 顺序 await;真实 sqlite 读前 flush/等待。

## References
- `packages/server/src/session-store/*`(SessionEntryStore / factory / mirror / codec / types)
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts`
- `packages/server/src/http/router.ts`、`routes/create-session.ts`、`routes/query-routes.ts`
- `packages/react/src/hooks/use-pi-session.ts`、`packages/protocol/src/transport/rest-dto.ts`
