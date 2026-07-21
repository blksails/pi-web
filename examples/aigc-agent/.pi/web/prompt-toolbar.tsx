/**
 * AigcPromptToolbar — 输入区工具入口(复刻 pi-labs composer 的**交互模式**,非像素级)。
 *
 * 取代旧的固定 pill 排(技能/文生图/图生图/模型/尺寸/数量)。新交互:
 *  - `＋` 分栏工具菜单(PlusMenu):置顶「添加附件」+ 业务分栏(图片 / 视频生成 / 多媒体处理),
 *    每行 hover 浮现图钉可固定到空闲快捷 pill(localStorage,最多 MAX_PINS);点行 = 选中该工具。
 *  - 空闲态:显示已固定(或默认)工具的快捷 pill;点 = 选中。
 *  - 选中态:黑底「意图胶囊」`× 工具名` + 图片工具的内联参数(模型/尺寸/数量,复用会话偏好 KV)。
 *  - 「添加附件」= 触发 vendor 组合器隐藏的 file input(`[data-pi-attachments-input]`);vendor 自带的
 *    附件加号经 CSS 隐藏(见 globals.css),避免双入口。
 *
 * 「选中工具」在 aigc 里作**软引导**:选中即把该工具的 slash 命令(如 `/t2v `)在输入框为空时预填
 * (systemPrompt 已把 slash 映射到对应工具);已有输入则仅显示意图胶囊、不改写用户文本。选中亦写
 * 会话 KV `aigc.targetedTool` 备后续接线。`state === undefined`(宿主未接状态桥)→ 返回 null 优雅退化。
 */
import * as React from "react";
import { createPortal } from "react-dom";
import {
  Plus, Paperclip, Pin, X, ChevronDown, Zap,
  ImagePlus, Wand2, Clapperboard, Film, Layers, Scissors, UserSquare, Mic,
  Combine, Image as ImageIcon, ImageDown, Music, FileVideo, AudioLines,
  type LucideIcon,
} from "lucide-react";
import type { WebExtStateAccess } from "@blksails/pi-web-kit";
import { setSkillPanelOpen } from "./skill-panel-store.js";

// ── 工具目录(静态;13 media-tools + 2 vendor 图像工具)──────────────────────────
interface ToolDef {
  readonly name: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** 选中时预填的 slash(输入框为空时);无则仅显示意图胶囊。 */
  readonly slash?: string;
  /** 图片工具的内联参数(复用 aigc.model/size/count KV)。 */
  readonly params?: readonly ("model" | "size" | "count")[];
}
interface Section {
  readonly key: string;
  readonly label: string;
  readonly tools: readonly ToolDef[];
}
const SECTIONS: readonly Section[] = [
  {
    key: "image",
    label: "图片",
    tools: [
      { name: "image_generation", label: "文生图", icon: ImagePlus, slash: "/img-gen ", params: ["model", "size", "count"] },
      { name: "image_edit", label: "图像编辑", icon: Wand2, slash: "/img-edit ", params: ["model", "size", "count"] },
    ],
  },
  {
    key: "video",
    label: "视频生成",
    tools: [
      { name: "text_to_video", label: "文生视频", icon: Clapperboard, slash: "/t2v " },
      { name: "image_to_video", label: "图生视频", icon: Film, slash: "/i2v " },
      { name: "multimodal_reference_video", label: "多模态参考生视频", icon: Layers },
      { name: "video_edit", label: "视频编辑", icon: Scissors },
      { name: "digital_human_video", label: "数字人对口型", icon: UserSquare },
      { name: "text_to_speech", label: "文本转语音", icon: Mic, slash: "/tts " },
    ],
  },
  {
    key: "media",
    label: "多媒体处理",
    tools: [
      { name: "video_concat", label: "视频拼接", icon: Combine },
      { name: "video_clip", label: "视频截片", icon: Scissors, slash: "/clip " },
      { name: "video_to_gif", label: "视频转 GIF", icon: ImageIcon, slash: "/gif " },
      { name: "video_extract_frame", label: "截取静帧", icon: ImageDown },
      { name: "video_with_audio", label: "视频套音轨", icon: Music },
      { name: "video_transcode", label: "视频转码", icon: FileVideo },
      { name: "audio_extract", label: "音轨提取", icon: AudioLines },
    ],
  },
];
const ALL_TOOLS: readonly ToolDef[] = SECTIONS.flatMap((s) => s.tools);
const toolByName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

