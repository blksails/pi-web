/**
 * 单元:useSourceSettingsChanged(source-settings-and-slots,任务 7.2;Req 7.1/7.2)。
 *  - 下行 control:settings-changed 帧到达 → hook 返回该 sourceKey 的最新快照并重渲
 *  - 不同 sourceKey 互不干扰
 *  - sourceKey 未定义时恒返回 undefined
 *  - 重连粘性帧回放(等价于 applyControlFrame 再次收到同一 sourceKey 的帧)同样生效,
 *    与「重连不丢」语义一致 —— hook 本身不区分首次下发与回放,只读 store 快照。
 */
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSourceSettingsChanged } from "../../src/hooks/use-source-settings-changed.js";
import { PiSessionConnection } from "../../src/sse/connection.js";

function setup() {
  const connection = new PiSessionConnection({
    baseUrl: "http://api.test",
    sessionId: "s1",
    fetchImpl: (async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
  });
  return { connection };
}

describe("useSourceSettingsChanged", () => {
  it("下行 control:settings-changed 帧到达后返回该 sourceKey 的最新值", async () => {
    const { connection } = setup();
    const { result } = renderHook(() =>
      useSourceSettingsChanged({ sourceKey: "abc123", connection }),
    );
    expect(result.current).toBeUndefined();

    act(() => {
      connection.controlStore.applyControlFrame({
        control: "settings-changed",
        sourceKey: "abc123",
        values: { apiBase: "https://x.test" },
        liveReloadKeys: ["notifyEmail"],
      });
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        values: { apiBase: "https://x.test" },
        liveReloadKeys: ["notifyEmail"],
      }),
    );
  });

  it("不同 sourceKey 互不干扰(只读订阅 hook 各自的 sourceKey 分区)", async () => {
    const { connection } = setup();
    const a = renderHook(() => useSourceSettingsChanged({ sourceKey: "aaa", connection }));
    const b = renderHook(() => useSourceSettingsChanged({ sourceKey: "bbb", connection }));

    act(() => {
      connection.controlStore.applyControlFrame({
        control: "settings-changed",
        sourceKey: "aaa",
        values: { x: 1 },
        liveReloadKeys: [],
      });
    });

    await waitFor(() => expect(a.result.current).toEqual({ values: { x: 1 }, liveReloadKeys: [] }));
    expect(b.result.current).toBeUndefined();
  });

  it("sourceKey 未定义时恒返回 undefined,即便 store 已有其他 sourceKey 的快照", async () => {
    const { connection } = setup();
    connection.controlStore.applyControlFrame({
      control: "settings-changed",
      sourceKey: "abc123",
      values: { apiBase: "v1" },
      liveReloadKeys: [],
    });
    const { result } = renderHook(() =>
      useSourceSettingsChanged({ sourceKey: undefined, connection }),
    );
    expect(result.current).toBeUndefined();
  });

  it("重连粘性帧回放(等价再次 applyControlFrame 同一 sourceKey)同样更新 hook 读到的值", async () => {
    const { connection } = setup();
    const { result } = renderHook(() =>
      useSourceSettingsChanged({ sourceKey: "abc123", connection }),
    );

    act(() => {
      connection.controlStore.applyControlFrame({
        control: "settings-changed",
        sourceKey: "abc123",
        values: { apiBase: "v1" },
        liveReloadKeys: [],
      });
    });
    await waitFor(() => expect(result.current?.values).toEqual({ apiBase: "v1" }));

    // 模拟服务端粘性帧在重连订阅时重放(与初次下发同一帧结构)。
    act(() => {
      connection.controlStore.applyControlFrame({
        control: "settings-changed",
        sourceKey: "abc123",
        values: { apiBase: "v1" },
        liveReloadKeys: [],
      });
    });
    await waitFor(() => expect(result.current?.values).toEqual({ apiBase: "v1" }));
  });
});
