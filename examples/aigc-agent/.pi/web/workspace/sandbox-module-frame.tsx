// [迁移壳层] 源:aigc-agent components/sandbox-module-frame.tsx。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
"use client";

import * as React from "react";
import {
  acceptsFrameMessage,
  createRpcEndpoint,
  type RpcEndpoint,
} from "./lib/iframe-rpc.js";

/**
 * 沙箱模块外壳 —— 工作区里**第一个真 iframe 模块**的通用底座。
 *
 * 安全形制（`docs/webext-digest/01`§14 + `02`§8，逐条落在 `lib/workspace/iframe-rpc.ts`）：
 * `sandbox="allow-scripts"`，**刻意不含 `allow-same-origin`** ⇒ 子帧不透明 origin，拿不到
 * 宿主 cookie/DOM/凭证。上游 Tab 设计稿的 `sandbox` 默认值含 `allow-same-origin`，那等于
 * 放弃隔离（来源 04 §7.1 C1），不可照抄。
 *
 * 生命周期取舍：`<Activity mode="hidden">` 会清理本组件的 effect，故 **port 通道随隐藏销毁、
 * 随恢复重建**（Jay：“Design for reloads and reconnects”）。iframe 的 DOM 不动 ⇒ 子帧内部
 * 状态不丢，重连成本只有一个 ping 间隔。可见性通知走**窗口通道**而非 port —— 否则「先通知
 * 再关管道」存在投递竞态。
 */
const PING_MS = 120;
const HANDSHAKE_GIVEUP_MS = 15_000;

export interface SandboxModuleFrameProps {
  readonly src: string;
  readonly instanceId: string;
  readonly title: string;
  /** 非活跃期一律丢弃的高权限事件名（Luigi `skipEventsWhenInactive` 范式）。 */
  readonly privilegedEvents?: readonly string[];
  readonly onEvent?: (name: string, data: unknown) => void;
}

export function SandboxModuleFrame({
  src,
  instanceId,
  title,
  privilegedEvents,
  onEvent,
}: SandboxModuleFrameProps): React.JSX.Element {
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = React.useState(false);
  const [log, setLog] = React.useState("");
  // 回调/数组每次 render 换引用；放 ref 里，避免把它们塞进 effect deps 造成反复重连。
  const optsRef = React.useRef({ privilegedEvents, onEvent });
  optsRef.current = { privilegedEvents, onEvent };

  React.useLayoutEffect(() => {
    const el = frameRef.current;
    if (el === null) return;
    let disposed = false;
    let endpoint: RpcEndpoint | null = null;
    const ping = (): void =>
      el.contentWindow?.postMessage({ t: "ping", v: 1 }, "*");
    const pingTimer = setInterval(ping, PING_MS);
    const giveUp = setTimeout(() => clearInterval(pingTimer), HANDSHAKE_GIVEUP_MS);

    const onWindowMessage = (ev: MessageEvent): void => {
      // 三道闸：origin 断言 "null" → source 引用相等 → 形状校验。任一不过即丢弃。
      if (!acceptsFrameMessage(ev, { expectedSource: el.contentWindow })) return;
      if (endpoint !== null) return; // 握手已完成，忽略重复 ready
      const channel = new MessageChannel();
      endpoint = createRpcEndpoint(channel.port1, {
        ...(optsRef.current.privilegedEvents !== undefined
          ? { privilegedEvents: optsRef.current.privilegedEvents }
          : {}),
        onEvent: (name, data) => optsRef.current.onEvent?.(name, data),
      });
      // 顺序要紧：可见性先于 init 发出。两者同走**窗口通道**故严格有序，而 port 上的
      // 首条消息必然晚于子帧处理 `init` ⇒ 子帧一定先看到 visible，再收到 RPC 请求。
      // （若把 visibility 放在 init 之后，它与 port 请求分属两条通道，投递顺序无保证。）
      el.contentWindow?.postMessage({ t: "visibility", v: 1, visible: true }, "*");
      // 握手包是唯一的裸 postMessage（不透明 origin 只能 "*"）⇒ 不含任何机密。
      el.contentWindow?.postMessage({ t: "init", v: 1, instanceId }, "*", [
        channel.port2,
      ]);
      clearInterval(pingTimer);
      clearTimeout(giveUp);
      window.removeEventListener("message", onWindowMessage);
      setReady(true);
      void endpoint
        .request("getState")
        .then((s) => {
          if (disposed) return;
          const rec = s as { log?: unknown } | null;
          if (rec !== null && typeof rec === "object" && typeof rec.log === "string") {
            setLog(rec.log);
          }
        })
        .catch(() => {
          /* 子帧未实现 getState —— 不影响外壳 */
        });
    };

    window.addEventListener("message", onWindowMessage);
    ping();

    return () => {
      disposed = true;
      clearInterval(pingTimer);
      clearTimeout(giveUp);
      window.removeEventListener("message", onWindowMessage);
      el.contentWindow?.postMessage({ t: "visibility", v: 1, visible: false }, "*");
      endpoint?.destroy();
    };
  }, [src, instanceId]);

  return (
    <div
      className="aigc-sandbox-host"
      data-sandbox-host={instanceId}
      data-sandbox-ready={ready ? "true" : "false"}
      data-sandbox-log={log}
    >
      <iframe
        ref={frameRef}
        src={src}
        title={title}
        // 不加 allow-same-origin：加了就等于把宿主 DOM/凭证还给子帧，隔离归零。
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
