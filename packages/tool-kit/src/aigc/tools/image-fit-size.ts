/**
 * `image_fit_size` — 把已有图像精确裁到用户目标尺寸。
 *
 * 模型生图要求宽高为 16 倍数;用户常要 1080x1920 等非整步尺寸。
 * 本工具在生图后 cover/缩放到精确 W×H,也可由 agent 单独调用。
 */
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { getAttachmentToolContext } from "../../attachment/seam.js";
import { resolveInputToDataUri } from "../../attachment/persist.js";
import { fitDataUriToTarget } from "../fit-image.js";
import { formatSize, planModelAndTargetSize } from "../size-fit.js";
import type { ToolExecuteDetails } from "../types.js";

export function registerImageFitSize(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "image_fit_size",
    label: "Fit image size",
    description:
      "Fit an existing image to an exact output size (WxH). " +
      "Use after generation when the user asked for a size that is not a multiple of 16 " +
      "(e.g. 1080x1920). Cover-crops or scales to the exact target; never letterboxes.",
    parameters: Type.Object({
      image: Type.String({
        description: "Attachment id (att_…) or data URI of the image to fit.",
      }),
      size: Type.String({
        description: 'Target size as "1080x1920" / "1080*1920" or a ratio like "9:16".',
      }),
    }),
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<ToolExecuteDetails>> {
      const image = typeof params.image === "string" ? params.image : "";
      const size = typeof params.size === "string" ? params.size : "";
      const plan = planModelAndTargetSize(size);
      if (image.length === 0 || plan === undefined) {
        return {
          content: [{ type: "text", text: "image_fit_size: 需要 image 与合法 size(如 1080x1920)。" }],
          details: { ok: false, error: "invalid-args" },
        };
      }
      const att = getAttachmentToolContext();
      if (!att.available) {
        return {
          content: [{ type: "text", text: "image_fit_size: attachment 上下文未注入。" }],
          details: { ok: false, error: "no-attachment-ctx" },
        };
      }
      const dataUri = image.startsWith("att_") ? await resolveInputToDataUri(image, att) : image;
      const fitted = await fitDataUriToTarget(dataUri, plan.targetSize);
      if (fitted === undefined) {
        return {
          content: [
            {
              type: "text",
              text:
                `无法精确裁到 ${formatSize(plan.targetSize)}(缺少图像处理能力或输入不是图)。` +
                `模型侧可用尺寸为 ${formatSize(plan.modelSize)}。`,
            },
          ],
          details: { ok: false, error: "fit-unavailable" },
        };
      }
      const name = `fit-${formatSize(plan.targetSize)}.jpg`;
      const ref = await att.putOutput({ bytes: fitted.bytes, name, mimeType: fitted.mimeType });
      return {
        content: [
          {
            type: "text",
            text: `已裁到 ${formatSize(plan.targetSize)}。\n![${name}](${ref.displayUrl})`,
          },
        ],
        details: {
          ok: true,
          model: "image_fit_size",
          assets: [
            {
              attachmentId: ref.attachmentId,
              displayUrl: ref.displayUrl,
              mimeType: ref.mimeType,
              name: ref.name,
            },
          ],
        },
      };
    },
  });
}
