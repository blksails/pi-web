/**
 * `entities`(GET)—— defaultEntity 字段 widget:"entity-picker" 的动态选项数据源。
 *
 * 演示面⑤/面⑦ 互为供给:本模块自己的 agent-declared-route 既是面⑥(声明式 HTTP routes)
 * 的产物,又是面⑦ 动态控件(settingsWidgets)所需的数据端点——不依赖第三方 webext。
 * 只读、无副作用,JSON 可序列化。
 */
import type { AgentRouteDecl } from "@blksails/pi-web-agent-kit";

const ENTITIES = [
  { value: "customer", label: "客户" },
  { value: "order", label: "订单" },
  { value: "invoice", label: "发票" },
] as const;

export function entitiesHandler(): unknown {
  return { entities: ENTITIES };
}

export const entitiesRoute: AgentRouteDecl = {
  name: "entities",
  description: "defaultEntity widget(entity-picker)的动态选项数据源",
  handler: entitiesHandler,
};
