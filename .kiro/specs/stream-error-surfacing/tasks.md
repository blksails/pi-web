# Implementation Plan

- [ ] 1. 服务端翻译层:终态错误与真实文案
- [x] 1.1 在 agent_end 增加终态错误/中止检测与真实文案翻译
  - 从 `agent_end.messages` 末尾取最近的 assistant 消息;`willRetry===false` 且其 `stopReason==="error"` → 产出携带真实 `errorMessage`(缺省用回退常量)的用户可见错误信号;`stopReason==="aborted"` → 产出中止信号;其余(`stop`/`length`/`toolUse`、末项非 assistant)→ 维持现有正常结束翻译
  - 产出错误/中止信号前关闭悬挂的 text/reasoning part(已开始流式后失败仍妥善收尾)
  - `willRetry===true` 维持现状(重试反馈由既有 auto-retry 数据部件承载)
  - 完成判据:对 error/aborted/正常 三类 agent_end 输入产出对应的"错误/中止/正常结束"帧,error 帧文本等于消息的真实 `errorMessage`;`tsc --noEmit`(server)通过,无 any
  - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.2, 3.2, 3.3, 4.1, 4.3, 5.1, 5.2_
- [x] 1.2 在 message_update 错误子事件中透传真实错误信息
  - `reason==="error"` 时用子事件携带的真实 `errorMessage`(缺省用回退常量)取代硬编码文案;`reason==="aborted"` 维持中止翻译
  - 完成判据:对带 `errorMessage` 的错误子事件,产出的错误帧文本为该真实信息而非恒定占位
  - _Requirements: 2.3, 4.1_
  - _Depends: 1.1_
- [x] 1.3 为翻译层错误/中止/重试/成功补充单元测试
  - 覆盖:终态错误产出携真实文案的错误帧、`errorMessage` 缺省时用回退、中止产出中止帧而非错误、`willRetry===true` 与 `stopReason==="stop"`/末项 toolResult 维持正常结束、已开启 text part 时失败先收尾、message_update 错误子事件透传真实文案与中止分支、auto-retry 事件仍产出重试反馈帧
  - 完成判据:`pnpm --filter @pi-web/server test`(翻译层相关)新增用例全绿;既有表驱动用例不回归(新鲜运行输出)
  - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.3, 5.1, 5.2, 5.4_
  - _Depends: 1.2_

- [ ] 2. 前端:错误呈现
- [x] 2.1 新增无状态错误提示元件并从 UI 包导出 (P)
  - 新增展示型元件:接收错误信息文本,空则不渲染,非空以 destructive 配色 + `role="alert"` 展示文本(允许必要截断,不替换为无意义占位);从 `@pi-web/ui` 导出
  - 完成判据:元件单测覆盖"空→不渲染""非空→alert 角色+文本";`tsc --noEmit`(ui)通过
  - _Requirements: 1.2, 2.4, 4.2_
  - _Boundary: packages/ui/src/elements/chat-error.tsx_
- [x] 2.2 在 pi-chat 接线 useChat 错误态到错误元件
  - 从 `useChat` 取错误态(`error`/`status`),把错误信息传入错误元件并接入既有布局;中止态不进入错误呈现
  - 完成判据:错误态存在时渲染错误元件且文本为错误信息;无错误/中止态时不渲染;`tsc --noEmit`(ui)通过
  - _Requirements: 1.2, 4.2_
  - _Depends: 2.1_
- [x] 2.3 为前端错误呈现补充组件测试(含部分消息保留验证)
  - 当会话处于错误态时断言:渲染错误元件且文本为错误信息;此前已渲染的助手消息内容仍可见(验证错误信号不丢弃部分消息);无错误态/中止态时不渲染错误
  - 完成判据:`pnpm --filter @pi-web/ui test`(pi-chat 相关)新增用例全绿(新鲜运行输出)
  - _Requirements: 1.2, 1.4, 2.4, 4.2, 5.4_
  - _Depends: 2.2_

- [ ] 3. 集成回归
- [x] 3.1 全量回归与类型校验
  - 运行 `@pi-web/server` 与 `@pi-web/ui` 全量测试 + 两包 `tsc --noEmit`,确认正常对话与其它事件翻译不回归
  - 完成判据:两包 `test` 与 `typecheck` 均以新鲜运行输出证明通过
  - _Requirements: 5.1, 5.2, 5.4_
  - _Depends: 1.3, 2.3_

## Notes
- 风险 R-1(AI SDK 错误信号是否丢弃已流式的部分助手消息)由任务 2.3 的"部分消息仍可见"断言强制验证;若证伪,停下回到设计修订(降级为内联数据部件方案)。
