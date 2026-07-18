/**
 * active-models — 「活跃图像模型清单」的单一事实源推导(canvas-actions-m2)。
 *
 * 自 `extension.ts` 的 `publishAigcCatalog` 提取的纯函数:把「生成∪编辑」路由并集按被禁集合过滤,
 * 去重(同一 model 首次出现胜出、插入序保持)得到有序模型清单。供两处同源消费:
 *  - `publishAigcCatalog` → `aigc.models/modelLabels/modelProviders` KV 下发(prompt-toolbar 选择器);
 *  - `buildCanvasCapability` → Canvas 能力清单快照(workbench/quick-settings)。
 *
 * 提取即纯重构:KV 的键、值、顺序与提取前逐字节等价(现实数据中每条路由均带 provider,
 * label/provider 均取模型首次出现值)。属 runtime 层(经路由表间接引 pi SDK 值),不进前端 bundle。
 */
import {
  IMAGE_GENERATION_ROUTES,
  IMAGE_GENERATION_DEFAULT_MODEL,
} from "./tools/image-generation.js";
import { IMAGE_EDIT_ROUTES } from "./tools/image-edit.js";
import { filterRoutes } from "./model-config.js";
import type { ImageProviderId, ImageRoute } from "./types.js";

/** 单个活跃模型条目(稳定 id + 展示标签 + 归属 provider)。 */
export interface ActiveModelEntry {
  /** LLM 可见 model 值 + 运行时路由键。 */
  readonly model: string;
  /** 展示标签(模型首次出现的路由 label)。 */
  readonly label: string;
  /** 归属 provider(首个带 provider 的路由值;供尺寸族/徽章分组)。 */
  readonly provider?: ImageProviderId;
}

/**
 * 按被禁集合推导有序活跃模型清单。纯函数,不依赖外部可变状态:
 *  - 路由源 = 生成∪编辑并集(含调用方按 env 条件传入的 `extraRoutes`,如
 *    ai-gateway-providers spec 的 `AI_GATEWAY_IMAGE_ROUTES`/`AI_GATEWAY_IMAGE_EDIT_ROUTES`,
 *    Req 4.2),经 {@link filterRoutes}(全禁时保留默认模型,与工具侧一致);
 *  - 同一 model 去重:label 取首次出现值,provider 取首个带 provider 的路由值;
 *  - 插入序 = 各 model 首次出现序(= 旧 `Object.keys(labelByModel)` 序)。
 *
 * @param extraRoutes 缺省 `[]`——未传入时行为与提取前逐字节等价。
 */
export function deriveActiveModels(
  disabledModels: ReadonlySet<string>,
  extraRoutes: readonly ImageRoute[] = [],
): readonly ActiveModelEntry[] {
  const activeRoutes = filterRoutes(
    [...IMAGE_GENERATION_ROUTES, ...IMAGE_EDIT_ROUTES, ...extraRoutes],
    disabledModels,
    IMAGE_GENERATION_DEFAULT_MODEL,
  );
  const byModel = new Map<string, { model: string; label: string; provider?: ImageProviderId }>();
  const order: string[] = [];
  for (const r of activeRoutes) {
    const existing = byModel.get(r.model);
    if (existing === undefined) {
      byModel.set(r.model, { model: r.model, label: r.label, provider: r.provider });
      order.push(r.model);
    } else if (existing.provider === undefined && r.provider !== undefined) {
      existing.provider = r.provider;
    }
  }
  return order.map((m) => {
    const e = byModel.get(m)!;
    return e.provider === undefined
      ? { model: e.model, label: e.label }
      : { model: e.model, label: e.label, provider: e.provider };
  });
}
