# Research & Design Decisions

## Summary

本 spec 属 **Extension（现有系统扩展）**，故走 integration-focused discovery。核心结论来自真机实测而非文献：**payload 字节数（而非分辨率）决定耗时**，因此手段是「转码」而非「缩放」。（⚠ 07-28 曾据一次观测断言「大图必然卡死」，07-29 已自我证伪，详见 Research Log 内的更正框。）落点已在既有上传链路中精确定位，无需新增架构层。

## Research Log

### 卡死的真实触发条件是什么

**调查方式**：对同一张 764×763 的照片构造多种编码，经真实路由打 NewAPI gemini relay。

| 输入 | payload | 耗时 | 结果 |
|---|---|---|---|
| 纯色小图 | 1.8 KB | 12.4s | ✅ 出图 |
| JPEG q85（**分辨率不变**） | 174 KB | 152.0s | ✅ 出图 |
| PNG（同一张、同分辨率） | 766 KB | — | ❌ 23 分钟无响应 |
| 多图 edit（1 主 + 3 参考） | 4.25 MB | 301.6s | ❌ HeadersTimeoutError |

**结论与蕴含**：同分辨率下仅换格式即大幅提速，故**转码足以解决问题，缩放非必需**。这直接决定了设计取向 —— 默认保留原始像素，只在极端尺寸时兜底缩放，避免损失医疗/设计类图像细节。

> ### ⚠ 2026-07-29 自我证伪（保留原记录以存证）
>
> 上表「PNG 766KB → 23 分钟无响应」**不可复现**。次日以同一张图、同一代码路径重测：
>
> | 模型 | 直连 | 走 http 代理 |
> |---|---|---|
> | gemini-3.1-flash-image-newapi | **128.5s ✅** | 111.1s ✅ |
> | gpt-image-2 | **38.0s ✅** | 38.3s ✅ |
>
> 故「大图**必然**卡死」是**错误结论** —— 那是 07-28 当时 NewAPI 的状态，不是模型的固有属性。
> 修正后的因果：**大 payload 显著更慢**（0.97MB 用 38–128s，1.8KB 仅 12s），慢意味着更容易
> 撞上传输层超时与服务端拥塞。压缩的价值不变（体积 -89%、耗时降一个数量级），但理由从
> 「避免必然失败」改为「大幅降低耗时与失败概率」。
>
> 另两点实测结论：
> - **代理无影响**：gpt-image-2 直连 38.0s vs 代理 38.3s，两次几乎重合。
> - **gpt-image-2 比 gemini relay 快约 3.4 倍**（同一输入）。

### 为何超时放宽不能替代压缩

**调查方式**：先修传输层（`b50c1fd6` 放宽至 15 分钟 + 透出 cause），再用同一张 766KB 图复测。

**发现**：修复前在 301.0s 抛 `TypeError: fetch failed ← HeadersTimeoutError`；修复后**23 分钟仍无响应**。

**蕴含（已按 07-29 复测修正）**：当时据此认为「300s 只是把一个永不返回的请求掐掉」。次日复测同一负载 38–128s 即返回，故该推断不成立 —— 07-28 观察到的是服务端拥塞态。修正后的蕴含：超时放宽对**本可成功但慢**的请求有效（250–300s 那一档不再被误杀）；而在服务端异常时，它会把「明确失败」变成「长时间挂起」，故仍需需求 7 的体积兜底给出可读失败。

### 压缩插在链路何处才能全链一致

**调查方式**：Grep 追踪上传与工具两条链路。

```
上传：add() → readAsDataUrl(预览) → uploadAttachment → POST /sessions/:id/attachments
      → store.put → { attachment, displayUrl }
工具：LLM 传 att_xxx → resolveInputToDataUri → 从 store 读字节 → base64 → provider
```

**关键发现**：工具侧**不走网络下载**，而是直接从 store 读字节（`packages/tool-kit/src/attachment/persist.ts:163`）。因此只要存进 store 的字节变小，工具侧自然受益，无需在两处分别处理。

**陷阱**：`add()` 内 `{ entry, file }` 的 `file` 是后续上传所用。若只把 `readAsDataUrl(file)` 换成压缩版而漏掉这个 `file`，会造成「预览已压、上传仍原图」的分裂 —— 已固化为需求 1.6。

### 并发现状

**发现**：`add()` 用无上限 `Promise.all(accepted.map(...))`。一次拖 20 张 4000×3000 的图，将同时存在 20 份解码副本（单份约 48MB）。**该隐患在压缩引入前就已存在**（20 份 base64 同时驻留），压缩只是让它更显著（多了 canvas 位图）。故并发闸门是独立价值项，不是压缩的附属。

### 浏览器端压缩的主线程开销

**调查方式**：按 API 语义分析（未做真实帧率测量，属已知残留风险）。

| 步骤 | 主线程 | 说明 |
|---|---|---|
| `createImageBitmap` | 否 | 异步解码 |
| `drawImage` | **是** | GPU 加速，764×763 亚毫秒级 |
| `toBlob` / `convertToBlob` | 否 | 异步编码 |
| 位图内存分配 | 是 | `w × h × 4` |

**蕴含**：单张开销可忽略，真正风险在并发驻留量 → 由并发闸门治理。`OffscreenCanvas.convertToBlob` 可把编码更彻底地移出主线程，作为首选路径。

