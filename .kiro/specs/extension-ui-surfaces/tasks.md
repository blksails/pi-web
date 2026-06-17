# Implementation Plan — extension-ui-surfaces

> 边界总览见 design.md「Boundary Commitments / File Structure Plan」。依赖方向 protocol → react → ui → app,只向左依赖。零协议/server 改动。

- [ ] 1. Foundation:react 数据层(ambient 分流 + hook 暴露)
- [x] 1.1 ControlStore 推送类分流为 ambient 状态
  - 在控制旁路 store 的快照中新增 ambient 切片:通知列表、键控状态映射、键控 widget 映射、会话标题、写入输入框的一次性信号(含单调递增计数)
  - 入帧分流:`notify` 追加通知并归一通知级别;`setStatus` 置/替换键,文本未提供即删该键;`setWidget` 置/替换键(归一放置位),行未提供即删该键;`setTitle` 置/替换标题;`set_editor_text` 写入文本并自增计数
  - 交互类四方法仍按原样进入对话框 FIFO 队列,推送类绝不进入该队列;新增按 id 移除通知的方法;通知列表设软上限防御增长
  - 观察完成态:`pnpm --filter @pi-web/react typecheck` 通过;给定五类推送帧后快照对应切片正确变化(置/替换/删除/计数),且交互类帧仍只进队列(由 1.1 自带或 4.1 单测断言)
  - _Requirements: 1.1, 1.2, 1.5, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 5.1, 5.2, 6.1, 6.3_
  - _Boundary: ControlStore_

- [x] 1.2 useExtensionUI 暴露 ambient 状态并导出类型
  - 从快照读出通知/状态/widget/标题/写入信号并入 hook 返回值(纯增字段,向后兼容);提供移除通知操作委托 store;推送类不调用 uiResponse
  - 无连接时 ambient 字段回落为空、移除操作为 no-op;react 包导出新增 ambient 类型
  - 观察完成态:`pnpm --filter @pi-web/react test typecheck` 通过;外部可从 `@pi-web/react` 导入新 ambient 类型与扩展后的结果类型
  - _Requirements: 1.4, 6.2, 6.3_
  - _Boundary: useExtensionUI, react index_
  - _Depends: 1.1_

- [ ] 2. Core:UI 无状态展示元件(主题走 shadcn CSS 变量,基本键盘/aria)
- [x] 2.1 (P) 通知浮层元件(Notifications/toasts)
  - 堆叠展示通知,按级别(info/warning/error)以 CSS 变量配色;每条挂载后定时自动消失并支持手动关闭(均回调移除)
  - error 用 alert 角色、info/warning 用 status 角色;关闭按钮带 aria-label;空列表不渲染
  - 观察完成态:组件单测验证空态不渲染、多条堆叠并存、手动关闭与自动消失(fake timers)各触发移除回调、级别对应角色与样式
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 8.1, 8.2_
  - _Boundary: Notifications_
  - _Depends: 1.1_

- [x] 2.2 (P) 状态条元件(StatusBar)
  - 并列展示键控状态项(小 pill),键序稳定;空状态不渲染
  - 观察完成态:组件单测验证空态不渲染、多键并列、键序稳定、主题经 CSS 变量
  - _Requirements: 2.1, 2.4, 2.5, 8.1_
  - _Boundary: StatusBar_
  - _Depends: 1.1_

- [x] 2.3 (P) Widget 区元件(Widgets)
  - 按放置位(上方/下方)筛选并逐行渲染 widget 文本;无匹配项不渲染
  - 观察完成态:组件单测验证空/无匹配 placement 不渲染、仅渲染匹配 placement、多行渲染、主题经 CSS 变量
  - _Requirements: 3.1, 3.2, 3.5, 8.1_
  - _Boundary: Widgets_
  - _Depends: 1.1_

- [ ] 3. Integration:PiChat 收敛与 ambient 接线
- [x] 3.1 富组件收敛为默认 PiChat,最小组件改名,保留废弃别名
  - 富聊天组件成为默认导出 `PiChat`;原最小组件以 `PiChatBasic` 非破坏保留;保留 `PiChatPro` 作为指向新 `PiChat` 的废弃别名(带 deprecated 说明)
  - 更新组件库索引导出三者;迁移既有富组件测试以新名引用
  - 观察完成态:`pnpm --filter @pi-web/ui test typecheck` 通过;可从 `@pi-web/ui` 导入 `PiChat`(富)/`PiChatBasic`(最小)/`PiChatPro`(别名),三者渲染不报错
  - _Requirements: 7.1, 7.2, 7.3_
  - _Boundary: pi-chat chat module, ui index_

