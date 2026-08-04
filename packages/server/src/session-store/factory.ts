/**
 * session-store-adapters — 配置驱动的 adapter 选择工厂。
 *
 * 三个 adapter 实现同一 `SessionEntryStore` 接口,但构造参数异构(fs 给目录、sqlite 给
 * 路径、postgres 给连接池/连接串)。本工厂把"选哪个后端"收敛成一个配置开关,使切换
 * 后端只改配置/环境变量,下游代码不变。
 */
import { defaultSessionsRoot, FsSessionEntryStore, type FsSessionLayout } from "./fs-store.js";
import { PostgresSessionEntryStore } from "./postgres-store.js";
import { SqliteSessionEntryStore } from "./sqlite-store.js";
import type { SessionEntryStore } from "./types.js";

export type SessionStoreKind = "fs" | "sqlite" | "postgres";

/** 选择并配置一个会话存储后端。 */
export type SessionStoreConfig =
  | { kind: "fs"; root?: string; layout?: FsSessionLayout }
  | { kind: "sqlite"; path?: string }
  | { kind: "postgres"; connectionString: string };

/**
 * 按配置创建一个 `SessionEntryStore`。
 * - fs:`root` = sessions 根目录;省略则用默认(`~/.pi/agent/sessions`)。
 * - sqlite:`path` = 数据库文件路径;省略则用 `:memory:`。
 * - postgres:`connectionString` 必填;`pg` 惰性 import,未选 postgres 的部署不加载。
 */
export async function createSessionEntryStore(config: SessionStoreConfig): Promise<SessionEntryStore> {
  switch (config.kind) {
    case "fs": {
      // 列表、冷恢复、重命名共享同一 FS store，复用路径/标题缓存并避免重复扫描。
      const root = config.root ?? defaultSessionsRoot();
      const layout = config.layout ?? "buckets";
      const key = `${layout}:${root}`;
      const cached = fsStores.get(key);
      if (cached !== undefined) return cached;
      const created = Promise.resolve<SessionEntryStore>(
        new FsSessionEntryStore(root, layout),
      ).catch((err: unknown) => {
        fsStores.delete(key);
        throw err;
      });
      fsStores.set(key, created);
      return created;
    }
    case "sqlite":
      return new SqliteSessionEntryStore(config.path ?? ":memory:");
    case "postgres": {
      if (!config.connectionString) {
        throw new Error("postgres session store requires a non-empty connectionString");
      }
      const { Pool } = await import("pg");
      return new PostgresSessionEntryStore(new Pool({ connectionString: config.connectionString }));
    }
    default: {
      const exhaustive: never = config;
      throw new Error(`unknown session store config: ${JSON.stringify(exhaustive)}`);
    }
  }
}

const fsStores = new Map<string, Promise<SessionEntryStore>>();

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
    case "": {
      const explicitRoot = env["SESSION_STORE_ROOT"];
      if (explicitRoot !== undefined && explicitRoot !== "") {
        return { kind: "fs", root: explicitRoot };
      }
      const piSessionDir = env["PI_CODING_AGENT_SESSION_DIR"];
      if (piSessionDir !== undefined && piSessionDir !== "") {
        return { kind: "fs", root: piSessionDir, layout: "flat" };
      }
      return { kind: "fs" };
    }
    default:
      throw new Error(`unknown SESSION_STORE: ${kind}`);
  }
}
