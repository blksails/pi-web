/**
 * 本地实现选型(spec session-meta-index)。
 *
 * 只验**选型规则**本身(纯函数,不建库):显式指定优先、未指定时跟随会话存储、
 * 非法值按缺省、以及构造不因配置笔误而抛。
 */
import { describe, expect, it } from "vitest";
import {
  createLocalSessionMetaIndex,
  sessionMetaStoreKindFromEnv,
} from "../../src/session-meta/local-factory.js";
import { JsonFileSessionMetaIndex } from "../../src/session-meta/json-file-index.js";
import { SqliteSessionMetaIndex } from "../../src/session-meta/sqlite-index.js";

describe("sessionMetaStoreKindFromEnv", () => {
  it("缺省为 json", () => {
    expect(sessionMetaStoreKindFromEnv({})).toBe("json");
  });

  it("显式 sqlite / json 生效", () => {
    expect(sessionMetaStoreKindFromEnv({ SESSION_META_STORE: "sqlite" })).toBe("sqlite");
    expect(sessionMetaStoreKindFromEnv({ SESSION_META_STORE: "json" })).toBe("json");
  });

  it("★ 未显式指定时跟随会话存储:SESSION_STORE=sqlite → 元数据也用 sqlite", () => {
    expect(sessionMetaStoreKindFromEnv({ SESSION_STORE: "sqlite" })).toBe("sqlite");
  });

  it("显式指定优先于跟随", () => {
    expect(
      sessionMetaStoreKindFromEnv({ SESSION_STORE: "sqlite", SESSION_META_STORE: "json" }),
    ).toBe("json");
  });

  it("会话存储是 fs / postgres 时不跟随(仍为 json 默认)", () => {
    expect(sessionMetaStoreKindFromEnv({ SESSION_STORE: "fs" })).toBe("json");
    expect(sessionMetaStoreKindFromEnv({ SESSION_STORE: "postgres" })).toBe("json");
  });

  it("非法值按缺省处理,不抛(配置笔误不该拖垮启动)", () => {
    expect(() => sessionMetaStoreKindFromEnv({ SESSION_META_STORE: "mongo" })).not.toThrow();
    expect(sessionMetaStoreKindFromEnv({ SESSION_META_STORE: "mongo" })).toBe("json");
  });
});

describe("createLocalSessionMetaIndex", () => {
  it("按选型构造对应实现", () => {
    const json = createLocalSessionMetaIndex({
      SESSION_META_STORE: "json",
      PI_WEB_SESSION_META_INDEX_PATH: ":memory-not-used:",
    });
    expect(json).toBeInstanceOf(JsonFileSessionMetaIndex);

    const sqlite = createLocalSessionMetaIndex({
      SESSION_META_STORE: "sqlite",
      PI_WEB_SESSION_META_DB_PATH: ":memory:",
    });
    expect(sqlite).toBeInstanceOf(SqliteSessionMetaIndex);
    (sqlite as SqliteSessionMetaIndex).close();
  });
});

describe("★ 默认路径必须跟随 PI_WEB_AGENT_DIR(否则会写进用户真实目录)", () => {
  it("JSON 索引默认路径落在 agentDir 下", async () => {
    const { defaultSessionMetaIndexPath, sessionMetaIndexPathFromEnv } = await import(
      "../../src/session-meta/json-file-index.js"
    );
    expect(defaultSessionMetaIndexPath({ PI_WEB_AGENT_DIR: "/tmp/fake-agent" })).toBe(
      "/tmp/fake-agent/piweb-session-index.json",
    );
    // env 覆盖仍优先
    expect(
      sessionMetaIndexPathFromEnv({
        PI_WEB_AGENT_DIR: "/tmp/fake-agent",
        PI_WEB_SESSION_META_INDEX_PATH: "/tmp/explicit.json",
      }),
    ).toBe("/tmp/explicit.json");
    // 未设 agentDir 时才回落到用户主目录
    expect(defaultSessionMetaIndexPath({})).toMatch(/\.pi[/\\]agent[/\\]piweb-session-index\.json$/);
  });

  it("SQLite 库默认路径落在 agentDir 下", async () => {
    const { defaultSessionMetaDbPath, sessionMetaDbPathFromEnv } = await import(
      "../../src/session-meta/sqlite-index.js"
    );
    expect(defaultSessionMetaDbPath({ PI_WEB_AGENT_DIR: "/tmp/fake-agent" })).toBe(
      "/tmp/fake-agent/piweb-session-meta.db",
    );
    expect(
      sessionMetaDbPathFromEnv({
        PI_WEB_AGENT_DIR: "/tmp/fake-agent",
        PI_WEB_SESSION_META_DB_PATH: "/tmp/explicit.db",
      }),
    ).toBe("/tmp/explicit.db");
    expect(defaultSessionMetaDbPath({})).toMatch(/\.pi[/\\]agent[/\\]piweb-session-meta\.db$/);
  });

  it("空白 agentDir 按未设处理(不产生 ' /piweb-...' 这种路径)", async () => {
    const { defaultSessionMetaIndexPath } = await import(
      "../../src/session-meta/json-file-index.js"
    );
    expect(defaultSessionMetaIndexPath({ PI_WEB_AGENT_DIR: "   " })).toMatch(
      /\.pi[/\\]agent[/\\]/,
    );
  });
});
