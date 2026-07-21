# aigc-agent — AIGC 图像工作台

文生图 / 图生图 + Canvas 画廊二创工作台。自源仓库 `aigc-agent`（`agents/aigc`）迁移而来的**完整 agent 定义**，取代早前的最小 AIGC 示例（旧版仅演示 image_generation/image_edit 渲染器；git 历史可查）。

> 迁移背景、同步方式、未随迁部分清单：见 [docs/aigc-agent-migration.md](../../docs/aigc-agent-migration.md)。源仓库仍在迭代期间，本目录内容由 `scripts/sync-from-aigc-agent.mjs` 同步生成——**勿在此目录手改逻辑**（改动会在下次同步被覆盖；须改则改源仓库或改同步脚本的变换规则）。

## 能力一览

| 层 | 内容 |
|---|---|
| 图像工具 | `image_generation`（文生图）/ `image_edit`（图生图·局部重绘·风格迁移·扩图），经 `aigcExtension`（`@blksails/pi-web-tool-kit/runtime`） |
| Canvas | `canvasSurfaceExtension`：domain=canvas 的 AAS；panelRight 画廊（6 视图）+ 二创工作台（`AigcCanvasPanel`，可移植纯画布） |
| 媒体工具族 | `mediaToolsExtension`（`@aigc-agent/media-tools`，本仓库 `packages/aigc-media-tools`）：视频生成 / TTS / 音频提取 / 本地 ffmpeg 后处理共 13 工具 + 富卡渲染器 |
| 声明式 route | `routes/gallery-stats.ts`：画廊统计（一路由一文件，`routes/index.ts` 只汇总） |
| 附件目录 | `attachmentCatalog`：`@` 引用宿主素材库（aigc_assets）注入对话 |
| 平台接缝 | `platform-client.ts`（内联）：租户 provider key 预取（`platform-keys.ts`）+ 生成台账落库（`persist-extension.ts`） |
| Web UI | `.pi/web/web.config.tsx`：promptToolbar 快捷 pill、技能面板（dialogLayer）、panelRight 画布、图像+媒体工具渲染器、专属空态 |

## 运行

```bash
pi-web ./examples/aigc-agent
```

- **model 省略即继承** `~/.pi/agent/settings.json` 默认 provider/model。
- **provider 密钥**经环境变量提供（`DASHSCOPE_API_KEY` / `OPENROUTER_API_KEY` / `NEWAPI_API_KEY` / `ARK_API_KEY` 等）；缺失时对应工具加载不崩溃、调用时返回「能力不可用」降级。
- **平台接缝可选**：`PLATFORM_CALLBACK_URL` + `PLATFORM_CALLBACK_TOKEN` 二者齐备才启用（多租户 key 解析、素材台账）；缺失 → `available:false` 全链路优雅降级（key 回落 env 直传、台账静默跳过、`@` 素材目录为空）。
- 安全边界：本 agent `noTools: "builtin"`（无 bash），预取写入 `process.env` 的租户 key 不会经孙进程 shell 外泄（源码 `platform-keys.ts` 头注详述）。

## Slash 命令

`/img-gen <提示词>`（文生图）· `/img-edit <提示词>`（图生图，取最近 `[attachment id=att_…]`）· 媒体族命令见 `@aigc-agent/media-tools` 的 `mediaSlashCompletions`。
