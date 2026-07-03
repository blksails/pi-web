# AIGC 图像工具 · 流式模式设计稿

> 状态(2026-07-03):
> - **✅✅ 真 `partial_images` 渐进局部图(由糊变清)已实现并实机验证** —— 经 **OpenRouter `/api/v1/images`** 端点(见 §0.2)。
> - **✅ OpenRouter chat 流式**(推理流边想边显 + 图早弹)已实现 —— Gemini 系走此路(见 §0.1)。
> - **🛑 NewAPI/sufy 的 `/images` 端点**仍不支持流式(见 §6),但 **OpenRouter `/api/v1/images` 支持** —— 早期"无网关支持 partial_images"的结论已被 OpenRouter 推翻。
>
> 关联章节:[11 · AIGC 图像工具](product/11-aigc-tools.md)。

## §0.2 已实现:OpenRouter `/api/v1/images` + `partial_images`(真·由糊变清)

**关键发现**:OpenRouter 有个 OpenAI-Images 兼容端点 `POST /api/v1/images`(**不是** `/images/generations`,那个 404;也不是 `/chat/completions`),对 OpenAI 图像模型支持 `stream:true` + `partial_images:N`,吐**真渐进局部图**:
```
event image_generation.partial_image  (idx 0..N-1,整幅 b64,完成度递增) → image_generation.completed
```

**接入**:`gpt-5-image` / `gpt-5-image-mini` / `gpt-5.4-image-2` 三个 OpenAI 模型的 gen+edit 走此端点
(`providers/openrouter-images.ts`,`streamKind:"images"`);edit 经 JSON `image` 字段传 data URI
(`/images/edits` 端点 404、multipart 500,故用 JSON body)。Gemini 系不支持 partial_images,仍走 §0.1 chat。

**执行层**:`engine/sse-stream.ts` 的 `makeOpenAiImagesAccumulator` 解析 `image_generation.partial_image`;
`endpoint-adapter.ts` runStreaming 按 `streamKind` 分流,每张 partial → `onStream({kind:"image"})` → `onUpdate` 预览。

**实机验证**(gpt-5-image,真实 runner):**3 张渐进 data-URI 图跨 19.3s 逐步到达**(@19.7s 糊 → @27.3s → @39s 清)→ 最终 att_ 落库。一张比一张清晰,即「由糊变清」。

> ⚠️ 代价:每张 partial 是 ~1.8MB data URI,一次生成经 SSE 传 3 张全图(~6MB)。`partial_images` 默认 2,可调。

---

## §0.1 已实现:OpenRouter chat/completions 流式(推理流 + 图早弹)

**做了什么**:给 OpenRouter 类图像路由(6 个 model)接入 `stream:true`,执行层读真 SSE,把
**推理文本增量**(边想边显)与**早弹图像**经已有 `onUpdate` partial 管线推到前端工具卡。

**落地点**:
- `engine/endpoint-types.ts` — `EndpointBehavior.stream?` + `StreamEvent`/`ToolStreamHandler`
- `engine/sse-stream.ts`(新) — SSE 行读取 `readOpenAiSse` + OpenAI-chat 累积器 `makeOpenAiChatAccumulator`(reasoning/content/images)
- `engine/endpoint-adapter.ts` — 流式分支 `runStreaming`(注入 `stream:true`;非 SSE 响应回退同步解析)
- `aigc/run-image-tool.ts` — `onStream`→`onUpdate`:推理文本节流 100ms 上报,图像出现即早弹预览
- `attachment/persist.ts` — `previewAssetsFromPicked(…, {includeDataUri:true})`:流式早弹保留 data URI(非流式仍过滤)
- `aigc/providers/openrouter-models.ts` — 6 路由 `stream:true`
- `ui/parts/pi-tool-part.tsx` — `update`(streaming)态默认展开,让流式增量可见

**实机验证**(真实 runner + OpenRouter + SSE):
- `gpt-5-image`:11 帧 `💭` 推理文本 33→404 字逐步增长(边想边显)。
- `gemini-3.1-flash-image`:图早弹 data URI **比最终 att_ 图早 1273ms**。

