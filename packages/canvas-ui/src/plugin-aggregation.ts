/**
 * plugin-aggregation — 宿主中立扩展描述符 → canvas 插件捆聚合(task 3.1,
 * Req 4.1/4.2/4.3/5.1/5.2/5.3;design「宿主中立注入与聚合」)。
 *
 * 宿主(pi-chat)对 canvas 领域中立:只把全部已装载扩展描述符(readonly WebExtension[])
 * 整体经 SlotHost 搬运进 CanvasPanel,不解析内容。真正的**领域聚合**发生在此:提取各扩展
 * 声明的 `canvasPlugins` 捆,附来源命名空间(= manifestId),交由 CanvasWorkbench 的
 * registerPluginBundles 施加 `<namespace>:` 前缀与拓扑校验。
 *
 * 类型收敛(design「Allowed Dependencies」):web-kit 的 CanvasPluginBundle 是**最小结构镜像**
 * (组件位 unknown 宽型,便于宿主中立搬运);canonical 家在 canvas-kit(具体插件形状)。二者
 * 无包依赖边,结构上 kit→web-kit 单向可赋值(窄→宽)。聚合是反向的 web-kit→kit **窄化**:
 * 运行期安全(source 作者以 canvas-kit defineXxx 声明捆,transport 仅把组件位擦除为 unknown),
 * 类型层以断言收窄(见 collectCanvasPluginBundles 的 `as`;双向可赋值防漂移断言在
 * plugin-aggregation.test.ts,capability-type-sync M2 先例)。
 */
import type { WebExtension } from "@blksails/pi-web-kit";
import type { CanvasPluginBundle } from "@blksails/pi-web-canvas-kit";

/** 单个来源(扩展)贡献的 canvas 插件捆集合 + 其命名空间(= manifestId)。 */
export interface NamespacedPluginBundles {
  /** 来源命名空间(registerPluginBundles 据此前缀化捆内 id/type;= WebExtension.manifestId)。 */
  readonly namespace: string;
  /** 该来源声明的插件捆(canonical canvas-kit 型;已从 web-kit 镜像窄化)。 */
  readonly bundles: readonly CanvasPluginBundle[];
}

/**
 * 从已装载扩展描述符集提取各自的 canvas 插件捆,附来源命名空间(manifestId)。
 *
 * - 无 `canvasPlugins` 声明或空数组的扩展被**剔除**(不产生空条目 → 零影响,Req 4.3);
 * - 验签失败的插件包根本不进 `extensions` 列表(装载链既有容错)→ 聚合天然不含、不崩(Req 5.3);
 * - `undefined` 入参(宿主未注入)→ 空聚合(现状路径,Req 4.3);
 * - 车道①(source 自带)与车道②(已装包 webext,同 defineWebExtension 形态)统一经此消费(Req 5.1/5.2)。
 *
 * 纯函数(无副作用;bundles 引用原样透传,仅类型收窄不拷贝/不 mutate 作者只读声明)。
 */
export function collectCanvasPluginBundles(
  extensions?: readonly WebExtension[],
): readonly NamespacedPluginBundles[] {
  if (extensions === undefined) return [];
  const out: NamespacedPluginBundles[] = [];
  for (const ext of extensions) {
    const plugins = ext.canvasPlugins;
    if (plugins === undefined || plugins.length === 0) continue;
    // web-kit 镜像型 → canvas-kit canonical 型窄化(结构上 kit 可赋给 web-kit,反向窄化断言;
    // 运行期安全见模块头注)。整捆引用透传,前缀化留 registerPluginBundles(装配层)。
    out.push({ namespace: ext.manifestId, bundles: plugins as readonly CanvasPluginBundle[] });
  }
  return out;
}
