# Implementation Plan — agent-slash-completion

## 1. 协议与声明基础

- [x] 1.1 protocol 新增 slash 候选声明与帧 schema (P)
  - 在 `packages/protocol/src/`(completion 域)新增 `SlashCompletionDeclSchema`(`name` / `description?` / `insertText?`)与 `SlashCompletionsFrameSchema`(`type:"slash_completions"` / `items[]`),导出 zod schema 与推断类型,经 protocol barrel 导出。
  - Done:`pnpm --filter @blksails/pi-web-protocol build`/typecheck 通过;`SlashCompletionDeclSchema.parse({name:"img-gen"})` 成功、缺 `name` 抛错;帧 schema 能 `safeParse` 一条 `{type:"slash_completions",items:[...]}`。
  - _Requirements: 1.1_
  - _Boundary: Protocol_

- [x] 1.2 AgentDefinition 增 slashCompletions 字段并经 loader 透传
  - `packages/agent-kit/src/types.ts` 与 `packages/server/src/runner/agent-definition.ts` 各加 `slashCompletions?: SlashCompletionDecl[]`(引用 1.1 类型);确认 `agent-loader.ts` 规范化时**保留**该字段(不被结构化 duck-type 丢弃)。
  - Done:`defineAgent({ slashCompletions:[{name:"x"}] })` 类型通过;为 loader 加/补一条单测断言加载后的定义保留 `slashCompletions`;`pnpm typecheck` 绿。
  - _Requirements: 1.1_
  - _Boundary: AgentKit+Runner_
  - _Depends: 1.1_

## 2. agent→server 装配期通道

- [x] 2.1 runner 装配期发送 slash_completions 帧
  - 新增 `packages/server/src/runner/slash-completions-wiring.ts` 的 `emitSlashCompletions(factory)`:空声明不写、非空 `process.stdout.write(JSON.stringify(frame)+"\n")`;在 `runner.ts` 的 `wireSessionTitlePersistence(...)`(:312)之后、`return runRpcMode(runtime)`(:328)之前调用。
  - Done:`emitSlashCompletions` 单测——空数组零写、非空写一行合法 JSONL 帧(mock stdout);`runner.ts` 调用点在 `runRpcMode` 之前。
  - _Requirements: 1.1, 1.3_
  - _Boundary: Runner_
  - _Depends: 1.1, 1.2_

- [x] 2.2 PiSession 接收并按会话缓存候选 (P)
  - `pi-session.ts` 加 `private slashCompletions` + `getSlashCompletions()`;在 `handleRawLine` 的 `if (this._status !== "active") return`(:406)**之前**用 `SlashCompletionsFrameSchema.safeParse` 识别该帧并缓存后 `return`;非法/其它行不受影响。
  - Done:单测——装配帧(session 尚未 active 时到达)被缓存且 `getSlashCompletions()` 返回其 items;非法帧被忽略、不影响既有 `ui_rpc_response` 处理。
  - _Requirements: 1.2, 4.1_
  - _Boundary: Session_
  - _Depends: 1.1_

## 3. 后端补全暴露

- [x] 3.1 agent-slash 补全 provider
  - 新增 `packages/server/src/completion/providers/agent-slash-provider.ts` 的 `createAgentSlashProvider(getSession)`:`trigger:"/"`、`extract:"lineStart"`、`kind:"agent-slash"`;`complete({query,ctx})` 经 `getSession(ctx.sessionId).getSlashCompletions()` 按 `name` 前缀过滤,映射为 `CompletionItem`(`label:"/"+name`、`insertText:insertText ?? "/"+name+" "`、`detail:description`)。
  - Done:单测——有声明会话按 query 前缀返回候选(含默认 insertText 推导);无声明/未知会话返回空数组。
  - _Requirements: 2.1, 4.1, 4.2_
  - _Boundary: Completion_
  - _Depends: 1.1, 2.2_

- [x] 3.2 create-handler 注册 agent-slash provider
  - `create-handler.ts` 在内置 provider 注册区(:79-91)追加 `completion.register(createAgentSlashProvider((id)=>store.get(id)))`,对齐 `store` 取 session 的实际 API。
  - Done:集成测试——`GET /sessions/:id/completion/triggers` 含 `/`;`GET …/completion?trigger=/&q=img` 对声明了候选的会话返回 `/img-gen`、对未声明会话返回空。
  - _Requirements: 2.1, 4.2_
  - _Boundary: Completion_
  - _Depends: 3.1_

## 4. AIGC 候选声明与示例接线

