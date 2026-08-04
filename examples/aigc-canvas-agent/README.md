# aigc-canvas-agent

Canvas(`aigc-canvas`)端到端示例:把 AIGC 生成/编辑图从「散落在对话流工具卡」聚合成
**画廊 + 二次创作工作台**。Canvas 是 `agent-authoritative-surface`(AAS)SDK 的 `domain="canvas"`
实例——通信一律复用上游(`createSurface` / `useSurface` / `wireSurfaceBridge`)。

> **本示例已迁到隔离 Pane 形态**(spec `isolated-panes` Wave 5)。画廊不再与宿主同 JS realm,
> 而是跑在一个独立 iframe 里,数据只经三条**受授权**的通道往返。迁移前后的差异见下方
> 「[从 slots 迁到 panes](#从-slots-迁到-panes)」。

## 装载

pane 自带 tools:每个 pane 一个 `PaneAgentModule`,`composePaneAgentModules` 一次装配。

```ts
// panes-modules.ts
export const paneModules = [
  {
    pane: canvasPaneMeta,                                              // pane-meta.ts(与 web 侧同源)
    extensions: [canvasSurfaceExtension, aigcExtension, visionExtension],
    routes: [galleryStatsRoute],
  },
];

// index.ts
const composed = composePaneAgentModules(paneModules);
defineAgent({ extensions: [...composed.extensions], routes: composed.routes, ... });
```

比迁移前的「三个扩展平铺 + routes 另列一处」多出的是**装配期校验**:`pane-meta.ts` 的
`capabilities.routes` 声明了 `gallery-stats`,就必须有模块提供它,否则 `composePaneAgentModules`
当场抛错 —— 而不是等 pane 在运行时调用才拿到 404。

- `aigcExtension`:`image_generation` / `image_edit` 工具(LLM 生成的图落 `att_`,触发源 ①)。
- `visionExtension`:`image_vision` 工具 + `/img_vision` 命令(spec `image-vision-tool`)。
  画廊里的图对 LLM 只是 `[attachment id=att_… …]` 文本标记 —— 读得到 id、**读不到像素**。
  `image_vision({ image, question })` 取回字节、委派给一个支持图像输入的模型,返回文字结论,
  于是 LLM 能「看见」自己生成的图(例如核对二创结果是否符合预期)。
  视觉模型取自 `models.json` 中 `input` 含 `"image"` 且凭据可用者;主模型无须多模态。
- `canvasSurfaceExtension`:`domain="canvas"` 的权威 surface。
  - **画廊 = attachment store 物化视图**:`hydrate()` 经上游 `attachment-tool-bridge` 的
    `listBySession()` 枚举当前会话图片附件 + `getMeta()` 读血缘重建;冷启/`sync` reconcile。
  - **A 档二创**(`edit`/`inpaint`/`reference`/`variants`/`outpaint`/`reframe`):经 AAS 命令通道
    → `wireSurfaceBridge` → 子进程内直调 `runImageTool`(拿 `models.json`/provider/key,不过 LLM)。
  - **血缘**(`derivedFrom`/`genParams`)经上游 `setMeta` 持久到附件不透明扩展 meta。

## 对话模型

`index.ts` 有意省略 `model`，沿 pi 默认路径读取 `~/.pi/agent/settings.json`。接入阿里云百炼
Token Plan 时，在 `~/.pi/agent/models.json` 登记 `dashscope-token-plan`：

```json
{
  "baseUrl": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  "apiKey": "$DASHSCOPE_TOKEN_PLAN_API_KEY",
  "api": "openai-completions"
}
```

模型条目至少填 `id`、`name`、`input`、`contextWindow`、`maxTokens`；再将
`settings.json` 的 `defaultProvider` / `defaultModel` 设为 `dashscope-token-plan` /
`qwen3.7-max`。Token Plan key 与官方 `DASHSCOPE_API_KEY` 分离，不可混用。

## UI(`.pi/web`)
## UI(`web/` → 构建产物 `.pi/web/dist/`)

- `panelRight` 槽:`PanesHost`(panes-kit 通用宿主)+ `panesDefinition`(单个 `canvas` pane)。
  pane 由 `initialPaneIds: ["canvas"]` 开箱即在。
- `promptToolbar` 槽:`AigcQuickSettings`(模型/尺寸快捷设置)—— **刻意保留为槽**,没有 pane 化。

源码在 `web/`,**不在 `.pi/web/`**:`build.ts` 用 esbuild 把 `web/panes/canvas.tsx` 连同 canvas-ui
的 Tailwind CSS 打成一份自足 HTML(pane 的 `srcDoc`),再由 `buildWebExtension` 产出
`.pi/web/dist/`。构建入口已接进 `pnpm build:webext-examples`(它是 `build:client` 的前置步骤)。

```bash
pnpm build:webext-examples   # 或直接 node --import jiti/register examples/aigc-canvas-agent/build.ts
```

> 中间产物 `web/pane-documents.generated.ts` **构建完即删**,不入库;类型侧由同名 `.d.ts` 垫片兜住。
> 这样 typecheck 不依赖构建产物,也就不会出现「本地绿是因为工作树里躺着一份没人生成的东西」。

## 从 slots 迁到 panes

| 关注点 | 迁移前(slots) | 迁移后(pane) |
|---|---|---|
| 渲染 realm | 宿主 app bundle | 独立 iframe(`sandbox="allow-scripts"`) |
| 打开方式 | `launcherRail` 按钮 + `canvasOpenStore` | pane tab,`initialPaneIds` 开箱即在 |
| surface | 宿主 `useSurface("canvas")` 直传 | `guest.surface.*`,受 `capabilities.surfaceKeys`/`surfaceCommands` 门禁 |
| 上传 | 宿主 fetch 附件端点 | `guest.upload(file)`,受 `capabilities.attachments` 门禁 |
| 发对话 | 宿主 Prompt 通道 | `guest.submitUserMessage`,受 `capabilities.conversation` 门禁 |
| 画廊统计 | 外部 curl agent-route | `guest.query("gallery-stats")`,受 `capabilities.routes` 门禁 |
| 全局门控 | `NEXT_PUBLIC_PI_WEB_CANVAS` | **无** —— 可见性由 source 是否声明该 webext 决定 |

三处**必须知道**的迁移决策:

1. **`launcherRail` 撤掉了,不是顺手删的。** `CanvasLauncher` 靠 module-level 的 `canvasOpenStore`
   与面板联动,而 store 不跨 realm;按钮留着就是个点了没反应的死按钮。
2. **`promptToolbar` 反而必须留。** 它挂在输入区(宿主 realm),经 state 桥 KV 与 agent 进程里的
   图像工具通信,与 pane 化无关;它的位置(发送键旁)本身就是它的语义。
3. **★ 轮末 auto-sync 需要宿主侧补一手。** 宿主每轮 idle 边沿 bump 的 `syncSignal` **不在 pane 协议里**,
   而 `image_generation` 恰恰只落附件、不写 canvas 快照 —— 于是 pane 观察不到任何变化,表现为
   「LLM 生了图,画廊不更新」。`web/web.config.tsx` 的 `ConfiguredPanesHost` 包装器监听 `syncSignal`
   并代发 `run("canvas","sync")` 补上这条线。**没往 panes-kit 协议里加通用 host-signal** 是有意的:
   「一轮结束该 reconcile 画廊」是 canvas 域的策略,不是通用 pane 关注点,大多数 pane 根本不在对话语境里。

非 AIGC source(无 `surface:canvas` 探针)→ `available===false` → 优雅退化为只读图库 + B 档客户端编辑,
不报错。

## 二次创作分档

- **A 档**(`image_edit` 映射):指令编辑 / inpaint 涂 mask / 参考图融合 / 扩图 / 多模型变体 / 比例重构。
- **B 档**(纯客户端 Canvas 2D):裁剪 / 旋转 / 拼贴 / 标注 / mask → 新 `att_` 回流画廊。
- **C 档**(灵感放大):血缘树 / 参数复用 / A-B 对比 / 当前工作图链。

## Agent Routes 演示(`gallery-stats`)

本示例同时演示 **agent 声明式 HTTP route**(spec `agent-declared-routes`):agent 在
`AgentDefinition.routes` 里声明只读查询 route,外部以任意 HTTP 客户端(如 curl)携会话 id 调用,
立即拿到结构化 JSON。handler **只在 agent 子进程内执行**(主进程仅见 name/methods/description
纯数据投影),不进 LLM、不产生对话消息——调用后对话 UI 无任何可见变化。

迁移到 pane 形态后,**主调用方变成了 pane 自己**(`guest.query("gallery-stats")`,见画廊顶部
统计条),外部 curl 那条路径依旧可用 —— 两者打的是同一个 handler。

### 声明方式(`routes/gallery-stats.ts` + `panes-modules.ts`)

```ts
// routes/gallery-stats.ts —— 一路由一文件,co-locate handler + 声明
export const galleryStatsRoute: AgentRouteDecl = {
  name: "gallery-stats",          // 小写字母/数字/连字符;同一定义内唯一
  // methods 缺省 → ["GET"](只读查询)
  description: "Canvas 画廊统计(资产计数/来源分布/是否生成中)",
  handler: galleryStatsHandler,   // 子进程内执行;返回值须 JSON 可序列化
};

// panes-modules.ts —— route 归属到**提供它的那个 pane**
{ pane: canvasPaneMeta, extensions: [...], routes: [galleryStatsRoute] }

// pane-meta.ts —— pane 想调用,还得显式**授予**
capabilities: { routes: [{ name: "gallery-stats", methods: ["GET"] }], ... }
```

> pane 形态下没有 `routes/index.ts` barrel —— `PaneAgentModule` 就是汇总点(与 `panes-agent` 一致)。
> 声明(`pane-meta`)与提供(`panes-modules`)分离是刻意的:前者是**能力授予**,后者是**实现登记**,
> 两边对不上时 `composePaneAgentModules` 在装配期抛错。

`galleryStatsHandler` 从进程内 canvas 状态接缝读快照:`getSessionState()`(state-injection-bridge
的 globalThis seam)按 key `"surface:canvas"`(`createSurface` 每次写快照的同一 KV)取
`GalleryState`,归纳为轻量统计。seam 未装配 / surface 尚未写入快照时返回稳定零值结构
(带 `note`),不抛错。

### URL 形态

| 端点 | 说明 |
|---|---|
| `GET /api/sessions/<sessionId>/agent-routes` | 该会话声明的 route 清单(无声明 → `{"routes":[]}`) |
| `GET /api/sessions/<sessionId>/agent-routes/gallery-stats` | 调用演示 route,响应体 = handler 返回的原始 JSON |

### 如何取会话 id

任选其一:

1. **创建会话响应**:`POST /api/sessions` 的 201 响应体 `sessionId` 字段(见下方 curl);
2. **浏览器 URL**:pi-web 会话页地址即 `/session/<sessionId>`;
3. **会话列表**:`GET /api/sessions` 返回历史会话(含 `sessionId`)。

### 完整 curl 示例

```bash
# 1) 创建会话(source 指向本示例目录;端口按实际 dev/CLI 端口调整)
curl -s -X POST http://localhost:3000/api/sessions \
  -H 'content-type: application/json' \
  -d '{"source":"<repo>/examples/aigc-canvas-agent"}'
# → {"sessionId":"550e8400-e29b-41d4-a716-446655440000","protocolVersion":"0.1.0"}

# 2) route 清单
curl -s http://localhost:3000/api/sessions/<sessionId>/agent-routes
# → {"routes":[{"name":"gallery-stats","methods":["GET"],
#      "description":"Canvas 画廊统计(资产计数/来源分布/是否生成中)"}],"protocolVersion":"0.1.0"}

# 3) 调用演示 route
curl -s http://localhost:3000/api/sessions/<sessionId>/agent-routes/gallery-stats
```

预期响应(空画廊):

```json
{ "domain": "canvas", "assets": 0, "byOrigin": { "upload": 0, "tool-output": 0 }, "generating": false }
```

生成过图片后再调用,`assets`/`byOrigin["tool-output"]` 随画廊增长(`generating: true` 表示当前
正有生成命令在流式出图);surface 尚未就绪(快照未写入)时返回同形零值结构并附
`"note": "canvas surface not registered"`。

### 门控与错误码

- `PI_WEB_AGENT_ROUTES_DISABLED=1`:服务端权威关断,全部 agent-routes 端点返回通用 404(默认开启)。
- `PI_WEB_AGENT_ROUTE_TIMEOUT_MS`:转发超时毫秒(默认 20000,超时 → 504)。
- `PI_WEB_AGENT_ROUTE_BODY_LIMIT`:POST 请求体上限字节(默认 1 MiB)。

| 状态码 | 错误码 | 场景 |
|---|---|---|
| 404 | `ROUTE_NOT_FOUND` | route 名未声明(会话不存在/门控关断亦为 404) |
| 405 | `METHOD_NOT_ALLOWED` | 方法不在该 route 声明的 methods 白名单(本演示仅 GET) |
| 400 | `INVALID_BODY` | POST 携带非法 JSON 请求体 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超上限(按 Content-Length 提前拒) |
| 502 | `ROUTE_HANDLER_ERROR` | handler 抛错 |
| 504 | `ROUTE_TIMEOUT` | 子进程应答超时 |
