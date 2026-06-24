# webext-renderer-agent

**Tier 2 · 自定义渲染器**示例 —— `.pi/web` 注册自定义渲染器,替代默认的工具卡 / data-part 渲染。配套一个 `echo` 工具:被要求回显时调用它,产出的 `tool-echo` part 命中扩展的 `EchoToolRenderer`。

## 它演示什么

| 能力 | API / 声明 | 前端表现(pi-web) |
|------|-----------|------------------|
| 自定义工具渲染器 | `renderers.tools.echo` | `tool-echo` part 渲染成含「输入 / 输出 / 状态」三段的富卡片(`echo-tool-card`),替代默认工具卡 |
| 自定义 data-part 渲染器 | `renderers.dataParts["data-metric"]` | 命中 `data-metric` part 时渲染指标卡(`metric-card`) |
| 主题自适应 | 配色取宿主 token `hsl(var(--…))` | 亮/暗主题与 declarative 主题覆盖都自适应 |
| agent 侧稳定触发 | `customTools: [echo]` + `noTools: "builtin"` + 空 skills | 屏蔽内置工具/磁盘技能干扰,让 LLM 被要求回显时稳定命中 `echo` |

> 触发自定义工具渲染器有两条路:**stub**(`PI_WEB_STUB_AGENT=1` 每轮发 `echo` 工具,无 LLM,e2e 用)与**真实 LLM**(systemPrompt 要求 LLM 回显时调用 `echo`)。注:`data-metric` data-part 渲染器目前在本例中无产出点(示例缺陷,非测试问题)。

## 运行

前端把 source 指向本目录,然后让 agent "echo 一段文字":

```ts
usePiSession({ create: { source: "./examples/webext-renderer-agent" } })
```

`model` 省略 → 继承 `~/.pi/agent/settings.json` 的默认 provider/model;凭据取自 `~/.pi/agent/auth.json`。

## 相关示例

- `webext-contrib-agent` —— Tier3 贡献点(slash / @mention 经 ui-rpc 回 agent)
- `webext-artifact-agent` —— Tier4 artifact 隔离 sandbox iframe
- `webext-slots-agent` —— Tier1 区域插槽全集