**边界/取舍**:
- 图**仍非**「由糊变清」渐进——OpenRouter 图是单帧原子到达;「早弹」= 图一到就先显 data URI,
  比 persist 完成早若干秒(gemini 首帧出图最明显,gpt-5 图在推理后故早弹幅度小)。
- 早弹会把一张多 MB 的 data URI 内联进一帧 preliminary SSE(仅流式路径,`includeDataUri` 显式开)。
- 网关未透传 SSE(返回整包 JSON)自动回退同步解析,不崩。
- 单测:`sse-stream`(9)+ `endpoint-adapter` 流式(3)+ `persist` includeDataUri(1)+ `pi-tool-part` update 展开。

---

## ⚡ 实证结论(TL;DR)

三个网关都 curl 实证过。**核心结论:「局部图由糊变清」(OpenAI `partial_images` 渐进渲染)在现有任何可达网关上都得不到。**

| 网关 / 接口 | `stream:true` | 传输层 | 图像交付 | 判定 |
|---|---|---|---|---|
| NewAPI · `/images/generations` | HTTP 200 | ❌ `application/json` 整包,零 SSE 帧 | 一次性 b64,~32s | ②接受但不分帧 |
| sufy · `/images/generations` | **HTTP 400** | — | — | ①硬拒 `"stream is not supported yet"` |
| OpenRouter · `/chat/completions` | HTTP 200 | ✅ **真 `text/event-stream`** | ⚠️ 图仍是**单帧原子**到达,无 `partial_image_index` | ③真 SSE 但图不分帧 |

**要点**:
- **OpenAI `/images` 兼容网关(NewAPI/sufy)**:一个静默吞掉 `stream`、一个直接 400。gpt-image 的
  `partial_images` 渐进流**两家都不透传**。
- **OpenRouter 是唯一吐真 SSE 的**,但它走的是 `/chat/completions` + `modalities:["image","text"]`
  (**不是** OpenAI `/images` 接口),图像模型把整张图放在**最后一个 SSE 帧**一次性发出:
  - `google/gemini-3.1-flash-image`:5 帧,图在帧1(775KB),帧2 是 1.1MB 的 `reasoning_details`(非图)。
  - `openai/gpt-5-image`:489 帧,前 484 帧是**推理文本 token**流,图在帧486(1.96MB)一次性到达,`含图帧数=1`。
  - `openai/gpt-5.4-image-2`(即「image 2」):接口返回真 SSE,但撞 OpenAI org 级 429 限流(TPM),未出到图;接口形态已验证同上。
- 三家**非流式基线均 200 出图**(NewAPI/sufy ~31s b64_json;OpenRouter gemini 16s / gpt-5-image 61s,data URI),证明鉴权/端点无碍。

**因此「渐显」体验拿不到**;OpenRouter 流式唯一能给的增量是:①推理/文本 token 边想边显,②图比连接关闭略早一点到——但图本身是原子单帧,不会由糊变清。**先 curl 实证的决策正确,挡下了注定拿不到目标体验的整套改造。**

## 0. 一句话目标

给 OpenAI 兼容图像工具(`gpt-image-2` / `gpt-image-2-sufy`)接入 OpenAI Images 的流式模式
(`stream: true` + `partial_images`),让网关出图过程中的**局部图(由糊到清)逐步显现在前端**,
消除现在整张图返回前 10–30s 的无中间态空窗。

---

## 1. 现状:全链路都是「同步单次请求」

| 层 | 文件:行 | 现状 |
|---|---|---|
| 请求体 | `packages/tool-kit/src/aigc/providers/openai-compat.ts:94` `buildT2IBody` | 只发 `{model,prompt,n,size,response_format:"b64_json"}`,**无 `stream`** |
| HTTP 执行 | `packages/tool-kit/src/engine/endpoint-adapter.ts:82` 分支 (b) | `callOnce` → `r.text()` → `JSON.parse` 一次性整包解析,无 SSE 读取 |
| 编排 | `packages/tool-kit/src/aigc/run-image-tool.ts:291` | `runEndpoint` 返回后**才**发一帧「乐观预览」(`run-image-tool.ts:301`) |

现在唯一的"进度感":整张图从网关回来后、落库前,抢发一帧预览 URL/data URI。网关真正出图前
的等待期里前端毫无中间态。

---

## 2. 关键发现:前端「增量渲染 partial」基础设施**已经就位** ✅

