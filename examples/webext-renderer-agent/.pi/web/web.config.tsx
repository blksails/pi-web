/** webext-renderer-agent UI 扩展:Tier 2 自定义 data-part 渲染器。 */
import * as React from "react";
import { defineWebExtension } from "@pi-web/web-kit";

function MetricRenderer({ part }: { part: { data?: unknown } }): React.JSX.Element {
  const data = (part.data ?? {}) as { label?: string; value?: number };
  return (
    <div data-testid="metric-card" style={{ padding: 8, border: "1px solid #ddd" }}>
      <strong>{data.label ?? "metric"}</strong>: <span>{data.value ?? 0}</span>
    </div>
  );
}

/** 从工具返回值/入参里稳健抽取文本(支持 string / {text} / {content:[{text}]} 形态)。 */
function extractText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v !== null && typeof v === "object") {
    const o = v as { text?: unknown; content?: unknown };
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.content)) {
      return o.content
        .map((c) =>
          c !== null &&
          typeof c === "object" &&
          typeof (c as { text?: unknown }).text === "string"
            ? (c as { text: string }).text
            : "",
        )
        .join("");
    }
  }
  return "";
}

/**
 * Tier2 自定义 tool 渲染器(R8):命中 `tool-echo` part 时由本渲染器渲染。
 * 读取该 tool part 的 input(入参 text)/ output(执行结果)/ state(生命周期),
 * 渲染一张含「输入 / 输出 / 状态」三段的富卡片,替代默认工具卡。配色取宿主主题
 * token(`hsl(var(--…))`),亮/暗主题与 declarative 主题覆盖都自适应。
 */
function EchoToolRenderer({
  part,
}: {
  part: { input?: unknown; output?: unknown; state?: string };
}): React.JSX.Element {
  const input = (part.input ?? {}) as { text?: string };
  const echoed = input.text ?? "";
  const output = extractText(part.output);
  const done = part.state === "output-available";
  const failed = part.state === "output-error";
  const statusLabel = failed ? "出错" : done ? "完成" : "运行中";
  const statusColor = failed
    ? "hsl(0 72% 51%)"
    : done
      ? "hsl(142 71% 45%)"
      : "hsl(var(--muted-foreground))";

  return (
    <div
      data-testid="echo-tool-card"
      data-pi-echo-card
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid hsl(var(--border))",
        borderLeft: "3px solid hsl(var(--primary))",
        background: "hsl(var(--muted))",
        color: "hsl(var(--foreground))",
        fontSize: 13,
        maxWidth: 560,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden="true">🔧</span>
        <strong>Echo</strong>
        <span style={{ color: "hsl(var(--muted-foreground))" }}>
          · 扩展自定义渲染器(webext-renderer)
        </span>
        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            color: statusColor,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: statusColor,
            }}
          />
          {statusLabel}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
          输入 · text
        </span>
        <code
          data-testid="echo-input"
          style={{
            display: "block",
            padding: "6px 8px",
            borderRadius: 6,
            background: "hsl(var(--background))",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {echoed || "—"}
        </code>
      </div>

      {output.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
            输出 · echoed
          </span>
          <div
            data-testid="echo-output"
            style={{
              padding: "6px 8px",
              borderRadius: 6,
              background: "hsl(var(--background))",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {output}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default defineWebExtension({
  manifestId: "webext-renderer",
  capabilities: ["renderers"],
  renderers: {
    dataParts: {
      // 命中 message 的 `data-metric` part 时由本渲染器渲染。
      "data-metric": MetricRenderer as never,
    },
    tools: {
      // 命中 `tool-echo`(stub 每轮发 echo 工具)时由本渲染器渲染。
      echo: EchoToolRenderer as never,
    },
  },
});
