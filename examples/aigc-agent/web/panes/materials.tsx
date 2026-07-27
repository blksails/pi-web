/**
 * 素材 pane 的 Guest 应用(隔离 iframe 内运行)。
 *
 * UI 与交互复刻独立仓 aigc-agent `components/material-drawer.tsx` 的素材卡(`AssetCell`):
 * 保持比例的缩略图 + 扫光占位→淡入、右键 / ⋯ 动作菜单(预览·复制链接·下载·重命名·移动到目录·
 * 素材分发·删除)、多选 checkbox、可拖拽。按本仓架构重写(不搬 vendor):菜单经 portal 挂 body 并
 * 用 `useFitPos` 夹进视口,数据面 / 控制面走 pane guest 通道而非 Next API。
 *
 * 全通道谱:
 *  - route GET:`guest.query("assets-list")` → 素材列表(数据面,只读 R-0a);
 *  - route GET:`guest.query("material-status")` → 分发状态角标(只读台账;发起/重试是写路径,不授权);
 *  - surface 订阅:`surface:materials` 回流选中集 / 目录树 / 归属 / 改名(权威在 agent,单写者 C1-2);
 *  - surface 命令(**控制面写通道**):select / set-filter / create-folder / rename-folder /
 *    move-folder / delete-folder / move-items / rename-item;
 *  - conversation 直送:`submitUserMessage(text, { attachmentIds })`(「带入对话」/「在画布编辑」——
 *    后者刻意不给本 pane 加 canvas 域授权,经对话让助手调画布工具,见 `editInCanvas` 注释);
 *  - 拖放发端:`text/att-id`(+ `text/uri-list` / `text/plain` 便于外部落点)拖入宿主输入框,
 *    零上传入列为已落库引用(受口见 packages/ui `attachment-dnd`)。
 *
 * sandbox 只给 allow-scripts —— **无 allow-modals**,故不得用 `prompt()`/`confirm()`,
 * 新建/改名走内联输入框,删除走「点两次确认」;也**无 allow-downloads**,故「下载」尽力而为,
 * 被拦时如实提示改用「复制链接」。
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { PaneGuestProvider, usePaneGuest } from "@blksails/pi-web-panes-kit/react";
import { ImageLightbox, type PreviewItem } from "./image-lightbox.js";

interface AssetItem {
  readonly assetId: string;
  readonly attachmentId?: string;
  readonly displayUrl: string;
  readonly createdAt: string;
  readonly meta?: { readonly name?: string } & Record<string, unknown>;
}

interface Folder {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
}

/** 分发状态(只读):shape 与 agent route `material-status` 的返回逐字段对齐。 */
type DistributeStatus = "none" | "pending" | "done" | "failed";

interface MaterialStatus {
  readonly attachmentId: string;
  readonly status: DistributeStatus;
  readonly advertiserCount?: number;
  readonly failureReason?: string;
}

const STATUS_LABEL: Readonly<Record<DistributeStatus, string>> = {
  none: "",
  pending: "分发中",
  done: "已分发",
  failed: "分发失败",
};

interface MaterialsSnapshot {
  readonly selectedIds?: readonly string[];
  readonly folders?: readonly Folder[];
  readonly itemFolder?: Readonly<Record<string, string>>;
  readonly itemName?: Readonly<Record<string, string>>;
}

function unwrapItems(raw: unknown): AssetItem[] {
  const o = (raw ?? {}) as { items?: unknown; data?: unknown };
  const inner = Array.isArray(o.items) ? o.items : ((o.data ?? {}) as { items?: unknown }).items;
  return Array.isArray(inner) ? (inner as AssetItem[]) : [];
}

