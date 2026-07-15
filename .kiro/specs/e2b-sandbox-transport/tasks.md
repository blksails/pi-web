# Implementation Plan

> 说明:`transport.ts` / `pi-rpc-session.ts` / `e2b-transport.ts` 已有草稿。以下任务在其上做「补全依赖、修正编译缺陷、补齐配置与装配、三层测试」。每个任务须以 strict 编译 + 测试新鲜运行为完成证据。

- [x] 1. 基础:e2b 依赖与 rpc-channel 导出面
- [x] 1.1 引入 e2b SDK 依赖并锁定可安装
  - 在 `@blksails/pi-web-server` 的 `dependencies` 加 `e2b`(v1.x),执行安装使 `node_modules/e2b` 存在且可 `import { Sandbox } from "e2b"`。
  - 观察完成:`e2b-transport.ts` 对 `e2b` 的 import 解析成功,该文件 tsc 不再报「找不到模块 e2b」。
  - _Requirements: 2.1_
  - _Boundary: E2bTransport_

- [x] 1.2 rpc-channel 导出面追加传输/核心/e2b 组件
  - barrel 追加导出 `RpcTransport`(类型)、`PiRpcSession`、`E2bTransport`、`E2bTransportConfig`(类型),供装配层从 `@blksails/pi-web-server` 引入。
  - 观察完成:`import { PiRpcSession, E2bTransport } from "@blksails/pi-web-server"` 类型解析通过;既有导出不变。
  - _Requirements: 1.1, 2.1_
  - _Boundary: rpc-channel index_

- [x] 2. 核心:传输无关会话核心 PiRpcSession
- [x] 2.1 定稿会话核心并结构对齐 SessionChannel
  - 核对 `PiRpcSession` 覆盖 `SessionChannel` 全部成员(4 传输方法 + `onEvent`/`onExtensionUIRequest`/`onExit`/`onStderr`/`respondExtensionUI` + `onRestart`/`newSession` + 16 命令方法);分帧只对已分行 `JSON.parse`,复用传输侧 `JsonlLineReader`,不引入 Node `readline`。
  - 观察完成:一处 `satisfies SessionChannel` 校验通过(strict,无 `any`);传输 `onExit` 触发后全部待决命令被 `ChannelClosedError` 拒绝。
  - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - _Boundary: PiRpcSession_

- [x] 2.2 会话核心单元测试(mock 传输)
  - 用可编程 mock `RpcTransport`(可注入行、触发 onExit/onSpawn)覆盖:`response` 帧兑现对应 id 的 pending;`event` 帧广播 `onEvent`;其它帧通知 `onExtensionUIRequest`;非 JSON 行静默忽略;命令方法生成唯一 id 并经 `send` 写出;`onExit` 后待决全部被拒;`close()` 后新命令立即拒绝;`health()` 透传传输。
  - 观察完成:新增测试文件运行全绿,覆盖上述 8 条分支。
  - _Requirements: 1.2, 1.3, 7.1, 7.5_
  - _Boundary: PiRpcSession tests_

- [x] 3. 核心:e2b 沙盒传输适配器 E2bTransport
- [x] 3.1 修正 close 错误构造并定稿传输映射
  - 修正 `close()` 中 `ChildCrashError` 误用为其真实签名 `(code, signal, message?)`(或改用合适错误类);核对 boot→`Sandbox.create`→`commands.run({background,onStdout,onStderr})`→取 `pid`,`send`→就绪前 outbox / 就绪后 `sendStdin(pid,line)`,`onStdout` 经 `JsonlLineReader` 只喂 `onLine`、stderr 只喂 `onStderr`(fd1 铁律),boot 失败包 `SpawnError` 并经 `onExit` 传播。
  - 观察完成:`e2b-transport.ts` strict 编译通过,无 `any`;`close()` resolve 后 `health().alive===false`;传输端口保持二期(附件共享/沙盒复用/保活重连)可增量,不含推翻性假设。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.4, 7.5_
  - _Boundary: E2bTransport_

- [x] 3.2 e2b 传输单元测试(mock e2b SDK)
  - 用可控 mock 替换 e2b SDK(可编程 `Sandbox.create`/`commands.run`/`sendStdin`/`kill`/`sandbox.kill`,可注入 onStdout/onStderr 数据、令 boot 抛错)覆盖:boot 起沙盒+后台 runner(参数含 template/cwd/envs);`onStdout` 数据块经分帧只喂 `onLine`(含跨块半行);stderr 只喂 `onStderr` 不混入 `onLine`;就绪前 `send` 进 outbox、就绪后 flush 并调 `sendStdin(pid,...)`;`close()` 先 `commands.kill` 后 `sandbox.kill` 且 health 变死;boot 失败传播 `SpawnError` 且经 `onExit` 拒绝待决。
  - 观察完成:新增测试文件全绿,覆盖上述 6 组行为,不真连 e2b。
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 7.1_
  - _Boundary: E2bTransport tests_

