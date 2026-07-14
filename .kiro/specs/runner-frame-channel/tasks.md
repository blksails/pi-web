# Implementation Plan

## 1. Foundation:共享原语模块(frame-channel)

- [x] 1.1 声明流最小视图接口与集中 seam key 常量
  - 单一处声明可读/可写流的最小视图接口(替换四桥各自重复的四份声明)
  - 集中三个 globalThis seam key 常量(会话状态、surface 注册表、attachment 工具上下文),每个标注须与 tool-kit 侧常量一致
  - 可观测完成:新增类型/常量模块编译通过,导出流接口与三个 seam key,四桥后续可从单一来源引用
  - _Requirements: 7.1, 7.2_
  - _Boundary: stream-views, seam-keys_

- [x] 1.2 上行行 writer 原语与单测
  - 实现「写一行」原语:默认直写原始 fd1(绕 takeOverStdout),注入可写出口时改写注入(测试接缝)
  - 保证单次原子写出完整一行,不缓冲不拆分
  - 可观测完成:单测覆盖「注入出口捕获写出」与「默认路径经 mock 写 fd1 一次且含行尾换行」,全部通过
  - _Requirements: 2.1, 2.4, 2.5_
  - _Boundary: line-writer_
  - _Depends: 1.1_

- [x] 1.3 单一入站帧通道(router)与单测
  - 实现对 stdin 只挂一个 data 读取器、只维护一个 JSONL 行解析器(复用既有 rpc-channel 的行解析器,不另造)
  - 按帧 type 查注册表:未注册 type / 非 JSON / schema 失败一律不消费不回包不抛;匹配则派发 handler
  - 提供 handler 上下文,其唯一上行出口经 1.2 的 writer 发帧(handler 无从触碰进程 stdout);handler 抛错被 catch 记诊断不外泄
  - 支持注入替代 stdin/stdout/stderr;install 失败降级(installed:false)不抛;cleanup 卸载读取器并清空注册表,幂等
  - 可观测完成:单测覆盖注册→匹配派发、未注册放行(handler 不触发)、schema 失败丢弃、ctx.send 经注入出口捕获、多次 cleanup 幂等、install 失败降级、handler 抛错被吞
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.2, 2.3, 6.2, 7.4, 8.1_
  - _Boundary: frame-router_
  - _Depends: 1.1, 1.2_

- [x] 1.4 装配期声明帧原语、统一释放原语与单测
  - 实现装配期声明帧写出原语:默认经装配窗口 stdout(runRpcMode 之前),支持注入出口;空内容由调用方判定不发
  - 实现统一释放原语:遍历接线 cleanup,单个抛错记诊断并继续,支持同步与异步 cleanup,永不抛
  - 可观测完成:单测覆盖「声明帧注入捕获 + 空内容不发」与「一个 cleanup 抛错仍释放其余并记诊断」,全部通过
  - _Requirements: 3.1, 3.2, 3.3, 6.3_
  - _Boundary: assembly-frame, dispose_
  - _Depends: 1.1_

## 2. Core:四桥与 slash 声明迁移到帧通道

- [x] 2.1 (P) 迁移状态桥到帧通道
  - 改为向帧通道注册 piweb_state_set / piweb_state_delete 两类写回帧,handler 改动权威状态核
  - 出站变更订阅改为经帧通道统一 writer 发下行变更帧(键/值/rev/deleted 语义逐字不变)
  - seam provider 与 seam key 从集中来源引用;保留能力对象(含 store)与幂等 cleanup(解绑注册 + 退订 + 清 seam)
  - 适配该桥既有单测到新构造签名(注入通道 + fake stdin/stdout)
  - 可观测完成:该桥既有单测在新签名下全绿,断言写回改 store 且下行帧字段不变
  - _Requirements: 4.1, 4.5, 4.6, 6.1, 6.2_
  - _Boundary: state-wiring_
  - _Depends: 1.3_

- [x] 2.2 (P) 迁移 surface 桥到帧通道
  - 改为注册 ui_rpc 帧;handler 内保留二段匹配(point/action + surface 命令载荷校验),非 surface 命令(如带 name 的 host 命令)直接返回不回包(=放行)
  - 命中 surface 命令按 domain 派发并回送响应帧;未注册 domain 回 surface_not_registered;dispatch 抛错回 dispatch_failed
  - seam key 从集中来源引用;保留能力对象与幂等 cleanup
  - 适配该桥既有单测到新构造签名
  - 可观测完成:该桥既有单测全绿,覆盖合法命令派发/未注册 domain/非 surface ui_rpc 放行三态
  - _Requirements: 4.2, 4.5, 4.6, 6.1, 6.2_
  - _Boundary: surface-wiring_
  - _Depends: 1.3_

