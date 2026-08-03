/**
 * 项目级 `.pi/` 信任策略(C-P4)。
 *
 * 构造一个 {@link TrustPolicy},按以下优先级决定是否信任某工作目录的 `.pi/` 资源:
 *   1. 显式请求(DTO `trust`):`true` → 放行并**落库**(跨会话记住);`false` → 拒绝。
 *   2. 持久化信任库:本地 `FsProjectTrustStore` 读写 `<agentDir>/trust.json`(默认 `~/.pi/agent`),
 *      格式与 pi CLI 一致 → 与 pi CLI 共享同一信任记录。
 *   3. 配置允许清单 `trustedRoots`:目录在某受信根之下(前缀)→ 放行。
 *   4. 安全默认:`"ask"`(headless 不放行)。
 *
 * 信任库实现:本地 `FsProjectTrustStore`(node:fs only,零 pi SDK 依赖),精确复刻 pi
 * 0.79.6 的磁盘契约(`<agentDir>/trust.json`),与 pi CLI 共享同一记录。**不再值导入
 * `@earendil-works/pi-coding-agent`** —— 解除主进程把整套 pi SDK 拽进 Next 路由 bundle 的根因。
 */
import path from "node:path";
import {
  FsProjectTrustStore,
  getAgentDir,
} from "./trust-store.js";
import type { TrustDecision, TrustPolicy } from "../agent-source/types.js";

export interface ProjectTrustPolicyOptions {
  /** pi agent 目录(信任库所在);缺省用 SDK 的 getAgentDir()(尊重 PI_CODING_AGENT_DIR)。 */
  agentDir?: string;
  /** 受信根目录清单(前缀匹配即放行);缺省空。 */
  trustedRoots?: string[];
}

/** 判断 dir 是否在某受信根之下(含相等)。 */
function underAnyRoot(dir: string, roots: string[]): boolean {
  const target = path.resolve(dir);
  return roots.some((root) => {
    const r = path.resolve(root);
    return target === r || target.startsWith(r + path.sep);
  });
}

/**
 * 构造项目信任策略。返回的 {@link TrustPolicy} 是纯查询 + (仅显式放行时)写库的闭包。
 * 写库为 best-effort:失败不抛、不阻断建会话。
 */
export function makeProjectTrustPolicy(
  options: ProjectTrustPolicyOptions = {},
): TrustPolicy {
  const agentDir = options.agentDir ?? getAgentDir();
  const store = new FsProjectTrustStore(agentDir);
  const trustedRoots = options.trustedRoots ?? [];

  return ({ dir, requestTrust }): TrustDecision => {
    // 1) 显式请求:放行即落库(跨会话记住),拒绝不落库(最小副作用)。
    if (requestTrust === true) {
      try {
        store.set(dir, true);
      } catch {
        // best-effort:写库失败不阻断会话。
      }
      return "always";
    }
    if (requestTrust === false) return "never";

    // 2) 持久化信任库(boolean | null)。
    const persisted = store.get(dir);
    if (persisted === true) return "always";
    if (persisted === false) return "never";

    // 3) 配置允许清单。
    if (trustedRoots.length > 0 && underAnyRoot(dir, trustedRoots)) return "always";

    // 4) 安全默认。
    return "ask";
  };
}
