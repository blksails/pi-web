/**
 * aigc 渲染器共用件:工具卡壳 + 媒体资产提取/单元格。
 *
 * webext 纪律:`.pi/web` 只依赖宿主经 import map 提供的单例包(`@blksails/pi-web-kit`、react),
 * **不得** import `@blksails/pi-web-ui`——那会把整份 UI 库(streamdown → katex 字体)bundle 进
 * 扩展产物,既违纪律又构建失败。故此处按 vendor `PiToolPart` 的 DOM/data-* 锚点与 class 字面量
 * 本地复刻卡壳(折叠头 + 状态徽章 + 明细区),外观随宿主主题 token 走。
 *
 * 资产恒以 displayUrl 引用流转,绝不进 base64(SES-P2)。
 */
import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ToolPill } from "@blksails/pi-web-kit";
import { c } from "./cls.js";

export type ToolPhase = "start" | "update" | "end" | "error";

const PHASE_LABEL: Record<ToolPhase, string> = {
  start: "Running",
  update: "Streaming",
  end: "Completed",
  error: "Error",
};

export type PartLike = {
  readonly type?: unknown;
  readonly state?: unknown;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly errorText?: unknown;
  readonly preliminary?: unknown;
  readonly toolName?: unknown;
  readonly [k: string]: unknown;
};

/** part.state → 阶段(与 vendor pi-tool-part 同逻辑)。 */
export function phaseOf(part: PartLike): ToolPhase {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return "start";
    case "output-error":
      return "error";
    case "output-available":
      return part.preliminary === true ? "update" : "end";
    default:
      return "start";
  }
}

/** 工具名(dynamic-tool 取 toolName,静态取 `tool-<name>` 后缀)。 */
export function nameOf(part: PartLike): string {
  if (part.type === "dynamic-tool") return typeof part.toolName === "string" ? part.toolName : "tool";
  return typeof part.type === "string" ? part.type.slice("tool-".length) : "tool";
}

/**
 * 工具卡壳:外框 + 可折叠头(工具名 + 状态徽章)+ 明细区。
 * 终态/流式默认展开,用户手动切换后接管(与 vendor PiToolPart 同款)。
 */
export function ToolShell({
  part,
  testId,
  children,
}: {
  readonly part: PartLike;
  readonly testId?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const phase = phaseOf(part);
  const name = nameOf(part);
  const isError = phase === "error";
  const contentId = React.useId();
  const [override, setOverride] = React.useState<boolean | null>(null);
  const open = override ?? phase !== "start";

  return (
    <div
      className={c(
        "toolcard",
        "overflow-hidden border-l-2 border-l-[hsl(var(--primary))] bg-[hsl(var(--surface-subtle))] text-[hsl(var(--foreground))]",
        isError && "border-l-[hsl(var(--destructive))]",
      )}
      data-pi-tool
      data-pi-tool-phase={phase}
      data-pi-tool-name={name}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOverride(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        <span aria-hidden="true" className="text-[hsl(var(--muted-foreground))]">
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
        <span className="font-medium" data-pi-tool-name-label>
          {name}
        </span>
        <span
          className={
            isError
              ? "ml-auto inline-flex items-center gap-1 rounded-full bg-[hsl(var(--destructive))] px-2 py-0.5 text-xs text-[hsl(var(--destructive-foreground))]"
              : "ml-auto inline-flex items-center gap-1 rounded-full bg-[hsl(var(--secondary))] px-2 py-0.5 text-xs text-[hsl(var(--secondary-foreground))]"
          }
          data-pi-tool-status
        >
          {PHASE_LABEL[phase]}
        </span>
      </button>
      {open ? (
        <div
          id={contentId}
          className={
            isError
              ? "border-t border-[hsl(var(--border))] px-3 py-2 text-[hsl(var(--destructive))]"
              : "border-t border-[hsl(var(--border))] px-3 py-2"
          }
          data-pi-tool-detail
        >
          {children}
          <ToolPillRow pills={toolPillsOf(part.output)} />
        </div>
      ) : null}
    </div>
  );
}

/** JSON 明细块(替代 vendor JsonBlock,无高亮)。 */
export function JsonBlock({ value }: { readonly value: unknown }): React.JSX.Element {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-[var(--radius)] bg-[hsl(var(--muted))] p-2 text-xs">
      <code className="language-json">{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}

// ── 资产提取 ────────────────────────────────────────────────────────────────

export type Kind = "image" | "video" | "audio";

export interface Asset {
  readonly name: string;
  readonly src: string;
  readonly mimeType: string;
  readonly attId: string | undefined;
  readonly kind: Kind;
}

const IMG_MD_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function attIdFromUrl(url: string): string | undefined {
  return /\/attachments\/(att_[^/?#]+)/.exec(url)?.[1];
}

function kindFromMime(mime: string, url: string): Kind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  const lower = url.split("?")[0]?.toLowerCase() ?? "";
  if (/\.(mp4|webm|mov)$/.test(lower)) return "video";
  if (/\.(mp3|wav|aac|m4a|ogg)$/.test(lower)) return "audio";
  return "image";
}

function joinTextParts(parts: ReadonlyArray<unknown>): string {
  return parts
    .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text?: unknown }).text ?? "") : ""))
    .join("\n");
}

