# Implementation Plan — rich-chat-ui

> 边界总览见 design.md「Boundary Commitments / File Structure Plan」。依赖方向:protocol → server / react → ui → app,只向左依赖。

- [ ] 1. Foundation:REST 薄透传(暴露已存在 RpcCommand)
- [x] 1.1 在协议包新增模型列表、fork、fork 消息三组 REST 传输契约
  - 复用既有 `Model` / `ImageContent` / entryId schema,新增"可用模型响应""fork 请求/响应""fork 消息响应"三组 zod 契约
  - 与 `RpcCommand` 中 `get_available_models` / `fork` / `get_fork_messages` 形状对齐
  - 观察完成态:协议包导出三组新契约且 `pnpm --filter @pi-web/protocol test typecheck` 通过(含三契约有效/无效负载解析单测)
  - _Requirements: 4.1, 4.5, 8.1, 8.2, 8.3_
  - _Boundary: Protocol REST DTO_

- [x] 1.2 在服务端会话与路由暴露三能力(镜像 set_model / commands 范本)
  - `PiSession` 新增三个透传方法,向底层 RpcChannel 发送对应 command 并解析返回
  - 注册路由:`GET /sessions/:id/models`、`POST /sessions/:id/fork`、`GET /sessions/:id/fork-messages`,沿用既有 `dataOrError` + `jsonResponse` + `error-map`
  - 观察完成态:三路由可经 handler 返回 200 + 协议契约负载,错误经既有 error-map 映射;不改既有路由与会话语义
  - _Requirements: 4.1, 8.1, 8.2, 8.3_
  - _Boundary: PiSession, Server HTTP routes_
  - _Depends: 1.1_

- [x] 1.3 在 react 客户端新增三能力 REST 方法
  - `PiClient` 新增 `getAvailableModels` / `fork` / `getForkMessages`,用协议契约解析响应;端点缺失(404)抛可识别错误供上层降级
  - 观察完成态:三方法的路径/HTTP 方法/响应解析单测通过,404 抛出可识别错误
  - _Requirements: 4.1, 8.1, 8.2, 8.3_
  - _Boundary: PiClient_
  - _Depends: 1.1_

- [x] 1.4 (P) 在传输层映射图片附件到 prompt
  - `PiTransport.sendMessages` 将消息携带的图片附件映射为 prompt 的 `images`;无附件时行为与现状一致
  - 观察完成态:transport 含/不含图片两路单测通过(含图片时请求负载带 `images`,不含时与现状一致)
  - _Requirements: 3.1, 3.2_
  - _Boundary: PiTransport_

- [ ] 2. Core:react 数据 hooks
- [x] 2.1 (P) 模型列表与切换 hook
  - 懒加载可用模型并按 provider 分组;经既有 setModel 切换并维护当前选中;空/报错时置 `available=false`
  - 模型项仅来自 `get_available_models`,不含任何写死项
  - 观察完成态:hook 在 mock client 下返回分组、`select` 触发 setModel、不可用时降级标志为真,单测通过
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Boundary: useModels_
  - _Depends: 1.3_

- [x] 2.2 (P) 图片附件状态 hook
  - 维护待发送图片附件列表(拖拽/粘贴/选择来源无关),仅接受图片类型,非图片记入 rejected;提供移除/清空与 base64→ImageContent 输出
  - 当会话/agent 不支持图片输入时置 `supported=false`
  - 观察完成态:mock 下添加图片入列、非图片进 rejected、`toImageContents` 产出正确编码,单测通过
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Boundary: useAttachments_

- [x] 2.3 (P) 消息分支 hook
  - 经 fork 创建同级版本,经 fork 消息加载分支序列并暴露"第 N/共 M"信息;`available=false` 时方法 no-op
  - 观察完成态:mock client 下 createBranch/select 调用正确端点、不可用时 no-op,单测通过
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Boundary: useBranches_
  - _Depends: 1.3_

- [x] 2.4 (P) 建议来源 hook
  - 合并 pi 命令(复用既有 getCommands/commands)与可配置预设为建议项;无命令且无预设时返回空
  - 观察完成态:mock controls 下 items 为命令∪预设、空源返回 [],单测通过
  - _Requirements: 10.1, 10.3_
  - _Boundary: useSuggestions_