const MAX_PINS = 5;
const PINS_LS_KEY = "pi-web.aigc.toolpins";
const DEFAULT_PINS: readonly string[] = ["image_generation", "image_edit", "text_to_video"];

const FALLBACK_MODELS: readonly string[] = ["gpt-image-2", "qwen-image-2.0"];
const FALLBACK_SIZES: readonly string[] = ["1024x1024", "1536x1024", "1024x1536", "auto"];
const COUNTS: readonly number[] = [1, 2, 4];

// ── KV 订阅工具(与 vendor AigcQuickSettings 同范式)──────────────────────────────
function useStateKey(state: WebExtStateAccess, key: string): unknown {
  const subscribe = React.useCallback((cb: () => void) => state.subscribe(key, cb), [state, key]);
  const getSnapshot = React.useCallback(() => state.get<unknown>(key), [state, key]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
function asStrings(raw: unknown, fallback: readonly string[]): readonly string[] {
  return Array.isArray(raw) && raw.length > 0 && raw.every((x) => typeof x === "string")
    ? (raw as readonly string[])
    : fallback;
}
function sizeShort(size: string | undefined): string {
  if (size === undefined || size === "") return "跟随";
  if (size === "auto") return "自适应";
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size);
  if (m === null) return size;
  return m[1] === m[2] ? `${m[1]}²` : `${m[1]}×${m[2]}`;
}

/** 把 slash 命令预填进 vendor 组合器输入框(React 受控 textarea:走原生 setter + input 事件)。 */
function primeSlash(slash: string): void {
  const ta = document.querySelector<HTMLTextAreaElement>("[data-pi-input-textarea]");
  if (!ta) return;
  if (ta.value.trim() !== "") { ta.focus(); return; } // 有输入则不改写,仅聚焦
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), "value")?.set;
  setter?.call(ta, slash);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.focus();
}
/** 触发 vendor 组合器隐藏的 file input(添加附件)。 */
function triggerUpload(): void {
  document.querySelector<HTMLInputElement>("[data-pi-attachments-input]")?.click();
}

/**
 * 弹层入视口:菜单经 portal 挂 <body>,输入区在视口底部 —— ＋ 菜单/参数下拉若只夹 x 会向下溢出看不全。
 * 测真实尺寸后 x 夹进视口、下方放不下则贴底上翻(材料抽屉同款 useFitPos)。
 */