/** 目录树按 parentId 归层;顺序即创建序(与快照一致,不另排序)。 */
function childrenOf(folders: readonly Folder[], parentId: string | undefined): Folder[] {
  return folders.filter((f) => f.parentId === parentId);
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

/**
 * 素材卡:保持比例(object-contain,不裁切)+ 动作菜单(右键 / ⋯)。可拖拽 + 可多选。
 * 能力缺席的菜单项照源项目呈 disabled + title 说明,不隐藏(用户知道有这功能、为何不可用)。
 */
function AssetCell({
  url,
  name,
  attachmentId,
  selected,
  anySelected,
  status,
  onToggleSelect,
  onPreview,
  onRename,
  onRequestMove,
  onEditInCanvas,
  onDragStart,
  onNotice,
}: {
  readonly url: string;
  readonly name: string;
  /** 无 attachmentId 者不可选 / 不可改名 / 不可归类(尚未落库的展示项)。 */
  readonly attachmentId?: string;
  readonly selected: boolean;
  readonly anySelected: boolean;
  /** 分发状态角标;缺省(平台未接 / 未分发)则不渲染。 */
  readonly status?: MaterialStatus;
  readonly onToggleSelect?: () => void;
  /** 点缩略图 / 菜单「预览」→ 由所属区域开 lightbox(带上下切换)。 */
  readonly onPreview?: () => void;
  readonly onRename?: (next: string) => void;
  readonly onRequestMove?: () => void;
  /** 跨 pane 送画布(零扩权:经对话直送,非直呼 canvas 域)。 */
  readonly onEditInCanvas?: () => void;
  readonly onDragStart: (e: React.DragEvent) => void;
  /** 复制 / 下载失败等一次性提示(隔离面板可能拦截)。 */
  readonly onNotice: (text: string) => void;
}): React.JSX.Element {
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  // 扫光占位 → 图片就绪淡入。
  const [loaded, setLoaded] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [renameVal, setRenameVal] = React.useState(name);
  const fit = useFitPos(menu?.x ?? 0, menu?.y ?? 0);

  const commitRename = (): void => {
    const n = renameVal.trim();
    if (n !== "") onRename?.(n);
    setRenaming(false);
    setMenu(null);
  };

  const copyLink = (): void => {
    setMenu(null);
    void navigator.clipboard
      ?.writeText(url)
      .then(() => onNotice("链接已复制"))
      .catch(() => onNotice("复制被隔离面板拦截,请右键图片另存"));
  };

  /** 角标 / 菜单里的分发说明:有台账则报状态,无台账则说明为何没有。 */
  const distributeTitle =
    status === undefined || status.status === "none"
      ? "尚未分发。发起分发是写路径(会真的对外投放),需平台投放端写接口,本面板只读"
      : status.status === "failed"
        ? `分发失败${status.failureReason !== undefined ? `:${status.failureReason}` : ""}。重试须平台投放端写接口,本面板只读`
        : status.status === "pending"
          ? "分发已提交,平台侧处理中(近 30 分钟内的运行)"
          : `已分发${status.advertiserCount !== undefined ? `到 ${status.advertiserCount} 个广告主` : ""}`;

  const download = (): void => {
    setMenu(null);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = name !== "" ? name : "image";
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      onNotice("隔离面板未授权下载,请用「复制链接」");
    }
  };

  return (
    <div
      className={selected ? "asset sel" : "asset"}
      title={name}
      draggable={attachmentId !== undefined}
      onDragStart={onDragStart}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {!loaded ? <span className="asset-shimmer" aria-hidden /> : null}
      <img
        className={loaded ? "asset-img loaded" : "asset-img"}
        src={url}
        alt=""
        draggable={false}
        loading="lazy"
        decoding="async"
        title={onPreview !== undefined ? "点击查看完整图" : undefined}
        onClick={() => (onPreview !== undefined ? onPreview() : onToggleSelect?.())}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
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
          {selected ? "✓" : ""}
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
        ⋯
      </button>
      {status !== undefined && status.status !== "none" ? (
        <span className={`asset-badge ${status.status}`} title={distributeTitle}>
          {STATUS_LABEL[status.status]}
        </span>
      ) : null}
      <span className="asset-name">{name}</span>
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
                ) : (
                  <button type="button" disabled title="尚未落库的素材不可改名">
                    重命名…
                  </button>
                )}
                {renaming && onRename !== undefined ? (
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
                    title="经对话把这张图交给助手放上画布(素材域不直呼画布域,操作留痕对话历史)"
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
                {/* 分发只读:显示台账状态,不提供发起/重试(写路径未接,亦未授权)。 */}
                <button type="button" disabled title={distributeTitle}>
                  {status === undefined || status.status === "none"
                    ? "素材分发:未分发"
                    : `素材分发:${STATUS_LABEL[status.status]}`}
                </button>
                <button type="button" disabled title="素材本体权威在平台数据面,本面板不可删">
                  删除
                </button>
              </div>
            </>,
            document.body,
          )
        : null}
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
            folders.map((f) => (
              <button key={f.id} type="button" className="dlg-row" onClick={() => onPick(f.id)}>
                {f.name}
              </button>
            ))
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

