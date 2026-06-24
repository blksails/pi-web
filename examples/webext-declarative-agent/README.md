# webext-declarative-agent

**Tier 5 · 纯声明**示例(零代码 UI 扩展)—— UI 定制完全靠 `.pi/web/manifest.json` 内联的声明式 config(theme token + layout + 空态),**不携带任何 bundle**,演示零加载路径。

## 它演示什么

| 能力 | 声明(manifest.json) | 前端表现(pi-web) |
|------|---------------------|------------------|
| 主题 token 覆盖 | `config.theme`(`--primary` / `--accent` / `--ring` / `--border` …) | 紫色主题,亮/暗自动适配 |
| 布局预设 | `config.layout: "wide"` | 更宽的对话版心 |
| 自定义空态 | `config.empty`(标题/副标题/starters) | 空屏文案与建议项全来自声明 |
| 建议项合并策略 | `config.empty.mergeCommands: "prepend"` | 配置建议项排在 agent slash 命令之前 |
| 标签页标题 | `config.documentTitle` | 载入后 `document.title` 同步,切走自动还原 |

> 纯声明式扩展只有一个 `manifest.json`(`capabilities: ["config"]`),没有 `.tsx`、不打包,所以"零加载"。**注意 layout 预设:本例用 `wide`;若用 `split` 但未提供 `panelRight` 插槽,右侧会留出约 384px 的空白 aside**——split 适合配合 Tier1 `panelRight` 一起用。

## 运行

前端把 source 指向本目录即可:

```ts
usePiSession({ create: { source: "./examples/webext-declarative-agent" } })
```

`model` 省略 → 继承 `~/.pi/agent/settings.json` 的默认 provider/model;凭据取自 `~/.pi/agent/auth.json`。

## 相关示例

- `webext-slots-agent` —— Tier1 + Tier5 声明式 `config.empty` 并存
- `webext-layout-agent` —— Tier1 区域插槽 + `config.panelRatio` 声明
- `webext-background-agent` —— Tier1 `background` 槽自定义背景(代码路径)
