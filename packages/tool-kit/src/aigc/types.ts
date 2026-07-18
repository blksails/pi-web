/**
 * AIGC 工具的本地类型契约(纯类型,无运行时值导入)。
 *
 * detoolspec-unify-builtin-tools:取代原 `engine/types.ts` 的声明层。`ImageRoute` 是
 * provider 工厂的产出(`EndpointBehavior` + 路由元数据);`InteractionParam` 描述业务必选项
 * 的交互补全;`ToolExecuteDetails` 是工具 result 的 `details` 判别联合(形态与重构前一致)。
 */
import type { EndpointBehavior } from "../engine/endpoint-types.js";

/** 归属 provider 标识(UI 以字母徽章表示;工厂盖章)。 */
export type ImageProviderId = "openrouter" | "newapi" | "sufy" | "dashscope" | "ai-gateway";

/** 单一 model 的图像端点路由(= EndpointBehavior + 路由元数据)。 */
export interface ImageRoute extends EndpointBehavior {
  /** LLM 可见 model 值 + 运行时路由键。 */
  model: string;
  /** 展示标签(进工具 description 文案)。 */
  label: string;
  description?: string;
  /** 归属 provider(供 UI 徽章分组);各 provider 工厂盖章,清单下发给选择器。 */
  provider?: ImageProviderId;
}

/** 业务必选项的交互补全声明(缺失时经 `ctx.ui` 补全)。 */
export interface InteractionParam {
  /** 目标参数名(如 "model" / "size" / "prompt")。 */
  param: string;
  via: "select" | "input";
  title: string;
  placeholder?: string;
  /** select 选项;含哨兵 "$models" 时运行时展开为 routes 的 model 集合。 */
  options?: readonly string[];
  /** 无交互 UI 时的兜底值。 */
  fallback?: string;
}

/** 工具执行结果的 details 判别联合(与重构前 ToolExecuteDetails 形态一致)。 */
export type ToolExecuteDetails =
  | {
      ok: true;
      model: string;
      assets: {
        attachmentId: string;
        displayUrl: string;
        mimeType: string;
        name: string;
      }[];
    }
  | { ok: false; error: string };