function useFitPos(
  x: number,
  y: number,
): { ref: React.RefObject<HTMLDivElement | null>; style: React.CSSProperties } {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number }>({ left: x, top: y });
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const fit = (): void => {
      const { width, height } = el.getBoundingClientRect();
      const pad = 8;
      setPos({
        left: Math.max(pad, Math.min(x, window.innerWidth - width - pad)),
        top:
          y + height > window.innerHeight - pad
            ? Math.max(pad, window.innerHeight - height - pad)
            : y,
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [x, y]);
  return { ref, style: { left: pos.left, top: pos.top } };
}

// ── 通用弹层(portal,fixed;复用 .aigc-asset-pop 不透明基调)──────────────────────
function Pop({
  anchor, onClose, width, children,
}: {
  readonly anchor: { x: number; y: number };
  readonly onClose: () => void;
  readonly width: number;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const fit = useFitPos(anchor.x, anchor.y);
  return createPortal(
    <>
      <div className="aigc-asset-backdrop" onClick={onClose} />
      <div ref={fit.ref} className="aigc-asset-pop aigc-pill-pop" style={{ ...fit.style, minWidth: width }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </>,
    document.body,
  );
}

export function AigcPromptToolbar(props: { readonly state?: WebExtStateAccess }): React.JSX.Element | null {
  const { state } = props;
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [param, setParam] = React.useState<{ kind: "model" | "size" | "count"; x: number; y: number } | null>(null);
  const [targeted, setTargeted] = React.useState<string | null>(null);
  const [pins, setPins] = React.useState<readonly string[]>(DEFAULT_PINS);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PINS_LS_KEY);
      if (raw !== null) {
        const arr = (JSON.parse(raw) as string[]).filter((n) => toolByName.has(n));
        if (arr.length > 0) setPins(arr);
      }
    } catch { /* 默认 */ }
  }, []);

  const noopState = React.useMemo<WebExtStateAccess>(
    () => ({ get: () => undefined, set: async () => {}, delete: async () => {}, subscribe: () => () => {} }),
    [],
  );
  const st = state ?? noopState;
  const models = asStrings(useStateKey(st, "aigc.models"), FALLBACK_MODELS);
  const sizes = asStrings(useStateKey(st, "aigc.sizes"), FALLBACK_SIZES);
  const labelsRaw = useStateKey(st, "aigc.modelLabels");
  const labels = typeof labelsRaw === "object" && labelsRaw !== null ? (labelsRaw as Record<string, string>) : {};
  const model = useStateKey(st, "aigc.model");
  const size = useStateKey(st, "aigc.size");
  const countRaw = useStateKey(st, "aigc.count");
  const count = typeof countRaw === "number" ? countRaw : 1;

  const setSticky = React.useCallback((key: string, val: unknown): void => {
    void st.set(key, val);
    try { localStorage.setItem(`pi-web.${key}`, JSON.stringify(val)); } catch { /* best-effort */ }
  }, [st]);

  const togglePin = React.useCallback((name: string): void => {
    setPins((prev) => {
      const has = prev.includes(name);
      const next = has ? prev.filter((n) => n !== name) : prev.length >= MAX_PINS ? prev : [...prev, name];
      try { localStorage.setItem(PINS_LS_KEY, JSON.stringify(next)); } catch { /* best-effort */ }
      return next;
    });
  }, []);

  const pickTool = React.useCallback((name: string): void => {
    setTargeted(name);
    void st.set("aigc.targetedTool", name);
    const tool = toolByName.get(name);
    if (tool?.slash) primeSlash(tool.slash);
    setMenu(null);
  }, [st]);

  const clearTarget = React.useCallback((): void => {
    setTargeted(null);
    void st.set("aigc.targetedTool", "");
  }, [st]);

  if (state === undefined) return null;

  const targetedTool = targeted !== null ? toolByName.get(targeted) : undefined;
  const modelLabel = typeof model === "string" && model !== "" ? (labels[model] ?? model) : "默认";
  const idlePills = (pins.length > 0 ? pins : DEFAULT_PINS)
    .map((n) => toolByName.get(n))
    .filter((t): t is ToolDef => Boolean(t))
    .slice(0, MAX_PINS);
  const openMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4 });
  };
  const openParam = (kind: "model" | "size" | "count", e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setParam({ kind, x: r.left, y: r.bottom + 4 });
  };

  return (
    <span className="aigc-ptb" data-aigc-prompt-toolbar>
      {/* ＋ 分栏工具菜单入口 */}
      <button type="button" className="aigc-qp aigc-tool-plus" title="工具 / 添加附件" onClick={openMenu}>
        <Plus size={14} />
      </button>

      {targetedTool ? (
        <>
          {/* 意图胶囊:× 工具名 */}
          <span className="aigc-qp on aigc-intent">
            <targetedTool.icon size={13} />
            <b>{targetedTool.label}</b>
            <button type="button" className="aigc-intent-x" title="取消选中" onClick={clearTarget}>
              <X size={12} />
            </button>
          </span>
          {/* 图片工具:内联 模型/尺寸/数量(复用会话偏好 KV) */}
          {targetedTool.params?.includes("model") ? (
            <button type="button" className="aigc-qp" onClick={(e) => openParam("model", e)} title={typeof model === "string" ? model : "默认模型"}>
              模型 <b>{modelLabel}</b> <ChevronDown size={12} className="chev" />
            </button>
          ) : null}
          {targetedTool.params?.includes("size") ? (
            <button type="button" className="aigc-qp" onClick={(e) => openParam("size", e)}>
              尺寸 <b>{sizeShort(typeof size === "string" ? size : undefined)}</b> <ChevronDown size={12} className="chev" />
            </button>
          ) : null}
          {targetedTool.params?.includes("count") ? (
            <button type="button" className="aigc-qp" onClick={(e) => openParam("count", e)}>
              数量 <b>{count}</b> <ChevronDown size={12} className="chev" />
            </button>
          ) : null}
        </>
      ) : (
        // 空闲态:已固定 / 默认工具快捷 pill
        idlePills.map((t) => (
          <button key={t.name} type="button" className="aigc-qp" onClick={() => pickTool(t.name)}>
            <t.icon size={13} /> {t.label}
          </button>
        ))
      )}

      {/* ＋ 分栏菜单 */}
      {menu !== null ? (
        <Pop anchor={menu} width={230} onClose={() => setMenu(null)}>
          <button type="button" className="aigc-menu-row" onClick={() => { triggerUpload(); setMenu(null); }}>
            <Paperclip size={14} /> <span>添加附件</span>
          </button>
          {SECTIONS.map((sec) => (
            <div key={sec.key}>
              <div className="aigc-menu-sec">{sec.label}</div>
              {sec.tools.map((t) => {
                const pinned = pins.includes(t.name);
                const canPin = pinned || pins.length < MAX_PINS;
                return (
                  <div key={t.name} className="aigc-menu-item">
                    <button type="button" className="aigc-menu-row" onClick={() => pickTool(t.name)}>
                      <t.icon size={14} /> <span>{t.label}</span>
                    </button>
                    <button
                      type="button"
                      className={`aigc-menu-pin${pinned ? " on" : ""}`}
                      title={pinned ? "取消固定" : canPin ? "固定到快捷栏" : `最多固定 ${MAX_PINS} 个`}
                      disabled={!canPin}
                      onClick={(e) => { e.stopPropagation(); togglePin(t.name); }}
                    >
                      <Pin size={12} fill={pinned ? "currentColor" : "none"} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="aigc-asset-pop-sep" />
          <button type="button" className="aigc-menu-row" onClick={() => { setSkillPanelOpen(true); setMenu(null); }}>
            <Zap size={14} /> <span>管理技能…</span>
          </button>
        </Pop>
      ) : null}

      {/* 图片工具参数下拉 */}
      {param !== null ? (
        <Pop anchor={param} width={200} onClose={() => setParam(null)}>
          {param.kind === "model" ? (
            <>
              <div className="aigc-pop-title">图像模型</div>
              {models.map((m) => (
                <button key={m} type="button" className={model === m ? "on" : ""} title={m} onClick={() => { setSticky("aigc.model", m); setParam(null); }}>
                  {labels[m] ?? m}
                </button>
              ))}
            </>
          ) : param.kind === "size" ? (
            <>
              <div className="aigc-pop-title">输出尺寸</div>
              {sizes.map((s) => (
                <button key={s} type="button" className={size === s ? "on" : ""} onClick={() => { setSticky("aigc.size", s); setParam(null); }}>
                  {sizeShort(s)} <span className="hint">{s}</span>
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="aigc-pop-title">生成数量</div>
              {COUNTS.map((n) => (
                <button key={n} type="button" className={count === n ? "on" : ""} onClick={() => { setSticky("aigc.count", n); setParam(null); }}>
                  ×{n}
                </button>
              ))}
            </>
          )}
        </Pop>
      ) : null}
    </span>
  );
}