- [ ] 3. Core:UI 元件层(无状态,主题走 shadcn CSS 变量,基本键盘/aria)
- [x] 3.1 (P) 会话滚动容器与自动滚动
  - 贴底时新内容/流式增量自动滚动;离底显示"回到底部"按钮(带 aria-label);点击平滑滚动并恢复自动滚动
  - 观察完成态:组件单测验证贴底自动滚动、离底显示按钮、点击回到底部三态
  - _Requirements: 7.1, 7.2, 7.3, 11.4, 11.5_
  - _Boundary: Conversation, useAutoScroll_

- [x] 3.2 (P) 状态化发送/停止按钮
  - 依 useChat 状态切换:ready→发送(仅有可发送内容时可用)、submitted/streaming→停止、error→错误态;停止态点击触发中断
  - 观察完成态:组件单测覆盖四态渲染与停止回调
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 1.3_
  - _Boundary: SubmitButton_

- [x] 3.3 (P) 富输入外壳
  - 多行文本框:Enter 提交、Shift+Enter 换行、空内容禁用提交;提供动作菜单与子控件插槽
  - 观察完成态:组件单测验证 Enter/Shift+Enter 行为与空内容禁用
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 11.5_
  - _Boundary: PromptInput_

- [x] 3.4 (P) 附件展示与拖拽/粘贴
  - dropzone + 粘贴 + 选择触发附件添加;chips 展示缩略图与移除按钮;非图片给"暂不支持"提示且不入列、不阻断发送;不支持图片输入时隐藏入口
  - 观察完成态:组件单测验证 chip 增删、非图片提示、不支持时隐藏
  - _Requirements: 3.1, 3.3, 3.4, 3.5, 11.4_
  - _Boundary: Attachments_
  - _Depends: 2.2_

- [x] 3.5 (P) 模型选择器(自定义轻量 popover)
  - button + 受控面板 + 点击外部/Esc 关闭;搜索框过滤 + provider 分组列表 + 选中勾选;`available=false` 时隐藏
  - 不渲染任何与 pi 无关的写死模型项
  - 观察完成态:组件单测验证打开/关闭、搜索过滤、选择触发回调、不可用隐藏与 aria-expanded
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 11.4_
  - _Boundary: ModelSelector_
  - _Depends: 2.1_

- [x] 3.6 (P) 语音输入按钮
  - feature-detect Web Speech;讲话转写追加到输入,再次点击停止并保留文本;不支持或拒权时隐藏/禁用并给可读提示
  - 观察完成态:组件单测在 mock SpeechRecognition 下验证转写填入与不支持降级
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 11.4_
  - _Boundary: SpeechInput_

- [x] 3.7 (P) 联网开关
  - 受控开关默认关闭,切换持久化于当前输入会话并反映于 UI
  - 观察完成态:组件单测验证默认关闭与切换状态回传
  - _Requirements: 6.1, 6.2, 11.5_
  - _Boundary: WebSearchToggle_

- [x] 3.8 (P) 引用来源折叠组件(无状态)
  - 可折叠来源区块默认折叠;接收来源数据展示,无来源不渲染(渲染器注册接线归装配任务 4.1)
  - 观察完成态:组件单测验证有来源时折叠/展开、无来源不渲染
  - _Requirements: 9.3, 9.4_
  - _Boundary: Sources_

- [x] 3.9 (P) 建议气泡
  - 气泡列表展示建议项;点击按模式填入输入或直接发送;无建议时不渲染区域
  - 观察完成态:组件单测验证点击填入/发送与空态不渲染
  - _Requirements: 10.1, 10.2, 10.3, 11.4_
  - _Boundary: Suggestions_
  - _Depends: 2.4_

- [ ] 3.10 (P) 消息气泡与分支切换控件
  - 消息气泡布局;存在多版本时渲染"‹ N/M ›"分支控件并触发切换;无多版本或分支不可用时不渲染控件
  - 观察完成态:组件单测验证多版本显示控件、单版本/不可用隐藏、切换回调
  - _Requirements: 8.1, 8.3, 8.4, 11.4_
  - _Boundary: Message_
  - _Depends: 2.3_