/** content 数组 / 工具结果对象 / string → 文本。 */
export function extractText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return joinTextParts(output);
  if (output && typeof output === "object") {
    const o = output as { content?: unknown };
    if (o.content !== undefined) return extractText(o.content);
  }
  return "";
}

/** 剥掉图片 markdown 后的纯文本(headline / 错误信息)。 */
export function plainText(output: unknown): string {
  return extractText(output).replace(IMG_MD_RE, "").replace(/\n{2,}/g, "\n").trim();
}

/** 取工具结果的 content(剥 details);content 数组 / string 原样。 */
export function contentOf(output: unknown): unknown {
  if (output && typeof output === "object" && !Array.isArray(output) && "content" in output) {
    return (output as { content?: unknown }).content;
  }
  return output;
}

/**
 * 从 tool part 的 output 抽出资产:优先 `details.assets`(带 mimeType 与 attachmentId),
 * details 不到前端时兜底解析 content 里的 `![name](displayUrl)`。
 */
export function extractAssets(output: unknown): Asset[] {
  if (output && typeof output === "object") {
    const details = (output as { details?: unknown }).details as { assets?: unknown } | undefined;
    if (details && Array.isArray(details.assets)) {
      const out: Asset[] = [];
      for (const a of details.assets) {
        const x = a as {
          name?: unknown;
          displayUrl?: unknown;
          mimeType?: unknown;
          attachmentId?: unknown;
        };
        if (typeof x.displayUrl !== "string") continue;
        const mime = typeof x.mimeType === "string" ? x.mimeType : "";
        out.push({
          name: typeof x.name === "string" ? x.name : "",
          src: x.displayUrl,
          mimeType: mime,
          attId:
            typeof x.attachmentId === "string" && x.attachmentId
              ? x.attachmentId
              : attIdFromUrl(x.displayUrl),
          kind: kindFromMime(mime, x.displayUrl),
        });
      }
      if (out.length > 0) return out;
    }
  }
  const text = extractText(output);
  const out: Asset[] = [];
  IMG_MD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMG_MD_RE.exec(text)) !== null) {
    const src = (m[2] ?? "").trim();
    if (src === "") continue;
    out.push({ name: m[1] ?? "", src, mimeType: "", attId: attIdFromUrl(src), kind: kindFromMime("", src) });
  }
  return out;
}

// ── pill 系统(ui-redesign:details.pills → 卡内 pill 行)────────────────────

