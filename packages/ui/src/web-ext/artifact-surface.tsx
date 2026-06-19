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
  readonly className?: string;
}

export function ArtifactSurface({
  src,
  srcDoc,
  initialHeight = 200,
  title = "artifact",
  rpc,
  className,
}: ArtifactSurfaceProps): React.JSX.Element {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState<number>(initialHeight);

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
            void rpc.request({
              point: msg.request.point,
              action: msg.request.action,
              payload: msg.request.payload,
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
      {...(src !== undefined ? { src } : {})}
      {...(srcDoc !== undefined ? { srcDoc } : {})}
      style={{ width: "100%", height, border: "0" }}
      {...(className !== undefined ? { className } : {})}
    />
  );
}
