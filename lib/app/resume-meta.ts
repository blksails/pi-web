/**
 * resume-meta — 主进程冷会话恢复读取器。
 *
 * 按会话标识从配置的 `SessionEntryStore`(由 `SESSION_STORE` 选择)读取恢复所需的元数据:
 *  - 权威 `cwd` 取自会话 header;header 不存在即视为"会话不存在"(返回 undefined)。
 *  - `source` / `model` 取自 runner 写入的 `piweb.session` custom entry(custom 模式有);
 *    cli 模式不写该 entry,`source` 为 undefined,由 resolver 据 `cwd` 判定为 cli 模式。
 *
 * 读取失败不抛出到调用方(返回 undefined / 退化为仅 cwd),由上层据此回 404 或以 cli 恢复。
 */
import {
  createSessionEntryStore,
  sessionStoreConfigFromEnv,
  type ResumeMeta,
  type SessionEntryStore,
  type SessionStoreConfig,
} from "@blksails/server";

/** runner / stub 写入创建元数据所用的 custom entry 类型标识。 */
export const PIWEB_SESSION_CUSTOM_TYPE = "piweb.session";

/**
 * 构造一个按会话标识读取 {@link ResumeMeta} 的加载器。存储句柄惰性建立并复用。
 * @param storeConfig 存储后端配置;缺省取自 `sessionStoreConfigFromEnv()`。
 */
export function makeResumeMetaLoader(
  storeConfig: SessionStoreConfig = sessionStoreConfigFromEnv(),
): (id: string) => Promise<ResumeMeta | undefined> {
  let storeP: Promise<SessionEntryStore> | undefined;
  const getStore = (): Promise<SessionEntryStore> =>
    (storeP ??= createSessionEntryStore(storeConfig));

  return async (id: string): Promise<ResumeMeta | undefined> => {
    let store: SessionEntryStore;
    try {
      store = await getStore();
    } catch {
      return undefined;
    }

    // 权威 cwd 取自 header;读不到 header 即视为会话不存在。
    let cwd: string;
    try {
      const header = await store.readHeader(id);
      cwd = header.cwd;
    } catch {
      return undefined;
    }

    // 读 entries 找 piweb.session 创建元数据中的 model(custom 模式写入;cli 模式无)。
    let model: string | undefined;
    try {
      for await (const entry of store.read(id)) {
        if (
          entry.type === "custom" &&
          entry.customType === PIWEB_SESSION_CUSTOM_TYPE
        ) {
          const data = entry.data as { model?: string } | undefined;
          if (data?.model !== undefined) model = data.model;
        }
      }
    } catch {
      // 读 entries 失败不致命:仍可用 header.cwd 恢复。
    }

    // source 用 header.cwd(agent 运行目录的绝对路径)。piweb.session.source 是相对原始
    // cwd 的相对路径,持久化后丢失基准;而 header.cwd 是 resolve 后的绝对目录,直接以它
    // 作 source 即可复现会话(custom→该目录有 index;cli→普通目录),避免相对 source 被
    // 二次拼接到已是 agent 目录的 cwd 上。
    return { source: cwd, cwd, ...(model !== undefined ? { model } : {}) };
  };
}