/** 从工具结果 details.pills 抽 pill(运行期轻校验,与 vendor toolPillsOf 同约束)。 */
export function extractPills(output: unknown): ToolPill[] {
  if (output === null || typeof output !== "object" || Array.isArray(output)) return [];
  const details = (output as { details?: unknown }).details;
  if (details === null || typeof details !== "object") return [];
  const pills = (details as { pills?: unknown }).pills;
  if (!Array.isArray(pills)) return [];
  const out: ToolPill[] = [];
  for (const p of pills) {
    if (p === null || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    if (typeof o.label !== "string" || o.label.length === 0) continue;
    out.push({
      label: o.label,
      ...(typeof o.action === "string"
        ? { action: o.action as ToolPill["action"] }
        : {}),
      ...(typeof o.src === "string" ? { src: o.src } : {}),
      ...(typeof o.copyText === "string" ? { copyText: o.copyText } : {}),
    });
  }
  return out;
}

/** 内置 pill 动作;未知 action → 惰性展示(无副作用)。 */
function runPill(p: ToolPill): void {
  switch (p.action) {
    case "download":
      if (p.src !== undefined) void downloadOne(p.src, "");
      break;
    case "open":
      if (p.src !== undefined) window.open(p.src, "_blank", "noreferrer");
      break;
    case "copy":
      void navigator.clipboard
        ?.writeText(p.copyText ?? p.src ?? p.label)
        .catch(() => undefined);
      break;
    default:
      break;
  }
}

/** 工具卡 pill 行(样式对齐宿主 toolPillRow)。 */
function ToolPillRow({ pills }: { readonly pills: readonly ToolPill[] }): React.JSX.Element | null {
  if (pills.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" data-pi-tool-pills>
      {pills.map((p, i) => (
        <button
          key={`${i}-${p.label}`}
          type="button"
          data-pi-tool-pill
          onClick={() => runPill(p)}
          title={p.src}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--surface))] px-2.5 text-xs text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--surface-subtle))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── 资产单元格 ──────────────────────────────────────────────────────────────

function openInCanvas(attId: string | undefined): void {
  if (attId === undefined) return;
  document.dispatchEvent(new CustomEvent("aigc-open-canvas-asset", { detail: { attachmentId: attId } }));
}

async function downloadOne(src: string, name: string): Promise<void> {
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name !== "" ? name : "media";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    window.open(src, "_blank", "noreferrer");
  }
}

/** 单个资产:video/audio 原生播放器,image 渲 <img> 且可点击进画布。 */
export function MediaCell({ asset }: { readonly asset: Asset }): React.JSX.Element {
  return (
    <div className={c("imgcard-cell")}>
      {asset.kind === "video" ? (
        <video
          src={asset.src}
          controls
          preload="metadata"
          style={{ maxWidth: "100%", borderRadius: 6, display: "block" }}
        />
      ) : asset.kind === "audio" ? (
        <audio src={asset.src} controls preload="metadata" style={{ width: "100%" }} />
      ) : (
        <img
          src={asset.src}
          alt={asset.name}
          loading="lazy"
          decoding="async"
          title={asset.attId !== undefined ? "点击在画布打开" : asset.name}
          onClick={() => openInCanvas(asset.attId)}
          style={{
            maxWidth: "100%",
            maxHeight: "40vh",
            borderRadius: 6,
            display: "block",
            cursor: asset.attId ? "pointer" : "default",
          }}
          {...(asset.attId !== undefined ? { "data-att-id": asset.attId } : {})}
        />
      )}
      <div className={c("imgcard-acts")}>
        {asset.kind === "image" && asset.attId !== undefined ? (
          <button type="button" onClick={() => openInCanvas(asset.attId)} title="在画布打开">
            画布
          </button>
        ) : null}
        <button type="button" onClick={() => void downloadOne(asset.src, asset.name)} title="下载">
          下载
        </button>
      </div>
      {asset.name !== "" ? (
        <span className={c("imgcard-name")} title={asset.name}>
          {asset.name}
        </span>
      ) : null}
    </div>
  );
}

/** 资产网格(卡内统一容器)。 */
export function MediaGrid({ assets }: { readonly assets: readonly Asset[] }): React.JSX.Element {
  return (
    <div className={c("imgcard")}>
      <div className={c("imgcard-grid")}>
        {assets.map((a, i) => (
          <MediaCell key={`${i}-${a.src.slice(-24)}`} asset={a} />
        ))}
      </div>
    </div>
  );
}
