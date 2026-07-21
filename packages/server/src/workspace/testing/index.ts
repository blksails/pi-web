/**
 * Workspace 一致性套件对外入口(spec: host-contract-ports,任务 3.1;Req 8.1)。
 *
 * 经 `@blksails/pi-web-server/testing` 子路径导出,供两端宿主实现引用:
 *
 * ```ts
 * import { describe, it } from "vitest";
 * import { runWorkspaceConformance } from "@blksails/pi-web-server/testing";
 *
 * runWorkspaceConformance({ describe, it }, "TenantWorkspace", async (opts) => { ... });
 * ```
 *
 * ⚠ 跨仓消费方配置 alias 时,**子路径必须列在裸包名之前**,否则子路径被裸名吞掉,
 * 且报错与顺序无关、极难定位(pi-web 自身的 `vitest.config.ts:35-37` 已有同类注释)。
 *
 * 本 barrel 只导出**套件与其类型**;测试夹具(内存实现等)刻意留在 `test/` 镜像目录,
 * 不经此对外暴露——本 spec 只认 `LocalWorkspace` 一个参照实现。
 */
export {
  assertRejectsWithCode,
  runWorkspaceConformance,
  withRawTarget,
  withTarget,
} from "./conformance-suite.js";
export type {
  ConformanceFactory,
  ConformanceTarget,
  ConformanceTargetOptions,
  NamespaceName,
  SuiteRunner,
} from "./conformance-suite.js";
