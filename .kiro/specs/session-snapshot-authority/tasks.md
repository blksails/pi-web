# Implementation Plan

> 按 design.md 的四步迁移组织,每步独立可上线可回退,末尾为整体回归与兼容验收。
> 依赖方向 protocol → server → react → ui。任务顺序即默认依赖。

- [x] 1. STEP1 — 服务端权威会话快照与 busy
- [x] 1.1 定义 session-state 帧与会话快照协议
  - 在协议层新增「会话快照」结构（lifecycle/busy/turn/stats/model/title）与 `control:"session-state"` 帧负载，并入既有 control 帧判别联合
  - 提供帧便捷构造与类型导出；保证旧消费者遇到未知帧走 default 分支安全忽略
  - 完成态：协议包可构造并校验一个 session-state 帧，且既有帧 schema 单测全绿、未识别帧不抛错
  - _Requirements: 1.1, 1.2, 8.2_
  - _Boundary: protocol/transport_

- [x] 1.2 实现会话快照纯归约函数
  - 实现 `reduceSnapshot(prev, event)`：轮次开始置忙、轮次结束（正常/中止/错误）置闲、无关事件不改忙碌；轮次开始注入 startedAt
  - 不读全局时钟、无副作用，相同事件序列恒等输出
  - 完成态：单测覆盖「agent_start→busy true」「agent_end/abort/error→busy false」「扩展命令序列（无 agent_start）busy 恒 false」「未知事件返回原态」四类断言全绿
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 7.1_
  - _Boundary: server/session reduce-snapshot_

- [x] 1.3 PiSession 持有、归约并广播权威快照
  - 新增权威快照字段与 `setSnapshot(patch)`（合并→广播 session-state 帧）；接收 agent 事件时经纯归约更新；生命周期变更与 stats 刷新时同步快照
  - 提供「不发起额外 RPC 即可同步读取当前快照」的读路径；REST 读取与快照同源
  - 完成态：触发一轮 agent 事件后，订阅 `/stream` 能依次收到 busy=true / busy=false 的 session-state 帧，且任一时刻「最近广播快照」等于服务端当前权威状态
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 3.1, 3.4_
  - _Depends: 1.1, 1.2_
  - _Boundary: server/session PiSession_

- [x] 1.4 STEP1 验收：reducer 单测 + 扩展命令不卡死 node e2e
  - 复用 `PI_WEB_STUB_AGENT=1` 离线 e2e：发普通 prompt 后 busy 回落 false；模拟扩展命令路径后 busy 不进入永久 true
  - 完成态：新增 node e2e 用例通过，断言收到 busy=false 的 session-state 帧且会话保持可发送
  - _Requirements: 2.3, 7.3_
  - _Depends: 1.3_

- [x] 2. STEP2 — 泛化粘性回放
- [x] 2.1 实现 last-value 粘性帧注册表
  - 实现按键覆盖 last-value 的注册表与「向新订阅者重放全部」能力；同键多次写入仅留最新
  - 完成态：单测覆盖 set 覆盖、replayInto 按序重放、多键并存、同键仅留最新四项全绿
  - _Requirements: 4.2, 4.4_
  - _Boundary: server/session sticky-registry_

- [x] 2.2 用注册表收口 subscribe 的回放
  - 将 PiSession 订阅时硬编码的生命周期/快照回放改为经注册表统一重放；保留 logs 环形缓冲回放；新增可重放状态仅需注册键
  - 完成态：晚订阅者订阅后立即收到当前 session-state 与 lifecycle，且新增一种可重放态无需改订阅核心流程
  - _Requirements: 4.1, 4.2, 4.3_
  - _Depends: 2.1, 1.3_
  - _Boundary: server/session PiSession_

- [x] 2.3 STEP2 验收：晚订阅回放收敛 node e2e
  - 离线 e2e：先驱动状态变更，再发起 `/stream` 订阅，断言迟到订阅者收敛到当前权威 session-state
  - 完成态：新增 node e2e 用例通过，迟到订阅首批帧即含最新 busy/lifecycle
  - _Requirements: 4.1, 4.3, 7.3_
  - _Depends: 2.2_

