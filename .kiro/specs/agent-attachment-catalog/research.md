# Research & Design Decisions — agent-attachment-catalog

## Summary
- **Feature**: `agent-attachment-catalog`
- **Discovery Scope**: Extension(挂在 @ 补全框架、附件系统、runner 帧桥三个既有体系上)
- **Key Findings**(Explore 实地探查 worktree `feat/attachment-backend-pluggable`):
  - **补全框架是现成的插槽**:`CompletionProvider{trigger,kind,priority,complete,resolve?}` 注册表 + 800ms per-provider 超时降级空 + `kind` 分组 + token 文法 `@<kind>:<id>` + 提交期 `resolveCompletions` 位置式重写。catalog 只需一个新 provider(`kind:"catalog"`),分组/过滤/降级(Req 2.1/2.2/2.4)全部由框架既有语义承担。
  - **busy 不影响补全**:补全端点是独立 GET,不经 prompt 通路(Req 2.3 结构性满足);子进程侧并发受理有 agent-routes 的「第二 stdin reader,每帧独立派发」先例。
  - **附件引用的统一出口**:提交期 `@attachment:<id>` 经 provider.resolve → `[attachment id=…]` 文本标记(绝不内联字节),与 `attachmentIds` 注入产物同形。catalog 物化后换成标准 `@attachment:` token 即可与普通附件完全同等待遇(Req 3.2/4.4)。
  - **前端即时感知无 SSE 先例**:control 帧判别集无 attachment 事件;现成模式是 `panelSyncSignal`(轮末边沿)——但 agent 后台推送可发生在轮中,轮末信号不满足 Req 4.2,需新增 control 帧(message-queue 加 `control:"queue"` 的先例流程可循)。
  - **帧桥先例完备**:装配期声明帧(`agent_routes`)+ 运行期请求/结果帧(`piweb_agent_route_request/result`,主进程 pending map + 子进程独立 reader + fd1 直写回流)可整族复制;物化在子进程侧经 child store 落库,**帧里只传 att_id 不传字节**。

## Research Log

### 物化时机:选中时(accept)vs 提交时(resolve)
- **Context**:Req 3.2「提交前物化」两种落法都合规;Req 3.4 要求「可理解的失败反馈」;既有输入区有 `onCompletionAccept` 捕获附件候选做缩略图预览(`PiMentionPreviews`)。
- **Findings**:resolve 失败的框架语义是「保留原 token 文本」——静默降级,用户看不到反馈;accept 时机则可 toast + 撤 token,且能接上既有预览链路。
- **Implications**:**主路径 = accept 时物化**(前端调专用物化端点,成功后把 `@catalog:<entryId>` token 换写为标准 `@attachment:<attId>`);**兜底 = catalog provider 的 resolve 也接同一物化通路**(用户在换写完成前抢发、或非 UI 客户端直发裸 token 时仍能物化;幂等使双路径安全)。失败反馈:accept 路径 toast+撤 token;resolve 兜底失败 → null → 框架保留原文(纯文本,不构成失效引用,Req 3.4 后半仍满足)。

### 幂等(Req 3.3)的持久化依据
- **Context**:同一条目重复选中不重复落库;子进程可能热重载(内存映射会丢)。
- **Findings**:attachment 描述符有不透明扩展 meta(`getMeta/setMeta`,Canvas 血缘已用);child store 可 `listBySession`。
- **Implications**:物化成功后 `setMeta(attId, { catalogEntry: { entryId, version } })`;物化前先查内存映射,miss 再扫 `listBySession + getMeta` 匹配 `entryId+version`(物化是低频操作,线性扫可接受)→ 命中即复用。agent 声明面给条目可选 `version`(缺省视为恒新?否——缺省视为同 entryId 即同内容,由作者自行决定何时换 version)。

### 前端即时感知通道
- **Context**:Req 4.2/4.3 要求 agent 推送后免刷新可见;推送可发生在轮中。
- **Findings**:SSE control 帧集可扩(`ControlPayloadSchema` 判别联合);`control:"queue"` 有「新增帧类型 + react connection 消费」全流程先例;补全服务端本就每次实时查,「即时」瓶颈只在前端何时重新触发查询与面板重拉。
- **Implications**:子进程 fd1 发 `piweb_attachment_event` 帧 → pi-session 转发为 SSE `control:"attachment"`(事件载荷含新附件描述符投影)→ react transport 暴露回调 → pi-chat bump 刷新信号(补全浮层开着则重查;附件面板/预览重拉)。**非粘性**(事件语义,错过不补;打开会话时本就全量枚举)。

