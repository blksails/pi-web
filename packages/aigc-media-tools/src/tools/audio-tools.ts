/**
 * 音频工具注册。text_to_speech(CosyVoice,scaffold 未接入 WS,见 providers/dashscope-audio.ts)。
 * audio_extract(本地 ffmpeg 抽音轨,现可用)在 tools/ffmpeg-tools.ts,由 audioToolsExtension 一并装载。
 */
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { runMediaTool, buildModelsDescription, optionalModelEnum } from "../run-media-tool.js";
import type { MediaToolDetails } from "../media-types.js";
import { DASHSCOPE_TTS_ROUTES } from "../providers/dashscope-audio.js";

type Emit = ((p: AgentToolResult<MediaToolDetails>) => void) | undefined;

export function registerTextToSpeech(pi: ExtensionAPI): void {
  const routes = DASHSCOPE_TTS_ROUTES;
  const defaultModel = routes[0]!.model;
  pi.registerTool({
    name: "text_to_speech",
    label: "Text → speech",
    description: buildModelsDescription(
      "把文本合成为语音(CosyVoice),支持声音克隆。音色由面板控制,你只提供 text。产出音频可作 digital_human_video 的 audio_url。",
      routes,
      defaultModel,
    ),
    parameters: Type.Object({
      text: Type.String({ description: "要合成的目标文本(用户原语言)。" }),
      model: optionalModelEnum(routes, defaultModel),
    }),
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      const emit = typeof onUpdate === "function" ? (onUpdate as Emit) : undefined;
      return runMediaTool(params, ctx, signal, emit, {
        toolName: "text_to_speech",
        routes,
        defaultModel,
        // text 是 schema 必填(LLM 提供);不弹 ctx.ui 模态。
        requiredParams: [],
      });
    },
  });
}
