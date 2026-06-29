/**
 * session-snapshot-authority(STEP4)— PART_KINDS 单一真相源驱动的 data-part 渲染器注册。
 *
 * 把「哪些 pi data-part kind 经渲染器注册表分发」从 pi-chat 里散落的手写字符串收口为
 * 一张 `Record<PartKind, DataPartRenderer>` 映射 + 一个遍历 `REGISTRY_PART_KINDS` 的注册函数。
 * 由此:
 *   - 注册遍历单一真相源 → 不可能漏注册任一 registry 类 kind(Req 6.4)。
 *   - 契约测试遍历 PART_KINDS 断言每个 registry 类 kind 在本映射中存在 → 孤儿渲染器静态不可能(Req 6.5)。
 *
 * 注:consume:"stream" 的 kind(queue/compaction/auto-retry)由上层 UI 直接消费,不在此注册;
 * data-source/data-sources 为 AI SDK 标准 part(非 pi-web 自定义 PART_KINDS),仍由 pi-chat 单独注册。
 */
import {
  REGISTRY_PART_KINDS,
  type RegistryPartKind,
} from "@blksails/pi-web-protocol";
import type {
  DataPartRenderer,
  RendererRegistry,
} from "../registry/renderer-registry.js";
import { PiUiPart } from "../parts/pi-ui-part.js";

/**
 * PART_KINDS 中 consume:"registry" 类 kind → 渲染组件的映射(单一真相源的前端对侧)。
 * `Record<RegistryPartKind, …>` 在**编译期**强制覆盖全部 registry 类 kind:新增一个 registry
 * kind 而忘记在此补渲染器 → tsc 报 missing property(STEP4 静态保证,Req 6.5);契约测试(运行期)
 * 进一步双保险。
 */
export const BUILTIN_DATA_PART_RENDERERS: Record<RegistryPartKind, DataPartRenderer> = {
  "data-pi-ui": PiUiPart,
};

/** 遍历 PART_KINDS 的 registry 类 kind,把内置渲染器注册进给定 registry(Req 6.4)。 */
export function registerBuiltinDataPartRenderers(registry: RendererRegistry): void {
  for (const kind of REGISTRY_PART_KINDS) {
    // RegistryPartKind 已由类型保证在映射中存在,直接注册(无需 undefined 守卫)。
    registry.registerDataPartRenderer(kind, BUILTIN_DATA_PART_RENDERERS[kind]);
  }
}
