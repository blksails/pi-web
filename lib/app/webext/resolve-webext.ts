/**
 * resolve-webext —— 已上提为泛用包面 `@blksails/pi-web-server/webext-runtime`(REQ-A10)。
 *
 * 该逻辑本就是「纯函数 + 注入依赖」,与载体无关:本宿主注入磁盘实现(`./locate-dist.js`),
 * 云宿主注入 registry bundle 实现,同一份解析语义。本文件保留为转发层,调用点零改。
 */
export {
  resolveWebext,
  type WebextResolveResponse,
  type ResolveWebextDeps,
} from "@blksails/pi-web-server/webext-runtime";
