/**
 * agents/aigc 图片工具渲染器(Tier2 · 承接自范例 examples/aigc-agent/.pi/web)。
 *
 * 让 image_generation / image_edit 产物显示为图片,**同时保留工具卡外观**
 * (工具名 / 状态 / 可折叠明细)。卡壳与资产提取取自本源 `./tool-card`(自绘,零 vendor UI 依赖:
 * `.pi/web` 只可依赖宿主 import map 提供的单例包)。
 *
 * 从 content/details 取 URL:pi 的 tool result 消息流优先携带 content,details 在即时路径可用;
 * 二者皆经 `extractAssets` 归一为 `displayUrl`(带签名、带 `/api` 前缀的可达 URL)。
 *
 * 视图切换按钮为本源单色黑白(设计系统 §2.5);图像永远以 displayUrl 引用流转,绝不进 base64(SES-P2)。
 */
import * as React from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";
import {
  JsonBlock,
  MediaGrid,
  ToolShell,
  contentOf,
  extractAssets,
  phaseOf,
  plainText,
  type PartLike,
} from "./tool-card.js";

/** 视图切换按钮样式(active 高亮 · 单色黑白 · 设计系统 §2.5)。 */
function tabStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    lineHeight: 1.4,
    padding: "2px 10px",
    borderRadius: 6,
    border: "1px solid #d4d4d8",
    background: active ? "#18181b" : "transparent",
    color: active ? "#fff" : "#71717a",
    cursor: "pointer",
  };
}

function AigcImageRenderer({ part }: { part: PartLike; message?: unknown }): React.JSX.Element {
  // 视图切换:image(默认,渲成图片)/ json(输入参数 + 归一后的 content,便于调试)。
  const [view, setView] = React.useState<"image" | "json">("image");
  const phase = phaseOf(part);
  const assets = React.useMemo(
    () => (phase === "end" || phase === "update" ? extractAssets(part.output) : []),
    [part.output, phase],
  );
  const text = plainText(part.output);
  const errText = typeof part.errorText === "string" ? part.errorText : "";

  return (
    <ToolShell part={part} testId="aigc-tool-card">
      {phase === "error" ? (
        <div className="text-xs">{errText || text || "失败"}</div>
      ) : (
        <div className="space-y-2">
          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
            <button
              type="button"
              data-testid="aigc-view-image"
              aria-pressed={view === "image"}
              onClick={() => setView("image")}
              style={tabStyle(view === "image")}
            >
              图片
            </button>
            <button
              type="button"
              data-testid="aigc-view-json"
              aria-pressed={view === "json"}
              onClick={() => setView("json")}
              style={tabStyle(view === "json")}
            >
              JSON
            </button>
          </div>
          {view === "json" ? (
            <JsonBlock value={{ input: part.input, output: contentOf(part.output) }} />
          ) : assets.length > 0 ? (
            <MediaGrid assets={assets} />
          ) : text !== "" ? (
            <div className="text-xs text-[hsl(var(--foreground))]">{text}</div>
          ) : null}
        </div>
      )}
    </ToolShell>
  );
}

/** 仅渲染器面(renderers.tools),供源自身 web.config 合并。 */
export const imageRendererExtension = defineWebExtension({
  manifestId: "aigc-image-renderer",
  capabilities: ["renderers"],
  renderers: {
    tools: {
      image_generation: AigcImageRenderer as never,
      image_edit: AigcImageRenderer as never,
    },
  },
});
