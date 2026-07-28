/**
 * GET /api/webext/singletons/:name —— 宿主单例 ESM。
 *
 * 实现已上提为泛用包面 `@blksails/pi-web-server/webext-runtime`(REQ-A10):该模块只产字符串
 * 与标准 `Response`,与框架无关,故 Vite SPA(本宿主)、Next App Router(pi-clouds cloud)及任何
 * 自建宿主皆可直接接线,不必各自复刻(历史上本实现曾在 Next 与 Vite 两侧各存一份)。
 *
 * 本文件保留为转发层:路由注册仍由 `server/index.ts` 统一完成,调用点零改。
 */
export { singletonModuleFor, handleSingleton } from "@blksails/pi-web-server/webext-runtime";
