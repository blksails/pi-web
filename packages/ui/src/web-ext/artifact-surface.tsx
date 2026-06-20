/**
 * ArtifactSurface — Tier4 隔离表面(任务 5.4 / Req 5.x)。
 *
 * 在 `sandbox="allow-scripts"` 的 iframe 中渲染 artifact(**不带** allow-same-origin →
 * 不透明 origin,无宿主 cookie/存储/DOM/凭证)。经 postMessage 双向通信:宿主校验
 * `event.source`(须为本 iframe)与消息结构(parseArtifactMessage),非法丢弃;
 * `resize` 调整高度,`rpc` 经注入的 UiRpcClient 中转回 agent。LLM 输出一律走此表面。
 */
import * as React from "react";
import { parseArtifactMessage } from "@pi-web/protocol";
import type { UiRpcClient } from "@pi-web/web-kit";

export interface ArtifactSurfaceProps {
  /** artifact 入口 URL(独立 origin 加载)。与 srcDoc 二选一。 */
  readonly src?: string;
  /** 内联 HTML(srcdoc;不透明 origin)。 */
  readonly srcDoc?: string;
  readonly initialHeight?: number;
  readonly title?: string;
  /** rpc 中转客户端(artifact 经此回 agent)。 */
  readonly rpc?: UiRpcClient;
  /**
   * 宿主 → artifact 推送(对话/agent 输出驱动 artifact 修改):变化时经 `event` 消息
   * postMessage 进 iframe。`data` 变化即重投;iframe 就绪后也补投最新值(防早到丢失)。
   */
  readonly push?: { readonly name: string; readonly data: unknown };
  readonly className?: string;
}

export function ArtifactSurface({
  src,
  srcDoc,
  initialHeight = 200,
  title = "artifact",
  rpc,
  push,
  className,
}: ArtifactSurfaceProps): React.JSX.Element {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState<number>(initialHeight);
  // 记录最新 push,iframe 加载完成(onLoad)时补投一次,避免推送早于 iframe 就绪而丢失。
  const pushRef = React.useRef<ArtifactSurfaceProps["push"]>(push);
  pushRef.current = push;

  // 宿主 → artifact:push 变化即投递(对话修改 artifact 的正向通道)。
  const pushKey = push === undefined ? "" : JSON.stringify(push);
  React.useEffect(() => {
    if (push === undefined) return;
    iframeRef.current?.contentWindow?.postMessage(
      { kind: "event", name: push.name, data: push.data },
      "*",
    );
    // 依赖序列化值:同一文本不重复投递,流式增量逐帧更新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushKey]);

  React.useEffect(() => {
    function onMessage(ev: MessageEvent): void {
      // 来源校验:必须来自本 iframe 的 contentWindow(Req 5.4)。
      const frameWin = iframeRef.current?.contentWindow ?? null;
      if (frameWin !== null && ev.source !== frameWin) return;
      const msg = parseArtifactMessage(ev.data);
      if (msg === undefined) return; // 非法结构丢弃(Req 5.4)
      switch (msg.kind) {
        case "resize":
          setHeight(msg.height);
          break;
        case "rpc":
          if (rpc !== undefined) {
            // artifact → agent 回调:转发到 ui-rpc 总线;响应经 `event` 消息回灌 iframe,
            // 使「对话/agent」可驱动并修改 artifact 内容(闭环;不透明 origin 用 "*" 投递)。
            void rpc
              .request({
                point: msg.request.point,
                action: msg.request.action,
                payload: msg.request.payload,
              })
              .then((resp) => {
                frameWin?.postMessage(
                  { kind: "event", name: "rpc:response", data: resp },
                  "*",
                );
              });
          }
          break;
        case "ready":
        case "event":
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [rpc]);

  // sandbox 不含 allow-same-origin → 不透明 origin、无同源凭证访问(Req 5.2)。
  return (
    <iframe
      ref={iframeRef}
      data-pi-artifact
      title={title}
      sandbox="allow-scripts"
      onLoad={() => {
        // iframe 就绪后补投最新 push,确保对话已产生的输出不因加载时序而丢失。
        const p = pushRef.current;
        if (p !== undefined) {
          iframeRef.current?.contentWindow?.postMessage(
            { kind: "event", name: p.name, data: p.data },
            "*",
          );
        }
      }}
      {...(src !== undefined ? { src } : {})}
      {...(srcDoc !== undefined ? { srcDoc } : {})}
      style={{ width: "100%", height, border: "0" }}
      {...(className !== undefined ? { className } : {})}
    />
  );
}
