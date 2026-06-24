/**
 * attachment-tool-bridge · `afterToolCall` base64 剥离闸门 `makeAfterToolCall`
 * (task 3.2;Req 6.1, 6.2, 6.3, 6.4, 9.1, 9.3 + 2.2 调用级临时文件回收)。
 *
 * 在工具结果回到模型对话历史**之前**,集中守住一条出口边界:把 tool result `content`
 * 里的内联 `ImageContent`(裸 base64)剥离、替换为指向其公开 id 的**文本引用**,保留原
 * text 项;除非该结果被**显式标记需复看**(`details[KEEP_INLINE_FLAG] === true`)才保留图像。
 * 集中实现使各 tool 无需各自编写省 context 逻辑(6.3),守住「base64 仅具名出口」不变式
 * (9.1/9.3:未标记复看不在结果出口物化 base64)。末尾触发该次调用的临时文件回收(2.2)。
 *
 * 设计约束(design.md §base64-gate / §Error Handling):
 * - 遍历 `event.content`:
 *   - 无 `ImageContent` → 返回 `undefined` 原样透传(6.4),不改写无 base64 的内容与明细。
 *   - 有 `ImageContent` 且**未**标记复看 → 用文本引用替换每个 image 项、保留 text 项,
 *     返回 `{ content: 改写后 }`(6.1);整段替换 `content` 时保留非 image 的 text 部分(invariant)。
 *   - 有 `ImageContent` 且 `details[KEEP_INLINE_FLAG] === true` → 原样保留(返回 `undefined`
 *     透传,图像 base64 作为「需复看」具名出口物化,6.2/9.1)。
 * - 文本引用形态:优先 `[attachment id=… type=… name=…]`(当 `details` 携带产出附件元信息),
 *   否则退化为 `[image stripped → att_…]` 或纯 `[image stripped]`(design §base64-gate)。
 * - **末尾无条件**触发 `tracker.cleanupForCall(toolCallId)`(2.2):无论剥离 / 保留 / 透传,
 *   该次调用的懒下载临时文件都应在调用结束被回收;tracker 内部吞错不阻断(见 TempFileTracker)。
 *
 * 注意(类型来源,沿用 bridge 3.1 经验):design 以 `NonNullable<AgentLoopConfig["afterToolCall"]>`
 * 描述签名,但 `AgentLoopConfig` 属 pi 内层包(`@earendil-works/pi-agent-core`),本仓库刻意不直接
 * 依赖、其内层 `AfterToolCallResult` 类型不可达(见 `@blksails/pi-web-agent-kit` sdk-types 约定)。本闸门
 * 以 pi 公开面**同形**的本地接口描述 tool result content 形状(`(TextContent|ImageContent)[]`,
 * 字段与 `@earendil-works/pi-ai` `types.d.ts` 完全一致)与 hook 返回形状(`AfterToolCallResult
 * { content?, details?, isError?, terminate? }`),保持纯函数;runner 接线(task 5.1)适配。
 */
import type { TempFileTracker } from "./temp-files.js";

/** pi `TextContent` 同形(`@earendil-works/pi-ai` types.d.ts §TextContent)。 */
export interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;
}

/** pi `ImageContent` 同形(`@earendil-works/pi-ai` types.d.ts §ImageContent;`data` 为裸 base64 string)。 */
export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/** tool result `content` 项:文本或图像(pi `ToolResultMessage.content` 同形)。 */
export type ToolResultContent = TextContent | ImageContent;

/**
 * `afterToolCall` 闸门入参的最小读取面(对齐 pi `afterToolCall` hook 上下文):
 * 携带调用 id、结果内容与结构化明细。本闸门消费 `content`(剥离图像)、`details`(读复看标记)、
 * `toolCallId`(调用级回收)。
 */
export interface AfterToolCallGuardEvent {
  readonly toolCallId: string;
  /** 工具结果内容(pi `ToolResultMessage.content`:`(TextContent|ImageContent)[]`)。 */
  readonly content: readonly ToolResultContent[];
  /** 工具结构化明细(pi `AgentToolResult.details`);可携带「需复看」标记与产出附件元信息。 */
  readonly details?: Record<string, unknown>;
}

/**
 * `afterToolCall` 闸门返回(对齐 pi `AfterToolCallResult`):
 * 返回字段整段替换工具结果对应字段;返回 `undefined` 表示原样透传(不改写)。
 */
export interface AfterToolCallGuardResult {
  content?: ToolResultContent[];
  details?: Record<string, unknown>;
  isError?: boolean;
  terminate?: boolean;
}

/** `details` 上的「需复看」标记键约定:为 `true` 时保留内联图像不剥离(design §base64-gate)。 */
export const KEEP_INLINE_FLAG = "keepInlineImages";

/**
 * 为一个被剥离的内联图像生成稳定的文本引用项。
 *
 * 形态(design §base64-gate):优先 `[attachment id=att_… type=<mime> name=<name>]`
 * (当 `details` 携带产出附件 id/类型/名),否则 `[image stripped → att_…]`,
 * 再否则纯 `[image stripped]`。仅文本,绝不内联 base64(9.3)。
 */
function strippedImageRef(
  image: ImageContent,
  details: Record<string, unknown> | undefined,
): TextContent {
  const id = readString(details?.["outputAttachmentId"]) ?? readString(details?.["attachmentId"]);
  const name = readString(details?.["outputName"]) ?? readString(details?.["name"]);
  const type = image.mimeType || readString(details?.["mimeType"]);

  let text: string;
  if (id !== undefined) {
    const parts = [`id=${id}`];
    if (type !== undefined) parts.push(`type=${type}`);
    if (name !== undefined) parts.push(`name=${name}`);
    text = `[attachment ${parts.join(" ")}]`;
  } else {
    text = type !== undefined ? `[image stripped type=${type}]` : "[image stripped]";
  }
  return { type: "text", text };
}

/** 读取一个 unknown 为非空 string,否则 undefined。 */
function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * 构造 `afterToolCall` base64 剥离闸门。
 *
 * @param tracker 临时文件登记器;闸门末尾对**每次**调用触发 `cleanupForCall(toolCallId)`(2.2)。
 * @returns 一个异步闸门函数:剥离时返回 `{ content }`,标记复看 / 无图像时返回 `undefined` 透传。
 */
export function makeAfterToolCall(
  tracker: TempFileTracker,
): (
  event: AfterToolCallGuardEvent,
) => Promise<AfterToolCallGuardResult | undefined> {
  return async (event) => {
    try {
      const hasImage = event.content.some((c) => c.type === "image");

      // 无内联图像 → 原样透传,不改写内容与明细(Req 6.4)。
      if (!hasImage) return undefined;

      // 显式标记需复看 → 保留图像(「需复看」具名出口物化 base64),原样透传(Req 6.2/9.1)。
      const keepInline = event.details?.[KEEP_INLINE_FLAG] === true;
      if (keepInline) return undefined;

      // 默认剥离:image 项 → 文本引用,text 项保留(Req 6.1/9.3)。
      const content: ToolResultContent[] = event.content.map((item) =>
        item.type === "image" ? strippedImageRef(item, event.details) : item,
      );

      return { content };
    } finally {
      // 末尾无条件回收该次调用的临时文件(Req 2.2);tracker 内部吞错不阻断主流程。
      await tracker.cleanupForCall(event.toolCallId);
    }
  };
}
