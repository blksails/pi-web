/**
 * AIGC 工具的本地类型契约(纯类型,无运行时值导入)。
 *
 * detoolspec-unify-builtin-tools:取代原 `engine/types.ts` 的声明层。`ImageRoute` 是
 * provider 工厂的产出(`EndpointBehavior` + 路由元数据);`InteractionParam` 描述业务必选项
 * 的交互补全;`ToolExecuteDetails` 是工具 result 的 `details` 判别联合(形态与重构前一致)。
 */
import type { EndpointBehavior } from "../engine/endpoint-types.js";
import type { ToolPill } from "@blksails/pi-web-protocol";

/**
 * 内置(编译期已知)的图像 provider 标识。
 *
 * ⚠ 这**不是**取值的全集 —— 见 {@link ImageProviderId}。保留本联合是为了让内置工厂在
 * 拼错名字时仍能被编译期发现。
 */
export type BuiltinImageProviderId =
  | "openrouter"
  | "newapi"
  | "sufy"
  | "dashscope"
  | "token-plan"
  /** BlackSail 自建网关(`BLKSAILS_GATEWAY_*`),**不是** Cloudflare。 */
  | "ai-gateway"
  /** Cloudflare AI Gateway(`CLOUDFLARE_*`,spec cloudflare-aigc-provider)。 */
  | "cloudflare";

/**
 * 归属 provider 标识(UI 以字母徽章表示;工厂盖章)。
 *
 * ## ★ 为什么放宽为 string(spec desktop-aigc-egress 任务 3.3,Req 5.1/5.2)
 *
 * 此前这是一个**封闭**的字面量联合,隐含「图像 provider 的全集在编译期已知」这个假设。
 * 该假设在两处崩掉:
 *
 * 1. **网关是多实例的**。provider 名 = 网关实例标识(部署方经 `PI_WEB_GATEWAYS` 或云端
 *    授予定义),编译期不可能穷举。对话侧的 `GatewayModelEntry.provider` 已因同一原因
 *    在 `multi-gateway-providers` 里放宽过 —— 图像侧这次跟上,两侧身份就此统一。
 * 2. **展示归属曾被写死成常量**。`providers/ai-gateway.ts` 一度把 `provider` 固定为
 *    `"cloudflare"`(源码注释自述"把某个部署的配置写进了常量"),于是指向自建网关的部署
 *    在界面上仍显示 Cloudflare —— 使用者据此去理解计费与能力必然出错。
 *
 * 放宽后语义不变:它仍是「该模型由谁承接」。内置工厂应继续使用
 * {@link BuiltinImageProviderId} 中的字面量以保留拼写检查。
 */
export type ImageProviderId = BuiltinImageProviderId | (string & {});

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
      /** 工具卡 pill 行(ui-redesign pill 系统):agent 可随结果声明动作 pill。 */
      pills?: ToolPill[];
    }
  | { ok: false; error: string };