### 参考实现对照（pi-labs）

**调查方式**：比对 `pi-labs/src/agents/aigc/providers/newapi.ts` 与 `shared/inline-image.ts`。

**发现**：pi-labs **没有**压缩/EXIF 管道（`package.json` 无任何图像依赖）。它处理的是**下行**问题（境外上游拉国内 CDN 慢），手段是下载超时 + 错误 marker + 重试切直连模型。与本 spec 的**上行 payload 过大**不是同一问题，无现成方案可复用。

**唯一可借鉴处**：其 `describeFetchError`（cause 展开）与本仓库 `b50c1fd6` 独立实现的 `describeError` 同构 —— 两个仓库各自撞到同一堵墙，印证该能力的必要性。

## Architecture Pattern Evaluation

| 方案 | 依赖代价 | 覆盖面 | 结论 |
|---|---|---|---|
| **A. 浏览器端上传前压缩** | 零依赖（Web API） | 用户上传图 | ✅ **采纳** |
| B. Node 侧发送前压缩 | 需 sharp（native）或 jimp（慢），打破 tool-kit 极干净依赖（现仅 undici/zod/mcp-sdk） | 上传图 + 生成图 | ❌ 本期不采纳 |
| C. 落库时压缩 | 同 B | 全覆盖 | ❌ 损失生成图原始质量 |
| **D. 发送前字节阈值拦截** | 零依赖 | 兜底全部来源 | ✅ **采纳**（与 A 组合） |

**采纳 A + D**：A 治本（用户上传路径），D 兜底（含 A 覆盖不到的生成图二创），二者均零依赖。B/C 留待后续 spec —— 届时若确需，可重新评估 native 依赖对沙箱镜像体积的影响。

## Design Decisions

### Decision: 转码而非缩放

**选择**：默认保持原始像素，仅在长边超过 4096 时兜底等比缩放。

**理由**：实测表明同分辨率转码即足以把耗时降一个数量级（766KB → 174KB，-78%）。缩放会损失临床照片的诊断细节与设计稿的精度，属不必要的画质代价。

### Decision: 阈值 200KB

**选择**：体积 > 200KB 触发压缩。

**理由**：已实测 174KB 快、766KB 显著更慢，中间区间未测。取 200KB 属激进档 —— 几乎所有照片都会被转码，代价仅是对本可通过的中等图做了一次无谓压缩（约百毫秒），换取确定性。用户于 2026-07-28 明确选择此档。

### Decision: 静默处理

**选择**：压缩不产生任何 UI 提示或标记。

**理由**：压缩是纯优化，失败亦静默回退；提示会在频繁上传时构成打扰，且需新增 i18n 文案。用户明确选择此档。

### Decision: 失败一律回退原图

**选择**：压缩任何环节抛错、或运行环境缺能力，均回退原图继续上传。

**理由**：压缩是优化而非关口。让一个优化措施成为新的失败点，是本设计最需要规避的风险。

## Risks & Mitigations

| 风险 | 影响 | 缓解 |
|---|---|---|
| **EXIF Orientation 丢失致照片躺倒** | 高 —— 且因元数据已清，下游**无法补救** | 必须 `createImageBitmap(file, { imageOrientation: "from-image" })`；测试覆盖带方向标记的图 |
| **透明 PNG 转 JPEG 变黑底** | 中 —— 视觉明显损坏 | 重绘前 `fillRect` 白底；测试覆盖带 alpha 的图 |
| 动图被压成静帧 | 中 | 跳过 GIF；测试覆盖 |
| 压缩后反而更大（源已是高压缩 JPEG） | 低 | 比较体积，不小于原图则保留原图 |
| jsdom 无 `createImageBitmap`/`OffscreenCanvas` | 中 —— 影响可测性 | 纯逻辑（阈值/跳过/回退/并发）与 canvas 操作分离；canvas 路径以注入或 mock 覆盖 |
| **主线程卡顿未经真实浏览器实测** | 低 —— 属残留风险 | 分析表明单张开销可忽略；并发闸门治理驻留量。如需确证，可用 DevTools Performance 录「拖 10 张大图」看有无 >50ms 长任务 |
| 二创大图更慢、异常时更易失败 | 中 —— 已知且**有意**不在本期解决 | 需求 7 兜底给出可读失败；★上限须足够宽以免误伤自家输出（gpt-image-2 单张实测 2.17MB，故上限定 4MiB）；真正解法留后续 spec |
| **据单次观测下普遍结论** | 高 —— 本 spec 已实际发生一次 | 07-28 的「必然卡死」被 07-29 复测推翻。涉及外部服务的结论须跨时段复测后才写成因果 |

## References

- 真机实测记录：本文档 Research Log 各表（2026-07-28 初测 / 2026-07-29 复测与更正）
- 既有修复：`b50c1fd6`（cause 透出 + 传输层超时放宽）
- 对照实现：`pi-labs/src/agents/aigc/{providers/newapi.ts,shared/inline-image.ts}`
- 链路代码：`packages/react/src/hooks/use-attachments.ts`、`packages/react/src/transport/attachment-upload.ts`、`packages/tool-kit/src/aigc/run-image-tool.ts`、`packages/tool-kit/src/attachment/persist.ts`
