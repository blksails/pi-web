# hello-agent

最小的自定义 agent，作为集成 / e2e 的目标基线。

## 它演示什么

| 关注点 | 做法 |
|---|---|
| 自定义工具 | 用 `defineTool` 声明一个极小的 `echo` 工具，把入参文本原样回吐 |
| 系统提示 | `systemPrompt` 一行说明身份 |
| 自包含运行 | `noTools: "builtin"` 关掉内置工具集，仅保留自定义工具与 `.pi/extensions/*` 扩展工具 |
| 干净 skills | `skills` override 返回空列表，丢弃磁盘发现的系统 skills（保留 diagnostics） |
| model 省略 | 不写 `model` → 继承 `~/.pi/agent/settings.json` 的 `defaultProvider` / `defaultModel`，凭证取自 `~/.pi/agent/auth.json` |

`index.ts` 的默认导出是一个朴素的 `AgentDefinition`（shape a），由 bootstrap runner 经 jiti 加载并映射进 pi 会话运行时。

## 运行

```bash
pi-web ./examples/hello-agent
```

前端 source 指向本目录即可。`model` 故意省略，因此开箱即用于任意 pi 登录（anthropic / openrouter / openai …）。若要固定模型，给 `defineAgent` 加 `model: { provider: "...", modelId: "..." }`——但该 provider 必须有有效凭证，否则 LLM 调用会失败。

发一句话，agent 即可调用 `echo` 把文本回吐给你。

## 相关示例

- [`minimal-agent`](../minimal-agent/README.md) — 更彻底的零能力基线（`noTools: "all"` + 关扩展）。
- [`builtin-tools-agent`](../builtin-tools-agent/README.md) — 反向：用 `tools` allowlist 显式开启内置工具。
