/**
 * useSourceSettingsChanged — per-source settings 运行期实时下发订阅 hook
 * (spec source-settings-and-slots,任务 7.2;design.md「通道 b」;Req 7.1/7.2)。
 *
 * 只读订阅:`PUT /config/source/:sourceKey` 落盘成功后经 `control:"settings-changed"` 帧
 * 广播到该 source 对应的活跃会话,本 hook 经 `ControlStore.sourceSettings` 切片
 * (`useSyncExternalStore`)读取该 sourceKey 最近一次下发的 `values` + `liveReloadKeys`。
 * 重连后经服务端粘性帧回放自动收敛(Req 7.2),消费方无需自行处理重连逻辑。
 *
 * 不含写路径(写走 `PUT /config/source/:sourceKey`,见面板);UI 消费从简 —— 只暴露最近一次
 * 下发的快照,`liveReloadKeys` 子集的取舍(是否/如何立即生效)由消费方自行判断。
 *
 * 风格对齐 `useExtensionState`:经 `connection.controlStore` 订阅,无 `usePiContext` 依赖
 * (只读,不需要 client)。
 */
import { useSyncExternalStore } from "react";
import type { PiSessionConnection } from "../sse/connection.js";
import type { SourceSettingsChangedEntry } from "../sse/control-store.js";

export interface UseSourceSettingsChangedOptions {
  /** 要订阅的 sourceKey;`undefined` 时恒返回 `undefined`(未选定 source)。 */
  readonly sourceKey: string | undefined;
  readonly connection: PiSessionConnection | undefined;
}

const NO_SUBSCRIBE = (): (() => void) => () => undefined;

/**
 * 订阅指定 sourceKey 最近一次运行期实时下发的 settings 快照。
 *
 * @returns 未下发过(或 `sourceKey`/`connection` 缺省)时为 `undefined`。
 */
export function useSourceSettingsChanged(
  opts: UseSourceSettingsChangedOptions,
): SourceSettingsChangedEntry | undefined {
  const connection = opts.connection;
  const snapshot = useSyncExternalStore(
    connection?.controlStore.subscribe ?? NO_SUBSCRIBE,
    connection?.controlStore.getSnapshot ?? ((): undefined => undefined),
    connection?.controlStore.getSnapshot ?? ((): undefined => undefined),
  );
  if (opts.sourceKey === undefined) return undefined;
  return snapshot?.sourceSettings[opts.sourceKey];
}
