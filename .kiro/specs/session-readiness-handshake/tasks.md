# Implementation Plan

## 1. 协议层:session-status 帧(Foundation)

- [ ] 1.1 定义会话生命周期状态枚举与 session-status 控制帧,并入控制帧判别联合
  - 新增生命周期状态枚举:`initializing`、`ready`、`error`、`ended`,以及携带 `state` + 可选 `detail`/`code` 的会话状态控制帧形状
  - 把会话状态帧并入既有控制帧判别联合(以 `control` 为判别键),并对外导出新类型供前后端共用
  - 编写 schema 单测:四个枚举值均可解析、带/不带 detail/code 均合法、与既有控制帧子类型无判别冲突
  - **Observable**:`pnpm --filter @blksails/pi-web-protocol test` 通过且新增 schema 用例全绿
  - _Requirements: 2.3, 6.3_

## 2. 会话引擎:生命周期状态机 + 就绪探针(Core · server)

- [ ] 2.1 在会话中引入生命周期状态字段与唯一变更入口
  - 新增与通道活动态正交的生命周期态字段(默认 `initializing`),及唯一变更入口:更新状态并广播一帧会话状态
  - 变更入口实现单向幂等守卫:相同态或已处终态(非 restart)时不重复广播;暴露只读当前态
  - **Observable**:单测验证构造后为 `initializing`、变更入口广播一帧、重复变更不二次广播
  - _Requirements: 1.1, 1.2, 1.5, 5.3_
  - _Depends: 1.1_

- [ ] 2.2 发起只读就绪探针并以首条响应判定就绪
  - 构造末尾异步发起只读探针(列命令查询),其响应(含 error 响应)即驱动迁移为 `ready`;不阻塞构造
  - 配置化探针超时(默认常量),超时未响应则迁移为 `error` 且 code 为 `probe-timeout`;响应/超时后清理计时器
  - **Observable**:单测(mock 通道 + fake timers)验证探针 resolve→`ready`、超时→`error{probe-timeout}`、就绪后再响应不回拨
  - _Requirements: 1.3, 1.4, 4.1, 1.5_
  - _Depends: 2.1_

- [ ] 2.3 新订阅者订阅即回放当前生命周期状态(粘性)
  - 在既有日志回填之后,向**新订阅者**单独回放一帧当前会话状态,不广播给既有订阅者
  - **Observable**:单测验证"先就绪后订阅"的订阅者仍立即收到 `ready` 帧(核心防丢帧)
  - _Requirements: 2.1, 2.2, 2.4_
  - _Depends: 2.1_

- [ ] 2.4 进程退出与停止时的生命周期终态处理
  - 子进程在就绪前退出 → 迁移 `error` 且 code 为 `exit-before-ready`(不停留 `initializing`);就绪后退出 → `ended`
  - 进入停止流程/已停止 → 置对应终态并停止后续就绪迁移
  - **Observable**:单测验证就绪前早退→`error{exit-before-ready}`、就绪后退出→`ended`
  - _Requirements: 4.2, 5.2_
  - _Depends: 2.1_

- [ ] 2.5 runner 重启后重新执行就绪握手
  - 底层 runner 重启后将生命周期复位 `initializing`、广播之并重启探针(终态经 restart 显式复位是唯一允许的回退)
  - **Observable**:单测验证 restart 后状态回到 `initializing` 并再次发起探针、再次就绪
  - _Requirements: 5.1, 5.3_
  - _Depends: 2.1, 2.2_

## 3. 前端 control 链路:状态切片与流放行(Core · react)(P)

- [ ] 3.1 在 control store 中新增生命周期状态切片 (P)
  - 在控制快照中新增 `lifecycle` 切片(初始 `initializing` 作失败安全默认),消费会话状态帧时更新该切片且不影响其它切片引用稳定性
  - 编写单测:应用会话状态帧后切片更新、初始为 `initializing`、其它切片引用不变
  - **Observable**:`pnpm --filter @blksails/pi-web-react test` 通过且新增 control-store 用例全绿
  - _Requirements: 2.3, 3.1, 3.3_
  - _Boundary: ControlStore_
  - _Depends: 1.1_

- [ ] 3.2 空闲控制流放行会话状态帧 (P)
  - 扩展空闲控制流的帧过滤:在既有放行 ui-rpc 之外,额外放行会话状态帧并应用到 control store,其余帧仍丢弃(避免重复应用 ambient)
  - **Observable**:单测/手验确认空闲控制流下会话状态帧能更新 `lifecycle` 切片,ambient 帧不被重复应用
  - _Requirements: 2.1, 2.2_
  - _Boundary: SSE connection_
  - _Depends: 1.1_

## 4. 前端就绪门控接入(Integration · ui)

- [ ] 4.1 控制能力 hook 暴露生命周期状态
  - 在既有控制能力 hook 的返回结果中暴露 `lifecycle`(取自控制快照),供聊天界面派生就绪判断
  - **Observable**:聊天界面可读取到 `lifecycle.state` 并随帧更新
  - _Requirements: 3.1, 3.2_
  - _Depends: 3.1_

- [ ] 4.2 聊天界面就绪门控与就绪前/错误指示
  - 派生 `sessionReady`(状态为 `ready`);把"打开空闲控制流"的条件扩展为"未就绪时也打开"(仍受非忙碌门控),以在 mount 期接收粘性状态帧
  - 未就绪时禁用发送并显示"连接中"指示;错误态显示可理解失败提示且保持禁用;就绪后启用发送并移除指示;刷新/重订阅依回放的当前态重判
  - **Observable**:就绪前发送按钮禁用且呈现"连接中";收到 `ready` 后按钮启用;`error` 态呈现失败提示且仍禁用
  - _Requirements: 3.1, 3.2, 3.3, 4.3, 6.2_
  - _Depends: 4.1, 3.2, 2.3_

## 5. 验收与回归(Validation)

- [ ] 5.1 集成测试:真实子进程的就绪握手与粘性回放
  - 真 runner 子进程:创建会话后**延迟订阅**,验证仍收到 `session-status{ready}`(跨进程粘性回放,防丢帧)
  - 验证只读探针对真 agent 在空闲期可得到响应并驱动迁移为 `ready`
  - **Observable**:集成测试套件通过,延迟订阅用例稳定收到 `ready`
  - _Requirements: 1.3, 1.4, 2.4_
  - _Depends: 2.2, 2.3_

- [ ] 5.2 浏览器 e2e:门控全链路
  - 隔离 build 下:选源→打开会话→输入框初始禁用且显示"连接中"→就绪后输入启用→发送 prompt→收到流式回复
  - (可选)模拟探针不就绪→呈现错误提示且保持禁用
  - **Observable**:`pnpm e2e`(隔离 dist)对应用例通过,门控状态切换与流式回复均被断言
  - _Requirements: 3.1, 3.2, 4.3_
  - _Depends: 4.2_

- [ ] 5.3 回归校验:就绪后路径不变与旧客户端兼容
  - 验证会话就绪后 prompt/事件流/历史行为与改前一致(就绪后零回归)
  - 验证未消费会话状态帧的既有解析路径不被破坏(增量帧向后兼容)
  - 验证服务端未引入上行 prompt 队列/缓冲(过早发送仅由前端门控阻止)
  - **Observable**:`pnpm typecheck` 全绿 + 既有 server/react/app 测试套件无回归;代码审查确认无服务端 prompt 缓冲
  - _Requirements: 6.1, 6.2, 6.3_
  - _Depends: 4.2, 5.1_