- [x] 4. 核心:e2b 传输配置解析
- [x] 4.1 (P) 从环境变量解析 e2b 传输配置
  - 新增纯函数,从 env 读 `E2B_API_KEY`(必需)、`PI_WEB_E2B_TEMPLATE`(必需)、`PI_WEB_E2B_TIMEOUT_MS`/`PI_WEB_E2B_RUNNER_CMD`/`PI_WEB_E2B_CWD`/`PI_WEB_E2B_ENV_PASSTHROUGH`(可选)。缺 apiKey 或 template 时抛携带修复指引的清晰 `Error`,不返回可用配置(不静默回退 local)。
  - 观察完成:缺 `E2B_API_KEY` 调用即抛且消息含变量名;齐全时返回结构正确的 `E2bTransportConfig`。单元测试覆盖缺失/齐全两路径。
  - _Requirements: 3.2, 3.3, 7.1_
  - _Boundary: e2bTransportConfigFromEnv_

- [x] 5. 集成:装配层按环境切换传输
- [x] 5.1 装配层 PI_WEB_TRANSPORT 切换分支
  - 在 `buildSingleton()` 的 `createChannel` 闭包新增第三分支:`PI_WEB_TRANSPORT==="e2b"` 时经 `e2bTransportConfigFromEnv(process.env)` 解析(缺配置在此抛清晰错误)、组装 e2b `spawnSpec`(复用 `--session-id`/`--model` 会话对齐 args)、返回 `new PiRpcSession(new E2bTransport(spec, cfg)) satisfies SessionChannel`;未设置/`local` 走既有 `PiRpcProcess`(零变化);stub 分支不变。
  - e2b 分支显式绕过本地假设:不注入附件相关 env(Req 6.3)、不注入热重载(Req 6.1)、不依赖 project-trust 的 cwd 信任语义(Req 6.2)。
  - 观察完成:未设 `PI_WEB_TRANSPORT` 时 createChannel 仍返回 `PiRpcProcess`(默认零变化);设为 e2b 且缺 key 时 createChannel 调用抛清晰错误;组合根 `createPiWebHandler`、协议、前端文件零改动。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.2, 6.1, 6.2, 6.3_
  - _Depends: 1.2, 3.1, 4.1_
  - _Boundary: assembly pi-handler createChannel_

- [x] 5.2 装配切换与配置失败的单元测试(stub 传输,不真连 e2b)
  - 以可注入的切换函数/stub 传输验证:`PI_WEB_TRANSPORT` 未设/`local` → 选本地路径;`=e2b` 且配置齐全 → 走 e2b 构造路径(以 mock/stub 传输替身断言选择,不起真实沙盒);`=e2b` 且缺配置 → 会话创建路径抛清晰错误。
  - 观察完成:测试断言三种切换结果与「缺配置清晰失败、不回退 local」,全绿。
  - _Requirements: 3.1, 3.2, 3.3, 7.3_
  - _Depends: 5.1_
  - _Boundary: assembly switch tests_

- [x] 6. 验证:真实 e2b 闭环与回归
- [x] 6.1 真实 e2b 集成测试(缺凭据可跳过)
  - 新增集成测试:缺 `E2B_API_KEY`(或 template)时 `skip` 并在输出明确报告跳过原因;有凭据时经 `PiRpcSession(new E2bTransport(...))` 起最小 agent,跑一轮 `prompt` → 收到 `event` 流式回复 → `close()` 后 `health().alive===false`(断言沙盒销毁,不泄漏计费)。
  - 观察完成:无凭据环境下测试报「skipped: E2B_API_KEY 未设」而非失败;有凭据时整轮 prompt→流式回复→关闭断言通过。
  - _Requirements: 2.7, 5.1, 5.2, 5.3, 7.2_
  - _Depends: 3.1, 4.1_
  - _Boundary: E2bTransport integration test_

- [x] 6.2 回归:既有 rpc-channel 与会话层测试保持全绿
  - 运行既有 `test/rpc-channel/*`(`pi-rpc-process.*`、`jsonl-reader`、`hot-reload`)与会话层测试,确认抽出会话核心 + 新增文件后行为零回归;运行本 spec 新增全部单元/装配测试。
  - 观察完成:server 包测试套件(既有 + 新增)一次运行全绿,附新鲜运行输出;`PI_WEB_TRANSPORT` 未设时 local 路径行为与改动前一致。
  - _Requirements: 1.4, 4.1, 4.3, 5.4, 7.4_
  - _Depends: 2.2, 3.2, 4.1, 5.2_
  - _Boundary: regression suite_
