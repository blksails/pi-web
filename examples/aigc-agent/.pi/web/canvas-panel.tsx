/**
 * 画布工作区(自建 `.cv-panel` 外壳 · 照原型 huaying-aigc-layout.html 的右栏画布复刻)。
 *
 * 结构:**一个** `.cv-panel[data-mode=gallery|workbench]`,共享**一个** `.cv-head`(← 返回画廊 /
 * 标题+副标 / ▦切画布 / ✕隐藏画布)。gallery 态显自建 AigcGallery 六视图;workbench 态按活动标签分流:
 * 空白标签 → BlankCanvas(拖入主体);真实资产 → vendor `<CanvasWorkbench>`(内核 + 全套编辑工具),
 * 其自带 header 经 globals.css 隐掉,复用本壳的 `.aigc-cvh`。
 *
 * 图片一律 displayUrl 引用,绝不 base64;生成经 `onSubmitPrompt`/`conversation` 走对话流。
 */
import * as React from "react";
import { ChevronLeft, X, Plus, LayoutGrid } from "lucide-react";
import {
  useCanvasOpen,
  CanvasWorkbench,
  type CanvasPanelProps,
} from "@blksails/pi-web-canvas-ui";
import type {
  GalleryAsset,
  GalleryState,
} from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import { AigcGallery } from "./gallery.js";

const DOMAIN = "canvas";
const STATE_KEY = "surface:canvas";
/** 空白画布标签的 sentinel id(区别于真实 attachmentId)。 */
const BLANK = "__blank__";
/** 工具轨拖拽落点记忆键(localStorage;跨 workbench 开合/刷新粘性)。 */
const TOOLRAIL_POS_KEY = "pi-web.aigc.toolRailPos";

