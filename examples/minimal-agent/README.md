# minimal-agent

最精简的零能力基线 agent。

## 它演示什么

本例比 [`hello-agent`](../hello-agent/README.md) 走得更远：用 `defineMinimalAgent` 预设一次性关掉所有能力，得到一个真正的零能力基线。

| 维度 | `hello-agent` | **`minimal-agent`** |
|---|---|---|
| 内置工具 | `noTools: "builtin"`（仅关内置，保留扩展工具） | `noTools: "all"`（内置 + 扩展工具全关） |
| 自定义工具 | 有一个 `echo` | 无 |
| 磁盘 skills | 空 `skills` override 丢弃 | 同样丢弃 |
| 磁盘扩展 | 保留 `.pi/extensions/*` | `allowExtensions: []` 全部禁用 |

`defineMinimalAgent` 已把 `noTools: "all"`、空 `skills` override、`allowExtensions: []` 都打包进预设，`index.ts` 里**无需再声明任何能力开关**，只留 `systemPrompt`。默认导出是预设产出的朴素 `AgentDefinition`，由 bootstrap runner 经 jiti 加载。

## 运行

```bash
pi-web ./examples/minimal-agent
```

前端 source 指向本目录即可。`model` 故意省略 → 继承 `~/.pi/agent/settings.json` 的默认 `provider` / `model`，凭证取自 `~/.pi/agent/auth.json`，与 `hello-agent` 同姿态，开箱即用于任意 pi 登录。

该 agent 没有任何工具，对话纯粹由模型自身能力驱动——适合作为「什么都不开」时的行为参照。

## 相关示例

- [`hello-agent`](../hello-agent/README.md) — 在此基线上加一个自定义工具与系统提示。
- [`builtin-tools-agent`](../builtin-tools-agent/README.md) — 反向：用 `tools` allowlist 显式开启内置工具。
