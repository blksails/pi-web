/**
 * 宿主契约版本(spec: host-contract-ports,任务 1.2;Req 9.1-9.3)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §1。本文件是**整个契约**的版本单一事实源
 * ——四个宿主端口(Workspace / CapabilityProvider / 能力面清单 / 配置域注册表)共用同一版本,
 * 不按端口分别版本化;契约是一个整体,分开版本化只会让「哪几个端口兼容」变成组合爆炸。
 *
 * 两层防护,缺一不可:
 *  1. **类型层**——端口对象声明 `readonly contractVersion: typeof HOST_CONTRACT_VERSION`,
 *     使实现在编译期就无法声明错误版本(同仓/同 TS 工程内有效)。
 *  2. **运行期**——{@link assertHostContractVersion}。跨仓消费(pi-clouds / desktop)时类型已擦除,
 *     且两侧可能各自引入**不同副本**的本常量,故类型层保证在跨边界处失效,断言不可省。
 *
 * 判定为**严格相等**,不做「向下兼容旧版本」的分支:契约 §1 规定同版本内只允许增量演进
 * (加可选成员、加新端口),一旦版本号变化即为不兼容。降级运行会让两端在不一致的语义下
 * 静默跑一段时间,故障点远离根因——这正是本模块要消灭的失败形态。
 *
 * pi-SDK-free:零外部依赖,可安全经 server 主 barrel 重导出。
 */

/** 当前宿主契约版本。演进规则见 `docs/pi-web-host-contract-v1.md` §1。 */
export const HOST_CONTRACT_VERSION = 1 as const;

/** 宿主声明的契约版本与 pi-web 当前版本不一致(Req 9.2)。 */
export class HostContractVersionError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(
      `host contract version mismatch: expected ${expected}, got ${actual}`,
    );
    this.name = "HostContractVersionError";
  }
}

/**
 * 宿主装配期自检(Req 9.2)。
 *
 * 须在**任何端口被使用之前**调用。不一致即抛,调用方**不得**捕获后继续——降级运行
 * 正是本断言要防止的事。
 *
 * @param declared 宿主声明其所实现的契约版本。
 * @throws {HostContractVersionError} 与 {@link HOST_CONTRACT_VERSION} 不相等时。
 */
export function assertHostContractVersion(declared: number): void {
  if (declared !== HOST_CONTRACT_VERSION) {
    throw new HostContractVersionError(HOST_CONTRACT_VERSION, declared);
  }
}
