# Research Log — completion-provider-framework

## 发现范围
扩展型特性(在既有 pi-web 上新增"触发符补全"框架)。Light discovery,基于对仓库的直接勘察(本会话已完成)。

## 关键发现(代码事实)

| 主题 | 事实 | 出处 | 设计含义 |
|---|---|---|---|
| 前端输入框 | pi-web 自有 React 组件,非 pi-tui | `packages/ui/src/elements/prompt-input.tsx` | pi CLI 的 `@` 编辑器内置不可复用,须自建前端 |
| 既有浮层 | `@`/补全浮层基础设施已存在:token 检测、下拉、替换 | `packages/ui/src/controls/pi-mention-popover.tsx`、`pi-autocomplete-popover.tsx` | 复用其交互,改为按"活跃触发符 + 分区"驱动 |
| 现有 mention 通道 | webext `contributions.mention/autocomplete` 经 ui-rpc 回 agent | `packages/web-kit/src/define-web-extension.ts`、`packages/ui/src/web-ext/contributions-controller.tsx` | 真实 agent 无 ui_rpc handler(待决项),只 stub 应答;新框架走服务端 provider,不依赖 agent |
| slash 通道 | `/` 命令经 `get_commands`→`GET /sessions/:id/commands` 真实可用 | `packages/server/src/http/routes/query-routes.ts:83`、`pi-session.ts:304` | slash 已工作,v1 不强拆为 provider(可选收敛) |
| 会话 cwd | 存于 session `header.cwd`,fs/sqlite store 均持久化 | `session-store/codec.ts`、`fs-store.ts`、`sqlite-store.ts` | file provider 与端点可据 `:id` 取 cwd |
| prompt 协议 | `PromptRequestSchema = { message, images? }`,无通用文件附件类型 | `packages/protocol/src/transport/rest-dto.ts:67` | 提交期 resolve:v1 文本直传(3a),v2 服务端内联(3b-inline),3b-attach 需扩协议(非目标) |
| 路由风格 | `/sessions/:id/*` 一排,经 `create-handler.ts` 注册;`requireSession(store, ctx)` 取会话 | `packages/server/src/http/create-handler.ts`、`routes/*.ts` | 新增 `/sessions/:id/completion*` 同款注册 |
| pi 原生扩展 | `registerCommand` 经 get_commands 可桥;`addAutocompleteProvider`/`registerShortcut` 是 pi-tui 绑定、无 web 桥 | pi SDK `core/extensions/types.d.ts` | autocomplete/mention 无原生 web 路,框架自建是正解 |
| trust 边界 | 仓库内 `.pi/`(含 examples)默认信任;cwd 经 pi-handler 注入 | `lib/app/pi-handler.ts`、`docs/pi-trust-loading-design.md` | file provider 复用同一 trust/cwd 边界 |

## 架构决策

- **D-1 服务端 provider 注册表(每 handler 单例)**:`file` 内置于 `createPiWebHandler`;app 层(`lib/app/pi-handler.ts`)可追加注册 `user`/`env` 示例。理由:provider 需访问服务端资源(FS/服务),且要拿 `CompletionCtx`(cwd/userId)——只能在服务端。
- **D-2 token 提取在前端、规则由服务端下发**:实时编辑需前端即时算 token range;服务端只下发"触发符 + 提取规则名(wordTail/lineStart)",前端按规则名执行。满足"新触发符零前端改动"(前端按数据驱动)。
- **D-3 归一化层**:全角/别名(＠→@、￥→$)在分发前规约,provider 只认规范符,接口不含数组。
- **D-4 合并/优先级**:统一排序键 `(priority desc, score desc, label asc)` + 按 kind 分组 + 同 `kind:id` 去重(高 priority 胜) + per-provider 超时降级。
- **D-5 提交期 resolve 在服务端**(messages 路由):v1 file.resolve 仅把 `@file:<path>` 规约为 `@<path>`(LLM 友好、零文件读);v2 再上 3b-inline。放服务端为 v2 文件读的安全留接缝。
- **D-6 触发符冲突优先级**:当 core 注册表对某触发符有 provider 时,core 补全浮层接管该符;遗留 webext `contributions.mention`(同符)被该符让位,避免双 `@` 浮层。非冲突触发符与现有行为不变(非回归)。

## 风险与缓解
- **R-1 大仓遍历慢** → cwd 文件清单 TTL 内存缓存 + 遍历上限 + 截断标示(Req 5.4/5.5)。
- **R-2 路径穿越/越权** → realpath 前缀断言 + 跳过 symlink 逃逸 + 鉴权(Req 6)。
- **R-3 慢 provider 拖垮整体** → per-provider 超时,返回就绪项(Req 4.3)。
- **R-4 破坏现有 slash/webext/prompt 回归** → core 浮层仅接管 core 注册的触发符;resolve 对无 token 消息零改动(Req 8.4);e2e 回归守门(Req 10.4)。

## 综合(build-vs-adopt / 简化)
- **复用** 现有 popover 交互与 token 检测思路,不重造下拉 UI。
- **泛化** 把"文件端点"上升为"provider 框架 + 通用端点",`file` 是首个实例(Req 9 可扩展性)。
- **简化 v1** resolve 走文本直传(3a),不动 prompt 协议;`user`/`env` 仅留 mock 证明可扩展。
