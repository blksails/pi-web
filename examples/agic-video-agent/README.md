
# agic-video-agent — Agent 视频工作室

以 `aigc-agent` 为模板的 workflow-first 视频创作工作台。创意简报先落为镜头方案，
再逐镜头生成、暂停、重试、人工修改、复核、预览与导出；此目录可由 pi-web 宿主独立载入。

## 能力一览

| 层 | 内容 |
|---|---|
| 图像工具 | `image_generation`（文生图）/ `image_edit`（图生图·局部重绘·风格迁移·扩图），经 `aigcExtension`（`@blksails/pi-web-tool-kit/runtime`） |
| Canvas | `canvasSurfaceExtension` 提供 domain=canvas AAS；Pane 直接并入基座 `@blksails/pi-web-canvas-ui/pane`，本仓无 UI 薄壳 |
| 媒体工具族 | `mediaToolsExtension`（`@aigc-agent/media-tools`，本仓库 `packages/aigc-media-tools`）：视频生成 / TTS / 音频提取 / 本地 ffmpeg 后处理共 13 工具 + 富卡渲染器 |
| 素材 Pane 模块 | `packages/materials-pane/`：自带 Guest、统一应用服务、routes、Surface、MCP/CustomTools 同源适配与测试，可原样移入任意 Agent |
| 搜索 Pane 模块 | `packages/search-pane/`：自带 Guest、样式、`creative-search` route、`creative_search` MCP/CustomTool 与测试，可原样移入任意 Agent |
| 声明式 route | `routes/`：只保留 Agent 自身 route；搜索、素材 routes 由独立模块汇入 |
| 附件目录 | `attachmentCatalog`：`@` 引用宿主素材库（aigc_assets）注入对话 |
| 平台接缝 | `platform-client.ts`（内联）：租户 provider key 预取（`platform-keys.ts`）+ 生成台账落库（`persist-extension.ts`） |
| Web UI | `.pi/web/web.config.tsx`：promptToolbar 快捷 pill、技能面板（dialogLayer）、panelRight 画布、图像+媒体工具渲染器、专属空态 |
| 视频工作室 Pane | `video-studio/`：Surface 权威项目状态 + 隔离 iframe Guest；支持最多 6 镜头 / 30 秒首版流程、自动与人工协作 |

## 运行

```bash
pi-web .
```

嵌入 pi-web 工作区开发时可从父仓执行 `pi-web ./examples/agic-video-agent`。

- **model 省略即继承** `~/.pi/agent/settings.json` 默认 provider/model。
- **provider 密钥**经环境变量提供（`DASHSCOPE_API_KEY` / `OPENROUTER_API_KEY` / `NEWAPI_API_KEY` / `ARK_API_KEY` 等）；缺失时对应工具加载不崩溃、调用时返回「能力不可用」降级。
- **平台接缝可选**：`PLATFORM_CALLBACK_URL` + `PLATFORM_CALLBACK_TOKEN` 二者齐备才启用（多租户 key 解析、素材台账）；缺失 → `available:false` 全链路优雅降级（key 回落 env 直传、台账静默跳过、`@` 素材目录为空）。
- 安全边界：本 agent `noTools: "builtin"`（无 bash），预取写入 `process.env` 的租户 key 不会经孙进程 shell 外泄（源码 `platform-keys.ts` 头注详述）。

### 接入 webapp 素材服务与对话 MCP

webapp 配置其 Pi-clouds 凭据验证端点：

```dotenv
PI_CLOUDS_DESKTOP_CAPABILITIES_URL=https://cloud.example/api/desktop/capabilities
```

素材 Pane 经固定 JSON BFF `/api/agent/materials` 读取当前租户数据；Pane Route、
MCP 与可选 Pi CustomTools 共用 `MaterialsApplicationService`，不各写业务规则。
搜图沿用同一 BFF 的 `op: "similar-search"` 契约；`creative_search` 已默认注册到 aigc-agent
对话工具，调用时 `text` 与 `image_url` 二选一，后端执行多模态向量检索。
需要对话工具时，在 `~/.pi/agent/mcp.json`
配置业务端点（令牌不写此文件）：

```json
{
  "servers": [
    {
      "name": "pi-labs",
      "transport": {
        "type": "streamable-http",
        "url": "http://127.0.0.1:3001/api/mcp/pi-labs"
      }
    }
  ]
}
```

桌面端登录后新建会话；agent 仅对本地默认 origin
（`http://127.0.0.1:4000` / `http://localhost:4000`）注入当前桌面凭据。
远程 webapp 须另设 `PI_LABS_WEBAPP_URL=https://webapp.example` 与
`PI_LABS_WEBAPP_TRUSTED_ORIGINS=https://webapp.example`；
Pi-clouds 可注入更窄的完整头
`PI_LABS_WEBAPP_AUTHORIZATION=Bearer <scoped-token>`。未登录、非法用户或云端拒绝时，
webapp BFF 返回 401；素材 Pane 显式降级，仍显示平台列表与本会话附件。
旧 `PI_LABS_MCP_*` 环境变量仅作兼容别名。

默认只暴露上例 pi-labs MCP，免同义工具重复。若部署不使用 MCP，可设
`PI_LABS_MATERIALS_AI_ADAPTER=custom-tools`，改为注册
`materials_search/get/status/manage/locate/distribute`。删除、批量写及投放须确认与
幂等键；服务复核凭据、BFF 以已验证租户校权并记结构化审计，成功后触发 Pane 权威重载。
服务端实现位于 webapp
`apps/web/features/materials/mcp/application.ts`，BFF Route 与 pi-labs MCP 皆为薄适配。

## Slash 命令

`/img-gen <提示词>`（文生图）· `/img-edit <提示词>`（图生图，取最近 `[attachment id=att_…]`）· 媒体族命令见 `@aigc-agent/media-tools` 的 `mediaSlashCompletions`。

## 视频工作室首版流程

1. 右栏打开「视频工作室」，填写创意简报、画幅、时长与自动化级别。
2. 「生成镜头方案」先生成可编辑的 3–4 个镜头草案。
3. 逐镜头「开始」或「自动生成首版」；生成中可暂停、改 prompt、带入对话、重试或回滚。
4. 全部镜头完成后预览时间线，点击「导出合成」触发 `video_concat`。

Surface 快照键为 `surface:video-studio`，声明式状态 route 为 `video-studio-state`；
Pane 交互不经 LLM，只有显式提交生成/导出时才进入对话流。