/** 空白画布:拖入素材作为编辑主体——画廊/缩略资产(text/att-id)直接作主体(不上传),OS 文件先上传。 */
function BlankCanvas({
  onDropFile,
  onSubjectAsset,
}: {
  readonly onDropFile: (file: File) => void;
  readonly onSubjectAsset: (attachmentId: string) => void;
}): React.JSX.Element {
  const [over, setOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // 兜底退出等待态:拖拽在别处松手/Esc 取消时 dragleave 不一定触发 → 靠 window 的 dragend/drop 清除。
  React.useEffect(() => {
    if (!over) return undefined;
    const clear = (): void => setOver(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [over]);
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setOver(false);
    const attId = e.dataTransfer?.getData("text/att-id");
    if (attId !== undefined && attId !== "") {
      onSubjectAsset(attId);
      return;
    }
    const file = e.dataTransfer?.files?.[0];
    if (file !== undefined && file.type.startsWith("image/")) {
      setBusy(true);
      onDropFile(file);
      return;
    }
    // 素材目录素材(text/uri-list,只有 CDN url,无 attachmentId):经同源代理取字节 → File →
    // 走上传接缝成主体(素材 CDN 跨域,直接 fetch 会被 CORS 拦)。
    const uri = (
      e.dataTransfer?.getData("text/uri-list") ||
      e.dataTransfer?.getData("text/plain") ||
      ""
    )
      .split("\n")[0]
      ?.trim();
    if (uri !== undefined && uri !== "" && /^https?:\/\//.test(uri)) {
      setBusy(true);
      void fetch(`/api/materials/fetch?url=${encodeURIComponent(uri)}`)
        .then((r) => r.blob())
        .then((b) =>
          onDropFile(
            new File([b], "material", { type: b.type || "image/png" }),
          ),
        )
        .catch(() => setBusy(false));
    }
  };
  return (
    <div
      className={`aigc-blank${over ? " over" : ""}`}
      data-canvas-blank
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="aigc-blank-inner">
        <div className="aigc-blank-plus">
          <Plus size={30} />
        </div>
        <div className="aigc-blank-hint">
          {busy ? "上传中…" : "拖入图片作为编辑主体"}
        </div>
      </div>
    </div>
  );
}

/** 多标签条:每个打开的资产/空白画布一个标签(tab 形,顶部圆角);「＋」新建空白。仅 workbench 态显示。 */
function TabBar({
  assets,
  tabs,
  activeId,
  onActivate,
  onClose,
  onNewBlank,
}: {
  readonly assets: readonly GalleryAsset[];
  readonly tabs: readonly string[];
  readonly activeId: string | null;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onNewBlank: () => void;
}): React.JSX.Element {
  return (
    <div className="aigc-cvtabs" data-canvas-tabbar>
      {tabs.map((id, i) => {
        const blank = id === BLANK;
        const asset = blank
          ? undefined
          : assets.find((a) => a.attachmentId === id);
        return (
          <div
            key={id}
            className={`aigc-cvtab${id === activeId ? " on" : ""}`}
            onClick={() => onActivate(id)}
            role="tab"
            aria-selected={id === activeId}
          >
            <span className="aigc-cvtab-t">
              {blank ? "空白画布" : asset?.name || `图 ${i}`}
            </span>
            <button
              type="button"
              className="aigc-cvtab-x"
              aria-label="关闭标签"
              onClick={(e) => {
                e.stopPropagation();
                onClose(id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="aigc-cvtab-add"
        onClick={onNewBlank}
        title="新建空白画布"
        aria-label="新建空白画布"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

/**
 * ToolRailDock — 让 vendor CanvasWorkbench 的浮动工具轨(`[data-canvas-tool-rail]`)可拖拽 + 靠边停靠
 * (承接原型 `.ftool` 交互:拖 grip 移动;近左/右边竖排停靠,近上/下边横排停靠)。
 *
 * vendor 用 className 定位工具轨、**不设 inline style**,故本组件以命令式 inline style 覆写其位置——
 * 跨 vendor 重渲(切工具时)稳定。grip 作**工具轨父容器的兄弟节点**注入(非工具轨子节点),不受工具轨
 * 重渲影响;MutationObserver 只盯 class(vendor 重渲改 class 不改 style),触发即重贴 grip 位置,不成环。
 * 工具轨可能晚于本 effect 挂载(CanvasWorkbench 异步)→ 找不到则观察右栏等它出现。渲染 null,纯副作用。
 */
function ToolRailDock({ activeKey }: { readonly activeKey: string }): null {
  // 位置以父容器百分比存(随缩放/尺寸稳定);默认右侧竖排(贴近 vendor right-2 默认,减少挂载跳动)。
  const posRef = React.useRef<{ x: number; y: number }>({ x: 0.97, y: 0.5 });

  // activeKey(=activeId)变即重跑:拆旧 active 轨的 grip、装到新 active 那条可见轨。多标签下
  // 各 CanvasWorkbench 各有一条工具轨,只服务当前可见的一条(隐藏实例的轨在 display:none 子树)。
  React.useEffect(() => {
    let rail: HTMLElement | null = null;
    let host: HTMLElement | null = null;
    let grip: HTMLDivElement | null = null;
    let attrMo: MutationObserver | null = null;
    let waitMo: MutationObserver | null = null;

    // 回填记忆位置(上次拖到的落点;坏值/无值 → 保持默认右侧)。
    try {
      const raw = localStorage.getItem(TOOLRAIL_POS_KEY);
      if (raw !== null) {
        const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
        if (typeof p.x === "number" && typeof p.y === "number") {
          posRef.current = {
            x: Math.min(0.97, Math.max(0.03, p.x)),
            y: Math.min(0.97, Math.max(0.03, p.y)),
          };
        }
      }
    } catch {
      /* 坏值/隐私模式 → 用默认 */
    }

    const dockOf = (x: number, y: number): "left" | "right" | "horiz" =>
      y < 0.15 || y > 0.85 ? "horiz" : x < 0.5 ? "left" : "right";

    const apply = (): void => {
      if (rail === null || host === null || grip === null) return;
      const { x, y } = posRef.current;
      const dock = dockOf(x, y);
      rail.setAttribute("data-dock", dock);
      rail.style.left = `${x * 100}%`;
      rail.style.top = `${y * 100}%`;
      rail.style.right = "auto";
      rail.style.bottom = "auto";
      rail.style.transform =
        dock === "horiz"
          ? `translate(-50%, ${y < 0.5 ? "0%" : "-100%"})`
          : `translate(${x < 0.5 ? "0%" : "-100%"}, -50%)`;
      // grip 贴工具轨外缘(竖排 → 顶部;横排 → 左侧),读实际 rect 定位。
      const rr = rail.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      if (dock === "horiz") {
        grip.style.left = `${rr.left - hr.left - 15}px`;
        grip.style.top = `${rr.top - hr.top + rr.height / 2 - 6}px`;
      } else {
        grip.style.left = `${rr.left - hr.left + rr.width / 2 - 9}px`;
        grip.style.top = `${rr.top - hr.top - 15}px`;
      }
    };

    const onDown = (e: PointerEvent): void => {
      e.preventDefault();
      if (grip === null) return;
      grip.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent): void => {
        if (host === null) return;
        const hr = host.getBoundingClientRect();
        posRef.current = {
          x: Math.min(0.97, Math.max(0.03, (ev.clientX - hr.left) / hr.width)),
          y: Math.min(0.97, Math.max(0.03, (ev.clientY - hr.top) / hr.height)),
        };
        apply();
      };
      const up = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        // 记住位置(跨 workbench 开合/刷新粘性;隐私模式/配额满静默跳过)。
        try {
          localStorage.setItem(TOOLRAIL_POS_KEY, JSON.stringify(posRef.current));
        } catch {
          /* best-effort */
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

    const setup = (): boolean => {
      // 多实例并存:取当前可见(active)那条轨——隐藏实例在 display:none 子树,offsetParent 为 null。
      rail =
        Array.from(
          document.querySelectorAll<HTMLElement>("[data-canvas-tool-rail]"),
        ).find((el) => el.offsetParent !== null) ?? null;
      host = rail?.parentElement ?? null;
      if (rail === null || host === null) return false;
      grip = document.createElement("div");
      grip.className = "aigc-railgrip";
      grip.title = "拖拽移动 / 靠边停靠";
      grip.innerHTML = "<span></span>".repeat(6);
      host.appendChild(grip);
      grip.addEventListener("pointerdown", onDown);
      apply();
      attrMo = new MutationObserver(() => apply());
      attrMo.observe(rail, { attributes: true, attributeFilter: ["class"] });
      return true;
    };

    const teardown = (): void => {
      attrMo?.disconnect();
      waitMo?.disconnect();
      if (grip !== null) {
        grip.removeEventListener("pointerdown", onDown);
        grip.remove();
      }
      if (rail !== null) {
        rail.removeAttribute("data-dock");
        rail.style.cssText = ""; // 只清本组件设的 inline(vendor 用 className,不设 inline)。
      }
    };

    if (!setup()) {
      const region =
        document.querySelector("[data-canvas-region]") ?? document.body;
      waitMo = new MutationObserver(() => {
        if (setup()) waitMo?.disconnect();
      });
      waitMo.observe(region, { childList: true, subtree: true });
    }
    return teardown;
  }, [activeKey]);

  return null;
}

/**
 * 画布内容主体(始终渲染)。`onActivate` 供 panelRight 场景请求容器展开;`onHide` = 隐藏画布面板(宿主右栏
 * 把 data-canvas 置 off,抽屉仍在)。data-mode 由是否有活动标签决定:无 → gallery;有 → workbench。
 */
export function CanvasWorkspace(
  props: CanvasPanelProps & {
    readonly onActivate?: () => void;
    readonly onHide?: () => void;
    readonly upload?: (
      baseUrl: string,
      sessionId: string,
      file: File,
    ) => Promise<{ attachment: { id: string } }>;
    readonly baseUrl?: string;
    readonly sessionId?: string;
    /** 宿主直接把 vendor `useSurface().state` 传入(useSyncExternalStore 活更新),画廊/版本优先用它——
     * 比自建 adapter 的 getState 更可靠地随 agent_end 重建实时刷新(承接「生成图入画廊」)。 */
    readonly galleryState?: GalleryState | null;
  },
): React.JSX.Element {
  const {
    surface,
    galleryState,
    historyImages,
    upload,
    baseUrl,
    sessionId,
    conversation,
    onSubmitPrompt,
    livePreviewImage,
    onActivate,
    onHide,
  } = props;

  const [tabs, setTabs] = React.useState<readonly string[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (surface?.subscribe === undefined) return undefined;
    return surface.subscribe(STATE_KEY, () => setTick((t) => t + 1));
  }, [surface]);

  const openTab = React.useCallback(
    (id: string): void => {
      setTabs((t) => (t.includes(id) ? t : [...t, id]));
      setActiveId(id);
      onActivate?.();
    },
    [onActivate],
  );

  const closeTab = React.useCallback((id: string): void => {
    setTabs((t) => {
      const idx = t.indexOf(id);
      const next = t.filter((x) => x !== id);
      setActiveId((cur) =>
        cur !== id ? cur : (next[idx - 1] ?? next[idx] ?? null),
      );
      return next;
    });
  }, []);

  const newBlank = React.useCallback((): void => {
    setTabs((t) => (t.includes(BLANK) ? t : [...t, BLANK]));
    setActiveId(BLANK);
    onActivate?.();
  }, [onActivate]);

  const onBlankDropFile = React.useCallback(
    (file: File): void => {
      if (upload === undefined) return;
      void upload(baseUrl ?? "", sessionId ?? "", file).then(async (res) => {
        const attachmentId = res.attachment.id;
        if (surface !== undefined) {
          await surface.run(DOMAIN, "register", { attachmentId });
        }
        setTabs((t) => t.map((x) => (x === BLANK ? attachmentId : x)));
        setActiveId(attachmentId);
      });
    },
    [upload, baseUrl, sessionId, surface],
  );

  // 「点对话工具卡图 → 开画布并新标签」+「点 CanvasWorkbench 版本轨缩略 → 回流我们的 activeId」
  // 常驻 document 监听。后者修版本轨/tab 失同步:CanvasWorkbench 自带版本轨点选只切它内部 currentId,
  // 不回流宿主 → 头部标题/tab 停在旧图。这里拦版本项(data-canvas-version-item)点击 openTab(id),
  // 与它自身 selectAsset 并行触发、收敛到同一 asset(排除 data-canvas-layer-add 的「加为图层」)。
  React.useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      const ver = target?.closest?.(
        "[data-canvas-version-item]",
      ) as HTMLElement | null;
      if (ver !== null && ver !== undefined) {
        const vid = ver.getAttribute("data-att-id");
        if (vid !== null && vid !== "") openTab(vid);
        return;
      }
      const img = target?.closest?.("img[data-att-id]") as HTMLElement | null;
      if (img === null || img === undefined) return;
      if (img.closest("[data-pi-tool-images]") === null) return;
      const id = img.getAttribute("data-att-id");
      if (id === null || id === "") return;
      openTab(id);
    };
    document.addEventListener("click", onDocClick);
    document.body.setAttribute("data-canvas-tool-image-clickable", "true");
    return () => {
      document.removeEventListener("click", onDocClick);
      document.body.removeAttribute("data-canvas-tool-image-clickable");
    };
  }, [openTab]);

  // 素材卡「在画布打开」自定义事件(material-drawer 派发)→ 打开对应标签。
  React.useEffect(() => {
    const onOpen = (e: Event): void => {
      const id = (e as CustomEvent<{ attachmentId?: string }>).detail
        ?.attachmentId;
      if (id !== undefined && id !== "") openTab(id);
    };
    document.addEventListener("aigc-open-canvas-asset", onOpen as EventListener);
    return () =>
      document.removeEventListener(
        "aigc-open-canvas-asset",
        onOpen as EventListener,
      );
  }, [openTab]);

  // 优先用宿主直传的 vendor state(活更新);缺省回退自建 adapter getState。
  const snap =
    galleryState ?? surface?.getState<GalleryState>(STATE_KEY) ?? undefined;
  const assets: readonly GalleryAsset[] = snap?.assets ?? historyImages ?? [];
  const activeBlank = activeId === BLANK;
  const activeAsset =
    activeId !== null && !activeBlank
      ? assets.find((a) => a.attachmentId === activeId)
      : undefined;

  const liveTabs = tabs.filter(
    (id) => id === BLANK || assets.some((a) => a.attachmentId === id),
  );

  const mode = activeBlank || activeAsset !== undefined ? "workbench" : "gallery";
  const headTitle = activeBlank
    ? "空白画布"
    : activeAsset !== undefined
      ? activeAsset.name || "未命名"
      : "画廊";
  const headSub = activeBlank
    ? "拖入图片作为编辑主体"
    : activeAsset !== undefined
      ? activeAsset.origin === "tool-output"
        ? "工具生成"
        : "上传"
      : `${assets.length} 张素材 · 会话聚合`;

  const lp = snap?.livePreview ?? undefined;
  const livePreviewUrl = livePreviewImage ?? lp?.displayUrl ?? undefined;

  return (
    <div className="aigc-cvp" data-mode={mode}>
      {/* cv-head(共享):← 返回画廊(仅工作台) / 标题+副标 / ▦切画布(仅画廊) / ✕隐藏画布 */}
      <div className="aigc-cvh">
        <button
          type="button"
          className="aigc-cvh-back"
          onClick={() => setActiveId(null)}
          title="退出编辑 · 返回画廊"
          aria-label="返回画廊"
        >
          <ChevronLeft size={17} />
        </button>
        <div className="aigc-cvh-meta">
          <div className="aigc-cvh-t">{headTitle}</div>
          <div className="aigc-cvh-s">{headSub}</div>
        </div>
        <div className="aigc-cvh-sp" />
        <button
          type="button"
          className="aigc-cvh-ic aigc-cvh-new"
          onClick={newBlank}
          title="切换到画布(无打开的画布则新建空白)"
          aria-label="新建画布"
        >
          <LayoutGrid size={16} />
        </button>
        {onHide !== undefined ? (
          <button
            type="button"
            className="aigc-cvh-ic"
            onClick={onHide}
            title="隐藏画布(抽屉仍可展开)"
            aria-label="隐藏画布"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      {liveTabs.length > 0 ? (
        <TabBar
          assets={assets}
          tabs={liveTabs}
          activeId={activeId}
          onActivate={setActiveId}
          onClose={closeTab}
          onNewBlank={newBlank}
        />
      ) : null}

      {/* 画廊:无活动标签时显示(无编辑态,按需渲染即可)。 */}
      {mode === "gallery" ? (
        <div className="aigc-cvgal">
          <AigcGallery
            assets={assets}
            onOpenAsset={openTab}
            onNewBlank={newBlank}
          />
        </div>
      ) : null}

      {/* 每个打开的标签一个常驻实例,以 display 显隐(隐者不卸载 → 各自 per-instance kernel 的缩放/平移/
          图层/undo 栈留存,切标签即保态,承接「同源多实例」路线,免 iframe)。仅 activeId 一份可见。
          BlankCanvas 与 vendor CanvasWorkbench 皆包在 .aigc-cvbody 内(其自带 header 经 globals.css 隐掉,
          复用共享 .aigc-cvh)。onClose=退回画廊。
          ponytail: vendor onPaste 挂 document 且不判焦点,多实例并存时一次「粘贴图片」会落进所有打开的画布
          (含隐藏者);低频且可逆(切过去删层/undo),暂不拦。真困扰再于宿主 capture 阶段按 activeId 门控。 */}
      {liveTabs.map((id) => {
        const blank = id === BLANK;
        const tabAsset = blank
          ? undefined
          : assets.find((a) => a.attachmentId === id);
        const active = id === activeId;
        return (
          <div
            key={id}
            className="aigc-cvbody"
            style={active ? undefined : { display: "none" }}
          >
            {blank ? (
              <BlankCanvas
                onDropFile={onBlankDropFile}
                onSubjectAsset={(attachmentId) => {
                  setTabs((t) => t.map((x) => (x === BLANK ? attachmentId : x)));
                  setActiveId(attachmentId);
                }}
              />
            ) : tabAsset !== undefined ? (
              <CanvasWorkbench
                asset={tabAsset}
                assets={assets}
                {...(surface !== undefined ? { surface } : {})}
                {...(conversation !== undefined ? { conversation } : {})}
                {...(upload !== undefined ? { upload } : {})}
                {...(baseUrl !== undefined ? { baseUrl } : {})}
                {...(sessionId !== undefined ? { sessionId } : {})}
                {...(active && livePreviewUrl !== undefined
                  ? { livePreviewImage: livePreviewUrl }
                  : {})}
                onClose={() => setActiveId(null)}
              />
            ) : null}
          </div>
        );
      })}

      {/* 工具轨拖拽/靠边停靠:单实例跟随 active(activeKey 变则重挂到当前可见那条轨)。 */}
      {activeAsset !== undefined && activeId !== null ? (
        <ToolRailDock activeKey={activeId} />
      ) : null}
    </div>
  );
}

/**
 * AigcCanvasPanel — panelRight 槽包装:开合门控(useCanvasOpen)+ 关闭时 null 收起。
 * 本仓库宿主已把 canvas 提到右区列(host-level),**不挂此包装**;保留导出供其他 pi-web 宿主用 panelRight 槽装载。
 */
export function AigcCanvasPanel(
  props: CanvasPanelProps,
): React.JSX.Element | null {
  const { open, setOpen } = useCanvasOpen();
  const on = (props.enabled ?? true) && open;
  if (!on) return null;
  return (
    <CanvasWorkspace
      {...props}
      onActivate={() => setOpen(true)}
      onHide={() => setOpen(false)}
    />
  );
}
