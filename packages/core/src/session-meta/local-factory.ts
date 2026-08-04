/**
 * session-meta — 本地形态的实现选型(spec session-meta-index)。
 *
 * 云端不走这里:pi-clouds 自行装配时直接 `new WorkspaceSessionMetaIndex(tenantWorkspace.user)`
 * 传进 `HostDeps.sessionMetaIndex`。本工厂只负责**本地**两条实现之间的选择。
 *
 * 选型规则(自上而下,第一条命中即用):
 *  1. `SESSION_META_STORE=json|sqlite` —— 显式指定,优先级最高;
 *  2. 会话存储本身是 sqlite(`SESSION_STORE=sqlite`)→ 元数据也用 sqlite。
 *     理由很实在:既然已经在用数据库存会话了,元数据没有理由退回整份 JSON 重写;
 *  3. 其余 → JSON 文件(零依赖、可直接查看/编辑,适合会话量不大的默认场景)。
 *
 * ★ 无论选中哪条,构造都**不抛**:实现内部把打不开/损坏的情形降级为「无元数据」
 *   (sqlite 还会先尝试重建)。装配阶段一个坏文件不该拖垮宿主。
 */
import { JsonFileSessionMetaIndex } from "./json-file-index.js";
import { SqliteSessionMetaIndex } from "./sqlite-index.js";
import type { SessionMetaIndex } from "./types.js";

export type SessionMetaStoreKind = "json" | "sqlite";

/** 按 env 判定本地实现;非法值按缺省处理(不抛 —— 元数据不该因配置笔误拖垮启动)。 */
export function sessionMetaStoreKindFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SessionMetaStoreKind {
  const explicit = env["SESSION_META_STORE"];
  if (explicit === "sqlite" || explicit === "json") return explicit;
  // 未显式指定时跟随会话存储:已经在用 sqlite 存会话,元数据也用 sqlite。
  if (env["SESSION_STORE"] === "sqlite") return "sqlite";
  return "json";
}

/** 构造本地元数据索引(见本文件顶部的选型规则)。 */
export function createLocalSessionMetaIndex(
  env: NodeJS.ProcessEnv = process.env,
): SessionMetaIndex {
  return sessionMetaStoreKindFromEnv(env) === "sqlite"
    ? new SqliteSessionMetaIndex()
    : new JsonFileSessionMetaIndex();
}
