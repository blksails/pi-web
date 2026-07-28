/**
 * 「身份已具备」形态的身份实现(spec: desktop-account-login,任务 4.2;
 * Req 1.2/1.4/6.1/6.2/6.3)。
 *
 * 这是**云端多租户 web 宿主的形态**:身份来自既有会话(cookie / Bearer),打开即已具备,
 * 不需要任何登录交互。本仓提供它有两个理由:
 *
 *  1. **它是 P5「不支持凭据交换」这条路径的活证明**。端口把 `exchange` 设为可选,若全仓
 *     只有一个实现且它恰好实现了 `exchange`,那条可选性就从未被走过 —— 抽象的正确性
 *     没有任何证据支撑,直到某天云端真的来接,才发现端口逼着它写假登录。
 *  2. 它让「调用方不得据宿主类型分支」这条约束**可被测试**:同一套路由与 UI 面对两个
 *     行为迥异的实现,若哪里偷偷 `if (isDesktop)`,测试立刻转红。
 *
 * ★ **本实现刻意不提供 `exchange`**。任何人想给它加上,应先回答:这个宿主的用户
 *   已经登录过了,再让他登录一次是要解决什么问题?
 */
import { HOST_CONTRACT_VERSION } from "../host-contract-version.js";
import type { CapabilityTenant } from "../capability/types.js";
import type { IdentityProvider, IdentityState } from "./types.js";

export interface SessionIdentityProviderOptions {
  /**
   * 从既有会话解析身份。
   *
   * 返回 `undefined` 表示会话不存在或已失效 —— 此时由**该宿主自身**的登录路径处理
   * (Req 6.2),本端口不介入。
   *
   * 抛错同样降级为 `anonymous`(见下),故实现方无需自己包 try。
   */
  readonly resolveTenant: () => Promise<CapabilityTenant | undefined> | CapabilityTenant | undefined;
}

export function createSessionIdentityProvider(
  opts: SessionIdentityProviderOptions,
): IdentityProvider {
  return {
    contractVersion: HOST_CONTRACT_VERSION,

    async current(): Promise<IdentityState> {
      try {
        const tenant = await opts.resolveTenant();
        if (tenant === undefined) return { kind: "anonymous" };
        return { kind: "authenticated", tenant };
      } catch {
        // 端口不变式 1:current() 不抛。探测失败与「没有身份」对宿主的处置相同 ——
        // 以未登录形态正常启动(Req 1.6)。若在此上抛,装配层就得为一个正常态写
        // try/catch,而那正是「身份不可得是错误」这一误解的开端。
        return { kind: "anonymous" };
      }
    },

    // exchange 与 revoke 刻意缺席 —— 见文件顶部第 3 段。
  };
}