这是决定方案可行性的核心。`onUpdate` 发的中途帧,在 UI 上**真的会逐步显示**,完整链路已核查:

```
runImageTool onUpdate(preview)                            run-image-tool.ts:301
  → tool-output-available { preliminary: true }           translate-event.ts:220-243（按 toolCallId 复用同一 part）
  → preliminary 标志透传给 AI SDK                          decode-chunk.ts:75-82
  → preliminary===true → 同一 toolCallId 每次更新替换前序输出  pi-tool-part.tsx:13/60/94/255
```

**结论:数据管线(protocol / server 翻译 / react transport)对 partial 帧零改**——只要工具多次
调用 `onUpdate` 推 b64 局部图,帧就能一路到前端。

### 2.1 ⚠️ 但默认工具卡「折叠」了 streaming 态 — 这是最大的 UI 坑

核对 `packages/ui/src/parts/pi-tool-part.tsx` 后发现:默认卡 `PiToolPart` 的展开策略是
`autoOpen = phase === "end" || phase === "error"`(`pi-tool-part.tsx:383`),即 **`update`
(streaming)态默认折叠**,而 `ToolContent` 折叠时直接 `return null`(`:282`)。

**含义:流式局部图默认落在一张「折叠」的卡里,用户看不到**,直到最终帧(`end` 态)才自动展开成图。
→「看着图由糊变清」这个流式核心卖点**开箱即用不可见**。要真正显现,二选一:
- **(a)** 改默认展开策略:`update` 态 output 含图像时也自动展开(小改 pi-tool-part.tsx,但影响
  所有工具的 streaming 卡观感,需评估);
- **(b)** 给 AIGC 做**自定义 renderer**,把 partial 图渲染到显眼位置(对话内大图 / Canvas 面板),
  不挤在折叠工具卡里——更契合 Canvas 方向,**推荐**。

### 2.2 Canvas 画廊不受影响

Canvas 画廊(panelRight)靠 idle 边沿 `panelSyncSignal` 拉**已落库 `att_` 资产**
(见记忆 `aigc-canvas-gallery-no-refresh-after-gen`)。流式中间帧是 **data URI、不落库**(§5.3),
故**不会**在生成过程中往画廊塞半成品;画廊仍只在最终图 persist 后 +1。流式观感只存在于**对话内工具卡**。

---

## 3. OpenAI 流式 API 形态(⚠️ 需 curl 实证网关支持)

OpenAI 原生 `gpt-image-1/2` 支持流式:请求加 `stream: true` + `partial_images: 1–3`,
响应变成 `text/event-stream`:

```
event: image_generation.partial_image
data: {"type":"image_generation.partial_image","b64_json":"…","partial_image_index":0,"size":"1024x1024"}
…（index 1, 2, 逐步清晰）
event: image_generation.completed
data: {"type":"image_generation.completed","b64_json":"…","usage":{…}}
```

编辑端点同理:`image_edit.partial_image` / `image_edit.completed`。

**要点**:流式响应里局部图与最终图**永远是 `b64_json`**(SSE 不发 CDN url),正好契合现有
`pickResult`(openai-compat.ts:64)的 b64 内联路径与 `persistPicked` 的本地解码优化。

---

## 4. 可复用件与缺口

- ✅ SSE 解析纯函数已存在:`packages/react/src/sse/parse-sse.ts` `parseSseBuffer()`
  (多行 `data:`、半帧缓冲、心跳注释、`\r\n\r` 规范化)——但在 **react 包**,tool-kit 不宜反向依赖。
- ❌ **tool-kit 内零流式代码**:`endpoint-adapter` 全是同步单请求,无 `ReadableStream` reader、
  无逐行 `data:` 解析。
- 缺口小:在 tool-kit engine 内写一个约 30 行自包含 SSE 行读取器(或把 `parse-sse` 下沉到
  `@blksails/pi-web-protocol` 或独立共享层再双边复用)。

---

## 5. 改造方案(4 处,改动可控)

### 5.1 请求体(`providers/openai-compat.ts`)
`OpenAiCompatConfig` 增 `stream?: boolean` + `partialImages?: number`;`buildT2IBody`/
`buildImageEditBody` 命中时追加 `stream: true, partial_images: N`。仅对开启的 provider 生效。

