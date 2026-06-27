/**
 * extension-management — 路由注册表(经 http-api createPiWebHandler 的 `routes?` 注入接缝装配)。
 *
 * 导出 `createExtensionRoutes(opts)`,返回 `ReadonlyArray<InjectedRoute>`(method+path+handler),
 * 形状与 `PiWebHandlerOptions.routes` 一致,可经 `createPiWebHandler({ routes })` 直接并入路由表。
 * 不实现 `Router` 本体或 `routes?` 接缝本身(归 http-api);不实现 `GET /sessions/:id/commands`
 * (归 http-api,本层仅消费其输出)。处理器经工厂注入本层依赖,无全局状态、可单测。
 *
 * 注:`DELETE /extensions/:extId` 的路径参数命名为 `:extId`(非 `:id`),以避免 http-api Router
 * 把扩展 id 当作 sessionId 做会话存在性校验 / 会话级授权。
 */
import { defaultTrustPolicy } from "../agent-source/index.js";
import type { InjectedRoute } from "../http/index.js";
import { DEFAULT_ALLOWLIST } from "./install/source-allowlist.js";
import { defaultAdminPolicy } from "./security/admin-policy.js";
import { defaultOnAudit } from "./security/audit.js";
import { makeListExtensionsHandler } from "./routes/list-extensions.js";
import { makeInstallSourcesHandler } from "./routes/install-sources.js";
import { makeInstallExtensionHandler } from "./routes/install-extension.js";
import { makeRemoveExtensionHandler } from "./routes/remove-extension.js";
import {
  defaultSessionReloader,
  makeReloadSessionHandler,
} from "./routes/reload-session.js";
import type { ExtManagementOptions } from "./ext.types.js";

export function createExtensionRoutes(
  opts: ExtManagementOptions,
): ReadonlyArray<InjectedRoute> {
  const adminPolicy = opts.adminPolicy ?? defaultAdminPolicy;
  const onAudit = opts.onAudit ?? defaultOnAudit;
  const trustPolicy = opts.trustPolicy ?? defaultTrustPolicy;
  const allowlist = opts.allowlist ?? DEFAULT_ALLOWLIST;
  const reloadSession = opts.reloadSession ?? defaultSessionReloader;
  const timeoutMs = opts.piInstallTimeoutMs;

  const listHandler = makeListExtensionsHandler(opts.piCli);
  const installSourcesHandler = makeInstallSourcesHandler(opts.store);
  const installHandler = makeInstallExtensionHandler({
    piCli: opts.piCli,
    adminPolicy,
    onAudit,
    allowlist,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  const removeHandler = makeRemoveExtensionHandler({
    piCli: opts.piCli,
    adminPolicy,
    onAudit,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  const reloadHandler = makeReloadSessionHandler({
    store: opts.store,
    adminPolicy,
    reloadSession,
    trustPolicy,
  });

  return [
    { method: "GET", path: "/extensions", handler: listHandler },
    {
      method: "GET",
      path: "/sessions/:id/install-sources",
      handler: installSourcesHandler,
    },
    { method: "POST", path: "/extensions", handler: installHandler },
    { method: "DELETE", path: "/extensions/:extId", handler: removeHandler },
    { method: "POST", path: "/sessions/:id/reload", handler: reloadHandler },
  ];
}
