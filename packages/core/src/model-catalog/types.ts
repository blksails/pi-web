/**
 * model-catalog · 目录组装的**契约类型**(spec: core-package-extraction,任务 3.1)。
 *
 * 这三个类型原本住在 `ai-gateway/model-catalog.ts`。把它们下沉到这里,是为了解除
 * `model-catalog(core) → ai-gateway(adapters)` 这条**跨层反向的值依赖**——
 * 它是内核提取继承下来的唯一一条已知欠债,不解除的话 core 包的依赖判据无法成立。
 *
 * ★ 类型下沉,**实现留在适配器**。`mergeModelCatalog` 不是自足纯函数:它依赖网关的
 *   provider 命名空间与「该模型能否用于会话」的判据,那两样都是 ai-gateway 的知识。
 *   把实现一起搬上来只会把 adapters 的知识偷渡进 core,换个位置继续违规。
 *   正解是 core 定契约、adapters 实现、装配层注入 —— 即本文件 + `MergeModelCatalog`。
 *
 * ★ 适配器侧从本文件引入并**原样 re-export**,故 `ai-gateway` 的导出面逐字不变,
 *   既有消费方(`lib/app/ai-gateway-session-assembly.ts` 等)无需跟随改动。
 */
import type { ModelOption, ModelOptions } from "../config/model-options.types.js";

/** 网关模型目录单条目。 */
export interface GatewayModelEntry {
  /** `/v1/models` 的 id。 */
  readonly model: string;
  /** `owned_by` → UI 徽章分组。 */
  readonly ownedBy: string;
  /**
   * ★ 放宽为 `string`(spec multi-gateway-providers 任务 3.2):此前固定字面量
   * `"ai-gateway"` 隐含「网关条目只可能来自单一来源」的假设,与多实例/多来源目录
   * 不兼容。放宽后其含义仍是「该条目属于 ai-gateway 类适配器产出」,具体归属哪个
   * 网关实例由 {@link GatewayModelEntry.instanceId} 承载。
   */
  readonly source: string;
  /**
   * 所属网关实例标识(spec multi-gateway-providers 任务 3.2,Req 1.2/1.3):
   * `mergeModelCatalog` 据此收敛条目的 `provider` 字段,而非硬拍固定常量 ——
   * 使两个同时启用的网关实例各自以其标识出现在 provider 清单中。
   */
  readonly instanceId: string;
}

/** 同名条目的**块排序**偏好(不做覆盖删除)。`"gateway"` = 网关块在前。 */
export type ModelPrecedence = "gateway" | "self";

/**
 * self 目录与网关目录的合并能力。由**装配层注入**;不注入 = 网关套件未启用。
 *
 * 合并语义(实现见 `ai-gateway/model-catalog.ts`)是 `self ∪ gateway` 不吞并:
 * 同名判定 key 为 `${provider}/${id}`,网关条目 provider 统一收敛,故两侧永不同 key。
 */
export type MergeModelCatalog = (
  selfEntries: readonly ModelOption[],
  gatewayEntries: readonly GatewayModelEntry[],
  precedence?: ModelPrecedence,
) => ModelOptions;
