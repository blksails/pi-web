/**
 * host-assembly — 宿主装配出口(spec: host-contract-capability-composition,M3)。
 *
 * ⚠ **D0 铁律**:本出口经 `@blksails/pi-web-server/host-assembly` 子路径暴露,**绝不**并入
 * server 主 barrel `src/index.ts`(`export *`)。`defaultCapabilities` 的 factory import 真实
 * 路由工厂(含 pi SDK 传递依赖),进主 barrel 会拖垮 routes bundle 的 `node:fs`(见记忆
 * pi-web-pi-sdk-dev-external / host-contract-ports barrel 纪律)。两端(pi-clouds C2 / desktop D4)
 * 经本子路径 import `defaultCapabilities` 并各自给 `decisions`。
 */
export { asCommands, asRoutes, type HostContribution } from "./host-contribution.js";
export { defaultCapabilities, type HostDeps } from "./default-capabilities.js";
