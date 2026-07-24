/**
 * DashScope 音频 provider —— TTS(CosyVoice)。
 *
 * ponytail: CosyVoice 合成在 DashScope **只有 WebSocket 通道**(REST tts-by-post 对 cosyvoice 恒
 * 报 url error,见 pi-labs providers/dashscope/cosyvoice-ws.ts 234 行 WS 客户端)。本包 scaffold
 * **不内联** WS 客户端(env-gated 且无法离线验证);runLocal 给出诚实的「未接入」错误,指明升级路径。
 * 接入 = 端口 cosyvoice-ws.ts 到本 runLocal(或提上游把 TTS WS 纳入 tool-kit 引擎)。
 * audio_extract(本地 ffmpeg 抽音轨)是音频族里**现在就可用**的那一半,见 tools/ffmpeg-tools.ts。
 */
import type { PickedResult } from "@blksails/pi-web-tool-kit/runtime";
import type { MediaRoute } from "../media-types.js";
import { DASHSCOPE_TTS_MODELS } from "./dashscope-models.js";

function ttsNotWired(): Promise<PickedResult> {
  return Promise.reject(
    new Error(
      "text_to_speech 未接入:CosyVoice 合成走 WebSocket 通道,本包 scaffold 暂未内联 WS 客户端。" +
        "接入方式见 pi-labs providers/dashscope/cosyvoice-ws.ts(端口到本包 runLocal 即可用)。",
    ),
  );
}

export const DASHSCOPE_TTS_ROUTES: readonly MediaRoute[] = [
  {
    model: DASHSCOPE_TTS_MODELS.cosyvoiceV2,
    label: "CosyVoice v2 · TTS/克隆",
    description: "CosyVoice v2 文本转语音,支持预置/复刻音色(声音克隆)。需 DASHSCOPE_API_KEY。",
    provider: "dashscope",
    requiredVars: ["DASHSCOPE_API_KEY"],
    // ponytail: WS 合成占位 —— 见文件头,升级 = 端口 cosyvoice-ws.ts。
    runLocal: () => ttsNotWired(),
  },
];