### 5.2 执行层(`engine/endpoint-adapter.ts`)
新增**流式分支 (d)**:当 `behavior.stream === true` 且 options 传入 `onPartial(PickedResult)` 时,
不走 `callOnce`,改为:
```
读 response.body reader → 逐帧 parseSse → 每个 *.partial_image → onPartial(pickResult(frame))
                                       → *.completed        → return pickResult(finalFrame)
```
`EndpointBehavior` 增 `stream?: boolean`;`RunEndpointOptions` 增 `onPartial?: (p: PickedResult) => void`。
错误语义沿用:HTTP 非 2xx / SSE 内嵌 `error` 事件 → 抛诊断 Error。

### 5.3 编排层(`aigc/run-image-tool.ts`)
把 `onPartial` 接到已有 `onUpdate` seam:
- 每张**局部** b64 图 → `onUpdate(buildImageResult([previewAsset], model, { preview: true }))`
  ——中间帧走 data URI **不落库**(previewAssetsFromPicked 已支持);
- 只有 `completed` 的最终图才 `persistPicked` → 签名 URL → 最终 `buildImageResult`。

### 5.4 路由声明(`tools/image-generation.ts` / `image-edit.ts`)
仅给 `gpt-image-2` / `gpt-image-2-sufy` 两条 OpenAI 兼容路由开 `stream`(经 provider 薄封装的
`OpenAiCompatConfig` 或 route `extras`);DashScope / token plan 路由不受影响。

---

## 6. 网关能力实证(2026-07-03)—— 🛑 均不支持

前置风险「网关是否透传 SSE 未知」已 curl 实证并**坐实为阻塞**。命令(打 `/v1/images/generations`,
带 `stream:true, partial_images:2`,`-N` 禁缓冲、`-D` 存响应头):

**NewAPI** — 情形②(接受参数但不分帧):
```
HTTP 200 | 32.5s | content-type: application/json | bytes=2.3MB
body: {"created":…,"data":[{"b64_json":"iVBOR…"}]}   ← 整包,零 event:/data: 行
```

**sufy** — 情形①(直接 400 拒参,与其拒 `response_format` 同源):
```
HTTP 400 | 2.5s | content-type: application/json
body: {"error":{"message":"openai-images[generation]: stream is not supported yet",
       "type":"invalid_request_error"}}
```

对照:两家**非流式基线**均 HTTP 200 + `b64_json`、~31s 出图,证明鉴权/端点/出图链路无碍。

**结论**:方案 §5 的四处改动技术上成立,但目标网关**没有流式能力**,现在实现 = 空转。搁置。

### 待网关支持后的重启前置
- 复跑本节两条 curl,任一网关返回 `Content-Type: text/event-stream` 且逐帧到达 `image_generation.partial_image` → 解除阻塞。
- 重启时:`stream` 逐 provider 门控、**默认关**,实测通过再开;执行层分支 (d) 必须容错
  「声明 stream 但网关返回整包 JSON」→ 回退同步解析,不崩(NewAPI 情形②的兜底)。
- 别忘 §2.1 的前端折叠坑:管线通了,还要让折叠的 streaming 卡把局部图显出来(推荐自定义 AIGC renderer)。

---

## 7. 验证口径(将来立 spec 时的测试脊柱)

- 单元:SSE 行读取器纯函数(半帧/多帧/心跳/error 事件)。
- 集成:mock 一个吐 `text/event-stream` 的 fetch,断言 `onPartial` 被按 partial_image_index
  顺序调用、`completed` 作为最终返回、中间帧不触发 persist。
- e2e:浏览器端选 aigc-agent → 生图 → 断言同一 toolCallId 的 `<img>` 发生 ≥2 次增量替换
  (preliminary 帧)后收敛到签名 URL 终帧。
- **真实网关**:curl 实证 NewAPI/sufy 支持后,再跑一次真实 stream 会话。

---

## 8. 下一步

调研到此为止。落地路径二选一:
- 先 `curl` 实证网关(§6)→ 通过则走 `/kiro-spec-init` 立 spec(含前置 curl 任务)→ requirements/design/tasks/impl;
- 或直接实现 §5 四处改动 + §7 自测(风险:网关支持未证)。
