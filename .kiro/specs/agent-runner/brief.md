# Brief — agent-runner

> 语言:zh。权威设计:`PLAN.md` §3.0.2(模块契约)、§3.0.3(bootstrap runner)、SDK 文档(`runRpcMode`/`createAgentSessionRuntime`)。

## 问题
- **谁**:自定义 agent 模式下被 spawn 的子进程,以及编写自定义 agent 的用户。
- **现状**:用户用 pi SDK 写的 `index.ts` 无标准载入方式;没有把"用户定义"变成 `AgentSessionRuntime` 再跑 `runRpcMode` 的桥。
- **改变**:提供 bootstrap runner(子进程入口)+ `@pi-web/agent-kit`(`defineAgent()` 类型),把任意自定义 agent 暴露为标准 RPC。

## 方法 / 范围
- **`@pi-web/agent-kit`**:`defineAgent(def)` 与 `AgentDefinition` 类型(`model/thinkingLevel/tools/customTools/excludeTools/noTools/systemPrompt/extensions/skills/promptTemplates/contextFiles/scopedModels`);运行时不强制依赖。
- **agent-loader**:jiti import `<agentPath>` → 归一化 default export 三形态:(a) 定义对象、(b) `(ctx)=>定义`、(c) 直接 `createRuntime` 工厂。
- **runner.ts**(子进程入口):解析 `--agent/--cwd/--agent-dir` → 用 `createAgentSessionServices`(`resourceLoaderOptions` 映射 systemPrompt/extensions/skills/prompts/contextFiles)+ `createAgentSessionFromServices`(model/tools/customTools 等)组装 `CreateAgentSessionRuntimeFactory` → `createAgentSessionRuntime(...)` → `await runRpcMode(runtime)`。
- 处理 `resolveProjectTrust`(承接 agent-source 的信任决策)。
- **范围外**:不解析源(agent-source 做);CLI 回退模式不经过 runner。

## 依赖
- protocol-contract(确保 runner 输出帧符合协议——与 cli 模式逐字节一致)。

## 测试 + e2e(硬性)
- **单元**:AgentDefinition 三形态归一化;映射到 services/fromServices 选项正确;无效定义的错误处理。
- **集成**:对示例 `examples/hello-agent/index.ts` 起 runner 进程,完成一次 prompt。
- **e2e**:runner 进程 ↔ stdin 发 `{"type":"prompt"}` → stdout 收到 `message_update(text_delta)` 与 `agent_end`,且帧通过 protocol schema 校验。

## 约束
- Node `>=22.19.0`;jiti 载入用户代码 = RCE,运行须在受信/沙箱(§11.2)。
- 自定义模式与 cli 模式对外协议必须一致(同为 `runRpcMode`)。
