/**
 * 能力授予端口(spec: host-contract-ports,任务 5.1;契约 §4)—— 模块出口。
 *
 * 本期只交付类型契约,无任何实现:`EnvCapabilityProvider` / `HttpCapabilityProvider`
 * 属后续阶段(见 design.md 的 Out of Boundary)。
 *
 * pi-SDK-free:全部为类型,零运行期依赖,可安全经 server 主 barrel 重导出
 * (主入口接线属任务 6.2,本任务不改 `src/index.ts`)。
 */
export type {
  CapabilityEgressGrant,
  CapabilityGrantBase,
  CapabilityProvider,
  CapabilitySnapshot,
  CapabilityTenant,
  CapabilityTokenGrant,
  StaticCapabilitySnapshot,
} from "./types.js";
