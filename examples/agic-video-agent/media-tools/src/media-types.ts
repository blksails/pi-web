/**
 * `@aigc-agent/media-tools` 本地类型契约(纯类型,无运行时值导入 → 前端安全)。
 *
 * 与 `@blksails/pi-web-tool-kit` 的 `ImageRoute`/`InteractionParam` 同构,但把 provider
 * 放宽到媒体域(含 ark / local-ffmpeg),并携带产出 `kind` 供渲染器判别。
 */
import type { EndpointBehavior } from "@blksails/pi-web-tool-kit/runtime";

/** 归属 provider 标识(UI 可作徽章分组)。 */
export type MediaProviderId =
  | "dashscope"
  | "ark"
  | "openrouter"
  | "newapi"
  | "sufy"
  | "local-ffmpeg";

/** 产出媒体类别(供渲染器与结果信封判别)。 */
export type MediaKind = "image" | "video" | "audio";

/** 单一 model 的媒体端点路由(= EndpointBehavior + 路由元数据)。 */
export interface MediaRoute extends EndpointBehavior {
  /** LLM 可见 model 值 + 运行时路由键。 */
  model: string;
  /** 展示标签(进工具 description 文案)。 */
  label: string;
  description?: string;
  provider?: MediaProviderId;
}

/** 落库后的稳定媒体引用。 */
export interface MediaAsset {
  attachmentId: string;
  displayUrl: string;
  mimeType: string;
  name: string;
}

/** 工具执行结果的 details 判别联合(前端渲染器据 kind + assets[].mimeType 选渲染)。 */
export type MediaToolDetails =
  | { ok: true; model: string; kind: MediaKind; assets: MediaAsset[] }
  | { ok: false; error: string };

/** 业务必选项的交互补全声明(缺失时经 `ctx.ui` 补全)。 */
export interface InteractionParam {
  /** 目标参数名(如 "model" / "prompt")。 */
  param: string;
  via: "select" | "input";
  title: string;
  placeholder?: string;
  /** select 选项;含哨兵 "$models" 时运行时展开为 routes 的 model 集合。 */
  options?: readonly string[];
  /** 无交互 UI 时的兜底值。 */
  fallback?: string;
}
