/**
 * vision 识别内核 — 工具入口与命令入口共用的唯一编排器。
 *
 * 编排顺序:附件能力可用性 → 取图 → 选模型 → **解析凭据** → 调模型 → 组装结果。
 *
 * ⚠ 关键决策(凭据):`completeSimple` **不会**从 `models.json` 解析凭据。其内部
 * `withEnvApiKey`(pi-ai `compat.js`)仅在 `options.apiKey` 缺省时回落**环境变量**。
 * 本仓目标 provider(如 apiservices 网关)的 key 只存在于 `~/.pi/agent/models.json`,
 * 因此必须先 `registry.getApiKeyAndHeaders(model)` 再显式传入 —— auto-title 未做这一步
 * 是因为它用 `ctx.model`(主模型,key 恰在 env 中)。照抄 auto-title 会直接 401。
 *
 * 不变式:本函数**永不抛出**,一律返回 {@link VisionResult};结果只含文字,绝不含图像字节。
 */
import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createLogger } from "@blksails/pi-web-logger";
import { describeError, fail } from "./errors.js";
import { resolveImageSource } from "./resolve-image.js";
import { modelKey, selectVisionModel } from "./select-model.js";
import type {
  ResolvedImage,
  VisionParams,
  VisionResult,
  VisionRunnerDeps,
} from "./types.js";

const log = createLogger({ namespace: "vision:run" });

/**
 * 中止判定。
 *
 * 刻意写成函数而非内联比较:内联时 TS 控制流会在首次判否后把 `signal?.aborted`
 * 永久窄化为 `false | undefined`,导致后续同样的比较被判为「无重叠」。
 * 而 `aborted` 在每次 `await` 之间都可能翻转,必须每次重新读取。
 */
function isAborted(signal: AbortSignal | undefined): boolean {
  if (signal === undefined) return false;
  return signal.aborted;
}

/** 从模型应答中拼接全部文本段;无文本返回空串。 */
export function extractText(msg: AssistantMessage): string {
  const content: unknown = msg.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("")
    .trim();
}

/** 构造单条 user message:文本段 + 图像段(图像 data 为裸 base64)。 */
export function buildVisionContext(question: string, image: ResolvedImage): Context {
  return {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image", data: image.base64, mimeType: image.mimeType },
        ],
      },
    ],
  } as Context;
}

/**
 * 构造识别内核。`deps` 注入使内核可在无真实模型/附件存储下单测。
 */
export function createVisionRunner(
  deps: VisionRunnerDeps,
): (
  params: VisionParams,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
) => Promise<VisionResult> {
  return async function runVisionTool(params, ctx, signal) {
    try {
      if (isAborted(signal)) return fail("aborted", "调用在开始前已被中止");

      // 1) 附件能力先于一切:seam 未接线时直接短路,避免误报「无可用模型」。
      const attCtx = deps.getAttachmentCtx();
      if (!attCtx.available) {
        return fail("attachment_unavailable", "附件能力不可用(存储未配置)");
      }

      // 2) 取图。失败率更高且更便宜,先失败先返回,避免无谓弹窗打扰用户。
      const image = await resolveImageSource(params.image, attCtx);
      if ("ok" in image && image.ok === false) return image;
      const resolved = image as ResolvedImage;

      if (isAborted(signal)) return fail("aborted", "取图后被中止");

      // 3) 选模型。
      const picked = await selectVisionModel({
        requested: params.model,
        registry: ctx.modelRegistry,
        ui: ctx.hasUI ? ctx.ui : undefined,
        hasUI: ctx.hasUI,
        defaultModel: deps.defaultModel(),
      });
      if ("ok" in picked && picked.ok === false) return picked;
      const model = picked as Model<Api>;
      const key = modelKey(model);

      if (isAborted(signal)) return fail("aborted", "选模型后被中止");

      // 4) 显式解析凭据(见文件头「关键决策」)。
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) return fail("model_auth_failed", auth.error);

      // 5) 调模型。
      const started = Date.now();
      let msg: AssistantMessage;
      try {
        msg = await deps.complete(model, buildVisionContext(params.question, resolved), {
          apiKey: auth.apiKey,
          headers: auth.headers,
          env: auth.env,
          signal,
        });
      } catch (err) {
        if (isAborted(signal)) return fail("aborted", "模型调用期间被中止");
        return fail("call_failed", describeError(err));
      }

      const text = extractText(msg);
      if (text.length === 0) return fail("call_failed", "模型未返回任何文本结论");

      log.debug("vision 识别完成", {
        model: key,
        mimeType: resolved.mimeType,
        bytes: resolved.base64.length,
        elapsedMs: Date.now() - started,
      });

      return { ok: true, text, model: key };
    } catch (err) {
      // 兜底:任何未预期异常都不得中断会话(7.1)。
      log.debug("vision 识别异常(已吞)", { err: describeError(err) });
      return fail("call_failed", describeError(err));
    }
  };
}

/** 默认模型来源:环境变量。 */
export function envDefaultModel(envVar: string): () => string | undefined {
  return () => {
    const raw = process.env[envVar];
    return raw !== undefined && raw.length > 0 ? raw : undefined;
  };
}
