/**
 * agents/aigc 图片工具渲染器(Tier2 · 承接自范例 examples/aigc-agent/.pi/web)。
 *
 * 让 image_generation / image_edit 产物显示为图片,**同时保留默认工具卡外观**
 * (工具名 / 状态 / 可折叠明细)。做法:复用宿主 `PiToolPart` 壳,仅把它的 `output`
 * (默认 content 数组 → JSON 代码块)替换为 **markdown 字符串**;`PiToolPart` 对
 * string 型 output 走 `<Response>` 富渲染,其中 `![name](displayUrl)`(工具 content 携带的
 * 带签名、带 `/api` 前缀的可达 URL)被渲成 `<img>`。
 *
 * 从 content 取 URL 而非 details:pi 的 tool result 消息流只携带 content,details 不到前端。
 *
 * 与范例的唯一差异:视图切换按钮的高亮色由范例紫(#7c3aed)改为本源单色黑白(设计系统 §2.5);
 * 图像永远以 displayUrl 引用流转,绝不进 base64(SES-P2)。
 */
import * as React from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";
import { PiToolPart } from "@blksails/pi-web-ui";

/** content 数组 → 合并各 text part 的文本。 */
function joinTextParts(parts: ReadonlyArray<unknown>): string {
  return parts
    .map((c) =>
      c && typeof c === "object" && "text" in c
        ? String((c as { text?: unknown }).text ?? "")
        : "",
    )
    .join("\n");
}

/**
 * 把 tool part 的 output 归一为 markdown 文本(含 `![](displayUrl)`),兼容两条路径的形态:
 *  - output = 工具结果对象 `{ content, details }` → 优先用 `details.assets[].displayUrl`;
 *  - 纯 `content` 数组(无 details 的工具 / 旧消息)→ 合并其 text;
 *  - string:原样。
 */
function extractText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return joinTextParts(output);
  if (output && typeof output === "object") {
    const o = output as { content?: unknown; details?: unknown };
    // 即时路径:details.assets 直接带签名 displayUrl,优先据此产 markdown 图片。
    const assets = (o.details as { assets?: unknown } | undefined)?.assets;
    if (Array.isArray(assets)) {
      const md = assets
        .map((a) => {
          const x = a as { name?: unknown; displayUrl?: unknown };
          return typeof x.displayUrl === "string"
            ? `![${String(x.name ?? "image")}](${x.displayUrl})`
            : "";
        })
        .filter(Boolean)
        .join("\n");
      if (md.length > 0) return md;
    }
    // 退而取 content(可能已含 markdown 图片)。
    if (o.content !== undefined) return extractText(o.content);
  }
  return "";
}

/** 取工具结果的 content(剥 details);content 数组 / string 原样。 */
function contentOf(output: unknown): unknown {
  if (
    output &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    "content" in output
  ) {
    return (output as { content?: unknown }).content;
  }
  return output;
}

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

function AigcImageRenderer({
  part,
  message,
}: {
  part: { output?: unknown; [k: string]: unknown };
  message?: unknown;
}): React.JSX.Element {
  // 视图切换:image(默认,渲成图片)/ json(归一后的 content 走默认 JsonBlock,便于调试)。
  const [view, setView] = React.useState<"image" | "json">("image");

  // image:把 output 换成 markdown(含 `![](displayUrl)`),由 PiToolPart 的 Response 渲成图;
  // json:展示工具调用——输入参数 input(prompt/model 等)+ 输出 content。
  const output =
    view === "image"
      ? extractText(part.output)
      : { input: part.input, output: contentOf(part.output) };
  const patched = { ...part, output };

  return (
    <div data-testid="aigc-tool-card">
      <div
        style={{
          display: "flex",
          gap: 4,
          justifyContent: "flex-end",
          marginBottom: 4,
        }}
      >
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
      <PiToolPart part={patched as never} message={message as never} />
    </div>
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
