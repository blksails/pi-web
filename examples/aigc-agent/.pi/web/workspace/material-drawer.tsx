// [迁移壳层] 源:aigc-agent components/material-drawer.tsx。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  GripHorizontal,
  Maximize2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  X,
  Check,
  RefreshCw,
  Upload,
  FolderPlus,
  Folder,
  MoreHorizontal,
  MoreVertical, // also used in TreeRow hover menu button
  BadgeCheck,
  Loader2,
  LocateFixed,
} from "lucide-react";
import { DistributeDialog } from "./distribute-dialog.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useSurface,
  uploadAttachment,
  type UsePiSessionResult,
} from "@blksails/pi-web-react";
import {
  useMaterialDrawerStore,
  type DrawerTab,
} from "./lib/material-drawer-store.js";
import {
  getUploadedMaterial,
  rememberUploadedMaterial,
  attachmentIdFromUrl,
} from "./lib/material-drop-cache.js";
import { ImageLightbox } from "./image-lightbox.js";
import { FolderPickerDialog } from "./folder-picker-dialog.js";
import type {
  GalleryAsset,
  GalleryState,
} from "@blksails/pi-web-tool-kit/aigc-canvas-schema";

/**
 * MaterialDrawer — 独立素材抽屉(③ app 壳 · 承接原型 §2.3 + pi-labs 真实结构)。
 *
 * 三 tab:素材库(当前会话·按日期分栏,读 surface assets)/ 素材目录(全局·pi-labs material_folders
 * parent_id 树 + folder_id 计数 rollup + 图/视/音过滤 + 上传/新建,读 /api/materials/tree)/ 并列
 * (库独立 + 「当前目录 + 目录树」成组 dir-group)。选中目录 → 「当前目录」列显示其素材(/api/materials?folder=)。
 * 可拖高度(grip 上占满/下隐藏);缩略可拖(session=att-id,全局=uri-list)。零 Supabase 耦合于此(经 API)。
 */
const FILTERS = ["全部", "图片", "视频", "音频"] as const;
const FILTER_TYPE: Record<string, string> = {
  图片: "IMAGE",
  视频: "VIDEO",
  音频: "AUDIO",
  全部: "全部",
};

interface TreeNode {
  readonly key: string;
  readonly name: string;
  readonly count: number;
  readonly leaf: boolean;
  readonly folderId: number;
  readonly children: TreeNode[];
}
interface MaterialItem {
  readonly id: string;
  readonly name: string;
  readonly fileUrl: string;
  readonly mimeType: string;
}

interface UploadRecord {
  readonly account: string;
  readonly accountId: string;
  readonly uploadedAt: string;
  readonly status: "done" | "uploading";
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 弹层入视口:菜单经 portal 挂 <body>,原先只夹 x、不管 y —— 靠近底部的行/卡的菜单会溢出视口下沿
 * 看不全。测真实尺寸后把 x 夹进视口;下方放不下则贴底上翻(始终完整可见)。ResizeObserver 跟随
 * 二级子菜单(移动到目录/重命名)展开重测。
 */
function useFitPos(
  x: number,
  y: number,
): { ref: React.RefObject<HTMLDivElement | null>; style: React.CSSProperties } {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number }>({
    left: x,
    top: y,
  });
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


/**
 * 素材卡(承接 pi-labs MediaThumb / AssetsRail 卡):**保持比例**(object-contain,不裁切)+ **动作菜单**
 * (右键 / ⋯ → 预览·复制链接·下载·在画布打开·重命名·移动到目录·素材分发·删除)。可拖拽 + 可多选。
 */
function AssetCell({
  url,
  name,
  drag,
  attachmentId,
  label,
  onDelete,
  onRename,
  onMove,
  onPreview,
  onDistribute,
  onLocate,
  uploadRecords,
  selected,
  anySelected,
  onToggleSelect,
  onRequestMove,
}: {
  readonly url: string;
  readonly name: string;
  /** 拖拽载荷:会话素材=att-id,目录素材=uri-list。 */
  readonly drag: { readonly type: "text/att-id" | "text/uri-list"; readonly value: string };
  /** 有 attachmentId 则菜单可「在画布打开」(经自定义事件通知 CanvasWorkspace)。 */
  readonly attachmentId?: string;
  /** 底部名条(目录素材显示;会话素材不显示)。 */
  readonly label?: string;
  /** 提供则菜单「删除」可用。 */
  readonly onDelete?: () => void;
  /** 提供则「重命名」可用(改单一真相源 public.materials.name)。 */
  readonly onRename?: (newName: string) => void;
  /** 提供则「移动到目录」可用(挂 material.folder_id / asset;null=取消分类)。 */
  readonly onMove?: (folderId: number | null) => void;
  /** 点缩略图 / 菜单「预览」→ 由所属区域开 gallery lightbox(带上下切换)。 */
  readonly onPreview?: () => void;
  /** 提供则「素材分发」可用(接 DistributeDialog)。 */
  readonly onDistribute?: () => void;
  /** 回到产出它的会话并定位到对应图片。 */
  readonly onLocate?: () => void;
  /** 分发已完成/在途状态；来自 material_sync_states + 分发台账。 */
  readonly uploadRecords?: readonly UploadRecord[];
  /** 多选态(CurPane 批量操作);提供 onToggleSelect 才渲染 checkbox。 */
  readonly selected?: boolean;
  readonly anySelected?: boolean;
  readonly onToggleSelect?: () => void;
  /** 打开「移动到目录」弹窗。替代内联 folders 列表。 */
  readonly onRequestMove?: () => void;
}): React.JSX.Element {
  // 菜单位置(视口坐标);null=关闭。经 portal 渲染到 body 逃出抽屉的 overflow:hidden。
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [loaded, setLoaded] = React.useState(false); // 扫光占位 → 图片就绪淡入(承接 pi-labs lazy-img)
  const [renaming, setRenaming] = React.useState(false); // 「重命名」内联输入
  const [renameVal, setRenameVal] = React.useState(name);
  const menuFit = useFitPos(menu?.x ?? 0, menu?.y ?? 0);
  const commitRename = (): void => {
    const n = renameVal.trim();
    if (n !== "" && onRename !== undefined) onRename(n);
    setRenaming(false);
    setMenu(null);
  };
  const openAt = (x: number, y: number): void => setMenu({ x, y }); // 入视口交给 useFitPos
  const copyLink = (): void => {
    void navigator.clipboard?.writeText(url).catch(() => {});
    setMenu(null);
  };
  const download = (): void => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "image";
    a.target = "_blank";
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setMenu(null);
  };
  const openInCanvas = (): void => {
    if (attachmentId !== undefined) {
      document.dispatchEvent(
        new CustomEvent("aigc-open-canvas-asset", { detail: { attachmentId } }),
      );
    }
    setMenu(null);
  };
  return (
    <div
      className={`aigc-asset${selected ? " sel" : ""}`}
      title={name}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(drag.type, drag.value);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openAt(e.clientX, e.clientY);
      }}
    >
      {!loaded ? <span className="aigc-asset-shimmer" aria-hidden /> : null}
      <img
        className={`aigc-asset-img${loaded ? " loaded" : ""}`}
        src={url}
        alt=""
        draggable={false}
        loading="lazy"
        decoding="async"
        title="点击查看完整图"
        onClick={() => onPreview?.()}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
      {onToggleSelect !== undefined ? (
        <button
          type="button"
          className={`aigc-asset-ck${selected ? " on" : ""}${anySelected ? " any" : ""}`}
          aria-label={selected ? "取消选择" : "选择"}
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
        >
          {selected ? <Check size={11} strokeWidth={3} /> : null}
        </button>
      ) : null}
      {uploadRecords !== undefined && uploadRecords.length > 0 ? (
        <span
          className={`aigc-upload-badge${uploadRecords.some((r) => r.status === "uploading") ? " busy" : ""}`}
          title={uploadRecords.map((r) => `${r.account} · ${r.status === "uploading" ? "上传中" : "已上传"}`).join("\n")}
        >
          {uploadRecords.some((r) => r.status === "uploading") ? <Loader2 size={11} /> : <BadgeCheck size={11} />}
          {uploadRecords.length > 1 ? <b>{uploadRecords.length}</b> : null}
        </span>
      ) : null}
      <button
        type="button"
        className="aigc-asset-menu"
        aria-label="素材菜单"
        onClick={(e) => {
          e.stopPropagation();
          if (menu !== null) {
            setMenu(null);
          } else {
            const r = e.currentTarget.getBoundingClientRect();
            openAt(r.right, r.bottom + 2);
          }
        }}
      >
        <MoreVertical size={13} />
      </button>
      {onLocate !== undefined ? (
        <button
          type="button"
          className="aigc-asset-locate"
          aria-label="定位会话"
          title="定位到产出它的会话"
          onClick={(e) => {
            e.stopPropagation();
            onLocate();
          }}
        >
          <LocateFixed size={13} />
        </button>
      ) : null}
      {label !== undefined ? <span className="b">{label}</span> : null}
      {menu !== null
        ? createPortal(
            <>
              <div
                className="aigc-asset-backdrop"
                onClick={() => setMenu(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu(null);
                }}
              />
              <div
                ref={menuFit.ref}
                className="aigc-asset-pop"
                style={menuFit.style}
                onClick={(e) => e.stopPropagation()}
              >
                {onPreview !== undefined ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      onPreview();
                    }}
                  >
                    预览
                  </button>
                ) : null}
                {attachmentId !== undefined ? (
                  <button type="button" onClick={openInCanvas}>
                    在画布打开
                  </button>
                ) : null}
                {onLocate !== undefined ? (
                  <button type="button" style={{ whiteSpace: "nowrap" }} onClick={() => { setMenu(null); onLocate(); }}>
                    <LocateFixed size={13} /> 定位会话
                  </button>
                ) : null}
                <button type="button" onClick={copyLink}>
                  复制链接
                </button>
                <button type="button" onClick={download}>
                  下载
                </button>
                {onRename !== undefined ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRenameVal(name);
                      setRenaming((v) => !v);
                    }}
                  >
                    重命名…
                  </button>
                ) : null}
                {renaming && onRename !== undefined ? (
                  <div className="aigc-move-sub">
                    <input
                      className="aigc-pop-input"
                      autoFocus
                      value={renameVal}
                      placeholder="素材名(≤200 字)"
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenaming(false);
                      }}
                    />
                    <button type="button" onClick={commitRename}>
                      确定
                    </button>
                  </div>
                ) : null}
                <div className="aigc-asset-pop-sep" />
                {onMove !== undefined ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      onRequestMove?.();
                    }}
                  >
                    移动到目录…
                  </button>
                ) : (
                  <button type="button" disabled title="仅已同步的生成素材可移动">
                    移动到目录…
                  </button>
                )}
                {onDistribute !== undefined ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      onDistribute();
                    }}
                  >
                    素材分发…
                  </button>
                ) : (
                  <button type="button" disabled title="仅可解析出素材的图片可分发">
                    素材分发…
                  </button>
                )}
                {onDelete !== undefined ? (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      onDelete();
                      setMenu(null);
                    }}
                  >
                    删除
                  </button>
                ) : (
                  <button type="button" disabled title="该素材不可删">
                    删除
                  </button>
                )}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