export function MaterialsApp(): React.JSX.Element {
  const guest = usePaneGuest();
  const [items, setItems] = React.useState<AssetItem[]>([]);
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set());
  const [folders, setFolders] = React.useState<readonly Folder[]>([]);
  const [itemFolder, setItemFolder] = React.useState<Readonly<Record<string, string>>>({});
  const [itemName, setItemName] = React.useState<Readonly<Record<string, string>>>({});
  const [phase, setPhase] = React.useState<"busy" | "done" | "error">("busy");
  const [message, setMessage] = React.useState("");
  /** 视图态(不入快照):当前浏览的目录、内联输入、删除确认、移动弹窗目标。 */
  const [view, setView] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<{ kind: "create" | "rename"; id?: string; value: string } | null>(null);
  const [confirmDel, setConfirmDel] = React.useState<string | null>(null);
  const [moving, setMoving] = React.useState<readonly string[] | null>(null);
  /** 预览灯箱:以当前可见列表为图库(左右切换),起始 index 为点中的那张。 */
  const [preview, setPreview] = React.useState<number | null>(null);
  /** 分发状态(只读台账,按 attachmentId 索引);平台未接时恒空 → 不显角标。 */
  const [status, setStatus] = React.useState<Readonly<Record<string, MaterialStatus>>>({});
  /**
   * 刚上传的素材(乐观入列)。数据面 `assets-list` 的权威来自平台后端;后端未接时它恒回
   * `{ error:"platform_unavailable", items: [] }`,故上传结果先在本地可见,后端接上后
   * 由 route 返回的真实列表覆盖(按 attachmentId 去重)。
   */
  const [uploaded, setUploaded] = React.useState<readonly AssetItem[]>([]);
  const [busyUp, setBusyUp] = React.useState(false);
  /** 拖入上传的高亮态。 */
  const [dropping, setDropping] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async (): Promise<void> => {
    setPhase("busy");
    try {
      setItems(unwrapItems(await guest.query("assets-list", { kind: "image", limit: "200" })));
      setPhase("done");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [guest]);
  React.useEffect(() => {
    void load();
  }, [load]);

  // 权威态回流(选中 / 目录树 / 归属 / 改名)——UI 只发命令,不直写。
  React.useEffect(
    () =>
      guest.surface.subscribe("surface:materials", (v) => {
        const s = (v ?? {}) as MaterialsSnapshot;
        if (Array.isArray(s.selectedIds)) {
          setPicked(new Set(s.selectedIds.filter((x): x is string => typeof x === "string")));
        }
        if (Array.isArray(s.folders)) setFolders(s.folders);
        if (s.itemFolder !== undefined && s.itemFolder !== null) setItemFolder(s.itemFolder);
        if (s.itemName !== undefined && s.itemName !== null) setItemName(s.itemName);
      }),
    [guest],
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
    async (files: readonly File[]): Promise<void> => {
      if (files.length === 0) return;
      setBusyUp(true);
      const added: AssetItem[] = [];
      try {
        for (const file of files) {
          const r = await guest.upload(file);
          added.push({
            assetId: r.attachmentId,
            attachmentId: r.attachmentId,
            displayUrl: r.displayUrl,
            createdAt: "",
            meta: { name: file.name },
          });
        }
        if (added.length > 0) {
          setUploaded((prev) => [...added, ...prev]);
          if (view !== null && view !== "__none") {
            await run("move-items", { ids: added.map((a) => a.attachmentId as string), folderId: view });
          }
        }
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyUp(false);
      }
    },
    [guest, run, view],
  );

  // 乐观项在前;route 返回同一 attachmentId 时以 route 为准(权威在数据面)。
  const seen = new Set(items.map((a) => a.attachmentId).filter((x): x is string => typeof x === "string"));
  const merged = [...uploaded.filter((a) => a.attachmentId === undefined || !seen.has(a.attachmentId)), ...items];

  /**
   * 分发状态(只读增强):列表变了就整批重查。route 在平台未接时降级为空,
   * 查询失败也**静默**——角标缺席不影响素材面板任何主功能,不该弹错扰人。
   */
  const statusKey = merged
    .map((a) => a.attachmentId)
    .filter((x): x is string => typeof x === "string")
    .join(",");
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
        const list = (raw ?? {}) as { items?: unknown };
        const items2 = Array.isArray(list.items) ? (list.items as MaterialStatus[]) : [];
        setStatus(
          Object.fromEntries(
            items2
              .filter((r) => typeof r?.attachmentId === "string")
              .map((r) => [r.attachmentId, r] as const),
          ),
        );
      })
      .catch(() => {
        if (alive) setStatus({});
      });
    return () => {
      alive = false;
    };
  }, [guest, statusKey]);

  // 当前目录过滤:null=全部;"__none"=未分类。
  const visible = merged.filter((a) => {
    if (view === null) return true;
    const id = a.attachmentId;
    if (id === undefined) return view === "__none";
    const owner = itemFolder[id];
    return view === "__none" ? owner === undefined : owner === view;
  });
  const selectable = visible.filter((a) => typeof a.attachmentId === "string");
  const allPicked = selectable.length > 0 && selectable.every((a) => picked.has(a.attachmentId as string));

  /** 显示名:热态覆盖名(改过名的)优先,否则数据面原名,再否则 assetId。 */
  const nameOf = (a: AssetItem): string =>
    (a.attachmentId !== undefined ? itemName[a.attachmentId] : undefined) ??
    a.meta?.name ??
    a.assetId;

  /** 预览图库 = 当前可见列表(与网格同序,故 index 可直接复用)。 */
  const gallery: readonly PreviewItem[] = visible.map((a) => ({
    url: a.displayUrl,
    name: nameOf(a),
  }));

  const bring = async (): Promise<void> => {
    const refs = [...picked];
    if (refs.length === 0) return;
    await guest.submitUserMessage(`带入对话(共 ${refs.length} 项制品)`, { attachmentIds: refs });
    applyPicked(new Set());
  };

  /**
   * 跨 pane「在画布编辑」——**零扩权**路径。
   *
   * 素材 pane 不加 canvas 域授权(见 web/panes/index.ts 的 capabilities),而是走本已授权的
   * conversation 直送:助手收到消息后自己调画布工具。这是本仓画布 pane 的既定范式
   * ——「操作天然回流对话历史」,故动作可审计、可回溯;代价是过一次 LLM(有延迟、非确定)。
   *
   * 反过来说,直呼 canvas 域会把「素材域被攻破」升级为「画布也被改」:素材面板渲染的是
   * 外部 CDN 来的图 URL,是三 pane 里攻击面最大的一个,不值得为省一次 LLM 往返而扩横向权限。
   */
  const editInCanvas = async (ids: readonly string[], label: string): Promise<void> => {
    if (ids.length === 0) return;
    try {
      await guest.submitUserMessage(`把${label}放到画布上,我要编辑`, { attachmentIds: [...ids] });
      setMessage("已送入对话,助手会把它放上画布");
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
      void run("create-folder", { name, ...(view !== null && view !== "__none" ? { parentId: view } : {}) });
    } else if (draft.id !== undefined) {
      void run("rename-folder", { id: draft.id, name });
    }
    setDraft(null);
  };

  /** 拖放发端:多选时整批带走(受口按空白切分);单项另附 uri/名便于外部落点。 */
  const onDragStart = (e: React.DragEvent, asset: AssetItem): void => {
    const id = asset.attachmentId;
    if (id === undefined) return;
    const ids = picked.has(id) ? [...picked] : [id];
    e.dataTransfer.setData("text/att-id", ids.join(" "));
    if (ids.length === 1) {
      e.dataTransfer.setData("text/uri-list", asset.displayUrl);
      e.dataTransfer.setData("text/plain", nameOf(asset));
    }
    e.dataTransfer.effectAllowed = "copy";
  };

  const renderTree = (parentId: string | undefined, depth: number): React.JSX.Element[] =>
    childrenOf(folders, parentId).flatMap((f) => [
      <div key={f.id} className={view === f.id ? "tree-row on" : "tree-row"} style={{ paddingLeft: 8 + depth * 12 }}>
        {draft?.kind === "rename" && draft.id === f.id ? (
          <input
            className="grow"
            autoFocus
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitDraft();
              if (e.key === "Escape") setDraft(null);
            }}
            onBlur={submitDraft}
          />
        ) : (
          <>
            <button type="button" className="tree-name" onClick={() => setView(f.id)} title={f.name}>
              {f.name}
            </button>
            <button type="button" className="tree-act" title="改名" onClick={() => setDraft({ kind: "rename", id: f.id, value: f.name })}>
              ✎
            </button>
            <button
              type="button"
              className={confirmDel === f.id ? "tree-act danger" : "tree-act"}
              title={confirmDel === f.id ? "再点一次删除(含子目录)" : "删除"}
              onClick={() => {
                if (confirmDel === f.id) {
                  void run("delete-folder", { id: f.id });
                  setConfirmDel(null);
                  if (view === f.id) setView(null);
                } else setConfirmDel(f.id);
              }}
            >
              {confirmDel === f.id ? "确认?" : "✕"}
            </button>
          </>
        )}
      </div>,
      ...renderTree(f.id, depth + 1),
    ]);

  return (
    <div className="pane-layout">
      <div className="toolbar">
        <span className="muted grow">{picked.size > 0 ? `已选 ${picked.size}` : `${visible.length} 个素材`}</span>
        {picked.size > 0 ? (
          <>
            <button type="button" className="button" onClick={() => setMoving([...picked])}>
              移动到目录…
            </button>
            <button
              type="button"
              className="button"
              title="经对话交给助手放上画布(素材域不直呼画布域)"
              onClick={() => void editInCanvas([...picked], `这 ${picked.size} 张素材`)}
            >
              在画布编辑
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="button"
          onClick={() => applyPicked(allPicked ? new Set() : new Set(selectable.map((a) => a.attachmentId as string)))}
        >
          {allPicked ? "清空" : "全选"}
        </button>
        <button type="button" className="button button-primary" disabled={picked.size === 0} onClick={() => void bring()}>
          带入对话
        </button>
        <button type="button" className="button" onClick={() => fileRef.current?.click()} disabled={busyUp}>
          {busyUp ? "上传中…" : "上传"}
        </button>
        <button type="button" className="button" onClick={() => void load()} disabled={phase === "busy"}>
          刷新
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void uploadFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      {message !== "" ? (
        <div className="notice" onClick={() => setMessage("")} title="点击关闭">
          {message}
        </div>
      ) : null}

      <div className="split">
        <aside className="side scroll">
          <div className={view === null ? "tree-row on" : "tree-row"}>
            <button type="button" className="tree-name" onClick={() => setView(null)}>
              全部素材
            </button>
          </div>
          <div className={view === "__none" ? "tree-row on" : "tree-row"}>
            <button type="button" className="tree-name" onClick={() => setView("__none")}>
              未分类
            </button>
          </div>
          {renderTree(undefined, 0)}
          {draft?.kind === "create" ? (
            <div className="tree-row">
              <input
                className="grow"
                autoFocus
                placeholder="目录名"
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitDraft();
                  if (e.key === "Escape") setDraft(null);
                }}
                onBlur={submitDraft}
              />
            </div>
          ) : (
            <button type="button" className="tree-add" onClick={() => setDraft({ kind: "create", value: "" })}>
              ＋ 新建目录{view !== null && view !== "__none" ? "(在当前目录下)" : ""}
            </button>
          )}
        </aside>

        <div
          className={dropping ? "content scroll grow dropping" : "content scroll grow"}
          style={{ minHeight: 0 }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDropping(true);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
          }}
          onDrop={(e) => {
            setDropping(false);
            const files = [...e.dataTransfer.files];
            if (files.length === 0) return;
            e.preventDefault();
            void uploadFiles(files);
          }}
        >
          {phase === "busy" ? <div className="empty">加载中…</div> : null}
          {phase === "error" ? <div className="empty error">{message}</div> : null}
          {phase === "done" && visible.length === 0 ? (
            <div className="empty">此处暂无素材(可把图片拖进来上传)</div>
          ) : null}
          <div className="grid">
            {visible.map((a, i) => {
              const id = a.attachmentId;
              return (
                <AssetCell
                  key={a.assetId}
                  onPreview={() => setPreview(i)}
                  url={a.displayUrl}
                  name={nameOf(a)}
                  {...(id !== undefined ? { attachmentId: id } : {})}
                  selected={id !== undefined && picked.has(id)}
                  anySelected={picked.size > 0}
                  {...(id !== undefined && status[id] !== undefined ? { status: status[id] } : {})}
                  {...(id !== undefined ? { onToggleSelect: () => toggle(id) } : {})}
                  {...(id !== undefined
                    ? { onEditInCanvas: () => void editInCanvas([id], `素材「${nameOf(a)}」`) }
                    : {})}
                  {...(id !== undefined
                    ? { onRename: (next: string) => void run("rename-item", { id, name: next }) }
                    : {})}
                  {...(id !== undefined ? { onRequestMove: () => setMoving([id]) } : {})}
                  onDragStart={(e) => onDragStart(e, a)}
                  onNotice={setMessage}
                />
              );
            })}
          </div>
        </div>
      </div>

      {preview !== null ? (
        <ImageLightbox
          items={gallery}
          index={Math.min(preview, Math.max(gallery.length - 1, 0))}
          onIndex={setPreview}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {moving !== null ? (
        <MovePop
          folders={folders}
          count={moving.length}
          onClose={() => setMoving(null)}
          onPick={(folderId) => {
            void run("move-items", { ids: [...moving], folderId });
            setMoving(null);
          }}
        />
      ) : null}
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl !== null) {
  createRoot(rootEl).render(
    <PaneGuestProvider paneId="materials" fallback={<main className="center muted">正在连接会话…</main>}>
      <MaterialsApp />
    </PaneGuestProvider>,
  );
}
