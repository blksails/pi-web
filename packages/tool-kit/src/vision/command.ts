/**
 * `/img_vision` 命令注册 — 用户主动发起的图像理解入口。
 *
 * ⚠ `RegisteredCommand.handler` 的签名是 `(args, ctx) => Promise<void>` —— **无返回值**。
 * 因此结论**只能**经 `ctx.ui.notify` 呈现,不能指望它作为助手消息流回(6.3 / 6.4 由类型强制)。
 * 相应地,pi-web 前端对 `source === "extension"` 的命令走 fire-and-forget 投递
 * (`ui/src/chat/pi-chat.tsx`):无气泡、不进消息历史、不卡 busy。
 *
 * `args` 是**裸 string**(无结构化参数):整段作为提问;为空时用默认提问。
 * 图像固定走「最近一张图」缺省规则 —— 命令不接受 `att_` id,避免用户手抄 nanoid;
 * 需要指定图时请用 `image_vision` 工具。
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { describeError } from "./errors.js";
import { DEFAULT_QUESTION } from "./types.js";
import type { VisionResult } from "./types.js";
import type { RunVisionTool } from "./tools/image-vision.js";

/** 用户取消 / 主动中止不是故障,以信息级呈现。 */
const BENIGN_REASONS = new Set(["cancelled", "aborted"]);

/** 把内核结果映射为一次 `ctx.ui.notify` 调用。 */
export function notifyResult(ui: ExtensionCommandContext["ui"], result: VisionResult): void {
  if (result.ok) {
    ui.notify(result.text, "info");
    return;
  }
  const detail = result.detail !== undefined ? `: ${result.detail}` : "";
  const level = BENIGN_REASONS.has(result.reason) ? "info" : "error";
  ui.notify(`图像识别失败(${result.reason})${detail}`, level);
}

/** 注册 `/img_vision` 命令。 */
export function registerImgVisionCommand(pi: ExtensionAPI, run: RunVisionTool): void {
  pi.registerCommand("img_vision", {
    description: "看一张图并回答问题（对会话内最近一张图发起视觉识别）",
    async handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
      try {
        const question = args.trim().length > 0 ? args.trim() : DEFAULT_QUESTION;
        // 命令 handler 无 `signal` 形参,中止信号取自上下文。
        const result = await run({ question }, ctx, ctx.signal);
        notifyResult(ctx.ui, result);
      } catch (err) {
        // 内核已 fail-soft;此处仅兜底,绝不让命令中断会话(7.1)。
        try {
          ctx.ui.notify(`图像识别失败: ${describeError(err)}`, "error");
        } catch {
          /* notify 亦失败时静默,不再升级 */
        }
      }
    },
  });
}
