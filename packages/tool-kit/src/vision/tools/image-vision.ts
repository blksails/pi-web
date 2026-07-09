/**
 * `image_vision` 工具注册函数 — LLM 自主调用的图像理解入口。
 *
 * `content` 只放文字(结论或失败说明),`details` 放完整 {@link VisionResult}。
 * **不放内联 `ImageContent`**:M1 无 inline 回看,且未打 `keepInlineImages` 的内联图像
 * 会被服务端 base64 闸门剥离(`attachment-bridge/base64-gate.ts`)。
 */
import { Type } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { VisionParams, VisionResult } from "../types.js";

const DESCRIPTION =
  "Look at an image and answer a question about it (image understanding / vision). " +
  "Use this to inspect an image that already exists in the session — e.g. one produced by " +
  "image_generation / image_edit, or uploaded earlier — since past images appear in your " +
  "context only as `[attachment id=att_...]` text markers, not as pixels. " +
  "Omit `image` to look at the most recent image in the session. " +
  "The image is sent to a vision-capable model; you get back a text conclusion.";

const PARAMETERS = Type.Object({
  image: Type.Optional(
    Type.String({
      description:
        "Attachment id (att_...) of the image to look at. " +
        "Omit to use the most recent image in the current session.",
    }),
  ),
  question: Type.String({
    description:
      "What to ask about the image, in the user's original language (do NOT translate to English). " +
      "Be specific: 'how many people are there?' beats 'describe this'.",
  }),
  model: Type.Optional(
    Type.String({
      description:
        "Vision model as `provider/modelId`. Omit to let the user pick interactively " +
        "(or to fall back to the configured default when no UI is available).",
    }),
  ),
});

/** 把内核结果转成 pi 工具结果:content 仅文本,details 承载结构化明细。 */
export function toToolResult(result: VisionResult): AgentToolResult<VisionResult> {
  const text = result.ok
    ? result.text
    : `图像识别失败(${result.reason})${result.detail !== undefined ? `: ${result.detail}` : ""}`;
  return { content: [{ type: "text", text }], details: result };
}

/** 从 pi 传入的裸参数中读出 {@link VisionParams}(运行时无 schema 保证,做窄化)。 */
function readParams(params: Record<string, unknown>): VisionParams {
  const question = typeof params["question"] === "string" ? params["question"] : "";
  const image = typeof params["image"] === "string" ? params["image"] : undefined;
  const model = typeof params["model"] === "string" ? params["model"] : undefined;
  return { question, image, model };
}

export type RunVisionTool = (
  params: VisionParams,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
) => Promise<VisionResult>;

/** 注册 `image_vision` 工具。 */
export function registerImageVision(pi: ExtensionAPI, run: RunVisionTool): void {
  pi.registerTool({
    name: "image_vision",
    label: "Image vision",
    description: DESCRIPTION,
    parameters: PARAMETERS,
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      return toToolResult(await run(readParams(params), ctx, signal));
    },
  });
}
