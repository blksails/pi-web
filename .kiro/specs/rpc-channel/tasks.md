# Implementation Plan

- [ ] 1. 基础设施:模块骨架、协议类型接线与测试运行器
- [ ] 1.1 接通上游协议类型并搭建测试运行器
  - 在模块中接入 `@pi-web/protocol` 导出的命令/响应/事件/扩展 UI 类型以及 `SpawnSpec`,确认可被 import 且 strict 编译通过(不重定义任何协议类型或 `SpawnSpec`)
  - 配置 `vitest`,使单一命令 `vitest run` 能发现并运行后续全部测试目录
  - 观察完成条件:`vitest run` 在空测试集下成功退出,且一个引用 `@pi-web/protocol` 类型的占位文件通过 `tsc --noEmit`
  - _Requirements: 5.3, 7.6_

- [ ] 1.2 定义传输无关通道端口与输入契约类型
  - 声明 `PiRpcChannel` 接口(发送一行、订阅行、关闭、健康查询)与 `ChannelHealth` 形状
  - `SpawnSpec`(命令/参数/cwd/env)不在本模块定义,而是 `import type { SpawnSpec } from "@pi-web/protocol"`(protocol-contract 拥有并导出,单一事实来源);确认其字段为 `{ cmd, args, cwd, env }`
  - 确保接口签名不出现任何子进程/管道/流的专有类型
  - 观察完成条件:端口接口与类型文件通过 strict 编译;`SpawnSpec` 解析自 `@pi-web/protocol` 而非本地声明;一个最小 mock 实现该接口即可编译,无需任何 Node 进程类型
  - _Requirements: 1.1, 1.3, 1.5, 6.4_
  - _Boundary: PiRpcChannel_

- [ ] 2. 核心:JSONL 成帧
- [ ] 2.1 实现协议正确的增量 JSONL reader
  - 仅以 `\n` 切行、剥离尾随 `\r`、缓冲跨 chunk 不完整行、单 chunk 多行按序输出、跳过空行、保留行内 `U+2028`/`U+2029`,禁用 Node `readline`
  - 提供流结束时取出残留缓冲的能力
  - 观察完成条件:对一段含 CRLF、被拆分行、行内 `U+2028`/`U+2029` 与空行的输入序列调用后,按序返回正确的完整行集合
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 1.2_
  - _Boundary: JsonlLineReader_

- [ ] 2.2 (P) 编写 JSONL 成帧单元测试
  - 覆盖:单条 JSON 拆成多 chunk 后拼回、CRLF 尾随 `\r` 剥离、JSON 字符串内含 `U+2028`/`U+2029` 不被误切、空行容错、单 chunk 多行按序、流结束残留处理
  - 观察完成条件:成帧测试套件全部通过,且每条特殊字符/分片断言独立可见
  - _Requirements: 7.1, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - _Boundary: JsonlLineReader_
  - _Depends: 2.1_

- [ ] 3. 核心:本地子进程实现
- [ ] 3.1 实现子进程启动与生命周期管理
  - 按传入 `SpawnSpec` 以 `detached:false` spawn 子进程并接管 stdin/stdout(UTF-8)/stderr;不在内部推断 spawn 目标
  - 持续收集 stderr;监听 exit/error,退出或崩溃时发出携带退出码/信号的可观察信号;`health()` 在退出/关闭后报告不可用
  - spawn 失败时传播可观察错误且不进入就绪状态
  - 观察完成条件:`PiRpcProcess` 实现 `PiRpcChannel` 全部成员且行为与契约一致;给定一个可启动的 spawnSpec 时通道就绪、`health().alive` 为真;子进程退出后 `health().alive` 为假并触发 exit 信号;给定不可执行命令时构造期传播 spawn 失败错误
  - _Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 6.1, 6.4, 6.5_
  - _Boundary: PiRpcProcess_
  - _Depends: 1.2_

- [ ] 3.2 实现 stdout 三类消息分发与待决表
  - 将 stdout 经成帧 reader 成行后逐行 JSON 解析;`response` 按 `id` 兑现待决命令、`event` 广播给监听器、`extension_ui_request` 登记待决并通知上层
  - 无对应 `id` 的响应与不可解析行均跳过并记可观察诊断,不中断后续处理;`respondExtensionUI(id, …)` 写回 stdin 并清除该待决项
  - 观察完成条件:注入三类样本行时分别触发兑现/广播/挂起;注入孤儿响应与坏行时通道不崩溃且继续处理后续行
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - _Boundary: PiRpcProcess_
  - _Depends: 2.1, 3.1_