### agent 主动推送的作者面
- **Findings**:`AttachmentToolContext.putOutput` 已可在子进程任意时刻落库(seam 是进程级 ambient);缺的只是「让前端知道」。
- **Implications**:扩展 `AttachmentToolContext` 增 `publish(input)` = putOutput + fd1 事件帧(发射器在 attachment-wiring 构造 ctx 时注入,fs.writeSync(1) 直写与各桥同坑);目录的 list/resolve 用户则走独立的 catalog 声明。两者正交:catalog=可发现的惰性目录,publish=即刻落库并广播。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 声明式 catalog + 帧桥 + accept 物化(选定) | agent_routes 全族复制 + 新 completion provider + 专用物化端点 | 全部构件有先例;字节不过 JSONL;busy 安全;失败可反馈 | 前端 accept 需处理异步换写 | resolve 兜底消解抢发竞态 |
| 纯 resolve 物化(零前端改动) | 提交期才物化 | 改动面最小 | 失败静默、无预览、发送延迟叠加物化耗时 | 否决为主路径,保留为兜底 |
| agent 预先全量落库 | 装配期 putOutput 一批 | 复用现有一切 | 违背惰性(Req 3.1);大目录不可行 | 否决 |
| 会话级自定义 store 后端(反向取字节) | 主进程按需向子进程索字节 | 能力最强 | 字节过帧通道;会话死后不可达,违背描述符权威生命周期 | 否决(前次调查已否) |

## Design Decisions

### Decision: 物化 = 子进程侧 child store 落库,帧只传 att_id
- 主进程发 `materialize(entryId)` 请求帧 → 子进程 agent `resolve` 取字节 → child store `putOutput`(自然继承拓扑/profile 写路由,Req 3.5)→ setMeta 幂等锚 → 回 `{attachmentId}`。字节零跨进程。

### Decision: 声明帧门控 provider 查询
- 装配期 `agent_attachment_catalog` 声明帧(available 投影);pi-session 缓存;catalog provider 先查可用性,无声明零往返(Req 1.2 结构性零变化,亦免 800ms 空等)。

### Decision: 补全时限内的目录查询
- provider.complete 经 pi-session 请求帧向子进程索 list,**约 700ms 上限**(留框架 800ms 余量);超时/错误 → 返回 `[]`(Req 2.4 恰为框架既有语义)。物化端点单独超时 env `PI_WEB_ATTACHMENT_CATALOG_TIMEOUT_MS`(缺省 20000,agent-route 同风格)。

### Decision: accept 异步换写状态机(UI)
- 选中 catalog 条目 → 立即插入 `@catalog:<entryId>` token(响应性)→ 后台调物化端点 → 成功:token 原位换写 `@attachment:<attId>` + 注册预览缩略图;失败:撤 token + toast。用户抢发未换写 token → 提交期 resolve 兜底物化(幂等保证不双落库)。

## Risks & Mitigations
- agent list 手写实现慢 → 700ms 上限 + 降级空组;文档建议作者内存化目录。
- accept 换写与用户编辑竞态(token 被手改)→ 换写按「精确匹配原 token 文本」定位,找不到则放弃换写(resolve 兜底仍在)。
- 事件帧风暴(agent 循环 publish)→ pi-session 侧对 `control:"attachment"` 做节流合并(尾沿 ≤1 帧/秒,面板重拉是全量枚举,合并无损)。
- 双路径物化并发(accept 与 resolve 同时)→ 子进程物化按 entryId 串行化(in-flight map 复用同一 Promise)。

## References
- 补全框架基线:`packages/server/src/completion/{types,registry,merge,token,resolve}.ts`、`providers/attachment-provider.ts`、`packages/ui/src/completion/*`、`packages/protocol/src/transport/completion-dto.ts`(Explore 探查记录,行号见会话)
- 帧桥先例:`packages/server/src/runner/agent-routes-wiring.ts`、`session/pi-session.ts`(pending map/handleRawLine)、`attachment-wiring.ts`(ctx 构造/fd1 直写)
- 上游 spec:`attachment-backend-pluggable`(child store/写路由)、`agent-attachment-profile`(声明帧+writeProfile)
