/**
 * aigc-agent UI 扩展:Tier2 自定义 tool 渲染器,让 text_to_image / image_edit 产物显示为图片,
 * **同时保留默认工具卡片外观**(工具名 / 状态 / 可折叠明细)。
 *
 * 做法:复用宿主的 `PiToolPart` 壳,仅把它的 `output`(默认是 content 数组 → JSON 代码块)
 * 替换为 **markdown 字符串**;`PiToolPart` 对 string 型 output 走 `<Response>` 富渲染,
 * 其中 `![name](displayUrl)`(工具 content 携带的带签名、带 `/api` 前缀的可达 URL)被渲成 `<img>`。
 *
 * 之所以从 content 取 URL 而非 details:pi 的 tool result 消息流只携带 content,details 不到前端。
 */
import * as React from "react";
import { defineWebExtension } from "@pi-web/web-kit";
import { PiToolPart } from "@pi-web/ui";

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
 *  - 即时 streaming 与历史回放现已同构:output = 工具结果对象 `{ content, details }`
 *    (即时经 translate-event 透传 event.result;历史经 agent-message-to-ui 透传 m.details
 *    —— pi 持久化历史**确实保留** details)→ 优先用 `details.assets[].displayUrl`;
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

/** 视图切换按钮样式(active 高亮)。 */
function tabStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    lineHeight: 1.4,
    padding: "2px 10px",
    borderRadius: 6,
    border: "1px solid #d4d4d8",
    background: active ? "#7c3aed" : "transparent",
    color: active ? "#fff" : "#71717a",
    cursor: "pointer",
  };
}

/**
 * 归一 output 为 `content` 数组,消除即时(`{ content, details }`)与历史(`content[]`)
 * 的展示差异 —— 即时独有的 `details`(tool 内部明细,历史不持久化)在 JSON 视图剥掉,
 * 使两条路径在图片/JSON 两个视图下展示一致。
 */
function normalizeContent(output: unknown): unknown {
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
  // json:归一为 content 数组(剥即时独有 details)交给 PiToolPart → JsonBlock,两路径展示一致。
  const output =
    view === "image" ? extractText(part.output) : normalizeContent(part.output);
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

export default defineWebExtension({
  manifestId: "aigc",
  capabilities: ["renderers"],
  renderers: {
    tools: {
      text_to_image: AigcImageRenderer as never,
      image_edit: AigcImageRenderer as never,
    },
  },
});