- [ ] 3.3 实现命令方法封装与订阅/回复接口
  - 暴露 18 个与 `RpcClient` 对齐的命令方法(prompt/steer/followUp/abort、setModel/cycleModel/getAvailableModels、setThinkingLevel、getState/getMessages/getSessionStats/getCommands、compact/fork/clone/newSession、bash/abortBash):各生成唯一 `id`、构造命令帧 `send` 写出、返回待决 Promise
  - 暴露 `onEvent()` 订阅事件与 `respondExtensionUI(id, …)` 回复扩展 UI;输入输出类型取自 `@pi-web/protocol`;待决期间不阻塞其他命令或事件
  - 观察完成条件:任一命令方法被调用后写出含唯一 `id` 的帧并返回待决 Promise,该 Promise 在同 `id` 响应到达时兑现;多个命令并发待决互不阻塞
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 4.1_
  - _Boundary: PiRpcProcess_
  - _Depends: 3.2_

- [ ] 3.4 实现关闭与待决拒绝
  - `close()` 终止子进程、关闭 stdin、停止后续行分发,并以"通道已关闭"理由拒绝全部待决命令;退出/崩溃时以对应错误拒绝全部待决命令;定义 spawn 失败/通道关闭/崩溃错误类型
  - 观察完成条件:`close()` resolve 后子进程不再存在(无僵尸)、`health().alive` 为假、所有待决命令 Promise 已被拒绝、待决表清空
  - _Requirements: 6.2, 6.3, 6.6, 2.4, 6.5_
  - _Boundary: PiRpcProcess_
  - _Depends: 3.3_

- [ ] 4. 核心:本地实现单元测试
- [ ] 4.1 (P) 编写 response/id 关联单元测试
  - 用伪 stdio + mock channel:命令方法发帧后注入同 `id` 响应使其 Promise 兑现;注入无对应 `id` 的响应被安全丢弃并记诊断;不可解析行被跳过且后续行仍处理;用最小 mock `PiRpcChannel` 驱动命令层而不启动真实进程
  - 观察完成条件:关联测试套件全部通过,孤儿响应/坏行不导致挂起或崩溃
  - _Requirements: 7.2, 4.1, 4.5, 4.6, 1.5, 5.2, 5.4_
  - _Boundary: PiRpcProcess_
  - _Depends: 3.3_

- [ ] 4.2 (P) 编写 extension_ui 挂起与回复单元测试
  - 注入 `extension_ui_request` 验证经订阅通知且登记为待决;调用 `respondExtensionUI(id, …)` 验证回复经 stdin 写出且待决项被清除
  - 观察完成条件:扩展 UI 测试套件全部通过,断言写出帧内容与待决表前后状态
  - _Requirements: 7.3, 4.3, 4.4, 5.5_
  - _Boundary: PiRpcProcess_
  - _Depends: 3.2_

- [ ] 4.3 (P) 编写生命周期单元测试
  - 用伪 stdio:`close()`/模拟 exit/模拟崩溃 时全部待决命令以对应错误被拒绝;`health()` 在退出/关闭后报告不可用;stderr 收集可被读取
  - 观察完成条件:生命周期测试套件全部通过,待决拒绝与 health 状态转换均被断言
  - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.1_
  - _Boundary: PiRpcProcess_
  - _Depends: 3.4_

- [ ] 5. 集成与端到端验证
- [ ] 5.1 提供等价 stub 子进程并编写集成测试
  - 实现一个按 RPC JSONL 协议读 stdin 命令、吐响应/事件的 stub 子进程作为真实 pi 不可用时的退路;集成测试 spawn 真实 `pi --mode rpc`(或 stub),发 `prompt` 并断言收到 `agent_end` 事件,且 stdout 经严格 reader 正确成帧
  - 观察完成条件:集成测试对真实或 stub 进程跑通 prompt→agent_end,产出可验证的新鲜运行结果
  - _Requirements: 7.4, 2.1, 4.1, 4.2_
  - _Boundary: PiRpcProcess, rpc-stub-process_
  - _Depends: 3.4_

- [ ] 5.2 编写完整一轮 e2e 测试
  - 用上游形状的 `SpawnSpec` 构造通道 → `prompt` → 收集 `text_delta` 与工具相关事件 → 调 `abort` 并断言生效 → `close()` 后断言子进程已退出、无僵尸、待决全部清空
  - 观察完成条件:e2e 测试完成 spawn→prompt→事件→abort→干净退出的完整路径,断言无残留子进程
  - _Requirements: 7.5, 5.1, 6.3, 6.6_
  - _Boundary: PiRpcProcess_
  - _Depends: 5.1_

- [ ] 5.3 校验单一命令运行全部测试
  - 确认 `vitest run` 一次性运行单元 + 集成 + e2e 全部测试并产出可验证结果;集成/e2e 在真实 pi 不可用时回退 stub
  - 观察完成条件:单条命令运行后输出包含成帧/关联/扩展 UI/生命周期/集成/e2e 各套件的通过结果
  - _Requirements: 7.6_
  - _Depends: 5.2_
