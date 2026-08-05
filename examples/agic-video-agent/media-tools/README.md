# @aigc-agent/media-tools

可自由集成的 pi-web AIGC **媒体工具套件**:视频生成 / TTS / 音频提取 / 本地 ffmpeg 后处理。
端口自 pi-labs 的 15 个媒体 category,重铸为 pi-web tool-kit 的 `ExtensionFactory` 范式——
**任意 pi-web agent 都能装载,脱离本 aigc 项目亦可用**。

## 为什么能「自由集成」

- 只复用 `@blksails/pi-web-tool-kit/runtime` 的引擎(`runEndpoint`:HTTP 同步 / 异步轮询 / `runLocal`
  分发)与 attachment store,**零改 vendor**。
- 工具以进程内 `ExtensionFactory` 暴露,agent 一行 `extensions:[…]` 即装载。
- 图像/视频/音频一律以 attachment `att_` 引用流转,**不进 base64**(ffmpeg 本地产物经 `data:` URI
  交回编排器统一落库,见 `persist-media.ts` 的 ponytail 上限说明)。

## 用法

```ts
// agents/<id>/index.ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { mediaToolsExtension } from "@aigc-agent/media-tools/runtime";
import { mediaSlashCompletions } from "@aigc-agent/media-tools";

export default defineAgent({
  systemPrompt: "…",
  extensions: [mediaToolsExtension],          // 或按需 ffmpegToolsExtension / videoToolsExtension / ttsToolsExtension
  slashCompletions: mediaSlashCompletions,
});
```

## 工具清单(13)

| 族 | 工具 | 传输 | 环境闸 |
|---|---|---|---|
| 视频生成 | `text_to_video` `image_to_video` `multimodal_reference_video` `video_edit` `digital_human_video` | HTTP 异步轮询 | `DASHSCOPE_API_KEY` / `ARK_API_KEY` |
| TTS | `text_to_speech` | (WS,scaffold 未接入) | `DASHSCOPE_API_KEY` |
| 本地 ffmpeg | `audio_extract` `video_concat` `video_clip` `video_to_gif` `video_extract_frame` `video_with_audio` `video_transcode` | `runLocal` 本机 ffmpeg | 本机装 `ffmpeg` |

- **本地 ffmpeg 族**无需任何 provider key,是可离线验证的一半。
- **视频生成 / TTS 族**为环境闸:端点形态照 pi-labs 复刻,真机验证需对应 key。
- `text_to_speech` 目前为诚实占位(CosyVoice 仅 WebSocket 通道);接入 = 端口 pi-labs
  `cosyvoice-ws.ts` 到 `providers/dashscope-audio.ts` 的 `runLocal`。

## 展示(渲染)

工具结果 `details = { ok, model, kind: "image"|"video"|"audio", assets:[{attachmentId,displayUrl,mimeType,name}] }`。
宿主按 `kind` / `mimeType` 选渲染器(aigc 侧见 `agents/aigc/.pi/web` 的 media renderer)。
