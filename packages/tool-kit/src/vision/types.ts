/**
 * vision 契约层 — 视觉识别(image_vision / img_vision)的结果判别联合与依赖契约。
 *
 * 本模块是 {@link VisionFailureReason} 的**唯一权威**:新增失败原因须同步 requirements 7.2
 * 的可区分性断言。零运行时依赖(纯类型 + 常量),不含 pi SDK 值导入。
 *
 * 设计要点:
 * - 内核 `runVisionTool` 永不抛出,一律返回 {@link VisionResult};适配层据 `ok` 分流。
 * - 失败结果**绝不携带图像字节**(`detail` 仅人类可读说明)。
 * - {@link VisionRunnerDeps} 使模型调用与附件上下文可在测试中替换(沿用 auto-title 形态)。
 */
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";

/**
 * 失败原因(判别联合的判别键)。十种取值两两互斥,对应 requirements 7.2 的可区分性要求。
 */
export type VisionFailureReason =
  /** 附件 seam 未接线(env 缺失),`available === false`。 */
  | "attachment_unavailable"
  /** 未指定图像且当前会话内不含任何图像(1.5)。 */
  | "no_image"
  /** 指定的附件引用无法解析(1.3)。 */
  | "attachment_not_found"
  /** 指定的附件存在但不是图像(1.4)。 */
  | "not_an_image"
  /** 无任何「支持图像输入且凭据可用」的候选模型(2.4 / 4.5)。 */
  | "no_vision_model"
  /** 调用显式指定的模型不在候选清单中(3.4)。 */
  | "unknown_model"
  /** 用户在模型选择器中取消(3.3)。 */
  | "cancelled"
  /** 收到中止信号(5.6)。 */
  | "aborted"
  /** 模型凭据解析失败(registry 未能给出 apiKey/headers)。 */
  | "model_auth_failed"
  /** 模型调用失败、超时,或应答不含任何文本(5.5)。 */
  | "call_failed";

/** 识别成功。 */
export interface VisionOk {
  readonly ok: true;
  /** 模型产出的文字结论;非空(5.2)。 */
  readonly text: string;
  /** 实际使用的模型,形如 `provider/modelId`(5.3)。 */
  readonly model: string;
}

/** 识别失败;`detail` 为人类可读补充,**不含图像字节**。 */
export interface VisionFail {
  readonly ok: false;
  readonly reason: VisionFailureReason;
  readonly detail?: string;
}

/** 内核返回值:永不为 `undefined`,永不抛出。 */
export type VisionResult = VisionOk | VisionFail;

/** 调用方入参(工具与命令归一后的形状)。 */
export interface VisionParams {
  /** `att_<id>` 引用;省略则取会话内最近一张图(1.2)。 */
  readonly image?: string;
  /** 要问图像什么。 */
  readonly question: string;
  /** 形如 `provider/modelId`;省略则交互选择或降级(3.1 / 3.2)。 */
  readonly model?: string;
}

/**
 * 已取回的图像。`base64` 是**裸 base64**(无 `data:` 前缀),
 * 直接对应 pi-ai `ImageContent.data` 的形状。
 */
export interface ResolvedImage {
  readonly base64: string;
  readonly mimeType: string;
  readonly attachmentId: string;
}

/**
 * 一次性模型调用签名(默认注入 pi-ai `completeSimple`)。
 *
 * `options` 必填:内核**必须**显式传入由 registry 解析出的 `apiKey`/`headers`/`env`——
 * `completeSimple` 内部仅在 `options.apiKey` 缺省时回落**环境变量**,而目标 provider 的
 * 凭据只存在于 `~/.pi/agent/models.json`。
 */
export type CompleteFn = (
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
) => Promise<AssistantMessage>;

/** 注入式依赖,使内核可在无真实模型、无真实附件存储下单测。 */
export interface VisionRunnerDeps {
  /** 一次性模型调用。 */
  readonly complete: CompleteFn;
  /** 取 runner 注入的附件上下文(默认 `getAttachmentToolContext`)。 */
  readonly getAttachmentCtx: () => AttachmentToolContext;
  /** 默认视觉模型(`provider/modelId`);默认读 `process.env.PI_WEB_VISION_MODEL`。 */
  readonly defaultModel: () => string | undefined;
}

/** 默认视觉模型的环境变量名(M1 唯一的默认模型来源;M2 引入 config 域后作为覆盖层保留)。 */
export const VISION_MODEL_ENV = "PI_WEB_VISION_MODEL";

/** 命令入口在 args 为空时使用的默认提问。 */
export const DEFAULT_QUESTION = "描述这张图片的内容。";