- [x] 4.1 tool-kit 导出 aigcSlashCompletions 常量 (P)
  - 新增 `packages/tool-kit/src/aigc/slash-completions.ts` 的 `aigcSlashCompletions`(`/img-gen`→image_generation、`/img-edit`→image_edit;纯数据、无 pi SDK 值导入),经 tool-kit **主入口**(非 `/runtime`)导出。
  - Done:`import { aigcSlashCompletions } from "@blksails/pi-web-tool-kit"` 可用且不引入 pi SDK 值导入(主入口 typecheck/构建绿);常量含两项且形状符合 `SlashCompletionDeclSchema`。
  - _Requirements: 6.1_
  - _Boundary: ToolKit_
  - _Depends: 1.1_

- [x] 4.2 示例 aigc-agent 声明候选
  - `examples/aigc-agent/index.ts` 的 `defineAgent` 增 `slashCompletions: aigcSlashCompletions`(system prompt 的 `/img-gen` `/img-edit` 用法已就位)。
  - Done:示例 typecheck 通过;真实子进程启动后该 agent 的会话经 `GET …/completion?trigger=/&q=img` 能取到两条候选(在 6.3 验证)。
  - _Requirements: 6.1, 6.3_
  - _Boundary: Example_
  - _Depends: 4.1, 1.2_

## 5. 前端 `/` 单浮层协调

- [x] 5.1 PiCommandPalette 并入伪命令候选并分流 select
  - `packages/ui/src/controls/pi-command-palette.tsx`:`open`(value 以 `/` 起)时新增 effect 拉 `client.getCompletion(sessionId,"/",query)`(参考 `extItems` 范式),混排进列表并视觉区分;`select()` 分流——伪命令候选 → `onChange(insertText)` **纯填入不执行**,真命令(`RpcSlashCommand`)→ 既有执行逻辑;按需在 `packages/react` client 暴露 `getCompletion`。
  - Done:敲 `/` 浮层同时含执行型命令与伪命令;选中伪命令仅改写输入框文本(无执行回调被触发),选中真命令仍执行;无双浮层并发。
  - _Requirements: 2.2, 2.3, 3.1, 3.2, 5.1, 5.2, 5.3_
  - _Boundary: UI_
  - _Depends: 3.2_

## 6. 测试与端到端验证

- [x] 6.1 后端单元/集成测试补齐
  - 覆盖:protocol schema(1.1)、PiSession 帧缓存与 active-gate 前识别(2.2)、provider 过滤与 gating(3.1)、`emitSlashCompletions` 写/不写(2.1)、completion 路由集成(3.2)。
  - Done:`pnpm --filter @blksails/pi-web-server test` 与 protocol 测试全绿,新增用例可见。
  - _Requirements: 1.1, 1.2, 2.1, 4.1, 7.3_
  - _Boundary: Tests_
  - _Depends: 2.1, 2.2, 3.2_

- [x] 6.2 前端分流单元测试
  - 测 `pi-command-palette` select 分流:伪命令 → 仅 `onChange`;真命令 → 执行回调;`getCompletion` 失败时伪命令置空不阻塞执行命令与输入。
  - Done:`pnpm test`(ui/app vitest)新增用例全绿。
  - _Requirements: 3.1, 3.2, 5.1, 5.3, 7.3_
  - _Boundary: Tests_
  - _Depends: 5.1_

- [x] 6.3 node e2e:真实子进程通道与 R1 验证
  - `pnpm e2e:node` 用例:启 aigc-agent(已声明候选)真实子进程 → 会话握手正常 + `GET …/completion?trigger=/&q=img` 返回 `/img-gen`/`/img-edit`,证明装配帧未破坏 RPC 流且端到端缓存到位。
  - Done:新增 node e2e 通过,新鲜运行输出显示候选返回且会话可正常对话(R1 排除)。
  - _Requirements: 6.1, 7.1, 7.2, 7.4_
  - _Boundary: Tests_
  - _Depends: 3.2, 4.2_

- [x] 6.4 浏览器 e2e:补全→填入→正常消息流 + gating A/B
  - `pnpm e2e`(隔离 build + stub,`PI_WEB_DISABLE_STANDALONE=1`):敲 `/` 出现 `/img-gen` → 选中 → 输入框得 `/img-gen `(未发送未执行)→ 补词提交 → 走正常消息流(stub)→ 工具卡/结果显示、刷新后历史载入;A/B——未声明候选的 agent 不出现 `/img-gen` 且 `/clear` 等执行命令仍正常。
  - Done:浏览器 e2e 通过,新鲜运行证据覆盖填入不执行、正常发送、gating、执行命令不破坏。
  - _Requirements: 2.2, 2.3, 3.1, 3.3, 4.1, 5.1, 6.2, 7.4_
  - _Boundary: Tests_
  - _Depends: 5.1, 3.2, 4.2_
