# Brief — rpc-channel

> 语言:zh。权威设计:`PLAN.md` §3.1、§3.0.0(spawn 目标)、§14.1①(传输无关接口)、RPC 文档(JSONL framing)。

## 问题
- **谁**:后端会话引擎,需要与 agent 子进程稳定通信。
- **现状**:包内 `RpcClient` 写死 spawn `pi --mode rpc`,且**未暴露 extension UI 子协议**(权限弹窗);
  Node `readline` 会在 `U+2028/2029` 误切,不符合 pi 的严格 JSONL 语义。
- **改变**:提供一个**传输无关的 `PiRpcChannel` 接口** + 其 `local` 实现 `PiRpcProcess`,正确处理三类 stdout 消息。

## 方法 / 范围
- 定义 `PiRpcChannel { send(line); onLine(cb); close(); health() }`(传输无关,为 e2b/ssh/device 预留)。
- `PiRpcProcess`(local 实现):`child_process.spawn` 给定 `spawnSpec`({cmd,args,cwd,env});
  内置**协议正确的 JSONL reader**(只按 `\n` 切、剥尾随 `\r`、禁用 readline);
  分发 stdout 三类:`response`(按 `id` 关联 Promise)、`event`(广播 listener)、`extension_ui_request`(挂起 + `respondExtensionUI(id,...)`)。
- 暴露与包 `RpcClient` 对齐的方法封装:`prompt/steer/followUp/abort/setModel/...getSessionStats/getCommands/bash` 等(基于 send + 等待 response)。
- 收集 stderr、监听 exit、错误传播。
- **范围外**:不决定 spawn 什么(由 agent-source-resolver 给 spawnSpec);不做事件→UIMessage 翻译(session-engine)。

## 依赖
- protocol-contract(命令/响应/事件/扩展UI 类型)。

## 测试 + e2e(硬性)
- **单元**:JSONL framing(分片到达、CRLF、内含 `U+2028/2029` 的 JSON 字符串不被误切、空行容错);response/id 关联;extension_ui 挂起与回复。
- **集成**:对真实 `pi --mode rpc`(或 stub 进程)spawn,发 `prompt` 收 `agent_end`。
- **e2e**:完整一轮——spawn → prompt → 收集 text_delta/tool 事件 → abort 生效 → close 干净退出(无僵尸)。

## 约束
- 不依赖全局 `pi`;spawnSpec 由上游给(通常 `node <pkg>/dist/cli.js --mode rpc` 或 runner)。
- `detached:false`,父退出连带清理。
