# Implementation Plan

- [x] 1. 基础:包脚手架与测试设施
- [x] 1.1 创建 `@blksails/pi-web-agent-kit` 包脚手架与 TypeScript strict 配置
  - 建立 `packages/agent-kit/`(`package.json` 标注零强制运行时依赖、pi SDK 类型为 peer/dev、`tsconfig.json` strict)
  - 观察完成:`tsc --noEmit` 在空包脚手架上通过,包可被 workspace 解析
  - _Requirements: 1.3_
  - _Boundary: agent-kit_

- [x] 1.2 建立 `lib/pi/` 与 vitest 测试设施
  - 配置 vitest,使单元/集成/e2e 测试可由单一命令运行
  - 安装运行时依赖(pi SDK、jiti),测试依赖(`@blksails/pi-web-protocol`、vitest)
  - 观察完成:`pnpm test` 在空测试集上成功运行并报告 0 失败
  - _Requirements: 7.4_

- [x] 2. agent-kit 类型层
- [x] 2.1 定义 `AgentDefinition` 与 `AgentContext` 类型
  - 覆盖 `model/thinkingLevel/tools/customTools/excludeTools/noTools/systemPrompt/extensions/skills/promptTemplates/contextFiles/scopedModels`,字段类型对齐 pi SDK 入参,禁止 `any`
  - 观察完成:为合法定义写的类型样例 `tsc` 通过;为非法字段写的样例 `tsc` 报错
  - _Requirements: 1.1, 1.4_
  - _Boundary: agent-kit_

- [x] 2.2 实现 `defineAgent()` 恒等帮助函数并导出聚合入口
  - `defineAgent(def)` 原样返回 `def`,仅提供类型推导,无运行时副作用
  - 观察完成:单测断言 `defineAgent(def) === def`(引用相等)
  - _Requirements: 1.2, 1.3_
  - _Boundary: agent-kit_

- [x] 3. 选项映射与信任接线
- [x] 3.1 (P) 实现 AgentDefinition → SDK 选项映射并组装 runtime factory
  - 资源类字段映射到 `resourceLoaderOptions`(systemPrompt/extensions 路径与工厂二分/skills/promptTemplates/contextFiles);会话类字段传 `createAgentSessionFromServices`;未提供字段不注入
  - 组装 `CreateAgentSessionRuntimeFactory`,调用时返回含 `services` 与 `diagnostics` 的结果
  - 观察完成:对一个含全部字段的定义,映射结果包含全部预期选项键;对仅含部分字段的定义,缺省键不出现
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Boundary: option-mapper_

- [x] 3.2 (P) 实现 `resolveProjectTrust` 接线
  - 提供 `makeResolveProjectTrust(trusted)` 回调,接入资源加载选项;仅门控 `.pi/` 项目资源,不影响 context 文件与 user/global 扩展
  - 观察完成:回调对 `trusted=true/false` 分别返回 true/false
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Boundary: project-trust_

- [x] 4. agent-loader 归一化
- [x] 4.1 实现 jiti import 与 default export 三形态归一化
  - 用 jiti import `agentPath` 取 default export;按 createRuntime 工厂(c)→ 函数(b,以 `ctx` 调用)→ 定义对象(a)顺序判别;形态 a/b 经 option-mapper 转 factory,形态 c 透传
  - 观察完成:三种 export 输入分别产出可用的 `NormalizedAgentRuntimeFactory`,形态 b 能观测到 `ctx` 被传入
  - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4, 3.4_
  - _Boundary: agent-loader_
  - _Depends: 3.1_

- [x] 4.2 实现无效定义错误处理
  - default export 缺失/为 null/既非对象非函数,或形态 b 工厂抛错/返回非定义对象 → 抛 `InvalidAgentDefinitionError`(含 `agentPath` 与原因)
  - 观察完成:各无效输入抛出带入口路径与原因的错误
  - _Requirements: 2.5, 2.6_
  - _Boundary: agent-loader_

- [x] 5. runner 子进程入口(集成)
- [x] 5.1 实现 runner 参数解析、运行时组装与 runRpcMode 启动
  - 解析 `--agent/--cwd/--agent-dir`;缺 `--agent` → stderr + 非零退出;经 loader+mapper 组装 factory → `createAgentSessionRuntime` + `SessionManager.create(cwd)` → `await runRpcMode(runtime)`;用户代码仅在子进程内执行
  - 观察完成:`node --import jiti/register runner.ts` 缺 `--agent` 时非零退出并打印错误;正常参数下进入 RPC 模式等待 stdin
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Boundary: runner_
  - _Depends: 4.1, 4.2, 3.2_

- [x] 5.2 创建示例 `examples/hello-agent/index.ts`
  - default export 一个最小可用 `AgentDefinition`,作为集成/e2e 目标
  - 观察完成:runner 能成功载入该示例并进入 RPC 模式
  - _Requirements: 7.2_
  - _Boundary: examples/hello-agent_

- [x] 6. 测试:单元
- [x] 6.1 (P) agent-loader 单元测试(三形态 + 无效定义)
  - 覆盖对象/工厂/createRuntime 三形态归一化与缺失/类型不符/工厂抛错/返回非定义的错误
  - 观察完成:测试运行通过,三形态与各错误分支均被断言
  - _Requirements: 7.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - _Boundary: agent-loader_

- [x] 6.2 (P) option-mapper 单元测试(映射正确性)
  - 覆盖资源/会话字段映射正例、`extensions` 路径/工厂二分、"未提供字段不注入"反例
  - 观察完成:测试运行通过,缺省字段断言不出现在选项中
  - _Requirements: 7.1, 3.1, 3.2, 3.3_
  - _Boundary: option-mapper_

- [x] 6.3 (P) agent-kit 与 project-trust 单元测试
  - `defineAgent` 恒等返回;非法字段类型测试编译失败;`makeResolveProjectTrust` 两路径返回值
  - 观察完成:测试运行通过,类型测试在非法字段下 `tsc` 报错
  - _Requirements: 7.1, 1.2, 1.4, 5.2, 5.3_
  - _Boundary: agent-kit, project-trust_

- [x] 7. 测试:集成与 e2e(硬性)
- [x] 7.1 集成测试:对 hello-agent 启动 runner 完成一次 prompt
  - 以子进程启动 runner 对 `examples/hello-agent/index.ts` 发一次 prompt,断言收到事件流并正常退出;含信任=false/true 的 `.pi/` 资源加载差异
  - 观察完成:集成测试通过,prompt 往返成功
  - _Requirements: 7.2, 4.3, 4.4, 5.2, 5.3_
  - _Boundary: runner_
  - _Depends: 5.1, 5.2_

- [x] 7.2 e2e 测试:stdin prompt → stdout 帧 + protocol schema 校验
  - 向 runner stdin 写入 `{"type":"prompt"}`,收集 stdout 帧,断言出现 `message_update`(`text_delta`)与 `agent_end`;每帧用 `@blksails/pi-web-protocol` 的 `AgentEvent`/`RpcResponse` schema `safeParse` 全部通过(即与 CLI `pi --mode rpc` 同形)
  - 观察完成:e2e 测试通过,全部帧通过 schema 校验
  - _Requirements: 7.3, 6.1, 6.2, 6.3_
  - _Boundary: runner_
  - _Depends: 5.1, 5.2_
