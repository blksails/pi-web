/**
 * 素材 pane 的 Guest 应用(隔离 iframe 内运行)。
 *
 * UI 与交互复刻独立仓 aigc-agent `components/material-drawer.tsx` 的素材卡(`AssetCell`):
 * 保持比例的缩略图 + 扫光占位→淡入、右键 / ⋯ 动作菜单(预览·复制链接·下载·重命名·移动到目录·
 * 素材分发·删除)、多选 checkbox、可拖拽。按本仓架构重写(不搬 vendor):菜单经 portal 挂 body 并
 * 用 `useFitPos` 夹进视口,数据面 / 控制面走 pane guest 通道而非 Next API。
 *
 * 全通道谱:
 *  - route GET:`guest.query("materials-library")` → agent 鉴权 BFF → webapp 素材目录;
 *  - route GET:`guest.query("assets-list",{scope:"session"})` → 当前会话上传及产出;
 *  - route GET:`guest.query("material-status")` → 分发状态角标(只读台账;发起/重试是写路径,不授权);
 *  - surface 订阅:`surface:materials` 回流选中集 / 目录树 / 归属 / 改名(权威在 agent,单写者 C1-2);
 *  - surface 命令(**控制面写通道**):select / set-filter / create-folder / rename-folder /
 *    move-folder / delete-folder / move-items / rename-item;
 *  - conversation 草稿:`stageUserMessage(text, { attachmentIds })`(「带入对话」不自动发送);
 *  - pane event:`pi.canvas.open-attachments`(「在编辑器打开」,宿主限权中继并激活可选编辑器);
 *  - 拖放发端:`text/att-id`(+ `text/uri-list` / `text/plain` 便于外部落点)拖入宿主输入框,
 *    零上传入列为已落库引用(受口见 packages/ui `attachment-dnd`)。
 *
 * sandbox 不给 allow-modals,故不得用 `prompt()`/`confirm()`；新建/改名走内联输入框,
 * 删除走「点两次确认」。仅本模块声明 allow-downloads；素材先取 Blob 后就地保存。
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  AtSign,
  AudioLines,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  FolderInput,
  FolderPlus,
  FolderTree,
  ImagePlus,
  Ellipsis,
  Info,
  ImageOff,
  Library,
  Loader2,
  PanelLeft,
  PanelRight,
  Pencil,
  PencilLine,
  RefreshCw,
  Replace,
  RotateCw,
  Send,
  SquareCheckBig,
  Trash2,
  VideoOff,
} from "lucide-react";
import {
  PaneGuestProvider,
  PaneLoadingSkeleton,
  usePaneGuest,
} from "@blksails/pi-web-panes-kit/react";
import { CANVAS_OPEN_ATTACHMENTS_EVENT, SESSION_LOCATE_EVENT } from "./events.js";
import { ImageLightbox, type PreviewItem } from "./image-lightbox.js";
import { installMaterialsPaneStyles } from "./styles.js";

interface AssetItem {
  readonly assetId: string;
  readonly attachmentId?: string;
  readonly displayUrl: string;
  readonly createdAt: string;
  readonly meta?: {
    readonly name?: string;
    readonly materialId?: string;
    readonly type?: string;
    readonly fileUrl?: string;
    readonly folderId?: string;
    readonly accounts?: unknown;
  } & Record<string, unknown>;
}

interface Folder {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string | null;
  readonly remote?: boolean;
}

/** 某目录及全部后代；迭代展开兼防脏数据成环。 */
function folderSubtreeIds(folders: readonly Folder[], rootId: string): ReadonlySet<string> {
  const ids = new Set([rootId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const folder of folders) {
      if (
        folder.parentId != null &&
        ids.has(folder.parentId) &&
        !ids.has(folder.id)
      ) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

interface Advertiser {
  readonly id: number;
  readonly name?: string | null;
  readonly account_id?: string | null;
  readonly platform?: string | null;
}

type UploadStatus = "done" | "uploading" | "failed" | "replaced";
type DistributeStatus = "none" | "pending" | UploadStatus;

interface UploadRecord {
  readonly account: string;
  readonly accountId: string;
  readonly advertiserId?: number;
  readonly uploader: string | null;
  readonly uploadedAt: string;
  readonly status: UploadStatus;
  readonly reason?: string;
  readonly retryable?: boolean;
  readonly warn?: boolean;
}

interface MaterialStatus {
  readonly attachmentId: string;
  readonly status: DistributeStatus;
  readonly materialId?: string;
  readonly records?: readonly UploadRecord[];
  readonly advertiserCount?: number;
  readonly failureReason?: string;
  readonly updatedAt?: string;
}

const STATUS_LABEL: Readonly<Record<DistributeStatus, string>> = {
  none: "",
  pending: "上传中",
  done: "已上传",
  failed: "上传失败",
  uploading: "上传中",
  replaced: "已换素材重传",
};

type Kind = "image" | "video" | "audio";
type Scope = "session" | "all";
type TrackView = "both" | "library" | "directory";
interface Filter {
  readonly kind?: Kind;
  readonly scope?: Scope;
}

interface MaterialsSnapshot {
  readonly selectedIds?: readonly string[];
  readonly filter?: Filter;
  readonly folders?: readonly Folder[];
  readonly itemFolder?: Readonly<Record<string, string>>;
  readonly itemName?: Readonly<Record<string, string>>;
  readonly enterpriseRevision?: number;
}

/** 类型过滤(复刻源项目 material-drawer.tsx:66 的 FILTERS);`undefined` = 全部。 */
const KIND_TABS: ReadonlyArray<{ readonly label: string; readonly kind?: Kind }> = [
  { label: "全部" },
  { label: "图片", kind: "image" },
  { label: "视频", kind: "video" },
  { label: "音频", kind: "audio" },
];
const PAGE_SIZE = 120;

function confirmedWrite(): {
  readonly confirmed: true;
  readonly idempotencyKey: string;
} {
  return {
    confirmed: true,
    idempotencyKey:
      globalThis.crypto?.randomUUID?.() ??
      `materials-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}

/** 按天分栏(复刻源项目 `dayOf`);createdAt 缺席者(刚上传、尚未落库)归「最近」。 */
function dayOf(iso: string | undefined): string {
  if (iso === undefined || iso === "") return "最近";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "最近";
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function unwrapItems(raw: unknown): AssetItem[] {
  const o = (raw ?? {}) as { items?: unknown; data?: unknown };
  const inner = Array.isArray(o.items) ? o.items : ((o.data ?? {}) as { items?: unknown }).items;
  return Array.isArray(inner) ? (inner as AssetItem[]) : [];
}

/** 目录树按 parentId 归层;顺序即创建序(与快照一致,不另排序)。 */
function childrenOf(folders: readonly Folder[], parentId: string | null | undefined): Folder[] {
  return folders.filter((f) => (f.parentId ?? undefined) === (parentId ?? undefined));
}

function mediaKind(asset: AssetItem): Kind {
  const type = String(asset.meta?.type ?? "").toLowerCase();
  const url = String(asset.meta?.fileUrl ?? asset.displayUrl).toLowerCase();
  if (type.includes("video") || /\.(mp4|webm|mov)(?:$|\?)/.test(url)) return "video";
  if (type.includes("audio") || /\.(mp3|wav|m4a|ogg)(?:$|\?)/.test(url)) return "audio";
  return "image";
}

function HoverPreview({
  kind,
  url,
  name,
  rect,
  boundary,
}: {
  readonly kind: Kind;
  readonly url: string;
  readonly name: string;
  readonly rect: DOMRect;
  readonly boundary: DOMRect;
}): React.JSX.Element {
  const mediaRef = React.useRef<HTMLMediaElement>(null);
  React.useEffect(() => {
    const media = mediaRef.current;
    if (media === null) return;
    media.muted = false;
    media.volume = 1;
    void media.play().catch(() => {});
    return () => {
      media.pause();
      media.currentTime = 0;
    };
  }, []);
  const gap = 6;
  const idealWidth = Math.min(420, Math.max(240, window.innerWidth * 0.32));
  const rightSpace = window.innerWidth - boundary.right - gap;
  const leftSpace = boundary.left - gap;
  let width = Math.min(idealWidth, window.innerWidth - 16);
  let left: number | undefined;
  let right: number | undefined;
  let top = Math.max(8, Math.min(rect.top, window.innerHeight - 340));
  if (rightSpace >= 180) {
    width = Math.min(width, rightSpace);
    left = boundary.right + gap;
  } else if (leftSpace >= 180) {
    width = Math.min(width, leftSpace);
    right = window.innerWidth - boundary.left + gap;
  } else {
    left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    if (boundary.top >= 220 + gap) top = Math.max(8, boundary.top - 330 - gap);
    else if (window.innerHeight - boundary.bottom >= 180 + gap) top = boundary.bottom + gap;
  }
  return createPortal(
    <div
      className="hover-preview"
      style={{ ...(left !== undefined ? { left } : { right }), top, maxWidth: width, ...(kind === "image" ? {} : { width }) }}
      aria-hidden
    >
      {kind === "image" ? (
        <img src={url} alt="" />
      ) : kind === "video" ? (
        <video ref={mediaRef as React.RefObject<HTMLVideoElement>} src={url} autoPlay playsInline controls />
      ) : (
        <div className="hover-audio">
          <AudioLines size={38} aria-hidden />
          <span>{name}</span>
          <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} src={url} autoPlay controls />
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * Portal tooltip: 逃出父元素, z-index 永远在顶端, 不被遮挡。
 * 替代原 CSS `[data-tip]::after` 方案(会被 overflow:hidden 裁剪)。
 */
function TooltipPortal({
  tip,
  children,
}: {
  readonly tip: string;
  readonly children: React.ReactElement;
}): React.JSX.Element {
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  const triggerRef = React.useRef<HTMLElement>(null);
  const show = React.useCallback(() => {
    const el = triggerRef.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    setPos({ left: r.left + r.width / 2, top: r.bottom + 6 });
  }, []);
  const hide = React.useCallback(() => setPos(null), []);
  return (
    <>
      {React.cloneElement(children, {
        ref: triggerRef,
        onMouseEnter: show,
        onMouseLeave: hide,
        onFocus: show,
        onBlur: hide,
      } as React.HTMLAttributes<HTMLElement>)}
      {pos !== null
        ? createPortal(
            <div
              style={{
                position: "fixed",
                left: pos.left,
                top: pos.top,
                zIndex: 100,
                translate: "-50% 0",
                padding: "4px 7px",
                borderRadius: 6,
                background: "#0f172a",
                color: "#fff",
                fontSize: 11,
                lineHeight: 1.4,
                whiteSpace: "nowrap",
                boxShadow: "0 4px 12px rgb(0 0 0/.18)",
                pointerEvents: "none",
              }}
            >
              {tip}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * 弹层入视口(复刻源项目 `useFitPos`):菜单经 portal 挂 body,右下角开的菜单会溢出视口,
 * 故测真实尺寸后把 x 夹进视口、下方放不下则贴底上翻。
 */
function useFitPos(
  x: number,
  y: number,
): { ref: React.RefObject<HTMLDivElement | null>; style: React.CSSProperties } {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number }>({
    left: Math.max(8, x),
    top: Math.max(8, y),
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

function FittedMenuPortal({
  x,
  y,
  label,
  className,
  onClose,
  children,
}: {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly className: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}): React.ReactPortal {
  const fit = useFitPos(x, y);
  return createPortal(
    <>
      <div className="asset-backdrop" onMouseDown={onClose} />
      <div
        ref={fit.ref}
        className={className}
        role="menu"
        aria-label={label}
        style={fit.style}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

function FolderMenu({
  folder,
  x,
  y,
  onClose,
  onCreateChild,
  onUpload,
  onRename,
  onDelete,
}: {
  readonly folder: Folder;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
  readonly onCreateChild: () => void;
  readonly onUpload: () => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}): React.ReactPortal {
  const fit = useFitPos(x, y);
  const run = (action: () => void): void => {
    onClose();
    action();
  };
  return createPortal(
    <>
      <div className="asset-backdrop" onMouseDown={onClose} />
      <div
        ref={fit.ref}
        className="asset-pop folder-pop"
        style={fit.style}
        role="menu"
        aria-label={`${folder.name}目录操作`}
      >
        <button type="button" role="menuitem" onClick={() => run(onCreateChild)}>
          <FolderPlus size={14} aria-hidden />
          新建子目录
        </button>
        <button type="button" role="menuitem" onClick={() => run(onUpload)}>
          <ImagePlus size={14} aria-hidden />
          上传素材
        </button>
        <button type="button" role="menuitem" onClick={() => run(onRename)}>
          <Pencil size={14} aria-hidden />
          重命名
        </button>
        <div className="pop-sep" />
        <button
          type="button"
          role="menuitem"
          className="danger"
          onClick={() => run(onDelete)}
        >
          <Trash2 size={14} aria-hidden />
          删除空目录
        </button>
      </div>
    </>,
    document.body,
  );
}

function FolderEditDialog({
  draft,
  onChange,
  onCancel,
  onSubmit,
}: {
  readonly draft: { readonly kind: "create" | "rename"; readonly value: string };
  readonly onChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
}): React.ReactPortal {
  return createPortal(
    <div className="dlg-backdrop" onMouseDown={onCancel}>
      <div
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-label={draft.kind === "create" ? "新建目录" : "重命名目录"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dlg-head">{draft.kind === "create" ? "新建目录" : "重命名目录"}</div>
        <div className="dlg-form">
          <label htmlFor="folder-name">目录名称</label>
          <input
            id="folder-name"
            autoFocus
            maxLength={64}
            value={draft.value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draft.value.trim() !== "") onSubmit();
              if (event.key === "Escape") onCancel();
            }}
          />
        </div>
        <div className="dlg-foot">
          <button type="button" className="button" onClick={onCancel}>取消</button>
          <button
            type="button"
            className="button primary"
            disabled={draft.value.trim() === ""}
            onClick={onSubmit}
          >
            确定
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function FolderDeleteDialog({
  folder,
  onCancel,
  onConfirm,
}: {
  readonly folder: Folder;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.ReactPortal {
  return createPortal(
    <div className="dlg-backdrop" onMouseDown={onCancel}>
      <div
        className="dlg"
        role="alertdialog"
        aria-modal="true"
        aria-label="删除目录"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dlg-head">删除目录</div>
        <div className="dlg-form">
          确定删除目录「{folder.name}」吗？
          {folder.remote === true ? "仅空目录可删除。" : "其子目录将一并删除，素材本体保留。"}
        </div>
        <div className="dlg-foot">
          <button type="button" className="button" onClick={onCancel}>取消</button>
          <button type="button" className="button danger" onClick={onConfirm}>删除</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function formatStatusTime(iso: string): string {
  if (iso === "") return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || "—";
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(date.getFullYear()).slice(-2)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function uploadStatusMeta(status: UploadStatus): {
  readonly label: string;
  readonly textClass: string;
  readonly pillClass: string;
} {
  switch (status) {
    case "failed":
      return { label: "上传失败", textClass: "failed", pillClass: "failed" };
    case "uploading":
      return { label: "上传中", textClass: "uploading", pillClass: "uploading" };
    case "replaced":
      return { label: "已换素材重传", textClass: "replaced", pillClass: "replaced" };
    default:
      return { label: "已上传", textClass: "done", pillClass: "done" };
  }
}

function UploadStatusIcon({
  status,
  className,
}: {
  readonly status: UploadStatus;
  readonly className?: string;
}): React.JSX.Element {
  if (status === "failed") return <AlertCircle className={className} aria-hidden />;
  if (status === "uploading") return <Loader2 className={className} aria-hidden />;
  if (status === "replaced") return <Replace className={className} aria-hidden />;
  return <BadgeCheck className={className} aria-hidden />;
}

function recordsForStatus(status: MaterialStatus): readonly UploadRecord[] {
  if (status.records !== undefined && status.records.length > 0) return status.records;
  const normalized = status.status === "pending" ? "uploading" : status.status;
  if (normalized === undefined || normalized === "none") return [];
  return [{
    account: status.advertiserCount !== undefined
      ? `${status.advertiserCount} 个广告主`
      : "分发任务",
    accountId: "",
    uploader: null,
    uploadedAt: status.updatedAt ?? "",
    status: normalized,
    ...(status.failureReason !== undefined ? { reason: status.failureReason } : {}),
  }];
}

function parseUploadRecords(value: unknown): UploadRecord[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null
      ? Object.values(value)
      : [];
  return values.flatMap((value): UploadRecord[] => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const rawStatus = row.status;
    if (rawStatus !== "done" && rawStatus !== "uploading" && rawStatus !== "failed" && rawStatus !== "replaced") {
      return [];
    }
    const rawAdvertiserId = row.advertiserId ?? row.advertiser_id;
    const advertiserId = typeof rawAdvertiserId === "number" && Number.isInteger(rawAdvertiserId)
      ? rawAdvertiserId
      : typeof rawAdvertiserId === "string" && /^\d+$/.test(rawAdvertiserId)
        ? Number(rawAdvertiserId)
        : undefined;
    const accountId = String(row.accountId ?? row.account_id ?? advertiserId ?? "");
    const accountValue = row.account ?? row.name ?? row.accountName;
    const account = accountValue === undefined ? accountId || "广告账户" : String(accountValue);
    const uploadedAt = String(row.uploadedAt ?? row.uploaded_at ?? row.createdAt ?? "");
    return [{
      account,
      accountId,
      ...(advertiserId !== undefined ? { advertiserId } : {}),
      uploader: typeof row.uploader === "string" ? row.uploader : null,
      uploadedAt,
      status: rawStatus,
      ...(typeof row.reason === "string" ? { reason: row.reason } : {}),
      ...(typeof row.retryable === "boolean" ? { retryable: row.retryable } : {}),
      ...(typeof row.warn === "boolean" ? { warn: row.warn } : {}),
    }];
  });
}

function statusFromRecords(records: readonly UploadRecord[]): DistributeStatus {
  if (records.some((record) => record.status === "failed")) return "failed";
  if (records.some((record) => record.status === "uploading")) return "uploading";
  if (records.some((record) => record.status === "replaced")) return "replaced";
  if (records.some((record) => record.status === "done")) return "done";
  return "none";
}

function DistributionBadge({
  status,
  materialId,
  onRetry,
  onReplaceOne,
  onReplaceBatch,
  onNotice,
}: {
  readonly status: MaterialStatus;
  readonly materialId?: string;
  readonly onRetry?: (materialId: string, advertiserId: number) => Promise<void>;
  readonly onReplaceOne?: (materialId: string, targetAccounts: { id: number; name: string }[]) => void;
  readonly onReplaceBatch?: (materialId: string) => void;
  readonly onNotice: (text: string) => void;
}): React.JSX.Element | null {
  const records = recordsForStatus(status);
  const badgeRef = React.useRef<HTMLDivElement>(null);
  const hideTimer = React.useRef<number | undefined>(undefined);
  const [retrying, setRetrying] = React.useState<ReadonlySet<number>>(new Set());
  const segments = (["failed", "uploading", "replaced", "done"] as const)
    .map((kind) => ({
      kind,
      count: records.filter((record) => record.status === kind).length,
    }))
    .filter((segment) => segment.count > 0);
  const primary = segments[0]?.kind ?? "done";
  const primaryMeta = uploadStatusMeta(primary);
  const mixed = segments.length > 1;
  const [position, setPosition] = React.useState<{ left: number; bottom: number } | null>(null);
  const cancelHide = (): void => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = undefined;
  };
  const scheduleHide = (): void => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      setPosition(null);
    }, 150);
  };
  const show = (): void => {
    cancelHide();
    const rect = badgeRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 240 - 8)),
      bottom: window.innerHeight - rect.top + 6,
    });
  };
  const retry = async (record: UploadRecord): Promise<void> => {
    if (onRetry === undefined || materialId === undefined || record.advertiserId === undefined) return;
    setRetrying((current) => new Set(current).add(record.advertiserId!));
    try {
      await onRetry(materialId, record.advertiserId);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "重试分发失败");
    } finally {
      setRetrying((current) => {
        const next = new Set(current);
        next.delete(record.advertiserId!);
        return next;
      });
    }
  };
  const warnRecords = records.filter(
    (record) => record.status === "failed" && record.warn === true && record.advertiserId !== undefined,
  );
  const showReplace = materialId !== undefined && warnRecords.length > 0 &&
    (onReplaceOne !== undefined || onReplaceBatch !== undefined);
  if (records.length === 0) return null;
  const ariaLabel = segments
    .map((segment) => `${uploadStatusMeta(segment.kind).label}${segment.count}`)
    .join(" ");
  return (
    <div
      ref={badgeRef}
      className="distribution-badge-wrap"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      <div
        className={`distribution-badge ${primaryMeta.pillClass}${mixed ? " mixed" : ""}`}
        aria-label={ariaLabel}
      >
        {segments.map((segment) => (
          <span className={`distribution-badge-segment ${segment.kind}`} key={segment.kind}>
            <UploadStatusIcon
              status={segment.kind}
              className={segment.kind === "uploading" ? "spin" : undefined}
            />
            {(mixed || records.length > 1) ? <small>{segment.count}</small> : null}
          </span>
        ))}
      </div>
      {position !== null ? createPortal(
        <div
          className="distribution-tooltip"
          role="tooltip"
          style={{ left: position.left, bottom: position.bottom }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <ul>
            {records.map((record, index) => {
              const isRetrying = record.advertiserId !== undefined && retrying.has(record.advertiserId);
              const meta = uploadStatusMeta(record.status);
              return (
                <li key={`${record.accountId}-${record.advertiserId ?? index}`}>
                  <div className="distribution-row-head">
                    <UploadStatusIcon
                      status={record.status}
                      className={`distribution-row-icon ${record.status} ${record.status === "uploading" ? "spin" : ""}`}
                    />
                    <span className="distribution-account">{record.account}</span>
                    <span className={`distribution-status-text ${meta.textClass}`}>
                      {meta.label}
                    </span>
                  </div>
                  {record.status === "failed" ? (
                    <div className="distribution-row-detail failed">
                      <span title={record.reason}>{record.reason ?? "分发失败"}</span>
                      <time>{formatStatusTime(record.uploadedAt)}</time>
                      {onRetry !== undefined && materialId !== undefined &&
                      record.retryable === true && record.warn !== true && record.advertiserId !== undefined ? (
                        <button
                          type="button"
                          disabled={isRetrying}
                          onClick={(event) => {
                            event.stopPropagation();
                            void retry(record);
                          }}
                        >
                          {isRetrying ? <Loader2 className="spin" aria-hidden /> : <RotateCw aria-hidden />}
                          {isRetrying ? "重试中" : "重试"}
                        </button>
                      ) : record.retryable !== true ? (
                        <em>不可重试</em>
                      ) : null}
                    </div>
                  ) : (
                    <div className="distribution-row-detail">
                      <span>
                        {record.accountId !== "" && record.accountId !== record.account
                          ? `${record.accountId} · `
                          : ""}
                        {formatStatusTime(record.uploadedAt)}
                        {record.uploader !== null && record.uploader !== undefined
                          ? ` · ${record.uploader}`
                          : ""}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {showReplace ? (
            <div className="distribution-replace-actions">
              {onReplaceOne !== undefined ? (
                <button
                  type="button"
                  onClick={() => {
                    onReplaceOne(
                      materialId!,
                      warnRecords.map((record) => ({
                        id: record.advertiserId!,
                        name: record.account,
                      })),
                    );
                    setPosition(null);
                  }}
                >
                  换素材上传
                </button>
              ) : null}
              {onReplaceBatch !== undefined ? (
                <button
                  type="button"
                  onClick={() => {
                    onReplaceBatch(materialId!);
                    setPosition(null);
                  }}
                >
                  批次换素材
                </button>
              ) : null}
            </div>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

/**
 * 素材卡:保持比例(object-contain,不裁切)+ 动作菜单(右键 / ⋯)。可拖拽 + 可多选。
 * 能力缺席的菜单项照源项目呈 disabled + title 说明,不隐藏(用户知道有这功能、为何不可用)。
 */
function AssetCell({
  url,
  sourceUrl,
  kind,
  name,
  attachmentId,
  materialId,
  draggable,
  selected,
  anySelected,
  status,
  onToggleSelect,
  onPreview,
  onRename,
  onRequestMove,
  onDelete,
  onDistribute,
  onRetry,
  onReplaceOne,
  onReplaceBatch,
  onLocate,
  onEditInCanvas,
  onBringToConversation,
  onDragStart,
  onPointerDrop,
  onNotice,
}: {
  readonly url: string;
  readonly sourceUrl?: string;
  readonly kind: Kind;
  readonly name: string;
  /** 稳定素材键；未落库项可传 assetId。 */
  readonly attachmentId?: string;
  readonly materialId?: string;
  readonly draggable?: boolean;
  readonly selected: boolean;
  readonly anySelected: boolean;
  /** 分发状态角标;缺省(平台未接 / 未分发)则不渲染。 */
  readonly status?: MaterialStatus;
  readonly onToggleSelect?: () => void;
  /** 点缩略图 / 菜单「预览」→ 由所属区域开 lightbox(带上下切换)。 */
  readonly onPreview?: () => void;
  readonly onRename: (next: string) => void;
  readonly onRequestMove?: () => void;
  readonly onDelete?: () => void;
  readonly onDistribute?: () => void;
  readonly onRetry?: (materialId: string, advertiserId: number) => Promise<void>;
  readonly onReplaceOne?: (materialId: string, targetAccounts: { id: number; name: string }[]) => void;
  readonly onReplaceBatch?: (materialId: string) => void;
  readonly onLocate?: () => void;
  /** 经宿主事件中介送画布；目标缺席时降级经对话。 */
  readonly onEditInCanvas?: () => void;
  readonly onBringToConversation?: () => void;
  readonly onDragStart: (e: React.DragEvent) => void;
  /** WebView2 原生拖放拦截 HTML5 时，以 Pointer 手势完成同文档轨间拖拽。 */
  readonly onPointerDrop?: () => void;
  /** 复制 / 下载失败等一次性提示。 */
  readonly onNotice: (text: string) => void;
}): React.JSX.Element {
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  // 扫光占位 → 图片就绪淡入。
  const [loaded, setLoaded] = React.useState(kind === "audio");
  const [failed, setFailed] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [renameVal, setRenameVal] = React.useState(name);
  const [hoverAnchor, setHoverAnchor] = React.useState<{
    readonly rect: DOMRect;
    readonly boundary: DOMRect;
  } | null>(null);
  const hoverTimer = React.useRef<number | undefined>(undefined);
  const pointerDrag = React.useRef(false);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const fit = useFitPos(menu?.x ?? 0, menu?.y ?? 0);
  const actionUrl = sourceUrl ?? url;
  const htmlDraggable = draggable === true && onPointerDrop === undefined;
  const unavailableLabel = actionUrl.startsWith("/api/attachments/")
    ? "本地附件未同步"
    : "素材暂不可用";

  React.useEffect(() => {
    setLoaded(kind === "audio");
    setFailed(false);
  }, [actionUrl, kind]);

  const commitRename = (): void => {
    const n = renameVal.trim();
    if (n !== "") onRename?.(n);
    setRenaming(false);
    setMenu(null);
  };

  const copyLink = async (): Promise<void> => {
    setMenu(null);
    try {
      if (navigator.clipboard?.writeText !== undefined) {
        await navigator.clipboard.writeText(actionUrl);
      } else {
        const input = document.createElement("textarea");
        input.value = actionUrl;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("copy rejected");
      }
      onNotice("链接已复制");
    } catch {
      onNotice("复制失败，请手动复制链接");
    }
  };

  const download = async (): Promise<void> => {
    setMenu(null);
    try {
      const response = await fetch(actionUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blobUrl = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = name !== "" ? name : "素材";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
      onNotice("已开始下载");
    } catch {
      onNotice("下载失败，请稍后重试");
    }
  };

  return (
    <div className="asset-card">
      <div
        ref={cardRef}
        className={selected ? "asset sel" : "asset"}
        title={name}
        draggable={htmlDraggable}
        data-pointer-draggable={onPointerDrop === undefined ? undefined : "true"}
        onDragStart={onDragStart}
        onPointerDown={(event) => {
        if (onPointerDrop === undefined || event.button !== 0) return;
        const { clientX: startX, clientY: startY, pointerId } = event;
        const startRect = cardRef.current?.getBoundingClientRect();
        const grabOffsetX = startRect === undefined ? 0 : startX - startRect.left;
        const grabOffsetY = startRect === undefined ? 0 : startY - startRect.top;
        pointerDrag.current = false;
        let ghost: HTMLDivElement | undefined;
        let activeDropTarget: HTMLElement | null = null;

        const updateDropTarget = (clientX: number, clientY: number): HTMLElement | null => {
          const next = document
            .elementFromPoint(clientX, clientY)
            ?.closest<HTMLElement>("[data-materials-library]") ?? null;
          if (next === activeDropTarget) return next;
          activeDropTarget?.classList.remove("dropping");
          next?.classList.add("dropping");
          activeDropTarget = next;
          return next;
        };
        const cleanup = (): void => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", cancel);
          activeDropTarget?.classList.remove("dropping");
          document.body.classList.remove("pointer-material-dragging");
          ghost?.remove();
        };
        const move = (next: PointerEvent): void => {
          if (next.pointerId !== pointerId) return;
          if (!pointerDrag.current
            && Math.hypot(next.clientX - startX, next.clientY - startY) >= 6) {
            pointerDrag.current = true;
            setHoverAnchor(null);
            const card = cardRef.current;
            if (card !== null) {
              const rect = startRect ?? card.getBoundingClientRect();
              ghost = card.cloneNode(true) as HTMLDivElement;
              ghost.className = "asset pointer-drag-ghost";
              ghost.setAttribute("aria-hidden", "true");
              ghost.removeAttribute("title");
              ghost.style.width = `${rect.width}px`;
              ghost.style.height = `${rect.height}px`;
              document.body.appendChild(ghost);
              document.body.classList.add("pointer-material-dragging");
            }
          }
          if (!pointerDrag.current) return;
          next.preventDefault();
          if (ghost !== undefined) {
            ghost.style.left = `${next.clientX - grabOffsetX}px`;
            ghost.style.top = `${next.clientY - grabOffsetY}px`;
          }
          updateDropTarget(next.clientX, next.clientY);
        };
        const up = (next: PointerEvent): void => {
          if (next.pointerId !== pointerId) return;
          const dropped = pointerDrag.current
            && updateDropTarget(next.clientX, next.clientY) !== null;
          cleanup();
          if (dropped) onPointerDrop();
        };
        const cancel = (next: PointerEvent): void => {
          if (next.pointerId !== pointerId) return;
          cleanup();
          pointerDrag.current = false;
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", cancel);
      }}
        onClickCapture={(event) => {
          if (!pointerDrag.current) return;
          pointerDrag.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onMouseEnter={() => {
          window.clearTimeout(hoverTimer.current);
          hoverTimer.current = window.setTimeout(() => {
            const rect = cardRef.current?.getBoundingClientRect();
            if (rect !== undefined) {
              setHoverAnchor({
                rect,
                boundary:
                  cardRef.current?.closest<HTMLElement>(".asset-list")?.getBoundingClientRect() ??
                  rect,
              });
            }
          }, 280);
        }}
        onMouseLeave={() => {
          window.clearTimeout(hoverTimer.current);
          setHoverAnchor(null);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          window.clearTimeout(hoverTimer.current);
          setHoverAnchor(null);
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {!loaded ? <span className="asset-shimmer" aria-hidden /> : null}
        {failed ? (
        <button
          type="button"
          className="asset-unavailable"
          draggable={htmlDraggable}
          aria-label={unavailableLabel}
          title={unavailableLabel}
          onClick={() => onToggleSelect?.()}
        >
          {kind === "video" ? <VideoOff size={28} aria-hidden /> : <ImageOff size={28} aria-hidden />}
          <span>{unavailableLabel}</span>
        </button>
        ) : kind === "video" ? (
        <video
          className={loaded ? "asset-img loaded" : "asset-img"}
          src={actionUrl}
          draggable={htmlDraggable}
          muted
          playsInline
          preload="metadata"
          onLoadedData={() => setLoaded(true)}
          onError={() => {
            setLoaded(true);
            setFailed(true);
          }}
          onClick={() => onToggleSelect?.()}
        />
        ) : kind === "audio" ? (
        <button
          type="button"
          className="audio-card"
          draggable={htmlDraggable}
          onClick={() => onToggleSelect?.()}
        >
          <AudioLines size={32} aria-hidden />
        </button>
        ) : (
        <img
          className={loaded ? "asset-img loaded" : "asset-img"}
          src={url}
          alt=""
          draggable={htmlDraggable}
          loading="lazy"
          decoding="async"
          title={onPreview !== undefined ? "点击查看完整图" : undefined}
          onClick={() => (onPreview !== undefined ? onPreview() : onToggleSelect?.())}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(true);
            setFailed(true);
          }}
        />
        )}
        {onToggleSelect !== undefined ? (
        <button
          type="button"
          className={`asset-ck${selected ? " on" : ""}${anySelected ? " any" : ""}`}
          aria-label={selected ? "取消选择" : "选择"}
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
        >
          {selected ? <Check size={12} aria-hidden /> : null}
        </button>
        ) : null}
        <button
        type="button"
        className="asset-menu"
        aria-label="素材菜单"
        onClick={(e) => {
          e.stopPropagation();
          if (menu !== null) {
            setMenu(null);
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.right, y: r.bottom + 2 });
        }}
        >
          <Ellipsis size={15} aria-hidden />
        </button>
        {status !== undefined ? (
          <DistributionBadge
            status={status}
            materialId={materialId}
            onRetry={onRetry}
            onReplaceOne={onReplaceOne}
            onReplaceBatch={onReplaceBatch}
            onNotice={onNotice}
          />
        ) : null}
        {!failed && hoverAnchor !== null && menu === null ? (
        <HoverPreview
          kind={kind}
          url={actionUrl}
          name={name}
          rect={hoverAnchor.rect}
          boundary={hoverAnchor.boundary}
        />
        ) : null}
        {menu !== null
          ? createPortal(
            <>
              <div
                className="asset-backdrop"
                onClick={() => setMenu(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu(null);
                }}
              />
              <div
                ref={fit.ref}
                className="asset-pop"
                style={fit.style}
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
                <button type="button" onClick={() => void copyLink()}>
                  复制链接
                </button>
                <button type="button" onClick={() => void download()}>
                  下载
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRenameVal(name);
                    setRenaming((v) => !v);
                  }}
                >
                  重命名…
                </button>
                {renaming ? (
                  <div className="pop-sub">
                    <input
                      className="pop-input"
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
                <div className="pop-sep" />
                {onEditInCanvas !== undefined ? (
                  <button
                    type="button"
                    title="经宿主中介送入画布；画布未载入时降级经对话"
                    onClick={() => {
                      setMenu(null);
                      onEditInCanvas();
                    }}
                  >
                    在画布编辑
                  </button>
                ) : (
                  <button type="button" disabled title="尚未落库的素材不可送入画布">
                    在画布编辑
                  </button>
                )}
                {onBringToConversation !== undefined ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      onBringToConversation();
                    }}
                  >
                    带入对话
                  </button>
                ) : null}
                {onRequestMove !== undefined ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      onRequestMove();
                    }}
                  >
                    移动到目录…
                  </button>
                ) : (
                  <button type="button" disabled title="尚未落库的素材不可归类">
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
                    {status === undefined || status.status === "none"
                      ? "素材分发…"
                      : `再次分发（${STATUS_LABEL[status.status]}）`}
                  </button>
                ) : null}
                {onLocate !== undefined ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      onLocate();
                    }}
                  >
                    定位生成会话
                  </button>
                ) : null}
                {onDelete !== undefined ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!deleteConfirm) {
                        setDeleteConfirm(true);
                        return;
                      }
                      setMenu(null);
                      setDeleteConfirm(false);
                      onDelete();
                    }}
                  >
                    {deleteConfirm ? "再次点击确认删除" : "删除"}
                  </button>
                ) : null}
              </div>
            </>,
            document.body,
            )
          : null}
      </div>
      <span className="asset-name">{name}</span>
    </div>
  );
}

/** 「移动到目录」弹窗:列全部目录 + 移出目录。替代早先塞在工具条里的下拉。 */
function MovePop({
  folders,
  count,
  onPick,
  onClose,
}: {
  readonly folders: readonly Folder[];
  readonly count: number;
  readonly onPick: (folderId: string | null) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const renderFolders = (parentId: string | undefined, depth: number): React.JSX.Element[] =>
    childrenOf(folders, parentId).flatMap((folder) => {
      const children = childrenOf(folders, folder.id);
      const closed = collapsed.has(folder.id);
      return [
        <div key={folder.id} className="move-tree-row" style={{ paddingLeft: 8 + depth * 14 }}>
          {children.length > 0 ? (
            <button
              type="button"
              className="move-tree-twist"
              aria-label={`${closed ? "展开" : "折叠"}${folder.name}`}
              aria-expanded={!closed}
              onClick={() => setCollapsed((current) => {
                const next = new Set(current);
                if (closed) next.delete(folder.id); else next.add(folder.id);
                return next;
              })}
            >
              {closed ? <ChevronRight size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
            </button>
          ) : <span className="move-tree-twist" aria-hidden />}
          <button type="button" className="dlg-row" onClick={() => onPick(folder.id)}>
            {folder.name}
          </button>
        </div>,
        ...(closed ? [] : renderFolders(folder.id, depth + 1)),
      ];
    });
  return createPortal(
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg" role="dialog" aria-label="移动到目录" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">移动 {count} 项到…</div>
        <div className="dlg-body scroll">
          <button type="button" className="dlg-row" onClick={() => onPick(null)}>
            移出目录(未分类)
          </button>
          {folders.length === 0 ? (
            <div className="muted" style={{ padding: "8px 10px" }}>
              还没有目录,先在左侧新建一个
            </div>
          ) : (
            renderFolders(undefined, 0)
          )}
        </div>
        <div className="dlg-foot">
          <button type="button" className="button" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function BatchRenamePop({
  items,
  onApply,
  onClose,
}: {
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
    readonly previewUrl: string;
    readonly previewKind: Kind;
  }[];
  readonly onApply: (items: readonly { readonly id: string; readonly name: string }[]) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  type RenameRule =
    | "seq-from-1"
    | "seq-from-0"
    | "seq-pad"
    | "paren"
    | "dash"
    | "underscore"
    | "alpha"
    | "date-seq"
    | "none";
  const rules: ReadonlyArray<{ readonly value: RenameRule; readonly label: string }> = [
    { value: "seq-from-1", label: "名称 1、名称 2…" },
    { value: "seq-from-0", label: "名称 0、名称 1…" },
    { value: "seq-pad", label: "名称 001、名称 002…" },
    { value: "paren", label: "名称 (1)、名称 (2)…" },
    { value: "dash", label: "名称-1、名称-2…" },
    { value: "underscore", label: "名称_1、名称_2…" },
    { value: "alpha", label: "名称 A、名称 B…" },
    { value: "date-seq", label: "名称 日期-1、日期-2…" },
    { value: "none", label: "仅使用基础名称" },
  ];
  const extensionOf = (name: string): string => {
    const match = /\.[^.]+$/.exec(name);
    return match?.[0] ?? "";
  };
  const [base, setBase] = React.useState("素材");
  const [rule, setRule] = React.useState<RenameRule>("seq-from-1");
  const generated = React.useMemo(() => {
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    return items.map((item, index) => {
      const sequence = index + 1;
      const suffix = rule === "seq-from-1"
        ? ` ${sequence}`
        : rule === "seq-from-0"
          ? ` ${index}`
          : rule === "seq-pad"
            ? ` ${String(sequence).padStart(3, "0")}`
            : rule === "paren"
              ? ` (${sequence})`
              : rule === "dash"
                ? `-${sequence}`
                : rule === "underscore"
                  ? `_${sequence}`
                  : rule === "alpha"
                    ? ` ${String.fromCharCode(65 + (index % 26))}`
                    : rule === "date-seq"
                      ? ` ${date}-${sequence}`
                      : "";
      return {
        ...item,
        id: item.id,
        name: `${base.trim()}${suffix}${extensionOf(item.name)}`,
      };
    });
  }, [base, items, rule]);
  const [overrides, setOverrides] =
    React.useState<Readonly<Record<string, string>>>(() =>
      Object.fromEntries(items.map((item) => [item.id, item.name]))
    );
  const rows = generated.map((row) => ({
    ...row,
    name: overrides[row.id] ?? row.name,
  }));
  return createPortal(
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg" role="dialog" aria-label="批量重命名" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">批量重命名 · {items.length} 项</div>
        <div className="dlg-form rename-rule-form">
          <label>
            基础名称
            <input
              value={base}
              maxLength={160}
              onChange={(event) => {
                setBase(event.target.value);
                setOverrides({});
              }}
            />
          </label>
          <label>
            命名规则
            <select
              value={rule}
              onChange={(event) => {
                setRule(event.target.value as RenameRule);
                setOverrides({});
              }}
            >
              {rules.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="dlg-body scroll rename-preview">
          {rows.map((row, index) => (
            <label className="rename-row" key={row.id}>
              <span>{index + 1}</span>
              <span className={`rename-thumb ${row.previewKind}`} aria-hidden>
                {row.previewKind === "video" ? (
                  <video src={row.previewUrl} muted playsInline preload="metadata" />
                ) : row.previewKind === "audio" ? (
                  <AudioLines size={18} />
                ) : (
                  <img src={row.previewUrl} alt="" loading="lazy" />
                )}
              </span>
              <input
                value={row.name}
                maxLength={200}
                onChange={(e) =>
                  setOverrides((current) => ({
                    ...current,
                    [row.id]: e.target.value,
                  }))
                }
              />
            </label>
          ))}
        </div>
        <div className="dlg-foot">
          <button type="button" className="button" onClick={onClose}>取消</button>
          <button
            type="button"
            className="button button-primary"
            disabled={rows.some((row) => row.name.trim() === "")}
            onClick={() => onApply(rows.map((row) => ({ id: row.id, name: row.name.trim() })))}
          >
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DistributePop({
  advertisers,
  count,
  onApply,
  onClose,
}: {
  readonly advertisers: readonly Advertiser[];
  readonly count: number;
  readonly onApply: (advertiserIds: readonly number[]) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const [selected, setSelected] = React.useState<ReadonlySet<number>>(new Set());
  return createPortal(
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg" role="dialog" aria-label="素材分发" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">分发 {count} 项素材</div>
        <div className="dlg-body scroll">
          {advertisers.length === 0 ? (
            <div className="muted" style={{ padding: 10 }}>当前公司暂无广告主</div>
          ) : advertisers.map((advertiser) => {
            const checked = selected.has(advertiser.id);
            const label = advertiser.name?.trim() || advertiser.account_id || `广告主 ${advertiser.id}`;
            return (
              <label className="advertiser-row" key={advertiser.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked) next.delete(advertiser.id);
                      else next.add(advertiser.id);
                      return next;
                    })
                  }
                />
                <span>{label}</span>
                {advertiser.platform ? <small>{advertiser.platform.toUpperCase()}</small> : null}
              </label>
            );
          })}
        </div>
        <div className="dlg-foot">
          <button type="button" className="button" onClick={onClose}>取消</button>
          <button
            type="button"
            className="button button-primary"
            disabled={selected.size === 0}
            onClick={() => onApply([...selected])}
          >
            确认分发
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function MaterialsApp(): React.JSX.Element {
  const guest = usePaneGuest();
  /** 两轨恒同时挂载：素材库(会话已使用)与素材目录(企业资产)。 */
  const [libraryItems, setLibraryItems] = React.useState<AssetItem[]>([]);
  const [libraryPage, setLibraryPage] = React.useState(1);
  const [libraryPageInput, setLibraryPageInput] = React.useState("1");
  const [libraryTotal, setLibraryTotal] = React.useState(0);
  const [galleryItems, setGalleryItems] = React.useState<AssetItem[]>([]);
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set());
  const [surfaceFolders, setSurfaceFolders] = React.useState<readonly Folder[]>([]);
  const [libraryFolders, setLibraryFolders] = React.useState<readonly Folder[] | undefined>();
  const folders = libraryFolders ?? surfaceFolders;
  const [canDistribute, setCanDistribute] = React.useState(false);
  const [advertisers, setAdvertisers] = React.useState<readonly Advertiser[]>([]);
  const [itemFolder, setItemFolder] = React.useState<Readonly<Record<string, string>>>({});
  const [itemName, setItemName] = React.useState<Readonly<Record<string, string>>>({});
  /** 过滤条件同为权威热态:UI 只发 set-filter,取数依回流后的值(单写者 C1-2)。 */
  const [filter, setFilter] = React.useState<Filter>({});
  const [phase, setPhase] = React.useState<"busy" | "done" | "error">("busy");
  const [message, setMessage] = React.useState("");
  /** 数据面降级说明(常驻,非一次性提示):区分「平台没接」与「真的没素材」。 */
  const [dataNote, setDataNote] = React.useState("");
  const [libraryNote, setLibraryNote] = React.useState("");
  /** 视图态(不入快照):当前浏览的目录、内联输入、删除确认、移动弹窗目标。 */
  const [view, setView] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<{
    kind: "create" | "rename";
    id?: string;
    parentId?: string | null;
    value: string;
  } | null>(null);
  const [folderMenu, setFolderMenu] = React.useState<{
    folder: Folder;
    x: number;
    y: number;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Folder | null>(null);
  /** 折叠的目录(视图态,不入快照 —— 别人的窗口该按自己的习惯展开)。 */
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const collapsedInitialisedRef = React.useRef(false);
  const [moving, setMoving] = React.useState<readonly string[] | null>(null);
  const [batchRenaming, setBatchRenaming] = React.useState(false);
  const [distributing, setDistributing] = React.useState<readonly string[] | null>(null);
  /** 预览灯箱:以当前可见列表为图库(左右切换),起始 index 为点中的那张。 */
  const [preview, setPreview] = React.useState<{
    readonly track: "library" | "directory";
    readonly index: number;
  } | null>(null);
  /** 分发状态(只读台账,按 attachmentId 索引);平台未接时恒空 → 不显角标。 */
  const [status, setStatus] = React.useState<Readonly<Record<string, MaterialStatus>>>({});
  const [statusRevision, setStatusRevision] = React.useState(0);
  /**
   * 刚上传的素材(乐观入列)。数据面 `assets-list` 的权威来自平台后端;后端未接时它恒回
   * `{ error:"platform_unavailable", items: [] }`,故上传结果先在本地可见,后端接上后
   * 由 route 返回的真实列表覆盖(按 attachmentId 去重)。
   */
  const [uploaded, setUploaded] = React.useState<readonly AssetItem[]>([]);
  const [busyUp, setBusyUp] = React.useState(false);
  /** 拖入上传的高亮态。 */
  const [dropping, setDropping] = React.useState(false);
  const [libraryDropping, setLibraryDropping] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const uploadFolderRef = React.useRef<string | null>(null);
  const splitRef = React.useRef<HTMLDivElement>(null);
  const workbenchRef = React.useRef<HTMLDivElement>(null);
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const enterpriseRevisionRef = React.useRef<number | undefined>(undefined);
  const identityRevisionRef = React.useRef<number | undefined>(undefined);
  const loadingRef = React.useRef(false);
  const pendingLoadRef = React.useRef<"visible" | "silent" | undefined>(undefined);
  const [folderWidth, setFolderWidth] = React.useState(148);
  const [trackView, setTrackView] = React.useState<TrackView>(() => {
    try {
      const saved = localStorage.getItem("pi.materials.track-view");
      return saved === "library" || saved === "directory" ? saved : "both";
    } catch {
      return "both";
    }
  });
  const [libraryTrackSize, setLibraryTrackSize] = React.useState(() => {
    try {
      const saved = Number(localStorage.getItem("pi.materials.library-size"));
      return Number.isFinite(saved) ? Math.min(70, Math.max(18, saved)) : 38;
    } catch {
      return 38;
    }
  });
  const [stackedTracks, setStackedTracks] = React.useState(false);
  const [toolbarTier, setToolbarTier] = React.useState<0 | 1 | 2 | 3>(3);
  const [toolbarMenu, setToolbarMenu] = React.useState<{
    readonly x: number;
    readonly y: number;
  } | null>(null);

  React.useEffect(() => {
    const element = toolbarRef.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const width = entry.contentRect.width;
      const next = width >= 900 ? 3 : width >= 650 ? 2 : width >= 420 ? 1 : 0;
      setToolbarTier((current) => current === next ? current : next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    const element = workbenchRef.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setStackedTracks(entry.contentRect.width <= 780);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    try {
      localStorage.setItem("pi.materials.track-view", trackView);
      localStorage.setItem("pi.materials.library-size", String(libraryTrackSize));
    } catch {
      // 隔离载体禁用 storage 时仍保留本次会话状态。
    }
  }, [libraryTrackSize, trackView]);

  React.useEffect(() => {
    if (collapsedInitialisedRef.current || folders.length === 0) return;
    const topLevel = folders.filter((folder) => (folder.parentId ?? undefined) === undefined);
    const expandedRoot = topLevel.find((folder) => folder.name.trim() === "花影aigc");
    setCollapsed(new Set(folders
      .filter((folder) => folder.id !== expandedRoot?.id)
      .map((folder) => folder.id)));
    collapsedInitialisedRef.current = true;
  }, [folders]);

  /**
   * 两条素材轨道并行加载且互不混合：
   * - 素材库：BFF 的 aigc_assets，仅 AIGC 产出及已使用引用；
   * - 素材目录：webapp 企业素材及目录。
   * 刷新期间保留旧列表，响应回来后原位替换，避免可见重排。
   */
  const load = React.useCallback(async (
    mode: "visible" | "silent" = "silent",
  ): Promise<void> => {
    if (loadingRef.current) {
      if (mode === "visible" || pendingLoadRef.current === undefined) {
        pendingLoadRef.current = mode;
      }
      return;
    }
    loadingRef.current = true;
    if (mode === "visible") setPhase("busy");
    const kindQ: Record<string, string> =
      filter.kind !== undefined ? { kind: filter.kind } : {};
    try {
      const [sessionResult, directoryResult] = await Promise.allSettled([
        guest.query("assets-list", {
          scope: "session",
          ...kindQ,
          limit: "60",
        }),
        guest.query("materials-library", {
          ...kindQ,
          ...(view === "__none"
            ? { folderId: "null" }
            : view !== null
              ? { folderId: view, includeSub: "true" }
              : {}),
          page: String(libraryPage),
          pageSize: String(PAGE_SIZE),
        }),
      ]);
      if (sessionResult.status === "fulfilled") {
        const response = (sessionResult.value ?? {}) as {
          error?: unknown;
          message?: unknown;
        };
        setGalleryItems(unwrapItems(sessionResult.value));
        setLibraryNote(
          typeof response.error === "string"
            ? `素材库不可用: ${
                typeof response.message === "string" ? response.message : response.error
              }`
            : "",
        );
      } else {
        setLibraryNote(
          `素材库不可用: ${
            sessionResult.reason instanceof Error
              ? sessionResult.reason.message
              : String(sessionResult.reason)
          }`,
        );
      }
      if (directoryResult.status === "fulfilled") {
          const response = (directoryResult.value ?? {}) as {
            error?: unknown;
            message?: unknown;
            total?: unknown;
            folders?: unknown;
            canDistribute?: unknown;
            advertisers?: unknown;
          };
          setLibraryItems(unwrapItems(directoryResult.value));
          const total = Number(response.total ?? 0);
          setLibraryTotal(Number.isFinite(total) ? Math.max(0, total) : 0);
          if (Array.isArray(response.folders)) {
            setLibraryFolders(
              response.folders.flatMap((raw) => {
                const row = raw as {
                  id?: unknown;
                  name?: unknown;
                  display_name?: unknown;
                  parent_id?: unknown;
                };
                const id = String(row.id ?? "");
                const name = String(row.display_name ?? row.name ?? "").trim();
                if (id === "" || name === "") return [];
                return [{
                  id,
                  name,
                  ...(row.parent_id !== null && row.parent_id !== undefined
                    ? { parentId: String(row.parent_id) }
                    : {}),
                  remote: true,
                }];
              }),
            );
          }
          setCanDistribute(response.canDistribute === true);
          setAdvertisers(
            Array.isArray(response.advertisers)
              ? response.advertisers as Advertiser[]
              : [],
          );
          setDataNote(
            typeof response.error === "string"
              ? `素材目录服务不可用: ${
                  typeof response.message === "string" ? response.message : response.error
                }`
              : "",
          );
      } else {
        setDataNote(
          `素材目录服务不可用: ${
            directoryResult.reason instanceof Error
              ? directoryResult.reason.message
              : String(directoryResult.reason)
          }`,
        );
      }
      if (mode === "visible") setPhase("done");
    } catch (e) {
      if (mode === "visible") {
        setMessage(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    } finally {
      loadingRef.current = false;
      const pendingMode = pendingLoadRef.current;
      pendingLoadRef.current = undefined;
      if (pendingMode !== undefined) {
        queueMicrotask(() => void load(pendingMode));
      }
    }
  }, [guest, filter.kind, libraryPage, view]);
  React.useEffect(() => {
    void load("visible");
  }, [load]);
  React.useEffect(
    () =>
      guest.onSignal("host:identityRevision", (value) => {
        if (typeof value !== "number") return;
        const previous = identityRevisionRef.current;
        identityRevisionRef.current = value;
        if (previous !== undefined && previous !== value) void load("visible");
      }),
    [guest, load],
  );
  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = (): void => {
      if (timer !== undefined) return;
      timer = setInterval(() => void load("silent"), 60_000);
    };
    const stop = (): void => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    start();
    const unsubscribe = guest.onLifecycle((state) => {
      if (state === "visible") start();
      else stop();
    });
    return () => {
      stop();
      unsubscribe();
    };
  }, [guest, load]);

  // 权威态回流(选中 / 目录树 / 归属 / 改名)——UI 只发命令,不直写。
  React.useEffect(
    () =>
      guest.surface.subscribe("surface:materials", (v) => {
        const s = (v ?? {}) as MaterialsSnapshot;
        if (Array.isArray(s.selectedIds)) {
          setPicked(new Set(s.selectedIds.filter((x): x is string => typeof x === "string")));
        }
        if (s.filter !== undefined && s.filter !== null) setFilter(s.filter);
        if (Array.isArray(s.folders)) setSurfaceFolders(s.folders);
        if (s.itemFolder !== undefined && s.itemFolder !== null) setItemFolder(s.itemFolder);
        if (s.itemName !== undefined && s.itemName !== null) setItemName(s.itemName);
        if (typeof s.enterpriseRevision === "number") {
          const previous = enterpriseRevisionRef.current;
          enterpriseRevisionRef.current = s.enterpriseRevision;
          if (previous !== undefined && previous !== s.enterpriseRevision) {
            void load("silent");
          }
        }
      }),
    [guest, load],
  );

  const run = React.useCallback(
    async (action: string, args: unknown): Promise<void> => {
      try {
        await guest.surface.run("materials", action, args);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      }
    },
    [guest],
  );
  const mutateLibrary = React.useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      try {
        const result = (await guest.mutate("materials-library", body)) as {
          error?: unknown;
          message?: unknown;
        };
        if (typeof result?.error === "string") {
          throw new Error(
            typeof result.message === "string" ? result.message : result.error,
          );
        }
        await load("silent");
        return true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [guest, load],
  );
  const retryDistribution = React.useCallback(
    async (materialId: string, advertiserId: number): Promise<void> => {
      const id = materialId.startsWith("material:") ? materialId.slice(9) : materialId;
      const ok = await mutateLibrary({
        op: "distribute",
        ids: [id],
        advertiserIds: [String(advertiserId)],
        ...confirmedWrite(),
      });
      if (!ok) throw new Error("重试分发失败");
      setStatusRevision((value) => value + 1);
    },
    [mutateLibrary],
  );
  const moveItems = React.useCallback(
    async (ids: readonly string[], folderId: string | null): Promise<void> => {
      const materialIds = ids.flatMap((id) => {
        const materialId = id.startsWith("material:") ? id.slice(9) : undefined;
        return materialId === undefined ? [] : [materialId];
      });
      const attachmentIds = ids.filter((id) => !id.startsWith("material:"));
      if (materialIds.length > 0) {
        await mutateLibrary({
          op: "move-materials",
          ids: materialIds,
          folderId,
          ...confirmedWrite(),
        });
      }
      if (attachmentIds.length > 0) {
        await run("move-items", { ids: attachmentIds, folderId });
      }
    },
    [mutateLibrary, run],
  );
  const locateMaterial = React.useCallback(
    async (materialId: string): Promise<void> => {
      try {
        const result = (await guest.mutate("materials-library", {
          op: "locate",
          id: materialId,
        })) as { locatable?: unknown; error?: unknown; message?: unknown };
        const locatable =
          typeof result.locatable === "object" && result.locatable !== null
            ? result.locatable as { sessionId?: unknown; assetId?: unknown; url?: unknown }
            : undefined;
        if (typeof locatable?.sessionId !== "string") {
          setMessage("未找到可定位的生成会话");
          return;
        }
        const delivered = await guest.events.publish(SESSION_LOCATE_EVENT, locatable);
        if (delivered.delivered === 0) setMessage("当前宿主不支持会话定位");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [guest],
  );

  const applyPicked = (next: ReadonlySet<string>): void => {
    setPicked(next);
    void run("select", { ids: [...next] });
  };
  const toggle = (attachmentId: string): void => {
    const next = new Set(picked);
    if (next.has(attachmentId)) next.delete(attachmentId);
    else next.add(attachmentId);
    applyPicked(next);
  };

  /**
   * 上传写-读回环:`guest.upload` 经宿主附件端口落库(大二进制走制品面,不进帧 R-0b)→
   * 得 attachmentId → 以引用走 `move-items` 登记进当前目录(控制面写)→ 本地乐观入列。
   */
  const uploadFiles = React.useCallback(
    async (files: readonly File[], folderId: string | null): Promise<void> => {
      if (files.length === 0) return;
      setBusyUp(true);
      try {
        const attachmentIds: string[] = [];
        for (const file of files) {
          const r = await guest.upload(file);
          attachmentIds.push(r.attachmentId);
        }
        const result = await guest.mutate("materials-library", {
          op: "upload-to-directory",
          attachmentIds,
          folderId,
        }) as { error?: unknown; message?: unknown; items?: unknown };
        if (typeof result.error === "string") {
          throw new Error(
            typeof result.message === "string" ? result.message : result.error,
          );
        }
        const saved = unwrapItems(result);
        if (saved.length > 0) {
          setUploaded((previous) => [...saved, ...previous]);
          await load("silent");
        }
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyUp(false);
      }
    },
    [guest, load],
  );

  // 手动上传仅乐观进入素材目录；素材库只采 BFF 权威会话资产。
  const sessionItems = galleryItems;
  const knownDirectoryIds = new Set(libraryItems.map((item) => item.assetId));
  const directoryItems = [
    ...uploaded.filter((item) => !knownDirectoryIds.has(item.assetId)),
    ...libraryItems,
  ];

  /**
   * 分发状态(只读增强):列表变了就整批重查。route 在平台未接时降级为空,
   * 查询失败也**静默**——角标缺席不影响素材面板任何主功能,不该弹错扰人。
   */
  const statusIdOf = (asset: AssetItem): string =>
    asset.attachmentId ?? asset.meta?.materialId ?? asset.assetId;
  const statusKey = [...new Set(
    [...directoryItems, ...sessionItems].map(statusIdOf),
  )].join(",");
  React.useEffect(() => {
    if (statusKey === "") {
      setStatus({});
      return undefined;
    }
    let alive = true;
    void guest
      .query("material-status", { ids: statusKey })
      .then((raw) => {
        if (!alive) return;
        const list = (raw ?? {}) as { items?: unknown; uploads?: unknown };
        const uploadItems = typeof list.uploads === "object" && list.uploads !== null && !Array.isArray(list.uploads)
          ? Object.entries(list.uploads).map(([materialId, records]) => ({ materialId, records }))
          : [];
        const sourceItems = Array.isArray(list.items) ? list.items : uploadItems;
        const items2 = sourceItems.flatMap((value): MaterialStatus[] => {
          if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
          const row = value as Record<string, unknown>;
          const attachmentId = String(row.attachmentId ?? row.materialId ?? row.id ?? "");
          if (attachmentId === "") return [];
          const records = parseUploadRecords(row.records ?? row.uploads ?? row.advertisers);
          const rawStatus = row.status;
          const status = rawStatus === "none" || rawStatus === "pending" || rawStatus === "done" ||
            rawStatus === "uploading" || rawStatus === "failed" || rawStatus === "replaced"
            ? rawStatus
            : statusFromRecords(records);
          return [{
            ...row,
            attachmentId,
            status,
            ...(records.length > 0 ? { records } : {}),
            ...(typeof row.materialId === "number" || typeof row.materialId === "string"
              ? { materialId: String(row.materialId) }
              : {}),
          } as MaterialStatus];
        });
        setStatus(
          Object.fromEntries(items2.flatMap((record) => [
            [record.attachmentId, record] as const,
            ...(record.materialId !== undefined
              ? [[record.materialId, record] as const]
              : []),
          ])),
        );
      })
      .catch(() => {
        if (alive) setStatus({});
      });
    return () => {
      alive = false;
    };
  }, [guest, statusKey, statusRevision]);
  React.useEffect(() => {
    const pending = Object.values(status).some((record) =>
      record.status === "pending" ||
      record.status === "uploading" ||
      record.records?.some((item) => item.status === "uploading"),
    );
    if (!pending) return undefined;
    const timer = window.setInterval(() => setStatusRevision((value) => value + 1), 5_000);
    return () => window.clearInterval(timer);
  }, [status]);

  const keyOf = (asset: AssetItem): string => asset.attachmentId ?? asset.assetId;
  const materialIdOf = (key: string): string | undefined =>
    [...directoryItems, ...sessionItems].find((item) => keyOf(item) === key)?.meta
      ?.materialId ??
    (key.startsWith("material:") ? key.slice("material:".length) : undefined);

  // 当前目录过滤:null=全部;"__none"=未分类。
  const viewFolderIds =
    view !== null && view !== "__none" ? folderSubtreeIds(folders, view) : undefined;
  const directoryVisible = directoryItems.filter((a) => {
    if (view === null) return true;
    const owner = a.meta?.folderId ?? itemFolder[keyOf(a)];
    return view === "__none" ? owner === undefined : owner !== undefined && viewFolderIds?.has(owner);
  });
  const selectable = directoryVisible;
  const allPicked = selectable.length > 0 && selectable.every((a) => picked.has(keyOf(a)));
  const pickedAssets = directoryItems.filter((asset) => picked.has(keyOf(asset)));
  const pickedMaterialIds = pickedAssets.flatMap((asset) =>
    asset.meta?.materialId === undefined ? [] : [asset.meta.materialId],
  );
  const pageCount = Math.max(1, Math.ceil(libraryTotal / PAGE_SIZE));
  const setCurrentLibraryPage = (page: number): void => {
    const nextPage = Math.min(pageCount, Math.max(1, page));
    setLibraryPage(nextPage);
    setLibraryPageInput(String(nextPage));
  };
  React.useEffect(() => {
    if (libraryPage > pageCount) setLibraryPage(pageCount);
    setLibraryPageInput(String(Math.min(libraryPage, pageCount)));
  }, [libraryPage, pageCount]);

  const jumpToLibraryPage = (value: string): void => {
    const requestedPage = Number.parseInt(value, 10);
    const page = Number.isFinite(requestedPage)
      ? Math.min(pageCount, Math.max(1, requestedPage))
      : libraryPage;
    setCurrentLibraryPage(page);
  };

  /** 显示名:热态覆盖名(改过名的)优先,否则数据面原名,再否则 assetId。 */
  const nameOf = (a: AssetItem): string =>
    itemName[keyOf(a)] ??
    a.meta?.name ??
    a.assetId;

  /**
   * 按天分栏(源项目「素材库」tab 的形态)。分组保持 visible 的原序,故每项带上其在 visible
   * 里的下标 —— 灯箱图库仍是整个 visible,跨栏左右切换不断。
   */
  const groupDays = (
    items: readonly AssetItem[],
  ): ReadonlyArray<readonly [string, ReadonlyArray<{ a: AssetItem; i: number }>]> => {
      const buckets = new Map<string, { a: AssetItem; i: number }[]>();
      items.forEach((a, i) => {
        const day = dayOf(a.createdAt);
        const g = buckets.get(day);
        if (g === undefined) buckets.set(day, [{ a, i }]);
        else g.push({ a, i });
      });
      return [...buckets.entries()];
    };
  const directoryDays = groupDays(directoryVisible);
  const libraryDays = groupDays(sessionItems);

  const previewItems =
    preview?.track === "library" ? sessionItems : directoryVisible;
  /** 预览图库 = 当前轨可见列表(与网格同序)。 */
  const gallery: readonly PreviewItem[] = previewItems.map((a) => ({
    url: a.displayUrl,
    name: nameOf(a),
  }));

  const toAttachmentIds = async (ids: readonly string[]): Promise<string[]> => {
    const local = ids.filter((id) =>
      [...sessionItems, ...directoryItems].some((item) =>
        keyOf(item) === id && item.attachmentId !== undefined));
    const localSet = new Set(local);
    const materialIds = ids.flatMap((id) => {
      if (localSet.has(id)) return [];
      const materialId = materialIdOf(id);
      return materialId === undefined ? [] : [materialId];
    });
    if (materialIds.length === 0) return local;
    const sources = materialIds.flatMap((materialId) => {
      const item = directoryItems.find((candidate) =>
        candidate.meta?.materialId === materialId);
      if (item === undefined) return [];
      return [{
        id: materialId,
        url: item.meta?.fileUrl ?? item.displayUrl,
        name: item.meta?.name,
        type: item.meta?.type,
      }];
    });
    const result = (await guest.mutate("materials-library", {
      op: "import-to-canvas",
      ids: materialIds,
      sources,
    })) as { attachmentIds?: unknown; error?: unknown; message?: unknown };
    if (!Array.isArray(result.attachmentIds)) {
      throw new Error(
        typeof result.message === "string"
          ? result.message
          : typeof result.error === "string"
            ? result.error
            : "素材导入失败",
      );
    }
    return [
      ...local,
      ...result.attachmentIds.filter((id): id is string => typeof id === "string"),
    ];
  };

  const importMaterialsToLibrary = async (materialIds: readonly string[]): Promise<void> => {
    try {
      const attachmentIds = await toAttachmentIds(
        materialIds.map((id) => `material:${id}`),
      );
      await load("silent");
      setMessage(`已加入当前会话素材库（${attachmentIds.length}）`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const bringToConversation = async (
    ids: readonly string[],
  ): Promise<boolean> => {
    try {
      const refs = await toAttachmentIds(ids);
      if (refs.length === 0) return false;
      await guest.stageUserMessage("", { attachmentIds: refs });
      setMessage("已加入对话输入框");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const bring = async (): Promise<void> => {
    const ok = await bringToConversation([...picked]);
    if (ok) applyPicked(new Set());
  };

  /** 素材不持 canvas surface 权限；只发布受限事件。无订阅者/旧宿主则降级经对话。 */
  const editInCanvas = async (ids: readonly string[], label: string): Promise<void> => {
    if (ids.length === 0) return;
    let attachmentIds: string[];
    try {
      attachmentIds = await toAttachmentIds(ids);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    try {
      const event = await guest.events.publish(CANVAS_OPEN_ATTACHMENTS_EVENT, {
        attachmentIds,
      });
      if (event.delivered > 0) {
        setMessage("已送入画布");
        return;
      }
    } catch {
      // 旧宿主或事件能力不可用：保留可移植降级路径。
    }
    try {
      await guest.submitUserMessage(`把${label}放到画布上,我要编辑`, { attachmentIds });
      setMessage("画布未连接，已送入对话");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const submitDraft = (): void => {
    if (draft === null) return;
    const name = draft.value.trim();
    if (name === "") {
      setDraft(null);
      return;
    }
    if (draft.kind === "create") {
      const parentId = draft.parentId ?? null;
      if (libraryFolders !== undefined) {
        void mutateLibrary({
          op: "create-folder",
          name,
          parentId,
        });
      } else {
        void run("create-folder", {
          name,
          ...(parentId !== null ? { parentId } : {}),
        });
      }
    } else if (draft.id !== undefined) {
      if (folders.find((folder) => folder.id === draft.id)?.remote === true) {
        void mutateLibrary({ op: "rename-folder", id: draft.id, name });
      } else {
        void run("rename-folder", { id: draft.id, name });
      }
    }
    setDraft(null);
  };

  /** 目录素材数(含后代 rollup)。列表元数据优先,快照归属表补齐未载入当前页的素材。 */
  const rollup = (folderId: string): number => {
    const ids = folderSubtreeIds(folders, folderId);
    const owners = new Map<string, string>();
    for (const asset of directoryItems) {
      const id = keyOf(asset);
      const owner = asset.meta?.folderId ?? itemFolder[id];
      if (owner !== undefined) owners.set(id, owner);
    }
    for (const [id, owner] of Object.entries(itemFolder)) {
      if (!owners.has(id)) owners.set(id, owner);
    }
    return [...owners.values()].filter((owner) => ids.has(owner)).length;
  };

  const unclassifiedCount = directoryItems.filter((asset) => {
    const id = keyOf(asset);
    return asset.meta?.folderId === undefined && itemFolder[id] === undefined;
  }).length;

  /** 拖放发端:多选时整批带走;WebView2 常丢自定义 MIME，故同步 text/plain 前缀。 */
  const onDragStart = (e: React.DragEvent, asset: AssetItem): void => {
    const id = keyOf(asset);
    const ids = picked.has(id) ? [...picked] : [id];
    const attachmentIds = ids.filter((value) =>
      directoryItems.some(
        (item) => keyOf(item) === value && item.attachmentId !== undefined,
      ),
    );
    const materialIds = ids.flatMap((value) => {
      const materialId = directoryItems.find((item) => keyOf(item) === value)?.meta?.materialId
        ?? materialIdOf(value);
      return materialId === undefined ? [] : [materialId];
    });
    if (attachmentIds.length > 0) {
      e.dataTransfer.setData("text/att-id", attachmentIds.join(" "));
    }
    if (materialIds.length > 0) {
      const payload = JSON.stringify(materialIds);
      e.dataTransfer.setData("application/x-pi-material-ids", payload);
      // WebView2 / 部分宿主只稳定保留 text/plain。
      e.dataTransfer.setData("text/plain", `pi-material-ids:${payload}`);
    } else if (ids.length === 1) {
      e.dataTransfer.setData("text/uri-list", asset.displayUrl);
      e.dataTransfer.setData("text/plain", nameOf(asset));
    }
    e.dataTransfer.effectAllowed = "copyMove";
  };

  const readMaterialIdsFromDataTransfer = (dt: DataTransfer): string[] => {
    const rawCustom = dt.getData("application/x-pi-material-ids");
    const rawPlain = dt.getData("text/plain");
    const raw = rawCustom !== ""
      ? rawCustom
      : rawPlain.startsWith("pi-material-ids:")
        ? rawPlain.slice("pi-material-ids:".length)
        : "";
    if (raw === "") return [];
    try {
      const ids = JSON.parse(raw) as unknown;
      if (!Array.isArray(ids)) return [];
      return ids
        .map((id) => String(id).trim())
        .filter((id) => id !== "" && /^\d+$/.test(id));
    } catch {
      return [];
    }
  };

  const renderTree = (parentId: string | null | undefined, depth: number): React.JSX.Element[] =>
    childrenOf(folders, parentId).flatMap((f) => {
      const kids = childrenOf(folders, f.id);
      const shut = collapsed.has(f.id);
      return [
      <div key={f.id} className={view === f.id ? "tree-row on" : "tree-row"} style={{ paddingLeft: 8 + depth * 12 }}>
        {kids.length > 0 ? (
          <button
            type="button"
            className="tree-twist"
            aria-label={shut ? "展开" : "折叠"}
            aria-expanded={!shut}
            onClick={() =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (shut) next.delete(f.id);
                else next.add(f.id);
                return next;
              })
            }
          >
            {shut ? <ChevronRight size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
          </button>
        ) : (
          <span className="tree-twist" aria-hidden />
        )}
        <button type="button" className="tree-name" onClick={() => { setCurrentLibraryPage(1); setView(f.id); }} title={f.name}>
          {f.name}
        </button>
        {/* 计数含后代 rollup(源项目 TreeNode.count 同义):看一眼就知道这支下面有多少素材。 */}
        <span className="tree-count">{rollup(f.id)}</span>
        <button
          type="button"
          className={folderMenu?.folder.id === f.id ? "tree-act open" : "tree-act"}
          aria-label={`${f.name}目录操作`}
          aria-haspopup="menu"
          aria-expanded={folderMenu?.folder.id === f.id}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setFolderMenu({ folder: f, x: rect.right - 164, y: rect.bottom + 2 });
          }}
        >
          <Ellipsis size={14} aria-hidden />
        </button>
      </div>,
      ...(shut ? [] : renderTree(f.id, depth + 1)),
      ];
    });

  interface ToolbarAction {
    readonly key: string;
    readonly label: string;
    readonly tip: string;
    readonly group: "整理" | "使用" | "选择";
    readonly icon: React.JSX.Element;
    readonly disabled?: boolean;
    readonly primary?: boolean;
    readonly run: () => void;
  }
  const toolbarActions: readonly ToolbarAction[] = [
    ...(canDistribute
      ? [{
          key: "distribute",
          label: "分发",
          tip: pickedMaterialIds.length === 0 ? "先选择已入库素材" : "分发到广告主",
          group: "使用" as const,
          icon: <Send size={14} aria-hidden />,
          disabled: pickedMaterialIds.length === 0,
          primary: true,
          run: () => setDistributing(pickedMaterialIds),
        }]
      : []),
    {
      key: "rename",
      label: "批量重命名",
      tip: picked.size === 0 ? "先选择素材" : "按规则批量重命名",
      group: "整理",
      icon: <PencilLine size={14} aria-hidden />,
      disabled: picked.size === 0,
      run: () => setBatchRenaming(true),
    },
    {
      key: "move",
      label: "移动",
      tip: picked.size === 0 ? "先选择素材" : "移动到目录",
      group: "整理",
      icon: <FolderInput size={14} aria-hidden />,
      disabled: picked.size === 0,
      run: () => setMoving([...picked]),
    },
    {
      key: "canvas",
      label: "画布编辑",
      tip: picked.size === 0 ? "先选择素材" : "送入画布编辑",
      group: "使用",
      icon: <Pencil size={14} aria-hidden />,
      disabled: picked.size === 0,
      run: () => void editInCanvas([...picked], `这 ${picked.size} 张素材`),
    },
    {
      key: "bring",
      label: "带入对话",
      tip: picked.size === 0 ? "先选择素材" : "带入当前对话",
      group: "使用",
      icon: <AtSign size={14} aria-hidden />,
      disabled: picked.size === 0,
      primary: true,
      run: () => void bring(),
    },
    {
      key: "select",
      label: allPicked ? "取消全选" : "全选",
      tip: allPicked ? "清空当前选择" : "选择当前目录全部素材",
      group: "选择",
      icon: <SquareCheckBig size={14} aria-hidden />,
      run: () =>
        applyPicked(allPicked ? new Set() : new Set(selectable.map(keyOf))),
    },
    {
      key: "refresh",
      label: "刷新",
      tip: "刷新素材库与素材目录",
      group: "选择",
      icon: <RefreshCw size={14} className={phase === "busy" ? "spin" : undefined} aria-hidden />,
      disabled: phase === "busy",
      run: () => void load("visible"),
    },
  ];
  const actionLimit =
    toolbarTier === 3
      ? toolbarActions.length
      : toolbarTier === 2
        ? toolbarActions.length
        : toolbarTier === 1
          ? Math.min(4, toolbarActions.length)
          : 0;
  const labelLimit =
    toolbarTier === 3
      ? toolbarActions.length
      : toolbarTier === 2
        ? Math.min(4, toolbarActions.length)
        : 0;
  const shownActions = toolbarActions.slice(0, actionLimit);
  const overflowActions = toolbarActions.slice(actionLimit);

  const renderAssetGrid = (
    track: "library" | "directory",
    items: readonly AssetItem[],
    days: ReadonlyArray<readonly [string, ReadonlyArray<{ a: AssetItem; i: number }>]>,
  ): React.JSX.Element => (
    <>
      {days.map(([day, group]) => (
        <section key={day}>
          {track === "library" || days.length > 1 ? (
            <div className="day">{day}</div>
          ) : null}
          <div className="grid">
            {group.map(({ a, i }) => {
              const id = keyOf(a);
              const materialId = a.meta?.materialId ?? materialIdOf(id);
              const accountCount = Array.isArray(a.meta?.accounts)
                ? a.meta.accounts.length
                : 0;
              const cellStatus = status[statusIdOf(a)] ?? (accountCount > 0
                ? {
                    attachmentId: id,
                    status: "done" as const,
                    advertiserCount: accountCount,
                  }
                : undefined);
              return (
                <AssetCell
                  key={a.assetId}
                  {...(mediaKind(a) === "image"
                    ? { onPreview: () => setPreview({ track, index: i }) }
                    : {})}
                  url={a.displayUrl}
                  {...(a.meta?.fileUrl !== undefined
                    ? { sourceUrl: a.meta.fileUrl }
                    : {})}
                  kind={mediaKind(a)}
                  name={nameOf(a)}
                  attachmentId={id}
                  {...(materialId !== undefined ? { materialId } : {})}
                  draggable={a.attachmentId !== undefined || materialId !== undefined}
                  selected={track === "directory" && picked.has(id)}
                  anySelected={track === "directory" && picked.size > 0}
                  {...(cellStatus !== undefined ? { status: cellStatus } : {})}
                  {...(track === "directory"
                    ? { onToggleSelect: () => toggle(id) }
                    : {})}
                  onEditInCanvas={() =>
                    void editInCanvas([id], `素材「${nameOf(a)}」`)
                  }
                  onBringToConversation={() =>
                    void bringToConversation([id])
                  }
                  onRename={(next: string) => {
                    void (async () => {
                      if (materialId !== undefined) {
                        await mutateLibrary({
                          op: "rename",
                          items: [{ id: materialId, name: next }],
                        });
                      }
                      await run("rename-item", { id, name: next });
                    })();
                  }}
                  {...(track === "directory" || materialId !== undefined
                    ? {
                        onRequestMove: () => setMoving([
                          materialId === undefined ? id : `material:${materialId}`,
                        ]),
                      }
                    : {})}
                  {...(track === "library" && a.attachmentId !== undefined
                    ? {
                        onDelete: () => void mutateLibrary({
                          op: "remove-from-session-library",
                          attachmentIds: [a.attachmentId],
                        }),
                      }
                    : track === "directory" && materialId !== undefined
                      ? {
                          onDelete: () =>
                            void mutateLibrary({
                              op: "delete",
                              ids: [materialId],
                              ...confirmedWrite(),
                            }),
                        }
                      : {})}
                  {...(canDistribute && materialId !== undefined
                    ? {
                        onRetry: retryDistribution,
                        ...(track === "directory"
                          ? { onDistribute: () => setDistributing([materialId]) }
                          : {}),
                      }
                    : {})}
                  {...(materialId !== undefined
                    ? { onLocate: () => void locateMaterial(materialId) }
                    : {})}
                  onDragStart={(event) => onDragStart(event, a)}
                  {...(track === "directory" && materialId !== undefined
                    ? {
                        onPointerDrop: () => void importMaterialsToLibrary(
                          picked.has(id) ? pickedMaterialIds : [materialId],
                        ),
                      }
                    : {})}
                  onNotice={setMessage}
                />
              );
            })}
          </div>
        </section>
      ))}
    </>
  );

  return (
    <div className="pane-layout">
      {message !== "" ? (
        <div className="notice" onClick={() => setMessage("")} title="点击关闭">
          {message}
        </div>
      ) : null}

      <nav className="materials-view-tabs" aria-label="素材工作台展示模式">
        {([
          { key: "both", label: "并列", icon: <Columns2 size={13} aria-hidden /> },
          { key: "library", label: "素材库", icon: <PanelLeft size={13} aria-hidden /> },
          { key: "directory", label: "素材目录", icon: <PanelRight size={13} aria-hidden /> },
        ] as const).map((item) => (
          <button
            key={item.key}
            type="button"
            className={trackView === item.key ? "on" : undefined}
            aria-pressed={trackView === item.key}
            onClick={() => setTrackView(item.key)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div
        ref={workbenchRef}
        className="materials-workbench"
        data-view={trackView}
        data-stacked={stackedTracks}
        style={{
          "--materials-library-size": `${libraryTrackSize}%`,
        } as React.CSSProperties}
      >
        {trackView !== "directory" ? <section
          className={libraryDropping ? "material-track library-track dropping" : "material-track library-track"}
          data-materials-library
          aria-labelledby="materials-library-title"
          onDragOver={(event) => {
            const types = [...event.dataTransfer.types];
            const accepts = types.includes("application/x-pi-material-ids")
              || types.includes("text/plain")
              || types.includes("Files");
            if (!accepts) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setLibraryDropping(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setLibraryDropping(false);
            }
          }}
          onDrop={(event) => {
            setLibraryDropping(false);
            event.preventDefault();
            const materialIds = readMaterialIdsFromDataTransfer(event.dataTransfer);
            if (materialIds.length === 0) {
              setMessage("未识别可入库素材（请从素材目录拖入）");
              return;
            }
            void importMaterialsToLibrary(materialIds);
          }}
        >
          <header className="track-header">
            <div className="track-title" id="materials-library-title">
              <Library size={15} aria-hidden />
              <strong>素材库</strong>
              <span>{sessionItems.length}</span>
            </div>
            {libraryNote !== "" ? (
              <span className="hint" title={libraryNote}><Info size={13} aria-hidden /></span>
            ) : null}
          </header>
          <div className="track-scroll scroll">
            {phase === "busy" && sessionItems.length === 0 ? (
              <div className="empty initial-loading">
                <RefreshCw size={18} className="spin" aria-hidden />
                <span>载入素材库</span>
              </div>
            ) : null}
            {phase !== "busy" && sessionItems.length === 0 ? (
              <div className="empty">
                <span>暂无已使用素材</span>
                <small>从素材目录拖至此处，或使用 AIGC 产出</small>
              </div>
            ) : null}
            <div className="asset-list">{renderAssetGrid("library", sessionItems, libraryDays)}</div>
          </div>
        </section> : null}

        {trackView === "both" ? (
          <div
            className="track-resizer"
            role="separator"
            aria-label="调整素材库与素材目录尺寸"
            aria-orientation={stackedTracks ? "horizontal" : "vertical"}
            aria-valuemin={18}
            aria-valuemax={70}
            aria-valuenow={Math.round(libraryTrackSize)}
            tabIndex={0}
            onKeyDown={(event) => {
              const decrement = stackedTracks ? "ArrowUp" : "ArrowLeft";
              const increment = stackedTracks ? "ArrowDown" : "ArrowRight";
              if (event.key !== decrement && event.key !== increment) return;
              event.preventDefault();
              setLibraryTrackSize((size) =>
                Math.min(70, Math.max(18, size + (event.key === increment ? 2 : -2))),
              );
            }}
            onPointerDown={(event) =>
              event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const rect = workbenchRef.current?.getBoundingClientRect();
              if (rect === undefined || rect.width === 0 || rect.height === 0) return;
              const next = stackedTracks
                ? ((event.clientY - rect.top) / rect.height) * 100
                : ((event.clientX - rect.left) / rect.width) * 100;
              setLibraryTrackSize(Math.min(70, Math.max(18, next)));
            }}
            onPointerUp={(event) =>
              event.currentTarget.releasePointerCapture(event.pointerId)}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
          />
        ) : null}

        {trackView !== "library" ? <section className="material-track directory-track" data-materials-directory>
          <header className="track-header directory-header">
            <div className="track-title" id="materials-directory-title">
              <FolderTree size={15} aria-hidden />
              <strong>素材目录</strong>
              <span>{libraryTotal}</span>
            </div>
            <div
              className="directory-toolbar"
              data-toolbar-tier={toolbarTier}
              ref={toolbarRef}
            >
              <div className="segs" role="group" aria-label="素材类型">
                {KIND_TABS.map((tab) => (
                  <button
                    key={tab.label}
                    type="button"
                    className={filter.kind === tab.kind ? "seg on" : "seg"}
                    onClick={() => {
                      setCurrentLibraryPage(1);
                      void run("set-filter", { kind: tab.kind });
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <span className="muted toolbar-summary">
                {picked.size > 0
                  ? `已选 ${picked.size}`
                  : `${folders.length} 个目录`}
                {dataNote !== "" ? (
                  <span className="hint" title={dataNote}>
                    <Info size={13} aria-hidden />
                  </span>
                ) : null}
              </span>
              <div className="toolbar-actions">
                {shownActions.map((action, index) => (
                  <TooltipPortal key={action.key} tip={action.tip}>
                    <button
                      type="button"
                      className={action.primary ? "action-button primary" : "action-button"}
                      disabled={action.disabled}
                      onClick={action.run}
                    >
                      {action.icon}
                      {index < labelLimit ? <span>{action.label}</span> : null}
                    </button>
                  </TooltipPortal>
                ))}
                {overflowActions.length > 0 ? (
                  <button
                    type="button"
                    className="action-button overflow-button"
                    aria-label="更多素材操作"
                    aria-haspopup="menu"
                    aria-expanded={toolbarMenu !== null}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setToolbarMenu(
                        toolbarMenu === null
                          ? { x: rect.right - 190, y: rect.bottom + 4 }
                          : null,
                      );
                    }}
                  >
                    <Ellipsis size={15} aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
          </header>

          <div className="split" ref={splitRef}>
            <aside className="side" style={{ width: folderWidth }}>
              <div className="side-scroll scroll">
                <div className="tree-sticky">
                  <div className={view === null ? "tree-row on" : "tree-row"}>
                    <button
                      type="button"
                      className="tree-name"
                      onClick={() => {
                        setCurrentLibraryPage(1);
                        setView(null);
                      }}
                    >
                      全部素材
                    </button>
                    <span className="tree-count">{libraryTotal}</span>
                  </div>
                  <div className="tree-create-row">
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({ kind: "create", parentId: null, value: "" })
                      }
                    >
                      <FolderPlus size={13} aria-hidden />
                      新建目录
                    </button>
                    <button
                      type="button"
                      disabled={busyUp}
                      onClick={() => {
                        uploadFolderRef.current = view === "__none" ? null : view;
                        fileRef.current?.click();
                      }}
                    >
                      <ImagePlus size={13} className={busyUp ? "spin" : undefined} aria-hidden />
                      上传
                    </button>
                  </div>
                </div>
                {renderTree(undefined, 1)}
                <div
                  className={view === "__none" ? "tree-row on" : "tree-row"}
                  style={{ paddingLeft: 20 }}
                >
                  <button
                    type="button"
                    className="tree-name"
                    onClick={() => {
                      setCurrentLibraryPage(1);
                      setView("__none");
                    }}
                  >
                    未分类
                  </button>
                  <span className="tree-count">{unclassifiedCount}</span>
                </div>
              </div>
              <div
                className="side-resizer"
                role="separator"
                aria-label="调整素材目录宽度"
                aria-orientation="vertical"
                aria-valuemin={120}
                aria-valuemax={360}
                aria-valuenow={Math.round(folderWidth)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  setFolderWidth((width) =>
                    Math.min(
                      360,
                      Math.max(120, width + (event.key === "ArrowRight" ? 12 : -12)),
                    )
                  );
                }}
                onPointerDown={(event) =>
                  event.currentTarget.setPointerCapture(event.pointerId)}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  const left = splitRef.current?.getBoundingClientRect().left ?? 0;
                  const max = Math.min(
                    360,
                    (splitRef.current?.clientWidth ?? 800) * 0.45,
                  );
                  setFolderWidth(Math.min(max, Math.max(120, event.clientX - left)));
                }}
                onPointerUp={(event) =>
                  event.currentTarget.releasePointerCapture(event.pointerId)}
                onPointerCancel={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                }}
              />
            </aside>
            <div
              className={dropping ? "content grow dropping" : "content grow"}
              data-materials-directory-content
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files")) {
                  event.preventDefault();
                  setDropping(true);
                }
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropping(false);
                }
              }}
              onDrop={(event) => {
                setDropping(false);
                const files = [...event.dataTransfer.files];
                if (files.length === 0) return;
                event.preventDefault();
                void uploadFiles(files, view === "__none" ? null : view);
              }}
            >
              <div className="materials-scroll scroll grow">
                {phase === "busy" && directoryVisible.length === 0 ? (
                  <div className="empty initial-loading">
                    <RefreshCw size={18} className="spin" aria-hidden />
                    <span>载入素材目录</span>
                  </div>
                ) : null}
                {phase === "error" && directoryVisible.length === 0 ? (
                  <div className="empty error">{message}</div>
                ) : null}
                {phase === "done" && directoryVisible.length === 0 ? (
                  <div className="empty">
                    <span>当前目录暂无素材</span>
                    {dataNote !== "" ? <small>{dataNote}</small> : null}
                  </div>
                ) : null}
                <div className="asset-list">{renderAssetGrid("directory", directoryVisible, directoryDays)}</div>
              </div>
              <nav className="pager" aria-label="素材分页">
                <button
                  type="button"
                  className="pager-button"
                  aria-label="上一页"
                  disabled={libraryPage === 1}
                  onClick={() => setCurrentLibraryPage(libraryPage - 1)}
                >
                  上一页
                </button>
                <div className="pager-page">
                  <span className="muted">第</span>
                  <input
                    className="pager-input"
                    type="number"
                    min={1}
                    max={pageCount}
                    inputMode="numeric"
                    aria-label="当前页码"
                    style={{ width: `${Math.max(40, libraryPageInput.length * 8 + 16)}px` }}
                    value={libraryPageInput}
                    onChange={(event) => setLibraryPageInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        jumpToLibraryPage(event.currentTarget.value);
                      }
                    }}
                  />
                  <span className="muted">/ {pageCount} 页</span>
                  {libraryPageInput !== String(libraryPage) ? (
                    <button
                      type="button"
                      className="pager-confirm"
                      onClick={() => jumpToLibraryPage(libraryPageInput)}
                    >
                      确认
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="pager-button"
                  aria-label="下一页"
                  disabled={libraryPage === pageCount}
                  onClick={() => setCurrentLibraryPage(libraryPage + 1)}
                >
                  下一页
                </button>
              </nav>
            </div>
          </div>
        </section> : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          void uploadFiles(
            [...(event.target.files ?? [])],
            uploadFolderRef.current,
          );
          event.target.value = "";
        }}
      />
      {toolbarMenu !== null
        ? (
            <FittedMenuPortal
              x={toolbarMenu.x}
              y={toolbarMenu.y}
              label="更多素材操作"
              className="asset-pop toolbar-pop"
              onClose={() => setToolbarMenu(null)}
            >
              {overflowActions.map((action, index) => (
                <React.Fragment key={action.key}>
                  {index > 0 && overflowActions[index - 1]?.group !== action.group
                    ? <div className="pop-sep" />
                    : null}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={action.disabled}
                    onClick={() => {
                      setToolbarMenu(null);
                      action.run();
                    }}
                  >
                    {action.icon}
                    <span>{action.label}</span>
                  </button>
                </React.Fragment>
              ))}
            </FittedMenuPortal>
          )
        : null}

      {preview !== null ? (
        <ImageLightbox
          items={gallery}
          index={Math.min(preview.index, Math.max(gallery.length - 1, 0))}
          onIndex={(index) => setPreview({ ...preview, index })}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {batchRenaming ? (
        <BatchRenamePop
          items={pickedAssets.map((asset) => ({
            id: keyOf(asset),
            name: nameOf(asset),
            previewUrl: asset.displayUrl,
            previewKind: mediaKind(asset),
          }))}
          onClose={() => setBatchRenaming(false)}
          onApply={(rows) => {
            void (async () => {
              const remote = rows.flatMap((row) => {
                const id = materialIdOf(row.id);
                return id === undefined ? [] : [{ id, name: row.name }];
              });
              if (remote.length > 0) {
                await mutateLibrary({
                  op: "rename",
                  items: remote,
                  ...(remote.length > 1 ? confirmedWrite() : {}),
                });
              }
              for (const row of rows) await run("rename-item", row);
              setBatchRenaming(false);
            })();
          }}
        />
      ) : null}

      {distributing !== null ? (
        <DistributePop
          advertisers={advertisers}
          count={distributing.length}
          onClose={() => setDistributing(null)}
          onApply={(advertiserIds) => {
            void (async () => {
              const ok = await mutateLibrary({
                op: "distribute",
                ids: distributing,
                advertiserIds: advertiserIds.map(String),
                ...confirmedWrite(),
              });
              if (ok) {
                setMessage("分发已提交");
                setStatusRevision((value) => value + 1);
              }
              setDistributing(null);
            })();
          }}
        />
      ) : null}

      {moving !== null ? (
        <MovePop
          folders={folders}
          count={moving.length}
          onClose={() => setMoving(null)}
          onPick={(folderId) => {
            void moveItems(moving, folderId);
            setMoving(null);
          }}
        />
      ) : null}
      {folderMenu !== null ? (
        <FolderMenu
          folder={folderMenu.folder}
          x={folderMenu.x}
          y={folderMenu.y}
          onClose={() => setFolderMenu(null)}
          onCreateChild={() =>
            setDraft({
              kind: "create",
              parentId: folderMenu.folder.id,
              value: "",
            })
          }
          onUpload={() => {
            uploadFolderRef.current = folderMenu.folder.id;
            fileRef.current?.click();
          }}
          onRename={() =>
            setDraft({
              kind: "rename",
              id: folderMenu.folder.id,
              value: folderMenu.folder.name,
            })
          }
          onDelete={() => setDeleteTarget(folderMenu.folder)}
        />
      ) : null}
      {draft !== null ? (
        <FolderEditDialog
          draft={draft}
          onChange={(value) => setDraft({ ...draft, value })}
          onCancel={() => setDraft(null)}
          onSubmit={submitDraft}
        />
      ) : null}
      {deleteTarget !== null ? (
        <FolderDeleteDialog
          folder={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            if (deleteTarget.remote === true) {
              void mutateLibrary({
                op: "delete-folder",
                id: deleteTarget.id,
                ...confirmedWrite(),
              });
            } else {
              void run("delete-folder", { id: deleteTarget.id });
            }
            if (
              view !== null &&
              view !== "__none" &&
              folderSubtreeIds(folders, deleteTarget.id).has(view)
            ) {
              setView(null);
            }
            setDeleteTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

installMaterialsPaneStyles();
const rootEl = document.getElementById("root");
if (rootEl !== null) {
  createRoot(rootEl).render(
    <PaneGuestProvider paneId="materials" fallback={<PaneLoadingSkeleton label="正在连接素材工作台…" />}>
      <MaterialsApp />
    </PaneGuestProvider>,
  );
}
