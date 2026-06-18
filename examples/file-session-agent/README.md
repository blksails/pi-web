# file-session-agent

一个最小 example agent,配合"文件存储会话"的端到端演示。

## 为什么 `index.ts` 里看不到文件存储配置?

因为**存储不是 agent 的配置项**。`AgentDefinition`(`defineAgent({...})`)只描述
模型、工具、系统提示、扩展等"能力",**不包含会话存哪里**——这是**运行时**职责。
所以本目录的 `index.ts` 是一个与存储无关的普通 agent,看不到 file 配置是正常的。

文件存储配置分布在下面三层,逐层都可"看见":

## 1. 运行时决定持久化方式:`SessionManager`(pi SDK)

pi 运行时用 `SessionManager` 持久化会话。runner 默认这样构造(见
`packages/server/src/runner/runner.ts`):

```ts
import { SessionManager } from "@earendil-works/pi-coding-agent";

// 默认:以 append-only JSONL 文件持久化到 <agentDir>/sessions/--<cwd 编码>--/...
const sessionManager = SessionManager.create(cwd);

// 指定文件目录:
const sessionManager = SessionManager.create(cwd, "/path/to/sessions/--bucket--");

// 不落盘(纯内存):
const sessionManager = SessionManager.inMemory();

await createAgentSessionRuntime(factory, { cwd, agentDir, sessionManager /* ... */ });
```

## 2. 存到哪个目录:runner 的 `--agent-dir`

会话文件根目录 = `<agentDir>/sessions/`。agentDir 由 runner 的 `--agent-dir` 决定,
缺省回退到 `~/.pi/agent`(可被 `PI_CODING_AGENT_DIR` 覆盖):

```bash
node --import jiti/register packages/server/src/runner/runner.ts \
  --agent examples/file-session-agent \
  --cwd  /your/project \
  --agent-dir /tmp/my-sessions      # → 会话写到 /tmp/my-sessions/sessions/--...--/<ts>_<id>.jsonl
```

落盘布局:

```
<agentDir>/sessions/
└── --<cwd 路径,/ \ : 换成 ->--/
    └── <ISO时间戳,: . 换成 ->_<sessionId>.jsonl   # 首行 header,其后逐行 entry
```

> 注意:pi 的会话**懒落盘**——只有在首条 assistant 消息出现后才把缓冲写入文件。

## 3. pi-web 侧读写同一批文件:`FsSessionEntryStore`

`@pi-web/server` 的 `FsSessionEntryStore` 以**完全兼容**上述布局的方式读写会话文件:

```ts
import { FsSessionEntryStore } from "@pi-web/server";

// root = sessions 根目录(即 <agentDir>/sessions)
const store = new FsSessionEntryStore("/tmp/my-sessions/sessions");

await store.list("/your/project");   // 按工作目录列举
for await (const entry of store.read(sessionId)) { /* 重建事件树 */ }
```

## 端到端验证

`packages/server/test/session-store/file-session-agent.e2e.test.ts` 覆盖:

- **A(始终跑)**:真实 `SessionManager` 落盘 JSONL ↔ `FsSessionEntryStore` 按序回读。
- **B(始终跑)**:真启本 agent 子进程,非 LLM RPC 证明可加载运行。
- **C(`PI_WEB_E2E_LLM=1` 才跑)**:真 agent 一轮真实 prompt → pi 落盘 →
  `FsSessionEntryStore` 读回 assistant 消息(用真实 agent-dir 以获完整凭证/代理环境)。
