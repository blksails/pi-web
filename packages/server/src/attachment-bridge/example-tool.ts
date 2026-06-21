/**
 * attachment-tool-bridge · 端到端示例 AgentTool 工厂 `createEditImageTool`
 * (task 4.2;Req 4.2, 4.3, 4.4, 4.5, 7.1, 7.2, 7.3)。
 *
 * 一个**协议兼容**的示例图像工具,演示 attachment-tool-bridge 的完整接入范式:
 *  - 以显式 `attachmentId` 参数承载输入引用(pi 协议无文件引用原语,只能走 tool JSON 参数,Req 4.2);
 *  - 在 `execute` 内用 `ctx.resolve(attachmentId)` 取句柄,**演示三种解析用法**:
 *    本地路径(`handle.localPath()`)、网络 URL(`handle.url()`)、原始字节(`handle.bytes()`)(Req 4.5);
 *  - 产出新字节经 `ctx.putOutput(...)` **先落库后引用**(`origin:"tool-output"`、同一 id 空间,Req 7.1/7.2/7.3);
 *  - 返回 pi `AgentToolResult`:**必填** `description`(在工具定义上)与**必填** `details`(结构化结果明细,Req 4.4);
 *  - 若回图,`ImageContent.data` 为**已 await 求值的裸 base64 字符串**(不是未求值的 Promise,Req 4.3)。
 *
 * 工具经**工厂构造时闭包注入** {@link AttachmentToolContext}(子进程 store + 当前 sessionId 已绑定),
 * 故 pi 的 `execute(toolCallId, params, signal, onUpdate, ctx)` 第五参 `ctx`(pi ExtensionContext)
 * 与本工具无关;附件能力经闭包的 {@link AttachmentToolContext} 取得(design.md §customTools 注入)。
 *
 * 注意(打包边界):本文件值导入 pi SDK(`defineTool`)与 pi-ai(`Type`),**不得**经
 * `attachment-bridge/index.ts`(被主 barrel `export *`)重导出 —— 否则会把整套 pi SDK 拉进
 * Next 服务端 bundle、破坏 webpack external 边界。本文件仅由 runner 子进程装配与测试直接相对路径导入。
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AttachmentToolContext } from "./tool-context.js";

/**
 * 示例工具结构化结果明细(pi `AgentToolResult.details`,必填,Req 4.4)。
 *
 * 成功:承载产出附件的公开 id 与展示 URL(引用回流,不含字节),并以 `resolvedForms`
 * 标记三种解析用法是否各自可达(端到端演示 Req 4.5);若回图,`returnedImage` 为 `true`。
 * 失败:`ok:false` + `error` 文本说明(解析/落库失败时,不回半引用,Req 7.4)。
 */
export type EditImageToolDetails =
  | {
      readonly ok: true;
      /** 产出附件公开 id(`att_<nanoid>`,与上传 id 同一空间,Req 7.2)。 */
      readonly outputAttachmentId: string;
      /** 客户端可达展示 URL(经既有分发 URL 呈现,Req 7.3)。 */
      readonly displayUrl: string;
      /** 输入附件公开 id(回引用,便于审计跨轮回环)。 */
      readonly inputAttachmentId: string;
      /** 三种 resolve 用法各自是否可达(端到端演示,Req 4.5)。 */
      readonly resolvedForms: {
        readonly localPath: boolean;
        readonly url: boolean;
        readonly bytes: boolean;
      };
      /** 是否在 content 里回图(image content,Req 4.3)。 */
      readonly returnedImage: boolean;
    }
  | {
      readonly ok: false;
      /** 失败说明(解析/落库失败)。 */
      readonly error: string;
    };

/** 示例工具参数:显式 `attachmentId` 承载输入引用(Req 4.2)+ 可选回图开关。 */
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

/**
 * 把字节编码为裸 base64 字符串(无 `data:` 前缀)。
 *
 * 注意:返回**已物化的 string**(同步返回),供 `ImageContent.data` 直接承载 —— 调用方在赋值前
 * 已 `await` 完所有异步取数(`bytes()`),此处编码本身同步、不引入 Promise(守 Req 4.3)。
 */
function toBareBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * 极简「图像处理」:把输入字节按调色翻转(逐字节取反)产出新字节。
 *
 * 仅用于端到端演示「输入字节 → 处理 → 产出新字节 → 落库回流」闭环;非真实图像编辑算法。
 * 产出与输入**字节不同**(除非全 0x80),便于断言回流的是新落库附件而非原样透传。
 */
