/**
 * attachment-tool-agent · 示例图像工具 `edit_image`(attachment-tool-bridge task 4.2)。
 *
 * 这是 {@link file://packages/server/src/attachment-bridge/example-tool.ts} 的**端到端 e2e 形态**:
 * 同一接入范式(显式 `attachmentId` 参数 → `ctx.resolve` 三形态 → `ctx.putOutput` 落库回引用 →
 * 回图 `data` 为已 await 的裸 base64 string),但写成「examples/ 下经 jiti 真实加载、装配为
 * customTool」的可运行形态,供浏览器 e2e(task 6.2)真实跑通整链路。
 *
 * **`AttachmentToolContext` 注入(runner 装配,task 5.1)**:运行在 runner 子进程的本工具,其附件
 * 接入上下文由 runner 在装配 `customTools` 时以**闭包注入**(子进程 store + 当前 sessionId 已绑定,
 * 见 design.md §customTools 注入)。在 5.1 落地前/装配缺失时,`getAttachmentToolContext()` 返回一个
 * `available:false` 的安全降级上下文,使本工具仍可加载并报「附件能力不可用」,而非崩溃(Req 3.4)。
 *
 * 类型契约经 `@blksails/agent-kit` 引用(仅类型,无值依赖到 `@blksails/server`,守 webpack external 边界)。
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AttachmentToolContext } from "@blksails/agent-kit";

/**
 * runner 装配(task 5.1)在子进程内把闭包绑定的 {@link AttachmentToolContext} 挂到该约定 key 上;
 * 本示例据此取得上下文。约定 key 与 5.1 装配端一致(单一约定,避免示例与装配各执一词)。
 */
const ATTACHMENT_CTX_KEY = "__piWebAttachmentToolContext__";

/** 安全降级上下文:5.1 装配缺失/能力不可用时使用,`resolve`/`putOutput` 拒绝而不崩溃(Req 3.4)。 */
const UNAVAILABLE_CTX: AttachmentToolContext = {
  available: false,
  async resolve() {
    throw new Error("attachment capability unavailable: context not injected");
  },
  async putOutput() {
    throw new Error("attachment capability unavailable: context not injected");
  },
};

/** 取得 runner 注入的附件接入上下文(缺失 → 安全降级,Req 3.4)。 */
function getAttachmentToolContext(): AttachmentToolContext {
  const injected = (globalThis as Record<string, unknown>)[ATTACHMENT_CTX_KEY];
  if (
    injected &&
    typeof injected === "object" &&
    "available" in (injected as object)
  ) {
    return injected as AttachmentToolContext;
  }
  return UNAVAILABLE_CTX;
}

const EditImageParameters = Type.Object({
  attachmentId: Type.String({
    description:
      "Public id (att_<nanoid>) of the input image attachment to edit. " +
      "Copy it verbatim from the [attachment id=…] reference in the user message.",
  }),
  returnImage: Type.Optional(
    Type.Boolean({
      description:
        "When true, also return the produced image inline (base64) for the model to review. " +
        "Defaults to false: only a reference to the produced attachment is returned.",
    }),
  ),
});

/** 字节 → 裸 base64 string(已物化、同步;供 ImageContent.data 直接承载,守 Req 4.3)。 */
function toBareBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** 极简「图像处理」:逐字节取反产出新字节(端到端可区分;非真实图像算法)。 */
function transformBytes(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = 0xff ^ (input[i] as number);
  return out;
}

/**
 * 示例图像编辑工具:解析输入(三形态)→ 处理 → 落库(tool-output)→ 回引用(Req 4.2/4.3/4.4/4.5/7.x)。
 */
export const editImageTool: ToolDefinition<typeof EditImageParameters> =
  defineTool({
    name: "edit_image",
    label: "Edit Image",
    description:
      "Edit an uploaded image referenced by its attachmentId. Resolves the input " +
      "attachment, transforms it, persists the result as a new attachment, and " +
      "returns a reference (and optionally the produced image inline).",
    parameters: EditImageParameters,
    async execute(_toolCallId, params) {
      const ctx = getAttachmentToolContext();
      if (!ctx.available) {
        return {
          content: [
            { type: "text", text: "Attachment capability is not available." },
          ],
          details: { ok: false, error: "attachment capability unavailable" },
        };
      }

      try {
        const handle = await ctx.resolve(params.attachmentId);

        // 演示三种 resolve 用法(Req 4.5):本地路径 / 网络 URL / 原始字节。
        const localPath = await handle.localPath();
        const url = await handle.url();
        const inputBytes = await handle.bytes();

        const outputBytes = transformBytes(inputBytes);
        const ref = await ctx.putOutput({
          bytes: outputBytes,
          name: `edited-${handle.meta.name}`,
          mimeType: handle.meta.mimeType,
        });

        const returnImage = params.returnImage === true;
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [
          {
            type: "text",
            text:
              `Edited image. Result attachment id=${ref.attachmentId} ` +
              `type=${ref.mimeType} name=${ref.name}.`,
          },
        ];
        if (returnImage) {
          // data 为已 await 求值的裸 base64 string(非 Promise,Req 4.3)。
          content.push({
            type: "image",
            data: toBareBase64(outputBytes),
            mimeType: ref.mimeType,
          });
        }

        return {
          content,
          details: {
            ok: true,
            outputAttachmentId: ref.attachmentId,
            displayUrl: ref.displayUrl,
            inputAttachmentId: params.attachmentId,
            resolvedForms: {
              localPath: localPath.length > 0,
              url: url.length > 0,
              bytes: inputBytes.length > 0,
            },
            returnedImage: returnImage,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to edit image: ${message}` }],
          details: { ok: false, error: message },
        };
      }
    },
  });