- [x] 3.2 PiChat 装配渲染 ambient 面并接线 title/editorText
  - 渲染通知浮层(叠加层)+ 状态条与扩展标题(内部头部)+ widget 区(输入框上/下方,空态与会话态共用);把键控 widget 映射派生为数组传入元件
  - 写入输入框:监听一次性信号计数变化时把输入框内容设为该文本;仅在收到推送时写入,不改写用户后续编辑;无 extensionUI 时各面不渲染(降级)
  - 观察完成态:集成测试注入五类推送帧后各面在 PiChat 中可见(通知/状态/widget/标题渲染、输入框被写入);新文本以最新为准
  - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 6.1, 8.4_
  - _Boundary: PiChat_
  - _Depends: 1.2, 2.1, 2.2, 2.3, 3.1_

- [x] 3.3 app-shell 装配点切换到默认 PiChat
  - 应用聊天装配点导入由旧富组件名切换为默认 `PiChat`,沿用既有会话装配与 extensionUI 注入
  - 观察完成态:本地启动后默认聊天界面为富版本并可完成一次基本对话
  - _Requirements: 7.4_
  - _Boundary: app chat 装配点_
  - _Depends: 3.1_

- [ ] 4. Validation:单测、集成、端到端与基线回归
- [x] 4.1 (P) ControlStore 分流单测
  - 验证五类推送帧 → 对应 ambient 切片(通知追加+级别归一+堆叠、状态置/替换/删、widget 置/替换/删+placement 归一、标题置/替换、写入信号计数单调递增);交互类四方法仍入对话框队列且不进 ambient;推送类不进队列(防阻塞回归);移除通知与软上限生效
  - 观察完成态:`pnpm --filter @pi-web/react test` 通过且覆盖上述分支
  - _Requirements: 1.1, 1.2, 1.5, 2.1, 2.2, 2.3, 3.1, 3.3, 3.4, 4.1, 4.2, 5.1, 5.2, 6.1, 6.3_
  - _Boundary: ControlStore test_
  - _Depends: 1.1_

- [x] 4.2 (P) 三个展示元件单测
  - 覆盖 Notifications/StatusBar/Widgets 的空态不渲染、增删、级别配色与角色、placement 过滤、自动消失/手动关闭、键序稳定、CSS 变量主题
  - 观察完成态:`pnpm --filter @pi-web/ui test` 中三元件用例通过
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 2.1, 2.4, 2.5, 3.1, 3.2, 3.5, 8.1, 8.2_
  - _Boundary: elements test_
  - _Depends: 2.1, 2.2, 2.3_

- [x] 4.3 PiChat 集成测试(渲染面 + 不阻塞 + 收敛)
  - 用 mock extensionUI 注入推送态:各面渲染、标题进头部、输入框被写入(最新优先);推送类与交互类同时存在时权限对话框仍弹出(队列未被阻塞);`PiChat`=富、`PiChatBasic` 可渲染、`PiChatPro` 别名等价
  - 观察完成态:`pnpm --filter @pi-web/ui test` 中 PiChat 集成用例通过,覆盖各面与不阻塞断言
  - _Requirements: 4.1, 5.1, 5.2, 6.1, 6.2, 6.4, 7.1, 7.2, 7.3, 8.4_
  - _Boundary: PiChat test_
  - _Depends: 3.2_

- [x] 4.4 浏览器端到端验证(确定性 stub 发推送帧)
  - 确定性 stub 在权限(confirm)帧之前增发 notify/setStatus/setWidget/setTitle/set_editor_text 帧;e2e 断言 toast 文本、状态项、widget 行、头部标题、输入框文本均出现,且 confirm 对话框随后仍可见并可应答(证明未被推送阻塞)
  - 观察完成态:`pnpm e2e` 中该用例通过,完成"推送呈现 + 交互不阻塞"闭环
  - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.2_
  - _Boundary: e2e, stub-agent-process_
  - _Depends: 3.3_

- [ ] 4.5 基线回归与类型检查
  - 运行全量 `pnpm test` 与 `pnpm typecheck`,确认无回归、无类型错误,无硬编码颜色、无 any
  - 观察完成态:全量测试与 typecheck 全绿,既有基线用例与新增用例均通过
  - _Requirements: 8.3_
  - _Depends: 4.1, 4.2, 4.3, 4.4_

## Implementation Notes
- 1.1:`set_editor_text` 用 `{text, seq}` 一次性信号,装配层据 seq 变化触发一次 setInput(Req 5.2/5.4);statuses/widgets 删除语义经 `undefined` 表达(Req 2.3/3.4)。
- 3.1:收敛改名涉及文件移动(最小→PiChatBasic、富→PiChat、新建别名文件);仓库内 PiChatPro 无包内引用,影响集中在 ui index 与 app 装配点。
- 3.2:widget 区在空态与会话态两分支共用,抽到包裹输入框的小片段以免重复;通知浮层需容器根 relative 定位。
- 1.2 连带:`UseExtensionUIResult` 新增必填 ambient 字段后,ui 包共享夹具 `packages/ui/test/fixtures/mock-session.ts` 的 extensionUI mock 需提供 ambient 默认值(空数组/空对象/undefined + dismissNotification no-op),否则 `pnpm --filter @pi-web/ui typecheck` 会红。已在 ui 元件任务前由父统一修复夹具。