- [ ] 4. Integration:富装配与 app 接入
- [ ] 4.1 装配富聊天组件 PiChatPro
  - 用会话 transport 驱动 useChat,组合上述元件与 useModels/useAttachments/useBranches/useSuggestions;复用 PartRenderer/PiReasoning/PiToolPart 与渲染器注册表;停止态按钮接线到 `usePiControls.abort` + useChat stop(2.3);经注册表注册 source 类 data-part 渲染器(承接 3.8 的 Sources 组件);联网开关意图随消息传达(pi 无能力时仅作提示,不报错);思考折叠复用既有 PiReasoning
  - 观察完成态:`<PiChatPro>` 可渲染完整富界面并发送一条带文本(可含图片)的消息;停止态点击触发中断;组件冒烟测试通过
  - _Requirements: 1.1, 1.5, 2.3, 6.3, 6.4, 9.1, 9.2, 11.1_
  - _Boundary: PiChatPro_
  - _Depends: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

- [ ] 4.2 导出新组件与 hooks
  - ui 包导出 `PiChatPro` 与元件层;react 包导出四个新 hooks;保留现有 `<PiChat>` 导出不变
  - 观察完成态:外部可从 `@pi-web/ui` / `@pi-web/react` 导入新符号,两包 typecheck 通过
  - _Requirements: 11.1_
  - _Boundary: ui index, react index_
  - _Depends: 4.1_

- [ ] 4.3 app-shell 切换到 PiChatPro
  - 根 app 的 chat 组件渲染 `<PiChatPro>` 取代 `<PiChat>`,沿用 `~/.pi/agent` 配置与现有会话装配
  - 观察完成态:本地启动后默认聊天界面为富版本并可完成一次基本对话
  - _Requirements: 11.3_
  - _Boundary: app chat-app_
  - _Depends: 4.2_

- [ ] 5. Validation:集成、端到端与基线回归
- [ ] 5.1 (P) 服务端透传集成测试
  - 验证三个 `PiSession` 透传方法经 RpcChannel(mock)发送正确 command 并解析;三路由的请求校验、成功响应与错误映射
  - 观察完成态:`pnpm --filter @pi-web/server test` 通过且覆盖三能力的成功与错误路径
  - _Requirements: 4.1, 8.1, 8.2, 8.3_
  - _Boundary: PiSession, Server HTTP routes_
  - _Depends: 1.2_

- [ ] 5.2 (P) PiChatPro 组件集成测试
  - 用 testing-library + jsdom 与 mock hooks 验证:提交文本、附件 chip 增删、模型选择器打开/搜索/选择、建议点击、SubmitButton 随状态切换(含停止触发中断)、分支控件出现/切换、思考折叠随流式增量更新、来源折叠
  - 观察完成态:组件集成测试通过,覆盖各富交互的可观察结果(含 reasoning 流式增量断言)
  - _Requirements: 1.2, 2.1, 2.3, 3.1, 4.2, 7.1, 8.1, 9.1, 9.2, 9.3, 10.2, 11.4_
  - _Boundary: PiChatPro_
  - _Depends: 4.1_

- [ ] 5.3 浏览器端到端测试
  - 新增 e2e 用例(用 `~/.pi/agent` 真实配置):基本对话(输入→发送→流式回复)、模型选择器(分组来自 get_available_models→搜索→选择→切换)、附件(图片成 chip→发送请求含 images;非图片提示不入列)、建议气泡点击;分支若会话支持则验证切换,否则断言控件隐藏(降级)
  - 观察完成态:`pnpm e2e` 中该用例通过,完成一次端到端富对话
  - _Requirements: 3.2, 4.3, 8.4, 10.2, 11.3_
  - _Boundary: e2e_
  - _Depends: 4.3_

- [ ] 5.4 基线回归与类型检查
  - 运行全量 `pnpm test` 与 `pnpm typecheck`,确认基线测试无回归、无类型错误,主题继承 CSS 变量未引入硬编码
  - 观察完成态:全量测试与 typecheck 全绿,基线 483 测试 + 新增测试均通过
  - _Requirements: 11.2, 11.5_
  - _Depends: 5.1, 5.2, 5.3_

## Implementation Notes
- 2.3: useBranches.select 会 getForkMessages 但当前未对外暴露 messages;任务 4.1 装配分支视图刷新时,需扩展 useBranches 暴露已加载分支消息(或在 PiChatPro 中处理),以满足 Req 8.3「更新对话视图」。e2e 5.3 验证分支切换确实刷新视图。
- 2.4: useSuggestions 不自动触发 getCommands;任务 4.1 装配 PiChatPro 时须调用 controls.getCommands() 以填充 commands 状态,建议气泡方能显示(Req 10.1)。
