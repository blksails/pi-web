/**
 * registry-source-resolver(spec: desktop-online-source-runnable,任务 3.2)——
 * 线上注册表源的 `SourceResolverPlugin` 实现。
 *
 * ## 为什么是这个接缝
 *
 * `identify()`(`agent-source/source-type.ts`)把 `opts.sourceResolver.canHandle(source)` 排在
 * **所有其他分支之前**,命中后经 `plugin.resolve()` 取得 `localDir`,其后的入口探测、模式判定、
 * spawnSpec 组装与一个**普通本地目录源完全同构**。这正是本特性「装完即普通本地源」策略所需,
 * 且是既有架构有意预留的一等扩展点(生产侧此前无实现)。
 *
 * 因此本模块无需改动 `create-session` 路由,也无需包装 `AgentSourceResolver` 核心。
 *
 * ## 索引优先
 *
 * `resolve` 先查已装索引:命中即直接返回该目录,**不触碰网络、不要求登录态**。这同时满足
 * Req 1.3(已装不重复下载)与 Req 2.2(离线/登出后仍可建会话)。只有未命中时才走安装端口。
 */
import {
  isOnlineSourceRef,
  parseOnlineSourceRef,
  type InstalledRegistryIndex,
  type ResolveOptions,
  type SourceResolverPlugin,
} from "@blksails/pi-web-server";
import type { InstallFailure, RegistryInstallPort } from "./registry-install-port.js";

/**
 * 安装失败导致的解析错误。
 *
 * 携带结构化 `failure` 而非仅一句话:`create-session` 的错误映射与前端据此区分
 * 「需登录」「未找到」「不支持」等不同处置(Req 4.1),压成同一种错误会让用户无从下手。
 */
export class OnlineSourceInstallError extends Error {
  readonly failure: InstallFailure;

  constructor(source: string, failure: InstallFailure) {
    super(`无法安装线上源 ${source}: ${failure.code}`);
    this.name = "OnlineSourceInstallError";
    this.failure = failure;
  }
}

export interface RegistrySourceResolverOptions {
  /** 已装索引(纯本地,不依赖网络与登录态)。 */
  readonly index: InstalledRegistryIndex;
  /** 安装端口(需授予)。 */
  readonly port: RegistryInstallPort;
}

export function createRegistrySourceResolver(
  opts: RegistrySourceResolverOptions,
): SourceResolverPlugin {
  return {
    canHandle(source: string): boolean {
      return isOnlineSourceRef(source);
    },

    async resolve(source: string, _opts: ResolveOptions): Promise<{ localDir: string }> {
      const ref = parseOnlineSourceRef(source);
      if (ref === undefined) {
        // 正常流程下不可达(identify 只在 canHandle 为真时才走到这里);
        // 显式抛出而非静默返回,避免调用方绕过 canHandle 时得到一个错误的目录。
        throw new Error(`不是线上源标识: ${source}`);
      }

      // 索引优先:已装即复用,不下载、不要求登录。
      const installed = opts.index.lookup(ref.sourceId);
      if (installed !== undefined) {
        return { localDir: installed.dir };
      }

      const outcome = await opts.port.install(ref);
      if (!outcome.ok) {
        throw new OnlineSourceInstallError(source, outcome.failure);
      }
      return { localDir: outcome.dir };
    },
  };
}
