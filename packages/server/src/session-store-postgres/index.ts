/**
 * session-store-postgres — 会话条目存储的 **postgres 实现**与按 env 选型的工厂(adapters 层)。
 *
 * 由 core-package-extraction 任务 4.1 从内核包的 `session-store` 摘出,判据同
 * `sandbox-transport`:值依赖 `pg` 驱动,而内核包的依赖声明不得出现数据库驱动(R1.2),
 * 源码直连分发又使 optional peer 不可用。
 *
 * 工厂一并摘出**不是顺手**:它值依赖 postgres 实现,留在内核就等于把 `pg` 一起留下。
 * 内核保留接口、编解码与 fs / sqlite 两个无外部驱动的实现;选型是装配期的事。
 *
 * ★ 导出面与摘出前逐字一致,且仍经兼容层主 barrel 导出 —— 既有消费方零改动。
 */
export { PostgresSessionEntryStore } from "./postgres-store.js";
export {
  createSessionEntryStore,
  sessionStoreConfigFromEnv,
  type SessionStoreConfig,
  type SessionStoreKind,
} from "./factory.js";
