/**
 * session-list — 只读会话列表端点(GET /sessions)的注入路由工厂。
 *
 * 经 `createSessionListRoutes(opts)` 产出 `ReadonlyArray<InjectedRoute>`,挂载到
 * `createPiWebHandler({ routes })` 的注入接缝。仅读 `SessionEntryStore` 头部元数据。
 */
export {
  createSessionListRoutes,
  type SessionListRoutesOptions,
} from "./session-list-routes.js";
