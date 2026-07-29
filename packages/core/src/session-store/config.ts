/**
 * session-store · 后端选型的**配置形状与 env 解析**(纯逻辑,零后端依赖)。
 *
 * 由 core-package-extraction 任务 4.1 从 `factory.ts` 拆出:后端**选型配置**是内核该知道的
 * (`HostCapabilityDeps.sessionStoreConfig` 就是它),而**按配置构造实例**要认识每个后端实现,
 * 其中 postgres 值依赖 `pg` —— 那一半随工厂搬去了兼容层包的 `session-store-postgres`。
 *
 * 拆这一刀的判据很实在:少了它,`SessionStoreConfig` 这个纯类型会把 `pg` 一路拖进内核。
 */
export type SessionStoreKind = "fs" | "sqlite" | "postgres";

/** 选择并配置一个会话存储后端。 */
export type SessionStoreConfig =
  | { kind: "fs"; root?: string }
  | { kind: "sqlite"; path?: string }
  | { kind: "postgres"; connectionString: string };

/**
 * 从环境变量解析存储配置(默认 fs):
 * - `SESSION_STORE=fs|sqlite|postgres`
 * - fs:`SESSION_STORE_ROOT`(可选)
 * - sqlite:`SESSION_STORE_PATH`(可选,默认 `:memory:`)
 * - postgres:`DATABASE_URL`(必填)
 */
export function sessionStoreConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SessionStoreConfig {
  const kind = env["SESSION_STORE"];
  switch (kind) {
    case "sqlite":
      return { kind: "sqlite", path: env["SESSION_STORE_PATH"] };
    case "postgres":
      return { kind: "postgres", connectionString: env["DATABASE_URL"] ?? "" };
    case "fs":
    case undefined:
    case "":
      return { kind: "fs", root: env["SESSION_STORE_ROOT"] };
    default:
      throw new Error(`unknown SESSION_STORE: ${kind}`);
  }
}
