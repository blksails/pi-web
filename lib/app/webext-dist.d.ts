/**
 * 构建产物的类型垫片:`.pi/web/dist/web-extension.mjs` 由 `pnpm build:webext-examples`
 * (迁移后由 `pi-web build`) 产出且刻意不入库,故 typecheck 不得依赖它的存在。
 * 与 examples/*\/web/pane-documents.generated.d.ts 是同一约定的两条链路:
 * 前者盖中间产物(build 脚本内部消费),本文件盖最终产物(lib/app/webext-registry.ts 消费)。
 */
declare module "*/.pi/web/dist/web-extension.mjs" {
  const ext: import("@blksails/pi-web-kit").WebExtension;
  export default ext;
}
