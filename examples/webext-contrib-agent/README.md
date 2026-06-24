# webext-contrib-agent

**Tier 3 · 贡献点**示例 —— `.pi/web` 声明 slash / @mention / 自动补全等贡献点 provider;运行时经宿主注入的 `UiRpcClient` 回 agent 取候选(双向 ui-rpc)。

## 它演示什么

| 能力 | API / 声明 | 前端表现(pi-web) |
|------|-----------|------------------|
| Slash 命令 | `contributions.slash.{list, execute}` | 输入 `/` 时经 ui-rpc 向 agent `list` 候选,选中 `execute` 回 agent |
| @mention | `contributions.mention.{trigger: "@", query}` | 输入 `@` 时经 ui-rpc `resolve` 候选 |
| 自动补全 / 行内补全 | `contributions.autocomplete.complete` / `inlineComplete.complete` | 编辑器补全候选 / 灰字行内建议,均经 ui-rpc 回 agent |
| 键位绑定 | `contributions.keybindings: [{ combo: "Mod+k", commandId }]` | 快捷键触发命令 |

> 贡献点的候选不是写死在前端,而是经 `rpc.request({ point, action, payload })` 回 agent 实时取——这条 ui-rpc 控制流**需要空闲控制流**才能开(`openControlOnlyStream` 仅在 `hasContributions && !isBusy` 时开,否则会破坏 prompt 流)。e2e 中由 stub agent 应答 `ui_rpc`;真实 pi agent 的 `ui_rpc` handler 见 spec 设计待决项。

## 运行

前端把 source 指向本目录,在输入框试 `/` 与 `@`:

```ts
usePiSession({ create: { source: "./examples/webext-contrib-agent" } })
```

`model` 省略 → 继承 `~/.pi/agent/settings.json` 的默认 provider/model;凭据取自 `~/.pi/agent/auth.json`。

## 相关示例

- `webext-renderer-agent` —— Tier2 自定义渲染器(data-part / 工具卡)
- `webext-artifact-agent` —— Tier4 artifact 隔离 sandbox iframe
- `webext-slots-agent` —— Tier1 区域插槽全集
