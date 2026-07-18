/**
 * model-catalog · ModelCatalogService — chat/image 双命名空间目录组装与过滤的
 * **单一权威**(model-catalog spec design.md「ModelCatalogService」组件块,
 * Req 1.1–1.4, 3.1, 4.1, 4.3, 5.1–5.4)。
 *
 * 定位与不变式:
 * - **组装,不取数**:各来源(self 对话取数、网关快照、图像静态目录、隐藏名单)
 *   全部经构造注入;自身零 env 读取、零 IO(纯依赖注入,便于单测)。
 * - **命名空间边界**:hidden(`PI_WEB_HIDE_PROVIDERS`)过滤仅作用于 chat 命名空间
 *   (Req 5.1);image 命名空间**不吃** hidden(图像工具 provider 命名空间独立,
 *   避免「工具可跑但清单不可见」偏差,Req 5.2)。
 * - **零侵入**:gateway 来源未注入(= 未启用 ai-gateway 套件)时,chat 输出对
 *   `listSelfChat()` 结果只做 hidden 过滤,hidden 为空集时直接返回原对象(引用级
 *   透传,字节一致,Req 1.3);image 输出 === 注入的静态目录(同,Req 4.3)。
 * - fail-soft:网关快照的既有 fail-soft 语义(拉取失败/从未成功 → 空集)原样透传,
 *   空集时行为 = merge 空数组,不阻断、不报错(Req 1.4)。
 *
 * 消费方:lib/app/pi-handler 装配处构造一次,`GET /api/config/models` 与
 * `GET /api/aigc/models` 均改经本服务取数(task 3.1)。
 */
import type { AigcCatalogEntry } from "@blksails/pi-web-tool-kit";
import { mergeModelCatalog } from "../ai-gateway/model-catalog.js";
import type { GatewayModelEntry, ModelPrecedence } from "../ai-gateway/model-catalog.js";
import { excludeProviders } from "../config/model-options-filter.js";
import type { ModelOptions } from "../config/model-options.types.js";

/** `createModelCatalogService` 的注入依赖(装配期一次性构造)。 */
export interface ModelCatalogServiceDeps {
  /** self 对话目录取数(既有 listModelOptions 闭包,hidden 过滤前的原始集)。 */
  readonly listSelfChat: () => ModelOptions;
  /** 网关对话目录快照;未启用 ai-gateway 时不注入(注入与否即启用判别)。 */
  readonly gatewayChat?: { get(): readonly GatewayModelEntry[] };
  /** 同名排序偏好(merge 的块排序,不做覆盖删除;缺省 `"gateway"`)。 */
  readonly modelPrecedence?: ModelPrecedence;
  /** 图像静态目录(self)。 */
  readonly imageCatalog: readonly AigcCatalogEntry[];
  /** 网关图像静态目录;未启用时不注入。 */
  readonly gatewayImageCatalog?: readonly AigcCatalogEntry[];
  /** chat 命名空间隐藏 provider 集合(image 命名空间不受其影响)。 */
  readonly hiddenProviders: ReadonlySet<string>;
}

/** 图像目录输出条目:静态条目 + 可选来源标记(仅聚合形态附带,响应只增不改)。 */
export type CatalogImageEntry = AigcCatalogEntry & {
  readonly source?: "self" | "ai-gateway";
};

/** chat/image 双命名空间目录的组装与过滤单一权威。 */
export interface ModelCatalogService {
  /** GET /config/models 数据:providers=self-only(过滤后),models=self∪gateway(过滤后)。 */
  chatOptions(): ModelOptions;
  /** GET /aigc/models 数据:静态∪网关条目(带 source),不吃 hidden 过滤。 */
  imageEntries(): readonly CatalogImageEntry[];
}

/** 构造目录组装服务(纯组装,零 env 读取、零 IO)。 */
export function createModelCatalogService(
  deps: ModelCatalogServiceDeps,
): ModelCatalogService {
  const {
    listSelfChat,
    gatewayChat,
    modelPrecedence,
    imageCatalog,
    gatewayImageCatalog,
    hiddenProviders,
  } = deps;
  return {
    chatOptions(): ModelOptions {
      const self = listSelfChat();
      if (gatewayChat === undefined) {
        // 未启用网关:只做 hidden 过滤;hidden 空集时 excludeProviders 走零拷贝
        // 快路径,返回 self 原引用(字节一致,Req 1.3)。
        return excludeProviders(self, hiddenProviders);
      }
      // 聚合形态:merge(不吞并 + provider 收敛 "ai-gateway" + 块排序)后应用 hidden
      // 过滤。hidden 含 "ai-gateway" 时网关条目因 provider="ai-gateway" 被整体剔除
      // (Req 5.3);providers 本就 self-only,不受影响。
      const merged = mergeModelCatalog(
        self.models,
        gatewayChat.get(),
        modelPrecedence,
      );
      return excludeProviders(merged, hiddenProviders);
    },
    imageEntries(): readonly CatalogImageEntry[] {
      if (gatewayImageCatalog === undefined) {
        // 未启用网关:引用级透传,字节一致(Req 4.3)。
        return imageCatalog;
      }
      // 聚合形态:self 块在前附 source="self",网关块在后附 source="ai-gateway"
      // (Req 4.1/4.5);不应用 hiddenProviders(Req 5.2)。
      return [
        ...imageCatalog.map((e) => ({ ...e, source: "self" as const })),
        ...gatewayImageCatalog.map((e) => ({ ...e, source: "ai-gateway" as const })),
      ];
    },
  };
}
