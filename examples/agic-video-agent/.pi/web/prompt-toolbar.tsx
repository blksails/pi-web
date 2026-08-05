/**
 * AigcPromptToolbar —— 输入区工具排(promptToolbar 槽),承接独立仓 aigc-agent 的 composer 交互模式。
 *
 * 交互(与源项目一致):
 *  - `＋` 分栏工具菜单:业务分栏(图片 / 视频生成 / 多媒体处理),置顶「添加附件」;每行 hover 浮现
 *    图钉可固定到快捷 pill(localStorage,最多 MAX_PINS);点行 = 选中该工具。
 *  - 空闲态:显示已固定(或默认)工具的快捷 pill;点 = 选中。
 *  - 选中态:「意图胶囊」`× 工具名` + 图像工具的内联参数(模型/尺寸/数量,复用会话偏好 KV)。
 *  - 「添加附件」触发 vendor 组合器隐藏的 file input(`[data-pi-attachments-input]`)。
 *
 * 「选中工具」仅更新意图胶囊与会话 KV `aigc.targetedTool`,不改写用户输入。
 *
 * webext 纪律:只 import 宿主 import map 单例(`react` / `@blksails/pi-web-kit`)与本源文件;
 * `lucide-react` 是纯 SVG 组件库,tree-shake 后仅打进用到的图标(不似 `pi-web-ui` 会拖入 katex 字体)。
 * 类名一律经 `./cls` 的 `c()` 加 `pw-aigc-studio-` 前缀,与 `styles.css` 的 scoping 对齐。
 * 技能管理 pill 由 `aigc.skills` 状态配置;未下发时回退 agent 内置技能。
 */
