# aigc-canvas-agent

Canvas(`aigc-canvas`)端到端示例:把 AIGC 生成/编辑图从「散落在对话流工具卡」聚合成
**画廊 + 二次创作工作台**。Canvas 是 `agent-authoritative-surface`(AAS)SDK 的 `domain="canvas"`
实例——通信一律复用上游(`createSurface` / `useSurface` / `wireSurfaceBridge`)。

## 装载

```ts
extensions: [aigcExtension, visionExtension, canvasSurfaceExtension]
```

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

## UI(`.pi/web`)

- `launcherRail` 槽:`CanvasLauncher`(门控 `NEXT_PUBLIC_PI_WEB_CANVAS`,开合画廊)。
- `panelRight` 槽:`CanvasPanel`(有 `surface` 接入 → 镜像快照 + A/B/C 档二创工作台)。

## 门控

默认关闭。开启:

```bash
NEXT_PUBLIC_PI_WEB_CANVAS=1
```

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

### 声明方式(`index.ts`)

```ts
routes: [
  {
    name: "gallery-stats",        // 小写字母/数字/连字符;同一定义内唯一
    // methods 缺省 → ["GET"](只读查询)
    description: "Canvas 画廊统计(资产计数/来源分布/是否生成中)",
    handler: galleryStatsHandler, // 子进程内执行;返回值须 JSON 可序列化
  },
],
```

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