- [x] 2.3 (P) 迁移取回桥到帧通道
  - 改为注册 piweb_clear_queue 请求帧;handler 调当前绑定 session 的 clearQueue 并经通道 writer 回送结果帧(id/steering/followUp)
  - clearQueue 抛错时回空结果不吞语义;保留能力对象与幂等 cleanup
  - 适配该桥既有单测到新构造签名
  - 可观测完成:该桥既有单测全绿,覆盖正常取回与 clearQueue 抛错回空结果两态
  - _Requirements: 4.3, 4.5, 4.6, 6.1, 6.2_
  - _Boundary: clear-queue-wiring_
  - _Depends: 1.3_

- [x] 2.4 (P) 迁移 agent-routes 桥到帧通道
  - 空 routes 保持零声明帧、零注册、installed:false(存量 source 零行为变化)
  - 非空:经装配期声明帧原语发纯数据 agent_routes 声明帧(不含 handler 引用),并注册 piweb_agent_route_request 请求帧
  - handler 按 name 派发:未注册回 route_not_registered,handler 抛错回 handler_error,返回值不可序列化归一化为 handler_error;结果帧经通道 writer 回送
  - 适配该桥既有单测到新构造签名
  - 可观测完成:该桥既有单测全绿,覆盖空声明零帧、装配声明帧、请求派发与三类错误码归一化
  - _Requirements: 4.4, 4.5, 4.6, 6.1, 6.2_
  - _Boundary: agent-routes-wiring_
  - _Depends: 1.3, 1.4_

- [x] 2.5 (P) slash 声明帧改用装配期声明帧原语
  - slash 补全声明改为经装配期声明帧原语发出(无声明则不发帧,行为不变)
  - 可观测完成:slash 声明既有单测全绿,空声明不发帧
  - _Requirements: 3.2, 3.4_
  - _Boundary: slash-completions-wiring_
  - _Depends: 1.4_

## 3. Integration:runner 装配序与统一收尾

- [x] 3.1 在 runner 装配序中接入单一帧通道与统一释放
  - 在进入 RPC 模式之前创建唯一帧通道实例,注入四个入站桥;保持装配期声明帧(slash / routes)在 runRpcMode 之前完成写出
  - 会话收尾改为经统一释放原语一次性释放全部接线(含帧通道),消除原五段重复 try/catch;单点失败不中断收尾
  - attachment 与 session-title 两机制保持原装配方式,不接入帧通道、不依赖帧通道
  - 可观测完成:runner 以单一 stdin 读取器运行,四能力如常;SIGTERM/SIGINT/beforeExit 触发时全部接线被释放且单点抛错不阻断
  - _Requirements: 3.4, 5.1, 5.2, 5.3, 6.3, 6.4_
  - _Boundary: runner.ts_
  - _Depends: 2.1, 2.2, 2.3, 2.4, 2.5_

## 4. Validation:零行为变更回归与云等价

- [x] 4.1 server 单元测试全量回归
  - 运行 packages/server 全量单测(四桥既有测试 + 新增原语单测)
  - 可观测完成:测试套件全部通过,无因签名迁移遗留的失败
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 7.3, 9.1, 9.4_
  - _Depends: 3.1_

- [x] 4.2 e2e 回归与云等价路径验证
  - 运行浏览器 e2e(state 双向共享态 / surface 命令 / message-queue 取回 / agent 声明式路由四条关键路径)与 node e2e(真实子进程 runner 装配 + fd1 直写上行路径)
  - 确认自定义帧仍为纯 JSONL、每帧自包含,经真实子进程 fd1 路径抵达(与 ACS sandbox 全量行转发契约一致,无需改 pi-clouds)
  - 排除与本 spec 无关的既有已知失败
  - 可观测完成:相关 e2e 用例全绿;真实子进程上行帧经 fd1 被读到
  - _Requirements: 8.2, 8.3, 8.4, 9.2, 9.3_
  - _Depends: 3.1_

- [x] 4.3 零外部契约变更核验
  - 以 git diff 核对未新增/修改任何面向外部的帧 schema、CLI 参数或配置项;逐帧比对四桥帧构造与错误码不变
  - 可观测完成:diff 核验通过,无外部契约变更
  - _Requirements: 9.3_
  - _Depends: 3.1_
