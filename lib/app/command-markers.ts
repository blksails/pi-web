/**
 * command-markers — 主进程纯扩展命令历史标记读取器(spec plugin-system-unification R13)。
 *
 * 按会话标识从配置的 `SessionEntryStore`(由 `SESSION_STORE` 选择,与 resume-meta 同后端)读取
 * runner 写入的 `piweb.command` 自定义条目,产出 `{ text, ts }`(ts 为 epoch ms)。注入到 server
 * 的 `loadCommandMarkers` 后,`GET /messages` 会把这些标记按时间序合并进消息序列,使纯命令
 * (如 `/review`,只经 ctx.ui 反馈、不触发对话轮)冷恢复后仍在转录区可见。
 *
 * 读取失败不抛出到调用方(返回 `[]`),由 server 端退化为仅返回 agent 消息——审计标记缺失绝不致 500。
 */
import {
  createSessionEntryStore,
  sessionStoreConfigFromEnv,
  PIWEB_COMMAND_CUSTOM_TYPE,
  type SessionEntryStore,
  type SessionStoreConfig,
} from "@blksails/pi-web-server";

/** 命令标记(epoch ms `ts` + 原始命令 `text`)。 */
export interface CommandMarker {
  readonly text: string;
  readonly ts: number;
}

/**
 * 构造一个按会话标识读取 `piweb.command` 标记的加载器。存储句柄惰性建立并复用(同 resume-meta)。
 * @param storeConfig 存储后端配置;缺省取自 `sessionStoreConfigFromEnv()`。
 */
export function makeCommandMarkerLoader(
  storeConfig: SessionStoreConfig = sessionStoreConfigFromEnv(),
): (id: string) => Promise<ReadonlyArray<CommandMarker>> {
  let storeP: Promise<SessionEntryStore> | undefined;
  const getStore = (): Promise<SessionEntryStore> =>
    (storeP ??= createSessionEntryStore(storeConfig));

  return async (id: string): Promise<ReadonlyArray<CommandMarker>> => {
    let store: SessionEntryStore;
    try {
      store = await getStore();
    } catch {
      return [];
    }

    const markers: CommandMarker[] = [];
    try {
      for await (const entry of store.read(id)) {
        if (
          entry.type === "custom" &&
          entry.customType === PIWEB_COMMAND_CUSTOM_TYPE
        ) {
          const data = entry.data as { text?: unknown } | undefined;
          const text = typeof data?.text === "string" ? data.text : undefined;
          if (text === undefined) continue;
          // entry.timestamp 为 ISO 字符串;转 epoch ms 以与 AgentMessage.timestamp(ms)合并。
          const ts = Date.parse(entry.timestamp);
          markers.push({ text, ts: Number.isFinite(ts) ? ts : 0 });
        }
      }
    } catch {
      // 读 entries 失败不致命:返回已收集到的(或空),server 退化为仅 agent 消息。
    }
    return markers;
  };
}