/** 素材库(当前会话·按日期分栏,每日期一列)。 */
function LibPane({
  assets,
  onClose,
  onDeleteAsset,
  onRenameAsset,
  onMoveAsset,
  onAddToLibrary,
  onPreview,
  onDistribute,
  onLocate,
  uploadsByMaterial,
  folders,
  style,
}: {
  readonly assets: readonly GalleryAsset[];
  readonly onClose?: () => void;
  /** 删除持久生成素材(仅带 genParams.assetId 的持久素材可删)。 */
  readonly onDeleteAsset?: (assetId: string) => void;
  /** 改名持久生成素材(改单一真相源 materials.name)。 */
  readonly onRenameAsset?: (assetId: string, name: string) => void;
  /** 移动持久生成素材到目录(null = 取消分类/根目录)。 */
  readonly onMoveAsset?: (assetId: string, folderId: number | null) => void;
  /** 拖目录素材(text/uri-list)进来 → 写 aigc_assets 加入本会话库(仅有会话时提供)。 */
  readonly onAddToLibrary?: (url: string) => void;
  /** 开区域内预览 lightbox(带上下切换):传本库有序图列表 + 起始 index。 */
  readonly onPreview: (
    items: ReadonlyArray<{ url: string; name: string }>,
    index: number,
  ) => void;
  /** 分发一批持久生成素材(按 assetId)。 */
  readonly onDistribute?: (assetIds: string[]) => void;
  /** name 可选,传给定位事件供 UI 显示素材名。 */
  readonly onLocate?: (sessionId: string, displayUrl: string, name?: string) => void;
  readonly uploadsByMaterial?: Readonly<Record<string, readonly UploadRecord[]>>;
  /** 目录选择器用的扁平目录列表。 */
  readonly folders?: ReadonlyArray<{ id: number; name: string; depth: number }>;
  /** 并列视图分栏占比(flex-basis,由 vsp 拖拽驱动)。 */
  readonly style?: React.CSSProperties;
}): React.JSX.Element {
  const libScope = useMaterialDrawerStore((s) => s.libScope);
  const setLibScope = useMaterialDrawerStore((s) => s.setLibScope);
  const [dragOver, setDragOver] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [libMoveTarget, setLibMoveTarget] = React.useState<string | null>(null);
  // 兜底退出等待态:拖拽在别处松手/Esc 取消时 dragleave 不一定触发 → 靠 window 的 dragend/drop 清除。
  React.useEffect(() => {
    if (!dragOver) return undefined;
    const clear = (): void => setDragOver(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [dragOver]);
  const groups = new Map<string, GalleryAsset[]>();
  for (const a of assets) {
    const k = dayOf(a.createdAt);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(a);
  }
  // 区域有序列表(按当前渲染顺序展平),供 lightbox 上下切换 + 定位起始 index。
  const flat = [...groups.values()].flat();
  const previewItems = flat.map((a) => ({
    url: a.displayUrl,
    name: a.name ?? a.attachmentId,
  }));
  const idxByAtt = new Map(flat.map((a, i) => [a.attachmentId, i]));
  const selectedAssets = flat.filter((a) => picked.has(a.attachmentId));
  const selectedAssetIds = selectedAssets
    .map((a) => (a.genParams as { assetId?: unknown } | undefined)?.assetId)
    .filter((id): id is string => typeof id === "string");
  const isSelectable = (a: GalleryAsset): boolean => {
    const p = typeof a.genParams === "object" && a.genParams !== null
      ? (a.genParams as { assetId?: unknown })?.assetId
      : undefined;
    return typeof p === "string";
  };
  const flatSelectable = flat.filter(isSelectable);
  const allPicked = flatSelectable.length > 0 && flatSelectable.every((a) => picked.has(a.attachmentId));
  const togglePicked = (attachmentId: string): void => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(attachmentId)) next.delete(attachmentId);
    else next.add(attachmentId);
    return next;
  });
  return (
    <div
      className={`aigc-am-pane pane-lib${dragOver ? " drop-over" : ""}`}
      {...(style !== undefined ? { style } : {})}
      {...(onAddToLibrary !== undefined
        ? {
            // 拖目录素材(uri-list)进来 → 加入本会话库;att-id(会话内素材)拖进来不处理。
            onDragOver: (e: React.DragEvent) => {
              if (e.dataTransfer.types.includes("text/uri-list")) {
                e.preventDefault();
                if (!dragOver) setDragOver(true);
              }
            },
            onDragLeave: (e: React.DragEvent) => {
              if (e.currentTarget === e.target) setDragOver(false);
            },
            onDrop: (e: React.DragEvent) => {
              setDragOver(false);
              const uri = (e.dataTransfer.getData("text/uri-list") || "")
                .split("\n")[0]
                ?.trim();
              if (uri !== undefined && /^https?:\/\//.test(uri)) {
                e.preventDefault();
                onAddToLibrary(uri);
              }
            },
          }
        : {})}
    >
      <div className="aigc-pane-h">
        素材库
        <span className="aigc-lib-scope">
          <button
            type="button"
            className={libScope === "session" ? "on" : ""}
            onClick={() => setLibScope("session")}
          >
            本会话
          </button>
          <button
            type="button"
            className={libScope === "all" ? "on" : ""}
            onClick={() => setLibScope("all")}
          >
            全部
          </button>
        </span>
        <span className="sp" />
        {onClose !== undefined ? (
          <button type="button" className="x" onClick={onClose} title="关闭素材库">
            <X size={12} />
          </button>
        ) : null}
      </div>
      {assets.length > 0 ? (
        <div className="aigc-cur-actions aigc-lib-actions">
          <span className="strong">{picked.size > 0 ? `已选 ${picked.size}` : `${assets.length} 个素材`}</span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => setPicked(allPicked ? new Set() : new Set(flatSelectable.map((a) => a.attachmentId)))}>
            {allPicked ? "清空" : "全选"}
          </button>
          <button type="button" disabled={selectedAssetIds.length === 0} onClick={() => onDistribute?.(selectedAssetIds)}>
            素材分发
          </button>
        </div>
      ) : null}
      <div className="aigc-pane-scroll">
        {assets.length === 0 ? (
          <div className="aigc-mat-empty">本会话暂无素材</div>
        ) : (
          <div className="aigc-lib">
            {[...groups.entries()].map(([day, items]) => (
              <div key={day} className="aigc-date-col">
                <div className="dh">
                  {day} <span className="c">{items.length}</span>
                </div>
                <div className="rule" />
                <div className="col-grid">
                  {items.map((a) => {
                    const params = typeof a.genParams === "object" && a.genParams !== null
                      ? (a.genParams as { assetId?: string; sessionId?: string; materialId?: number })
                      : undefined;
                    const assetId = params?.assetId;
                    return (
                      <AssetCell
                        key={a.attachmentId}
                        url={a.displayUrl}
                        name={a.name ?? a.attachmentId}
                        attachmentId={a.attachmentId}
                        drag={{ type: "text/att-id", value: a.attachmentId }}
                        {...(isSelectable(a)
                          ? {
                              selected: picked.has(a.attachmentId),
                              anySelected: picked.size > 0,
                              onToggleSelect: () => togglePicked(a.attachmentId),
                            }
                          : {})}
                        {...(params?.sessionId !== undefined && onLocate !== undefined
                          ? { onLocate: () => onLocate(params.sessionId!, a.displayUrl, a.name) }
                          : {})}
                        {...(params?.materialId !== undefined && uploadsByMaterial !== undefined
                          ? { uploadRecords: uploadsByMaterial[String(params.materialId)] }
                          : {})}
                        {...(assetId !== undefined && onDeleteAsset !== undefined
                          ? { onDelete: () => onDeleteAsset(assetId) }
                          : {})}
                        {...(assetId !== undefined && onRenameAsset !== undefined
                          ? {
                              onRename: (n: string) => onRenameAsset(assetId, n),
                            }
                          : {})}
                        {...(assetId !== undefined &&
                        onMoveAsset !== undefined &&
                        folders !== undefined
                          ? {
                              onMove: (folderId: number | null) =>
                                onMoveAsset(assetId, folderId),
                              onRequestMove: () =>
                                setLibMoveTarget(assetId),
                            }
                          : {})}
                        onPreview={() =>
                          onPreview(
                            previewItems,
                            idxByAtt.get(a.attachmentId) ?? 0,
                          )
                        }
                        {...(assetId !== undefined && onDistribute !== undefined
                          ? { onDistribute: () => onDistribute([assetId]) }
                          : {})}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {libMoveTarget !== null && folders !== undefined ? (
        <FolderPickerDialog
          open
          title="移动到目录"
          folders={folders}
          allowRoot
          onPick={(folderId) => {
            onMoveAsset?.(libMoveTarget!, folderId);
            setLibMoveTarget(null);
          }}
          onClose={() => setLibMoveTarget(null)}
        />
      ) : null}
    </div>
  );
}

/** 目录树节点(递归):caret + 文件夹 icon + name + count(叶子亦为文件夹);右键 → 目录菜单。 */
function TreeRow({
  node,
  depth,
  selectedId,
  expanded,
  onToggle,
  onSelect,
  onMenu,
}: {
  readonly node: TreeNode;
  readonly depth: number;
  readonly selectedId: number | null;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly onSelect: (n: TreeNode) => void;
  readonly onMenu: (n: TreeNode, x: number, y: number) => void;
}): React.JSX.Element {
  const open = expanded.has(node.key);
  const hasKids = node.children.length > 0;
  return (
    <div className={`aigc-tnode${node.leaf ? " leaf" : ""}`}>
      <div
        className={`aigc-trow${selectedId === node.folderId ? " sel" : ""}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => {
          if (hasKids) onToggle(node.key);
          onSelect(node);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(node, e.clientX, e.clientY);
        }}
      >
        <span className="tcar">
          {hasKids ? (
            open ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )
          ) : null}
        </span>
        <span className="tico">
          <Folder size={14} />
        </span>
        <span className="tname">{node.name}</span>
        <span className="tcount">{node.count}</span>
        <button
          type="button"
          className="tmore"
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            onMenu(node, r.left, r.bottom + 4);
          }}
          aria-label="目录菜单"
        >
          <MoreVertical size={12} />
        </button>
      </div>
      {hasKids && open ? (
        <div className="aigc-tchildren">
          {node.children.map((ch) => (
            <TreeRow
              key={ch.key}
              node={ch}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              onMenu={onMenu}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 目录右键菜单(portal,参考 pi-labs MaterialFolderTree 菜单项)。
 * 可用:新建子目录 / 重命名 / 复制(结构副本) / 移动到 / 删除(软删,经 /api/materials/folders)。
 * 发送到对话(需 remote)/ 上传素材(需 storage)暂无后端 → 诚实置灰标注。合成根「全部」只允许新建子目录。
 * 输入(新建/重命名)、移动目标选择、删除确认都在同一 portal 内切换面板,不用 window.prompt。
 */
function TreeMenuPop({
  node,
  pos,
  folders,
  initialMode,
  onClose,
}: {
  readonly node: TreeNode;
  readonly pos: { readonly x: number; readonly y: number };
  /** 「移动到」目标选择器用的扁平目录列表(排除自身/后代由后端环保护兜底)。 */
  readonly folders: ReadonlyArray<{ id: number; name: string; depth: number }>;
  readonly initialMode?: "create" | "rename" | "del";
  readonly onClose: () => void;
}): React.JSX.Element {
  const qc = useQueryClient();
  const [mode, setMode] = React.useState<
    "menu" | "create" | "rename" | "del" | "move"
  >(initialMode ?? "menu");
  const [name, setName] = React.useState(initialMode === "rename" ? node.name : "");
  const [busy, setBusy] = React.useState(false);
  const isRoot = node.folderId === -1;
  const fit = useFitPos(pos.x, pos.y);

  const call = async (body: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fetch("/api/materials/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await qc.invalidateQueries({ queryKey: ["materials-tree"] });
      await qc.invalidateQueries({ queryKey: ["materials"] });
    } finally {
      setBusy(false);
      onClose();
    }
  };
  const submitName = (): void => {
    const n = name.trim();
    if (n === "" || busy) return;
    void call(
      mode === "create"
        ? { action: "create", parentId: isRoot ? null : node.folderId, name: n }
        : { action: "rename", id: node.folderId, name: n },
    );
  };

  return createPortal(
    <>
      <div
        className="aigc-asset-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={fit.ref}
        className="aigc-asset-pop aigc-tree-pop"
        style={fit.style}
        onClick={(e) => e.stopPropagation()}
      >
        {mode === "menu" ? (
          <>
            <div className="aigc-pop-title">{node.name}</div>
            <button type="button" onClick={() => setMode("create")}>
              新建子目录…
            </button>
            {!isRoot ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setName(node.name);
                    setMode("rename");
                  }}
                >
                  重命名…
                </button>
                <div className="aigc-asset-pop-sep" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void call({
                      action: "copy-structure",
                      sourceId: node.folderId,
                      targetParentId: null,
                      rootName: `${node.name} 副本`,
                    })
                  }
                >
                  复制(结构副本)
                </button>
                <button type="button" onClick={() => setMode("move")}>
                  移动到…
                </button>
                <button type="button" disabled title="需接入对话 remote(P1)">
                  发送到对话
                </button>
                <button type="button" disabled title="需接入存储上传(后续)">
                  上传素材…
                </button>
                <div className="aigc-asset-pop-sep" />
                <button type="button" onClick={() => setMode("del")}>
                  删除…
                </button>
              </>
            ) : null}
          </>
        ) : mode === "del" ? (
          <>
            <div className="aigc-pop-title">确认删除「{node.name}」?</div>
            <div className="aigc-pop-hint">仅软删(可由后台恢复)。</div>
            <div className="aigc-pop-row">
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => void call({ action: "delete", id: node.folderId })}
              >
                删除
              </button>
              <button type="button" onClick={onClose}>
                取消
              </button>
            </div>
          </>
        ) : mode === "move" ? (
          <>
            <div className="aigc-pop-title">移动「{node.name}」到</div>
            <div className="aigc-move-sub">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void call({
                    action: "move",
                    id: node.folderId,
                    parentId: null,
                  })
                }
              >
                根目录(一级)
              </button>
              {folders
                .filter((f) => f.id !== node.folderId)
                .map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    disabled={busy}
                    style={{ paddingLeft: 8 + f.depth * 10 }}
                    onClick={() =>
                      void call({
                        action: "move",
                        id: node.folderId,
                        parentId: f.id,
                      })
                    }
                  >
                    {f.name}
                  </button>
                ))}
            </div>
          </>
        ) : (
          <>
            <div className="aigc-pop-title">
              {mode === "create" ? `新建子目录 · ${node.name}` : "重命名"}
            </div>
            <input
              className="aigc-pop-input"
              autoFocus
              value={name}
              placeholder="目录名(≤50 字)"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitName();
                if (e.key === "Escape") onClose();
              }}
            />
            <div className="aigc-pop-row">
              <button type="button" disabled={busy} onClick={submitName}>
                确定
              </button>
              <button type="button" onClick={onClose}>
                取消
              </button>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

/** 素材目录(全局树 · toolbar + 图/视/音过滤 + 树)。 */
function DirPane({
  tree,
  loading,
  filter,
  onFilter,
  selectedId,
  expanded,
  folders,
  onToggle,
  onSelect,
  onClose,
}: {
  readonly tree: TreeNode | null;
  readonly loading: boolean;
  readonly filter: string;
  readonly onFilter: (f: string) => void;
  readonly selectedId: number | null;
  readonly expanded: ReadonlySet<string>;
  /** 「移动到」目标选择器用的扁平目录列表(透传给 TreeMenuPop)。 */
  readonly folders: ReadonlyArray<{ id: number; name: string; depth: number }>;
  readonly onToggle: (key: string) => void;
  readonly onSelect: (n: TreeNode) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const qc = useQueryClient();
  // 右键菜单态:{node, x, y, mode?};null=关闭。工具栏「新建」= 根上直接开 create 面板。
  const [menu, setMenu] = React.useState<{
    node: TreeNode;
    x: number;
    y: number;
    mode?: "create";
  } | null>(null);
  return (
    <div className="aigc-am-pane pane-dir">
      <div className="aigc-pane-h">
        目录树 <span className="n">· 全部</span>
        <span className="sp" />
        <button type="button" className="x" onClick={onClose} title="关闭素材目录">
          <X size={12} />
        </button>
      </div>
      <div className="aigc-dir-toolbar">
        <button
          type="button"
          title="刷新"
          onClick={() =>
            void qc.invalidateQueries({ queryKey: ["materials-tree"] })
          }
        >
          <RefreshCw size={13} />
        </button>
        <button type="button" title="上传本地素材(待平台层 P0-B)" disabled>
          <Upload size={13} /> 上传
        </button>
        <button
          type="button"
          title="新建一级目录"
          onClick={(e) => {
            if (tree === null) return;
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ node: tree, x: r.left, y: r.bottom + 4, mode: "create" });
          }}
        >
          <FolderPlus size={13} /> 新建
        </button>
      </div>
      <div className="aigc-dir-filter">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={filter === f ? "on" : ""}
            onClick={() => onFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="aigc-pane-tree">
        {loading ? (
          <div className="aigc-mat-empty">加载目录树…</div>
        ) : tree === null || tree.children.length === 0 ? (
          <div className="aigc-mat-empty">暂无目录</div>
        ) : (
          <div className="aigc-tree">
            {tree.children.map((n) => (
              <TreeRow
                key={n.key}
                node={n}
                depth={0}
                selectedId={selectedId}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
                onMenu={(n, x, y) => setMenu({ node: n, x, y })}
              />
            ))}
          </div>
        )}
      </div>
      {menu !== null ? (
        <TreeMenuPop
          node={menu.node}
          pos={{ x: menu.x, y: menu.y }}
          folders={folders}
          {...(menu.mode !== undefined ? { initialMode: menu.mode } : {})}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

/** 当前目录(选中目录内容·侧列)。多选 + 批量条(全选/移动到目录/分发/更多)全接真后端。 */
function CurPane({
  folder,
  filter,
  folders,
  onPreview,
  onDistribute,
  onClose,
  style,
}: {
  readonly folder: { id: number; name: string; count: number };
  readonly filter: string;
  /** 「移动到目录」选择器用的扁平目录列表。 */
  readonly folders: ReadonlyArray<{ id: number; name: string; depth: number }>;
  /** 开区域内预览 lightbox(带上下切换)。 */
  readonly onPreview: (
    items: ReadonlyArray<{ url: string; name: string }>,
    index: number,
  ) => void;
  /** 分发一批目录素材(按 materialId)。 */
  readonly onDistribute: (materialIds: number[]) => void;
  readonly onClose: () => void;
  /** 分栏占比(flex-basis,由 vsp 拖拽驱动)。 */
  readonly style?: React.CSSProperties;
}): React.JSX.Element {
  const qc = useQueryClient();
  const t = FILTER_TYPE[filter] ?? "IMAGE";
  const { data: items = [] } = useQuery({
    queryKey: ["materials", folder.id, t],
    queryFn: async (): Promise<readonly MaterialItem[]> => {
      const res = await fetch(
        `/api/materials?folder=${folder.id}&type=${encodeURIComponent(t)}`,
      );
      const json = (await res.json()) as { materials?: MaterialItem[] };
      return json.materials ?? [];
    },
  });

  // 多选态(material id 字符串);切目录/切筛选自动清空。批量条弹层(移动/更多)。
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [barMenu, setBarMenu] = React.useState<{
    kind: "move" | "more";
    x: number;
    y: number;
  } | null>(null);
  const [curMoveTarget, setCurMoveTarget] = React.useState<number | null>(null);
  const [curMoveBatch, setCurMoveBatch] = React.useState<number[] | null>(null);
  React.useEffect(() => {
    setPicked(new Set());
    setBarMenu(null);
    setCurMoveTarget(null);
    setCurMoveBatch(null);
  }, [folder.id, t]);
  const barFit = useFitPos(barMenu?.x ?? 0, barMenu?.y ?? 0);

  const previewItems = items.map((m) => ({ url: m.fileUrl, name: m.name }));
  const pickedItems = items.filter((m) => picked.has(m.id));
  const allPicked = items.length > 0 && picked.size === items.length;
  const pickedIds = [...picked].map((s) => Number(s));

  const toggle = (id: string): void =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ["materials"] });
    void qc.invalidateQueries({ queryKey: ["materials-tree"] });
  };
  // 批量操作(移动/删除)成功后:刷新查询 + 清空多选 + 收起批量条弹层。
  const resetBatch = (): void => {
    invalidate();
    setPicked(new Set());
    setBarMenu(null);
  };

  const moveTo = (ids: number[], folderId: number | null): void => {
    void fetch("/api/materials", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, folderId }),
    })
      .then(resetBatch)
      .catch(() => {});
  };
  const remove = (ids: number[]): void => {
    void fetch(`/api/materials?ids=${ids.join(",")}`, { method: "DELETE" })
      .then(resetBatch)
      .catch(() => {});
  };
  const rename = (id: number, n: string): void => {
    void fetch("/api/materials", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name: n }),
    })
      .then(() => invalidate())
      .catch(() => {});
  };
  const copyUrls = (): void => {
    const urls = pickedItems.map((m) => m.fileUrl).join("\n");
    if (urls !== "") void navigator.clipboard?.writeText(urls).catch(() => {});
    setBarMenu(null);
  };
  const downloadPicked = (): void => {
    for (const m of pickedItems) {
      const a = document.createElement("a");
      a.href = m.fileUrl;
      a.download = m.name || "image";
      a.target = "_blank";
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setBarMenu(null);
  };

  const openBar = (kind: "move" | "more", e: React.MouseEvent): void => {
    if (barMenu?.kind === kind) {
      setBarMenu(null);
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setBarMenu({ kind, x: Math.min(r.left, window.innerWidth - 180), y: r.bottom + 4 });
  };

  return (
    <div
      className="aigc-am-pane pane-cur"
      {...(style !== undefined ? { style } : {})}
    >
      <div className="aigc-pane-h">
        当前目录 · {folder.name}
        <span className="sp" />
        <button type="button" className="x" onClick={onClose} title="关闭当前目录">
          <X size={12} />
        </button>
      </div>
      <div className="aigc-cur-actions">
        <span className="strong">
          {picked.size > 0 ? `已选 ${picked.size}` : `${folder.count} 个素材`}
        </span>
        <span style={{ flex: 1 }} />
        {items.length > 0 ? (
          <a
            className="on"
            role="button"
            onClick={() =>
              setPicked(
                allPicked ? new Set() : new Set(items.map((m) => m.id)),
              )
            }
          >
            {allPicked ? "清空" : "全选"}
          </a>
        ) : null}
        <a
          className={picked.size > 0 ? "on" : "off"}
          role="button"
          onClick={(e) => picked.size > 0 && openBar("move", e)}
        >
          移动到目录
        </a>
        <a
          className={picked.size > 0 ? "on" : "off"}
          role="button"
          onClick={() =>
            picked.size > 0 && onDistribute(pickedIds)
          }
        >
          素材分发
        </a>
        <a
          className={picked.size > 0 ? "on" : "off"}
          role="button"
          title="更多"
          onClick={(e) => picked.size > 0 && openBar("more", e)}
        >
          <MoreHorizontal size={13} />
        </a>
      </div>
      <div className="aigc-pane-scroll">
        {items.length === 0 ? (
          <div className="aigc-mat-empty">该目录暂无素材</div>
        ) : (
          <div className="aigc-cur-grid">
            {items.map((m, i) => (
              <AssetCell
                key={m.id}
                url={m.fileUrl}
                name={m.name}
                label={m.name}
                drag={{ type: "text/uri-list", value: m.fileUrl }}
                selected={picked.has(m.id)}
                anySelected={picked.size > 0}
                onToggleSelect={() => toggle(m.id)}
                onPreview={() => onPreview(previewItems, i)}
                onRename={(n) => rename(Number(m.id), n)}
                onMove={(folderId) => moveTo([Number(m.id)], folderId)}
                onRequestMove={() => setCurMoveTarget(Number(m.id))}
                onDistribute={() => onDistribute([Number(m.id)])}
                onDelete={() => remove([Number(m.id)])}
              />
            ))}
          </div>
        )}
      </div>
      {barMenu !== null
        ? createPortal(
            <>
              <div
                className="aigc-asset-backdrop"
                onClick={() => setBarMenu(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setBarMenu(null);
                }}
              />
              <div
                ref={barFit.ref}
                className="aigc-asset-pop"
                style={barFit.style}
                onClick={(e) => e.stopPropagation()}
              >
                {barMenu.kind === "move" ? (
                  <button type="button" onClick={() => setCurMoveBatch(pickedIds)}>
                    移动到目录…
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={copyUrls}>
                      复制链接
                    </button>
                    <button type="button" onClick={downloadPicked}>
                      下载
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        remove(pickedIds)
                      }
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            </>,
            document.body,
          )
        : null}
      {curMoveTarget !== null ? (
        <FolderPickerDialog
          open
          title="移动到目录"
          folders={folders}
          excludeId={folder.id}
          allowRoot
          onPick={(folderId) => {
            moveTo([curMoveTarget], folderId);
            setCurMoveTarget(null);
          }}
          onClose={() => setCurMoveTarget(null)}
        />
      ) : null}
      {curMoveBatch !== null ? (
        <FolderPickerDialog
          open
          title="批量移动到目录"
          folders={folders}
          excludeId={folder.id}
          allowRoot
          batchCount={curMoveBatch.length}
          onPick={(folderId) => {
            moveTo(curMoveBatch, folderId);
            setCurMoveBatch(null);
          }}
          onClose={() => setCurMoveBatch(null)}
        />
      ) : null}
    </div>
  );
}

export function MaterialDrawer({
  connection,
  sessionId,
  drawer,
  onGripDown,
  onToggleFull,
  onToggleHide,
  galleryState,
}: {
  readonly connection: UsePiSessionResult["connection"];
  readonly sessionId: string | undefined;
  /**
   * 抽屉三态(承接原型 `data-drawer`)。**省略 = 工作区模块形态**:占满所在窗,不渲染
   * 抓手与「占满/还原」(Tab 化后这两者已无语义),`onToggleHide` 退化为「关闭本模块」。
   */
  readonly drawer?: "docked" | "full" | "hidden";
  /** 抓手 pointerdown → 交给宿主右栏的拖拽 snap 逻辑(rz 分隔条同一处理);模块形态不传。 */
  readonly onGripDown?: (e: React.PointerEvent) => void;
  readonly onToggleFull?: () => void;
  readonly onToggleHide: () => void;
  /**
   * 可选:父级直传的画廊 surface 快照。panelRight slot 场景无 `connection`,由 slot 的
   * `surface` prop 派生后经此透入;缺省(宿主右栏路径)回退 `useSurface(connection)`。
   */
  readonly galleryState?: GalleryState | null;
}): React.JSX.Element {
  const { state } = useSurface<GalleryState>("canvas", { connection, sessionId });
  // 会话画廊(surface,进程内 live)。slot 直传 galleryState 时优先用它(无 connection 场景);
  // 宿主右栏未传则回退 useSurface(connection) —— 行为字节级不变。
  const surfaceAssets: readonly GalleryAsset[] = (galleryState ?? state)?.assets ?? [];

  // UI 态由 Zustand 持有(跨抽屉开关/会话保持,不每次重置);数据由 React Query 缓存。
  const tab = useMaterialDrawerStore((s) => s.tab);
  const filter = useMaterialDrawerStore((s) => s.filter);
  const expanded = useMaterialDrawerStore((s) => s.expanded);
  const selDir = useMaterialDrawerStore((s) => s.selDir);
  const setTab = useMaterialDrawerStore((s) => s.setTab);
  const setFilter = useMaterialDrawerStore((s) => s.setFilter);
  const toggleNode = useMaterialDrawerStore((s) => s.toggleNode);
  const setSelDir = useMaterialDrawerStore((s) => s.setSelDir);

  const dirOpen = tab === "dir" || tab === "split";
  const libOpen = tab === "lib" || tab === "split";
  const collapsed = drawer === "hidden";
  /** 工作区模块形态:无抽屉三态,故不渲染抓手与「占满/还原」。 */
  const asModule = drawer === undefined;

  // 持久生成素材回填(A · 承接 pi-labs hybrid AssetsRail):/api/assets 读 pilabs.aigc_assets
  // (B5 落库,跨刷新/子进程重启存活)。与 surface 会话画廊按 attachmentId 去重合并(surface 优先=live)。
  const libScope = useMaterialDrawerStore((s) => s.libScope);
  const { data: persisted = [] } = useQuery({
    queryKey: ["session-assets", libScope === "all" ? "all" : sessionId],
    queryFn: async (): Promise<GalleryAsset[]> => {
      // 全部=跨会话取本租户所有生成素材;本会话=按 pi_session_id。
      const q =
        libScope === "all"
          ? "/api/assets?kind=image&limit=200"
          : sessionId !== undefined
            ? `/api/assets?session=${encodeURIComponent(sessionId)}&kind=image`
            : null;
      if (q === null) return [];
      const res = await fetch(q);
      if (!res.ok) return [];
      const json = (await res.json()) as {
        items?: Array<{
          assetId: string;
          attachmentId?: string;
          displayUrl: string;
          createdAt: string;
          sessionId?: string;
          materialId?: number;
          meta?: Record<string, unknown>;
        }>;
      };
      return (json.items ?? [])
        .filter((it) => typeof it.attachmentId === "string")
        .map((it) => ({
          attachmentId: it.attachmentId as string,
          displayUrl: it.displayUrl,
          mimeType:
            typeof it.meta?.mimeType === "string" ? it.meta.mimeType : "image/*",
          name:
            typeof it.meta?.name === "string"
              ? it.meta.name
              : (it.attachmentId as string),
          createdAt: it.createdAt,
          origin: "tool-output" as const,
          // 持久素材的 assetId 藏进 genParams,供 AssetCell 启用删除(surface 会话素材无此字段)。
          genParams: {
            assetId: it.assetId,
            ...(typeof it.sessionId === "string" ? { sessionId: it.sessionId } : {}),
            ...(typeof it.materialId === "number" ? { materialId: it.materialId } : {}),
          },
        }));
    },
    enabled:
      libOpen &&
      !collapsed &&
      (libScope === "all" || sessionId !== undefined),
    staleTime: 30_000,
  });

  const assets: readonly GalleryAsset[] = React.useMemo(() => {
    // surface(live)与 persisted 按 attachmentId 合并,surface 优先(实时)。但 surface 只是画廊快照、
    // **不带 assetId**;若原样保留,已落库的生成图在库里也认不出 assetId → 删/改名/移动/分发全被禁,
    // 这正是「只有已同步素材才有全部菜单」的病根。修:surface 命中 persisted 时,把 persisted 的
    // name(单一真相源 materials.name)与 assetId 嫁接到 surface 上(保留其真实 genParams),于是每张
    // 已落库的生成图都有全套菜单(faithful pi-labs:所有菜单项对所有素材可用)。
    const persistedByAtt = new Map(persisted.map((p) => [p.attachmentId, p]));
    const seen = new Set(surfaceAssets.map((a) => a.attachmentId));
    const surface = surfaceAssets.map((a) => {
      const p = persistedByAtt.get(a.attachmentId);
      if (p === undefined) return a;
      const persistedParams = p.genParams as { assetId?: string; sessionId?: string; materialId?: number } | undefined;
      const assetId = persistedParams?.assetId;
      const name = p.name !== undefined && p.name !== "" ? p.name : a.name;
      const genParams =
        assetId !== undefined
          ? {
              ...(typeof a.genParams === "object" && a.genParams !== null ? a.genParams : {}),
              assetId,
              ...(persistedParams?.sessionId !== undefined ? { sessionId: persistedParams.sessionId } : {}),
              ...(persistedParams?.materialId !== undefined ? { materialId: persistedParams.materialId } : {}),
            }
          : a.genParams;
      return { ...a, name, genParams };
    });
    return [...surface, ...persisted.filter((p) => !seen.has(p.attachmentId))];
  }, [surfaceAssets, persisted]);

  // 素材库状态角标：已上传(remote_present)与近 30 分钟在途分发分开呈现；没有 materialId 的
  // 临时 surface 素材不请求，待落库/link-B 回填后自然出现。
  const assetMaterialIds = React.useMemo(
    () => [...new Set(assets.map((a) =>
      (a.genParams as { materialId?: unknown } | undefined)?.materialId,
    ).filter((id): id is number => typeof id === "number"))],
    [assets],
  );
  const { data: uploadsByMaterial = {} } = useQuery({
    queryKey: ["material-uploads", assetMaterialIds],
    queryFn: async (): Promise<Record<string, UploadRecord[]>> => {
      if (assetMaterialIds.length === 0) return {};
      const r = await fetch(`/api/material-uploads?materialIds=${assetMaterialIds.join(",")}`);
      if (!r.ok) return {};
      return ((await r.json()) as { byMaterialId?: Record<string, UploadRecord[]> }).byMaterialId ?? {};
    },
    enabled: libOpen && !collapsed && assetMaterialIds.length > 0,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const qcRoot = useQueryClient();
  // 素材目录自动刷新:会话画廊(surface)新增素材 = 有新图落库(link-B 已写 public.materials),
  // 故 surface 资产数增长时失效目录树/当前目录/会话库查询,免手动刷新。
  const surfaceCount = surfaceAssets.length;
  React.useEffect(() => {
    if (surfaceCount === 0) return;
    void qcRoot.invalidateQueries({ queryKey: ["materials-tree"] });
    void qcRoot.invalidateQueries({ queryKey: ["materials"] });
    void qcRoot.invalidateQueries({ queryKey: ["session-assets"] });
  }, [surfaceCount, qcRoot]);
  // 删除持久生成素材(DELETE /api/assets?id=);仅持久素材(genParams.assetId 存在)可删。
  const onDeleteAsset = React.useCallback(
    (assetId: string): void => {
      void fetch(`/api/assets?id=${encodeURIComponent(assetId)}`, {
        method: "DELETE",
      })
        .then(() => qcRoot.invalidateQueries({ queryKey: ["session-assets"] }))
        .catch(() => {});
    },
    [qcRoot],
  );
  // 改名(PATCH /api/assets?id= {name});改单一真相源 materials.name,各处读同一名。
  const onRenameAsset = React.useCallback(
    (assetId: string, name: string): void => {
      void fetch(`/api/assets?id=${encodeURIComponent(assetId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      })
        .then(() => qcRoot.invalidateQueries({ queryKey: ["session-assets"] }))
        .catch(() => {});
    },
    [qcRoot],
  );
  // 移动持久生成素材到目录(PATCH /api/assets?id=);经 link-B 的 webapp_material_id 更新 folder_id。
  const onMoveAsset = React.useCallback(
    (assetId: string, folderId: number | null): void => {
      void fetch(`/api/assets?id=${encodeURIComponent(assetId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderId }),
      })
        .then(() => qcRoot.invalidateQueries({ queryKey: ["materials"] }))
        .catch(() => {});
    },
    [qcRoot],
  );
  // 区域内预览 lightbox(素材库/当前目录共用一个根级实例):{有序图列表, 起始 index}。
  const [lightbox, setLightbox] = React.useState<{
    items: ReadonlyArray<{ url: string; name: string }>;
    index: number;
  } | null>(null);
  const openPreview = React.useCallback(
    (items: ReadonlyArray<{ url: string; name: string }>, index: number): void =>
      setLightbox({ items, index }),
    [],
  );
  // 素材分发 lightbox:素材库按 assetIds,素材目录按 materialIds(二选一)。
  const [distribute, setDistribute] = React.useState<{
    assetIds?: string[];
    materialIds?: number[];
  } | null>(null);

  // 拖目录素材进「素材库」tab:取字节 → 上传成会话附件(拿 attachmentId)→ POST 写 aigc_assets
  // 持久行并挂本会话;link-B 内容去重复用已存在的 public.materials。刷新会话库即见。
  const onAddToLibrary = React.useCallback(
    (url: string): void => {
      if (sessionId === undefined) return;
      const sid = sessionId;
      const postAsset = (attachmentId: string, displayUrl: string): Promise<unknown> =>
        fetch("/api/assets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: sid,
            attachmentId,
            displayUrl,
            kind: "image",
            // 原始素材 url:服务端据此去重(本会话已有该素材则不再入库第二条)。
            sourceUrl: url,
          }),
        }).then(() => qcRoot.invalidateQueries({ queryKey: ["session-assets"] }));

      // 已是内部附件(如把对话内图拖进来)或本会话已上传过同一 URL → 直接入库,免重复上传。
      const internal = attachmentIdFromUrl(url);
      if (internal !== undefined) {
        void postAsset(internal, url).catch(() => {});
        return;
      }
      const cached = getUploadedMaterial(sid, url);
      if (cached !== undefined) {
        void postAsset(cached.attachmentId, cached.displayUrl).catch(() => {});
        return;
      }
      // 素材目录素材(外部 CDN):同源代理取字节(CDN 跨域直 fetch 会被 CORS 拦)→ 上传 → 记缓存 → 入库。
      void fetch(`/api/materials/fetch?url=${encodeURIComponent(url)}`)
        .then((r) => r.blob())
        .then((b) =>
          uploadAttachment(
            "/api",
            sid,
            new File([b], "material", { type: b.type || "image/png" }),
          ),
        )
        .then((res) => {
          rememberUploadedMaterial(sid, url, {
            attachmentId: res.attachment.id,
            displayUrl: res.displayUrl,
          });
          return postAsset(res.attachment.id, res.displayUrl);
        })
        .catch(() => {});
    },
    [sessionId, qcRoot],
  );

  // 目录树:React Query 缓存(同 type 命中缓存,**不再每次打开重载**);仅目录态且未隐藏时启用。
  const treeType = FILTER_TYPE[filter] ?? "IMAGE";
  const { data: tree = null, isFetching: treeLoading } = useQuery({
    queryKey: ["materials-tree", treeType],
    queryFn: async (): Promise<TreeNode | null> => {
      const res = await fetch(
        `/api/materials/tree?type=${encodeURIComponent(treeType)}`,
      );
      const json = (await res.json()) as { tree?: TreeNode | null };
      return json.tree ?? null;
    },
    // 目录态展示 + 库态的「移动到目录」选择器都需要目录列表,故 lib/dir 任一开启即加载(缓存)。
    enabled: (dirOpen || libOpen) && !collapsed,
  });

  // 扁平目录列表(供素材「移动到目录」选择器);跳过合成根(folderId=-1),带层级缩进。
  const flatFolders = React.useMemo(() => {
    const out: Array<{ id: number; name: string; depth: number }> = [];
    const walk = (node: TreeNode | null, depth: number): void => {
      if (node === null) return;
      if (node.folderId > 0) out.push({ id: node.folderId, name: node.name, depth });
      for (const c of node.children) walk(c, node.folderId > 0 ? depth + 1 : depth);
    };
    walk(tree, 0);
    return out;
  }, [tree]);

  const expandedSet = React.useMemo(
    () => new Set<string>(expanded),
    [expanded],
  );

  // 并列视图分栏占比(store 持久;setter 内 clamp 15–85)+ vsp 中线拖拽。
  const libSplitPct = useMaterialDrawerStore((s) => s.libSplitPct);
  const dirSplitPct = useMaterialDrawerStore((s) => s.dirSplitPct);
  const setLibSplitPct = useMaterialDrawerStore((s) => s.setLibSplitPct);
  const setDirSplitPct = useMaterialDrawerStore((s) => s.setDirSplitPct);
  const startSplitDrag =
    (apply: (pct: number) => void) =>
    (e: React.PointerEvent): void => {
      const host = (e.currentTarget as HTMLElement).parentElement;
      if (host === null) return;
      const rect = host.getBoundingClientRect();
      e.preventDefault();
      document.body.classList.add("aigc-dragging");
      const move = (ev: PointerEvent): void => {
        apply(((ev.clientX - rect.left) / rect.width) * 100);
      };
      const up = (): void => {
        document.body.classList.remove("aigc-dragging");
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    };

  const pickTab = (t: DrawerTab): void => {
    setTab(t);
    if (collapsed) onToggleHide(); // 隐藏态点 tab → 展开
  };

  return (
    <section className="aigc-assetmgr" data-material-drawer>
      <div className="aigc-am-head">
        {!asModule ? (
          <span
            className="aigc-am-grip"
            title="拖拽调整高度(上占满 / 下隐藏)"
            onPointerDown={onGripDown}
          >
            <GripHorizontal size={14} />
          </span>
        ) : null}
        <div className="aigc-am-tabs">
          <button
            type="button"
            className={tab === "split" ? "on" : ""}
            onClick={() => pickTab("split")}
          >
            并列
          </button>
          <button
            type="button"
            className={tab === "lib" ? "on" : ""}
            onClick={() => pickTab("lib")}
          >
            素材库 <span className="n">· 当前会话</span>
          </button>
          <button
            type="button"
            className={tab === "dir" ? "on" : ""}
            onClick={() => pickTab("dir")}
          >
            素材目录 <span className="n">· 全部</span>
          </button>
        </div>
        <div className="aigc-am-tools">
          {!asModule ? (
            <button
              type="button"
              className={`aigc-am-ic${drawer === "full" ? " on" : ""}`}
              title="占满右栏 / 还原"
              onClick={onToggleFull}
            >
              <Maximize2 size={15} />
            </button>
          ) : null}
          <button
            type="button"
            className="aigc-am-ic"
            title={asModule ? "关闭素材模块" : collapsed ? "展开抽屉" : "隐藏抽屉"}
            aria-label={asModule ? "关闭素材模块" : undefined}
            onClick={onToggleHide}
          >
            {asModule ? (
              <X size={15} />
            ) : collapsed ? (
              <ChevronUp size={15} />
            ) : (
              <ChevronDown size={15} />
            )}
          </button>
        </div>
      </div>
      {!collapsed ? (
        <div className="aigc-am-body">
          {libOpen ? (
            <LibPane
              assets={assets}
              onDeleteAsset={onDeleteAsset}
              onRenameAsset={onRenameAsset}
              onMoveAsset={onMoveAsset}
              {...(sessionId !== undefined ? { onAddToLibrary } : {})}
              onPreview={openPreview}
              onDistribute={(assetIds) => setDistribute({ assetIds })}
              uploadsByMaterial={uploadsByMaterial}
              onLocate={(targetSessionId, displayUrl, name) => {
                document.dispatchEvent(
                  new CustomEvent("aigc-locate-session-asset", {
                    detail: { sessionId: targetSessionId, displayUrl, name },
                  }),
                );
              }}
              folders={flatFolders}
              {...(tab === "split"
                ? {
                    onClose: () => setTab("dir"),
                    style: { flex: `0 0 ${libSplitPct}%` },
                  }
                : {})}
            />
          ) : null}
          {tab === "split" && dirOpen ? (
            <div
              className="aigc-vsp"
              title="拖拽调整分栏"
              onPointerDown={startSplitDrag(setLibSplitPct)}
            />
          ) : null}
          {dirOpen ? (
            <div
              className="aigc-dir-group"
              {...(tab === "split"
                ? { style: { flex: `1 1 ${100 - libSplitPct}%` } }
                : {})}
            >
              <div className="aigc-dg-head">
                素材目录 <span className="dg-n">· 目录树 + 当前目录</span>
              </div>
              <div className="aigc-dg-body">
                {selDir !== null ? (
                  <>
                    <CurPane
                      folder={selDir}
                      filter={filter}
                      folders={flatFolders}
                      onPreview={openPreview}
                      onDistribute={(materialIds) =>
                        setDistribute({ materialIds })
                      }
                      onClose={() => setSelDir(null)}
                      style={{ flex: `0 0 ${dirSplitPct}%` }}
                    />
                    <div
                      className="aigc-vsp"
                      title="拖拽调整分栏"
                      onPointerDown={startSplitDrag(setDirSplitPct)}
                    />
                  </>
                ) : null}
                <DirPane
                  tree={tree}
                  loading={treeLoading}
                  filter={filter}
                  onFilter={setFilter}
                  selectedId={selDir?.id ?? null}
                  expanded={expandedSet}
                  folders={flatFolders}
                  onToggle={toggleNode}
                  onSelect={(n) =>
                    setSelDir({ id: n.folderId, name: n.name, count: n.count })
                  }
                  onClose={() => setTab("lib")}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {lightbox !== null ? (
        <ImageLightbox
          items={lightbox.items}
          index={lightbox.index}
          onIndex={(i) =>
            setLightbox((prev) => (prev !== null ? { ...prev, index: i } : prev))
          }
          onClose={() => setLightbox(null)}
        />
      ) : null}
      {distribute !== null ? (
        <DistributeDialog
          {...(distribute.materialIds !== undefined
            ? { materialIds: distribute.materialIds }
            : { assetIds: distribute.assetIds ?? [] })}
          onClose={() => setDistribute(null)}
          onSubmitted={() => {
            void qcRoot.invalidateQueries({ queryKey: ["materials"] });
            void qcRoot.invalidateQueries({ queryKey: ["session-assets"] });
          }}
        />
      ) : null}
    </section>
  );
}