import * as React from "react";
import { createPortal } from "react-dom";
import {
  Plus, Paperclip, Pin, X, ChevronDown,
  ImagePlus, Wand2, Clapperboard, Film, Layers, Scissors, UserSquare, Mic,
  Combine, Image as ImageIcon, ImageDown, Music, FileVideo, AudioLines, Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { SlotRenderProps, WebExtStateAccess } from "@blksails/pi-web-kit";
import { c } from "./cls.js";

/**
 * 插槽 props:契约类型 `SlotRenderProps` 目前只声明 `extId`,但宿主 `SlotHost`
 * (`packages/ui/src/web-ext/extension-slots.tsx:57`)确实把 `state` 透传给插槽组件。
 * 故此处以交叉类型显式接住——`state` 可选,仍可赋给 `ComponentType<SlotRenderProps>`,
 * 无需 `as never` 绕过类型。宿主未接状态桥时 `state === undefined`,组件优雅退化返回 null。
 */
type PromptToolbarProps = SlotRenderProps & { readonly state?: WebExtStateAccess };

// ── 工具目录(静态;13 media-tools + 2 图像工具)────────────────────────────────
interface ToolDef {
  readonly name: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** 图像工具的内联参数(复用 aigc.model/size/count KV)。 */
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
      { name: "image_generation", label: "文生图", icon: ImagePlus, params: ["model", "size", "count"] },
      { name: "image_edit", label: "图像编辑", icon: Wand2, params: ["model", "size", "count"] },
    ],
  },
  {
    key: "video",
    label: "视频生成",
    tools: [
      { name: "text_to_video", label: "文生视频", icon: Clapperboard },
      { name: "image_to_video", label: "图生视频", icon: Film },
      { name: "multimodal_reference_video", label: "多模态参考生视频", icon: Layers },
      { name: "video_edit", label: "视频编辑", icon: Scissors },
      { name: "digital_human_video", label: "数字人对口型", icon: UserSquare },
      { name: "text_to_speech", label: "文本转语音", icon: Mic },
    ],
  },
  {
    key: "media",
    label: "多媒体处理",
    tools: [
      { name: "video_concat", label: "视频拼接", icon: Combine },
      { name: "video_clip", label: "视频截片", icon: Scissors },
      { name: "video_to_gif", label: "视频转 GIF", icon: ImageIcon },
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
interface SkillDef {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
}
const DEFAULT_SKILLS: readonly SkillDef[] = [
  { name: "creative-nine-grid-pro", label: "九宫格创作", description: "九宫格定位与排版" },
];

const FALLBACK_MODELS: readonly string[] = ["gpt-image-2", "qwen-image-2.0"];
const FALLBACK_SIZES: readonly string[] = ["1024x1024", "1536x1024", "1024x1536", "auto"];
const COUNTS: readonly number[] = [1, 2, 4];
const PROVIDER_COLORS: Readonly<Record<string, string>> = {
  NewAPI: "#f59e0b",
  sufy: "#f97316",
  OpenRouter: "#6366f1",
  Cloudflare: "#f97316",
};

function modelDisplay(label: string): { readonly name: string; readonly provider?: string } {
  const [name, provider] = label.split(/\s+·\s+/, 2);
  return { name: name ?? label, ...(provider !== undefined ? { provider } : {}) };
}

function asSkills(raw: unknown): readonly SkillDef[] {
  if (!Array.isArray(raw)) return DEFAULT_SKILLS;
  const skills = raw.filter((item): item is SkillDef => {
    if (typeof item !== "object" || item === null) return false;
    const value = item as Record<string, unknown>;
    return typeof value.name === "string" && typeof value.label === "string";
  });
  return skills.length > 0 ? skills : DEFAULT_SKILLS;
}

// 构建期注册表直接载入 TS 描述符，不经过 webext 的 ext.css 管线；故工具栏自带最小关键样式。
// 独立发布形态仍由 styles.css 供全量样式，两路视觉同构。
const PROMPT_TOOLBAR_CSS = `
[data-pi-attachments-add]{display:none!important}
[data-aigc-prompt-toolbar]{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
.pw-aigc-studio-qp{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;border:1px solid hsl(var(--border));border-radius:999px;background:hsl(var(--background));color:hsl(var(--muted-foreground));font-size:12px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.pw-aigc-studio-qp:hover{background:hsl(var(--muted));color:hsl(var(--foreground))}
.pw-aigc-studio-qp.pw-aigc-studio-on{border-color:transparent;background:hsl(var(--primary));color:hsl(var(--primary-foreground))}
.pw-aigc-studio-skill{background:hsl(var(--background));color:hsl(var(--foreground))}
.pw-aigc-studio-skill-pop{min-width:220px}
.pw-aigc-studio-skill-pop button{display:flex;align-items:flex-start;gap:8px;width:100%;padding:8px 9px;border-radius:7px;font-size:12.5px;text-align:left}
.pw-aigc-studio-skill-pop button:hover:not(:disabled),.pw-aigc-studio-skill-pop button.pw-aigc-studio-on{background:hsl(var(--muted));color:hsl(var(--foreground))}
.pw-aigc-studio-skill-pop button b{display:block;font-weight:600}
.pw-aigc-studio-skill-pop button small{display:block;margin-top:2px;color:hsl(var(--muted-foreground));font-size:10.5px}
.pw-aigc-studio-tool-plus{order:-1;padding:0 7px}
.pw-aigc-studio-intent-x{display:inline-flex;margin-left:2px;padding:0;border:0;background:none;color:inherit;cursor:pointer;opacity:.75}
.pw-aigc-studio-pop-backdrop{position:fixed;inset:0;z-index:70}
.pw-aigc-studio-pop{position:fixed;z-index:71;display:flex;flex-direction:column;gap:1px;min-width:132px;padding:4px;border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--popover));color:hsl(var(--popover-foreground));box-shadow:0 10px 30px rgb(0 0 0/.18)}
.pw-aigc-studio-pop button{border:0;background:none;color:inherit;cursor:pointer}
.pw-aigc-studio-pop button:hover:not(:disabled){background:hsl(var(--muted))}
.pw-aigc-studio-menu-sec,.pw-aigc-studio-pop-title{padding:6px 9px 2px;color:hsl(var(--muted-foreground));font-size:10.5px;letter-spacing:.04em}
.pw-aigc-studio-menu-item{display:flex;align-items:center}
.pw-aigc-studio-menu-row{display:inline-flex;flex:1;align-items:center;gap:8px;min-width:0;padding:6px 9px;border-radius:7px;font-size:12.5px;text-align:left}
.pw-aigc-studio-menu-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pw-aigc-studio-menu-pin{flex:none;margin-right:4px;padding:4px;border-radius:5px;color:hsl(var(--muted-foreground));opacity:0}
.pw-aigc-studio-menu-item:hover .pw-aigc-studio-menu-pin,.pw-aigc-studio-menu-pin.pw-aigc-studio-on{opacity:1}
.pw-aigc-studio-pill-pop{max-height:320px;overflow-y:auto}
.pw-aigc-studio-pill-pop button{display:flex;width:100%;align-items:center;justify-content:flex-start;padding:8px 10px;border-radius:7px;font-size:13px;line-height:1.3;text-align:left;white-space:nowrap}
.pw-aigc-studio-pill-pop button:hover:not(:disabled){background:hsl(var(--muted));color:hsl(var(--foreground))}
.pw-aigc-studio-pill-pop button.pw-aigc-studio-on{background:hsl(var(--accent));color:hsl(var(--accent-foreground));font-weight:600}
.pw-aigc-studio-pill-pop .pw-aigc-studio-hint{margin-left:auto;padding-left:12px;color:hsl(var(--muted-foreground));font-size:10.5px}
.pw-aigc-studio-model-badge{display:grid;flex:none;width:16px;height:16px;place-items:center;border-radius:4px;color:#fff;font-size:9px;font-weight:700;line-height:1}
.pw-aigc-studio-model-name{min-width:0;overflow:hidden;text-overflow:ellipsis}
`;

// ── 会话 KV 订阅 ─────────────────────────────────────────────────────────────
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

/** 触发宿主组合器隐藏的 file input(添加附件)。 */
function triggerUpload(): void {
  document.querySelector<HTMLInputElement>("[data-pi-attachments-input]")?.click();
}

/**
 * 弹层入视口:菜单经 portal 挂 `<body>`,而输入区在视口底部——若只夹 x 会向下溢出看不全。
 * 故测真实尺寸后 x 夹进视口、下方放不下则贴底上翻。
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
        top: y + height > window.innerHeight - pad ? Math.max(pad, window.innerHeight - height - pad) : y,
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [x, y]);
  return { ref, style: { left: pos.left, top: pos.top } };
}

/** 通用弹层(portal + fixed)。 */
function Pop({
  anchor, onClose, width, className, children,
}: {
  readonly anchor: { x: number; y: number };
  readonly onClose: () => void;
  readonly width: number;
  readonly className?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const fit = useFitPos(anchor.x, anchor.y);
  return createPortal(
    <>
      <div className={c("pop-backdrop")} onClick={onClose} />
      <div
        ref={fit.ref}
        className={className !== undefined ? `${c("pop")} ${className}` : c("pop")}
        style={{ ...fit.style, minWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

export function AigcPromptToolbar(props: PromptToolbarProps): React.JSX.Element | null {
  const { state } = props;
  const [composerToolbar, setComposerToolbar] = React.useState<HTMLElement | null>(null);
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [skillMenu, setSkillMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [param, setParam] = React.useState<{ kind: "model" | "size" | "count"; x: number; y: number } | null>(null);
  const [targeted, setTargeted] = React.useState<string | null>(null);
  const [pins, setPins] = React.useState<readonly string[]>(DEFAULT_PINS);

  React.useEffect(() => {
    setComposerToolbar(document.querySelector<HTMLElement>("[data-pi-prompt-input-toolbar]"));
  }, []);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PINS_LS_KEY);
      if (raw !== null) {
        const arr = (JSON.parse(raw) as string[]).filter((n) => toolByName.has(n));
        if (arr.length > 0) setPins(arr);
      }
    } catch {
      /* 用默认 */
    }
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
  const skills = asSkills(useStateKey(st, "aigc.skills"));
  const activeSkill = useStateKey(st, "aigc.skill");
  const activeSkillName = typeof activeSkill === "string" ? activeSkill : "";
  const activeSkillDef = skills.find((skill) => skill.name === activeSkillName);

  const setSticky = React.useCallback(
    (key: string, val: unknown): void => {
      void st.set(key, val);
      try {
        localStorage.setItem(`pi-web.${key}`, JSON.stringify(val));
      } catch {
        /* best-effort */
      }
    },
    [st],
  );

  const togglePin = React.useCallback((name: string): void => {
    setPins((prev) => {
      const has = prev.includes(name);
      const next = has ? prev.filter((n) => n !== name) : prev.length >= MAX_PINS ? prev : [...prev, name];
      try {
        localStorage.setItem(PINS_LS_KEY, JSON.stringify(next));
      } catch {
        /* best-effort */
      }
      return next;
    });
  }, []);

  const pickTool = React.useCallback(
    (name: string): void => {
      setTargeted(name);
      void st.set("aigc.targetedTool", name);
      setMenu(null);
    },
    [st],
  );

  const clearTarget = React.useCallback((): void => {
    setTargeted(null);
    void st.set("aigc.targetedTool", "");
  }, [st]);

  // 宿主未接状态桥 → 优雅退化(不渲染,不报错)。
  if (state === undefined) return null;

  const targetedTool = targeted !== null ? toolByName.get(targeted) : undefined;
  const modelLabel = typeof model === "string" && model !== "" ? (labels[model] ?? model) : "默认";
  const idlePills = (pins.length > 0 ? pins : DEFAULT_PINS)
    .map((n) => toolByName.get(n))
    .filter((t): t is ToolDef => t !== undefined)
    .slice(0, MAX_PINS);
  const openMenu = (e: React.MouseEvent): void => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4 });
  };
  const openSkillMenu = (e: React.MouseEvent): void => {
    const r = e.currentTarget.getBoundingClientRect();
    setSkillMenu({ x: r.left, y: r.bottom + 4 });
  };
  const selectSkill = (name: string): void => {
    void st.set("aigc.skill", name);
    setSkillMenu(null);
  };
  const openParam = (kind: "model" | "size" | "count", e: React.MouseEvent): void => {
    const r = e.currentTarget.getBoundingClientRect();
    setParam({ kind, x: r.left, y: r.bottom + 4 });
  };
  const plusButton = (
    <button
      type="button"
      className={c("qp", "tool-plus")}
      aria-label="工具与添加附件"
      title="工具 / 添加附件"
      onClick={openMenu}
    >
      <Plus size={14} />
    </button>
  );

  return (
    <span className={c("ptb")} data-aigc-prompt-toolbar>
      <style>{PROMPT_TOOLBAR_CSS}</style>
      {composerToolbar !== null ? createPortal(plusButton, composerToolbar) : plusButton}

      <button
        type="button"
        className={c("qp", "skill", activeSkillDef !== undefined ? "on" : undefined)}
        aria-label="技能管理"
        aria-expanded={skillMenu !== null}
        onClick={openSkillMenu}
      >
        <Sparkles size={13} /> {activeSkillDef?.label ?? "技能管理"} <ChevronDown size={12} />
      </button>

      {targetedTool !== undefined ? (
        <>
          {/* 意图胶囊:× 工具名 */}
          <span className={c("qp", "on", "intent")}>
            <targetedTool.icon size={13} />
            <b>{targetedTool.label}</b>
            <button type="button" className={c("intent-x")} title="取消选中" onClick={clearTarget}>
              <X size={12} />
            </button>
          </span>
          {/* 图像工具:内联 模型 / 尺寸 / 数量(复用会话偏好 KV) */}
          {targetedTool.params?.includes("model") === true ? (
            <button
              type="button"
              className={c("qp")}
              onClick={(e) => openParam("model", e)}
              title={typeof model === "string" ? model : "默认模型"}
            >
              模型 <b>{modelLabel}</b> <ChevronDown size={12} className={c("chev")} />
            </button>
          ) : null}
          {targetedTool.params?.includes("size") === true ? (
            <button type="button" className={c("qp")} onClick={(e) => openParam("size", e)}>
              尺寸 <b>{sizeShort(typeof size === "string" ? size : undefined)}</b>{" "}
              <ChevronDown size={12} className={c("chev")} />
            </button>
          ) : null}
          {targetedTool.params?.includes("count") === true ? (
            <button type="button" className={c("qp")} onClick={(e) => openParam("count", e)}>
              数量 <b>{count}</b> <ChevronDown size={12} className={c("chev")} />
            </button>
          ) : null}
        </>
      ) : (
        // 空闲态:已固定 / 默认工具的快捷 pill
        idlePills.map((t) => (
          <button key={t.name} type="button" className={c("qp")} onClick={() => pickTool(t.name)}>
            <t.icon size={13} /> {t.label}
          </button>
        ))
      )}

      {skillMenu !== null ? (
        <Pop anchor={skillMenu} width={240} className={c("skill-pop")} onClose={() => setSkillMenu(null)}>
          <div className={c("pop-title")}>技能 · 点选启用</div>
          {skills.map((skill) => (
            <button
              key={skill.name}
              type="button"
              className={activeSkillName === skill.name ? c("on") : undefined}
              onClick={() => selectSkill(skill.name)}
            >
              <Sparkles size={14} />
              <span>
                <b>{skill.label}</b>
                {skill.description !== undefined ? <small>{skill.description}</small> : null}
              </span>
            </button>
          ))}
        </Pop>
      ) : null}

      {/* ＋ 分栏菜单 */}
      {menu !== null ? (
        <Pop anchor={menu} width={230} onClose={() => setMenu(null)}>
          <button
            type="button"
            className={c("menu-row")}
            onClick={() => {
              triggerUpload();
              setMenu(null);
            }}
          >
            <Paperclip size={14} /> <span>添加附件</span>
          </button>
          {SECTIONS.map((sec) => (
            <div key={sec.key}>
              <div className={c("menu-sec")}>{sec.label}</div>
              {sec.tools.map((t) => {
                const pinned = pins.includes(t.name);
                const canPin = pinned || pins.length < MAX_PINS;
                return (
                  <div key={t.name} className={c("menu-item")}>
                    <button type="button" className={c("menu-row")} onClick={() => pickTool(t.name)}>
                      <t.icon size={14} /> <span>{t.label}</span>
                    </button>
                    <button
                      type="button"
                      className={pinned ? c("menu-pin", "on") : c("menu-pin")}
                      title={pinned ? "取消固定" : canPin ? "固定到快捷栏" : `最多固定 ${MAX_PINS} 个`}
                      disabled={!canPin}
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePin(t.name);
                      }}
                    >
                      <Pin size={12} fill={pinned ? "currentColor" : "none"} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </Pop>
      ) : null}

      {/* 图像工具参数下拉 */}
      {param !== null ? (
        <Pop anchor={param} width={param.kind === "model" ? 292 : 210} className={c("pill-pop")} onClose={() => setParam(null)}>
          {param.kind === "model" ? (
            <>
              <div className={c("pop-title")}>图像模型</div>
              {models.map((m) => {
                const display = modelDisplay(labels[m] ?? m);
                return (
                  <button
                    key={m}
                    type="button"
                    className={model === m ? c("on") : undefined}
                    title={labels[m] ?? m}
                    onClick={() => {
                      setSticky("aigc.model", m);
                      setParam(null);
                    }}
                  >
                    <span
                      className={c("model-badge")}
                      style={{ background: PROVIDER_COLORS[display.provider ?? ""] ?? "#64748b" }}
                      aria-hidden
                    >
                      {(display.provider ?? display.name).slice(0, 1).toUpperCase()}
                    </span>
                    <span className={c("model-name")}>{display.name}</span>
                  </button>
                );
              })}
            </>
          ) : param.kind === "size" ? (
            <>
              <div className={c("pop-title")}>输出尺寸</div>
              {sizes.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={size === s ? c("on") : undefined}
                  onClick={() => {
                    setSticky("aigc.size", s);
                    setParam(null);
                  }}
                >
                  {sizeShort(s)} <span className={c("hint")}>{s}</span>
                </button>
              ))}
            </>
          ) : (
            <>
              <div className={c("pop-title")}>生成数量</div>
              {COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={count === n ? c("on") : undefined}
                  onClick={() => {
                    setSticky("aigc.count", n);
                    setParam(null);
                  }}
                >
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