- [x] 3. STEP3 — 前端纯投影
- [x] 3.1 ControlStore 吸收 session-state 成为权威投影
  - 控制面快照新增「会话权威投影」与 busy 字段；收到 session-state 帧时据快照同步内部 lifecycle/stats，使存量读者零改动即受益
  - 保持无变更不换引用的稳定性不变式
  - 完成态：单测断言 apply session-state 后 busy/会话投影/lifecycle/stats 同步正确，且无关帧不改变引用
  - _Requirements: 3.2, 5.1_
  - _Depends: 1.1_
  - _Boundary: react/sse control-store_

- [x] 3.2 控制 hook 暴露权威 busy 与会话投影
  - 控制 hook 暴露 busy 与会话权威投影；统计不再合并独立 REST 来源，仅保留首屏一次性读取
  - 完成态：hook 返回的 busy/stats 来自权威投影，移除轮次结束的轮询触发
  - _Requirements: 3.2, 3.3, 5.1_
  - _Depends: 3.1_
  - _Boundary: react/hooks use-pi-controls_

- [x] 3.3 PiChat 派生改读权威快照
  - isBusy/stats/ready/canSubmit 改由权威投影派生；删除基于消息流 status 的忙碌时序推断与 stats 轮询；useChat 仅用于 messages 渲染
  - 保留就绪前空闲控制流门控；无 session-state 帧时 isBusy 安全回退到兼容路径（回退安全）
  - 完成态：busy 锚点（data-pi-busy）随权威 busy 变化；移除轮询后 stats 仍随快照更新；既有就绪/空闲控制流回归不破
  - _Requirements: 5.2, 5.3, 5.4, 8.4_
  - _Depends: 3.2_
  - _Boundary: ui/chat pi-chat_

- [x] 3.4 STEP3 验收：投影单测 + busy 态 browser e2e
  - jsdom 组件单测：给定会话权威投影快照，断言 isBusy/stats/canSubmit 派生正确（project 纯函数）
  - Playwright：真实管线发消息→收完→断言 `data-pi-busy="false"`；晚订阅/重连后 busy 与就绪态正确
  - 完成态：新增组件单测与浏览器 e2e 用例全绿
  - _Requirements: 5.2, 7.2, 7.4_
  - _Depends: 3.3_

- [x] 4. STEP4 — 闭合协议契约
- [x] 4.1 (P) 建立 data-part 类型单一真相源
  - 提取 data-part 类型注册表（kind→{schema, 服务端事件映射}），并把 kind 暴露为受检类型，消除散落字符串字面量
  - 完成态：注册表登记全部既有 data-part kind，拼错 kind 在类型检查阶段报错
  - _Requirements: 6.1, 6.2_
  - _Boundary: protocol/transport part-kinds_

- [x] 4.2 服务端翻译遍历单一真相源
  - 事件→data-part 帧的翻译改为基于单一真相源驱动，保证不漏翻译任一已登记 kind
  - 完成态：翻译路径不再含逐 kind 手写分支遗漏；既有翻译单测全绿
  - _Requirements: 6.3_
  - _Depends: 4.1_
  - _Boundary: server/session translate-event_

- [x] 4.3 前端渲染器注册遍历单一真相源
  - data-part 渲染器注册改为遍历单一真相源，保证不漏注册任一已登记 kind
  - 完成态：注册逻辑由真相源驱动；既有渲染单测全绿、无孤儿降级
  - _Requirements: 6.4_
  - _Depends: 4.1_
  - _Boundary: ui/chat pi-chat 渲染器注册_

- [x] 4.4 契约测试断言无孤儿
  - 新增契约测试，遍历单一真相源断言每个 kind 均存在服务端映射与前端渲染器
  - 完成态：契约测试通过；人为去掉某 kind 的渲染器或映射时该测试失败（负向自检）
  - _Requirements: 6.5_
  - _Depends: 4.2, 4.3_
  - _Boundary: protocol/ui 契约测试_

- [x] 5. 整体回归与向后兼容验收
- [x] 5.1 全量单测与 e2e 回归
  - 运行各包 vitest、node e2e、浏览器 e2e 全套，修复改造引入的回归
  - 完成态：既有 + 新增全部测试通过，无回归
  - _Requirements: 7.5_
  - _Depends: 3.4, 4.4_

- [x] 5.2 向后兼容与回退验收
  - 验证 session-state 为新增帧、旧消费者忽略不报错；过渡期 session-status/stats/logs 帧与既有 REST 端点仍可用；任一步回退后退回该步前可工作状态
  - 完成态：兼容性用例通过（含「无 session-state 帧时前端回退兼容路径」）
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Depends: 5.1_
