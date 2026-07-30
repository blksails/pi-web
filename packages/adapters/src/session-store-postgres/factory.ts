/**
 * session-store-adapters — 配置驱动的 adapter 选择工厂。
 *
 * 三个 adapter 实现同一 `SessionEntryStore` 接口,但构造参数异构(fs 给目录、sqlite 给
 * 路径、postgres 给连接池/连接串)。本工厂把"选哪个后端"收敛成一个配置开关,使切换
 * 后端只改配置/环境变量,下游代码不变。
 */
import { FsSessionEntryStore } from "@blksails/pi-web-core/session-store/fs-store.js";
import { PostgresSessionEntryStore } from "./postgres-store.js";
import { SqliteSessionEntryStore } from "@blksails/pi-web-core/session-store/sqlite-store.js";
import type { SessionEntryStore } from "@blksails/pi-web-core/session-store/types.js";

// 配置形状与 env 解析留在内核(`session-store/config.ts`)—— 它们零后端依赖,
// 而 `HostCapabilityDeps.sessionStoreConfig` 需要那个类型。此处原样 re-export,
// 本模块导出面与拆分前逐字不变。
export type {
  SessionStoreKind,
  SessionStoreConfig,
} from "@blksails/pi-web-core/session-store/config.js";
export { sessionStoreConfigFromEnv } from "@blksails/pi-web-core/session-store/config.js";
import type { SessionStoreConfig } from "@blksails/pi-web-core/session-store/config.js";

/**
 * 按配置创建一个 `SessionEntryStore`。
 * - fs:`root` = sessions 根目录;省略则用默认(`~/.pi/agent/sessions`)。
 * - sqlite:`path` = 数据库文件路径;省略则用 `:memory:`。
 * - postgres:`connectionString` 必填;`pg` 惰性 import,未选 postgres 的部署不加载。
 */
export async function createSessionEntryStore(config: SessionStoreConfig): Promise<SessionEntryStore> {
  switch (config.kind) {
    case "fs":
      return new FsSessionEntryStore(config.root);
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