function transformBytes(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    // 0xff ^ b:逐字节取反,保证产出与输入不同(端到端可区分)。
    out[i] = 0xff ^ (input[i] as number);
  }
  return out;
}

/**
 * 构造示例图像编辑工具,闭包注入 {@link AttachmentToolContext}(Req 4.1/4.2/4.3/4.4/4.5/7.x)。
 *
 * @param ctx tool 接入上下文(子进程 store + 当前 sessionId 已闭包绑定)。
 * @returns 协议兼容的 pi {@link ToolDefinition},可直接装配进 `defineAgent({ customTools: [...] })`。
 *   返回的 `defineTool` 结果带 `& AnyToolDefinition` 交叉,使其可赋入 `ToolDefinition[]`
 *   (`customTools`)而不触发参数协变冲突。`details` 的强类型见 {@link EditImageToolDetails}。
 */
export function createEditImageTool(
  ctx: AttachmentToolContext,
): ReturnType<typeof defineTool<typeof EditImageParameters, EditImageToolDetails>> {
  return defineTool({
    name: "edit_image",
    label: "Edit Image",
    // 必填 description(Req 4.4)。
    description:
      "Edit an uploaded image referenced by its attachmentId. Resolves the input " +
      "attachment, transforms it, persists the result as a new attachment, and " +
      "returns a reference (and optionally the produced image inline).",
    parameters: EditImageParameters,
    async execute(_toolCallId, params): Promise<{
      content: Array<
        { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
      >;
      details: EditImageToolDetails;
    }> {
      // 能力不可用(env 缺失降级)→ 安全早返回,不崩溃(Req 3.4)。
      if (!ctx.available) {
        return {
          content: [
            { type: "text", text: "Attachment capability is not available." },
          ],
          details: { ok: false, error: "attachment capability unavailable" },
        };
      }

      try {
        // 1) 解析输入附件(属主已由 beforeToolCall 前置保证)。
        const handle = await ctx.resolve(params.attachmentId);

        // 2) 演示三种 resolve 用法(Req 4.5):本地路径 / 网络 URL / 原始字节。
        //    —— localPath:LocalFs 直返落盘路径(不复制),证明本地路径形态可达。
        const localPath = await handle.localPath();
        //    —— url:客户端可达展示 URL(与分发签名同形),证明 URL 形态可达。
        const url = await handle.url();
        //    —— bytes:原始字节,作为「处理」的实际输入,证明字节形态可达。
        const inputBytes = await handle.bytes();

        const resolvedForms = {
          localPath: localPath.length > 0,
          url: url.length > 0,
          bytes: inputBytes.length > 0,
        };

        // 3) 处理产出新字节。
        const outputBytes = transformBytes(inputBytes);
        const outName = `edited-${handle.meta.name}`;
        const outMime = handle.meta.mimeType;

        // 4) 先落库后引用(Req 7.1/7.2/7.3):putOutput 失败抛错 → 不回半引用(Req 7.4,落到 catch)。
        const ref = await ctx.putOutput({
          bytes: outputBytes,
          name: outName,
          mimeType: outMime,
        });

        // 5) 组装回流 content + details。
        const returnImage = params.returnImage === true;
        const content: Array<
          { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
        > = [
          {
            type: "text",
            text:
              `Edited image. Result attachment id=${ref.attachmentId} ` +
              `type=${ref.mimeType} name=${ref.name}.`,
          },
        ];
        if (returnImage) {
          // ImageContent.data 必须为**已 await 求值**的裸 base64 字符串(Req 4.3):
          // outputBytes 已物化、toBareBase64 同步编码 → data 是 string,非 Promise/thenable。
          content.push({
            type: "image",
            data: toBareBase64(outputBytes),
            mimeType: outMime,
          });
        }

        return {
          content,
          details: {
            ok: true,
            outputAttachmentId: ref.attachmentId,
            displayUrl: ref.displayUrl,
            inputAttachmentId: params.attachmentId,
            resolvedForms,
            returnedImage: returnImage,
          },
        };
      } catch (err) {
        // 解析/落库失败:以 details 标失败 + 简短 text,不回半引用、不崩溃子进程(Req 7.4)。
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to edit image: ${message}` }],
          details: { ok: false, error: message },
        };
      }
    },
  });
}
