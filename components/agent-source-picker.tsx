"use client";

import * as React from "react";
import type {
  AgentSourceItem,
  ListAgentSourcesRequest,
  ListAgentSourcesResponse,
} from "@blksails/pi-web-protocol";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  useI18n,
} from "@blksails/pi-web-ui";

/**
 * AgentSourcePicker — agent source input + submit,可选叠加"可浏览的源列表"。
 *
 * Accepts any `source` shape supported by agent-source-resolver (a local
 * directory path or a git source). Offers a "use default source" option when a
 * default is configured. Shows a loading indicator while a session is being
 * created and a recognizable error (with re-pick) on failure (Req 1.5 / 4.1 /
 * 4.4 / 4.5). It produces only a `source` string and a submit intent — it does
 * not create the session itself.
 *
 * agent-sources-list:当 `enableSourceList` 开启且注入 `listAgentSources` 时,在手输框
 * 之上展示一个只读的可选源列表(GET /agent-sources)。点击某项等价于把其 `source` 交给
 * `onSubmit`(与手输等价字符串再提交完全一致,Req 5.1/5.2)。列表加载失败或为空都不阻断
 * 手输框(Req 5.3/5.4);会话创建中(`loading`)禁用列表点击(Req 5.5)。
 */
export interface AgentSourcePickerProps {
  /** Called with the chosen source string (empty string ⇒ use default). */
  readonly onSubmit: (source: string) => void;
  /** Configured default source, if any. */
  readonly defaultSource?: string | undefined;
  /** True while a session is being created. */
  readonly loading?: boolean;
  /** Recognizable error message from a failed session creation. */
  readonly error?: string | undefined;
  /**
   * 只读源列表数据源(注入 PiClient.listAgentSources)。未注入 ⇒ 不显示列表。
   */
  readonly listAgentSources?: (
    req: ListAgentSourcesRequest,
  ) => Promise<ListAgentSourcesResponse>;
  /** 门控:是否启用源列表入口。未启用或未注入数据源 ⇒ 仅显示手输框(Req 6.4)。 */
  readonly enableSourceList?: boolean;
  /**
   * 刷新信号(spec install-host-command,任务 4.2):变更时重拉源列表(免刷新反映 `/install`
   * 装/卸 agent 源后的最新结果)。可选,未注入 ⇒ 行为不变(仅 enabled 变化时加载一次)。
   */
  readonly refreshSignal?: number;
  /**
   * sidebar-launcher-rail:已收藏的 source 集合(用于星标高亮)。未注入 ⇒ 不显示星标
   * (向后兼容 agent-sources-list)。
   */
  readonly favoriteSources?: ReadonlySet<string>;
  /** 收藏/取消收藏某源(切换)。未注入 ⇒ 不显示星标。 */
  readonly onToggleFavorite?: (item: AgentSourceItem) => void;
  /**
   * 展示形态(sidebar-launcher-rail:悬浮对话框):
   * - `"page"`(默认):整页居中(初始启动屏)。
   * - `"dialog"`:悬浮遮罩层 + 居中卡片 + 关闭按钮,可在会话进行中调出。
   */
  readonly variant?: "page" | "dialog";
  /** 关闭对话框(仅 `variant="dialog"`;点关闭/遮罩/Esc 触发)。 */
  readonly onClose?: () => void;
  /** 对话框标题(仅 dialog)。 */
  readonly dialogTitle?: string;
  /**
   * desktop-directory-picker:桌面壳注入的原生「选择文件夹」能力。注入时在来源框旁展示
   * 「浏览文件夹」入口;返回被选目录绝对路径(取消/失败返回 undefined)。未注入(浏览器态)
   * ⇒ 不展示入口(Req 1.1/1.2/1.3)。
   */
  readonly onBrowseDirectory?: () => Promise<string | undefined>;
}

type ListStatus = "idle" | "loading" | "error";

/** 源列表子视图状态。竞态守卫用 reqId ref 丢弃过期响应。 */
function useAgentSourceList(
  enabled: boolean,
  listAgentSources:
    | ((req: ListAgentSourcesRequest) => Promise<ListAgentSourcesResponse>)
    | undefined,
  refreshSignal?: number,
): { status: ListStatus; items: readonly AgentSourceItem[] } {
  const [status, setStatus] = React.useState<ListStatus>("idle");
  const [items, setItems] = React.useState<readonly AgentSourceItem[]>([]);
  const reqIdRef = React.useRef(0);

  React.useEffect(() => {
    if (!enabled || listAgentSources === undefined) {
      setStatus("idle");
      setItems([]);
      return;
    }
    const myId = reqIdRef.current + 1;
    reqIdRef.current = myId;
    setStatus("loading");
    void listAgentSources({})
      .then((res) => {
        if (reqIdRef.current !== myId) return; // 过期响应丢弃
        setItems(res.sources);
        setStatus("idle");
      })
      .catch(() => {
        if (reqIdRef.current !== myId) return;
        setStatus("error");
      });
    // refreshSignal 变化(如 /install 装/卸 agent 源成功)→ 重拉,免刷新可见最新结果。
  }, [enabled, listAgentSources, refreshSignal]);

  return { status, items };
}

/** avatar 是否为可直接渲染的图片地址(URL / data-URI)。 */
function isImageAvatar(avatar: string): boolean {
  return (
    avatar.startsWith("http://") ||
    avatar.startsWith("https://") ||
    avatar.startsWith("data:")
  );
}

/** 源头像:图片地址→<img>;短文本/emoji→文字;缺省→标题/名称首字母。 */
function SourceAvatar({
  item,
}: {
  readonly item: AgentSourceItem;
}): React.JSX.Element {
  const label = item.title ?? item.name;
  const base =
    "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[hsl(var(--muted))] text-sm font-medium text-[hsl(var(--muted-foreground))]";
  if (item.avatar !== undefined && isImageAvatar(item.avatar)) {
    return (
      <img
        src={item.avatar}
        alt=""
        data-agent-source-avatar
        className="h-9 w-9 shrink-0 rounded-md object-cover"
      />
    );
  }
  const glyph =
    item.avatar !== undefined && item.avatar.length > 0
      ? item.avatar
      : (label.trim()[0] ?? "?").toUpperCase();
  return (
    <span data-agent-source-avatar className={base} aria-hidden>
      {glyph}
    </span>
  );
}

export function AgentSourcePicker({
  onSubmit,
  defaultSource,
  loading = false,
  error,
  listAgentSources,
  enableSourceList = false,
  refreshSignal,
  favoriteSources,
  onToggleFavorite,
  variant = "page",
  onClose,
  dialogTitle: dialogTitleProp,
  onBrowseDirectory,
}: AgentSourcePickerProps): React.JSX.Element {
  const t = useI18n();
  const dialogTitle = dialogTitleProp ?? t("agentSourcePicker.dialogTitle");
  const [value, setValue] = React.useState<string>(defaultSource ?? "");
  // desktop-directory-picker:仅在等待原生对话框期间禁用「浏览」按钮自身(防重入),
  // 不禁用手输框/源列表(Req 5.2)。
  const [browsing, setBrowsing] = React.useState(false);
  const showBrowse = onBrowseDirectory !== undefined;
  const showList = enableSourceList && listAgentSources !== undefined;
  const showFavToggle = onToggleFavorite !== undefined;
  const isDialog = variant === "dialog";
  const { status, items } = useAgentSourceList(
    showList,
    listAgentSources,
    refreshSignal,
  );
  // 默认只展示前 COLLAPSE_LIMIT 个源卡片,其余折叠在「显示全部」之后。
  const COLLAPSE_LIMIT = 9;
  const [expanded, setExpanded] = React.useState(false);
  const hasMore = items.length > COLLAPSE_LIMIT;
  const visibleItems =
    expanded || !hasMore ? items : items.slice(0, COLLAPSE_LIMIT);

  const submit = (source: string): void => {
    if (loading) return;
    onSubmit(source);
  };

  const onFormSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    submit(value.trim());
  };

  // desktop-directory-picker:触发桌面壳原生「选择文件夹」对话框;选中→回填来源框(不提交,
  // Req 2.3);取消/失败→保持原值(Req 2.5/5.1)。防重入 + finally 清标志避免卡死禁用(Req 5.2)。
  const onBrowse = async (): Promise<void> => {
    if (onBrowseDirectory === undefined || loading || browsing) return;
    setBrowsing(true);
    try {
      const picked = await onBrowseDirectory();
      if (typeof picked === "string" && picked.length > 0) setValue(picked);
    } catch {
      // 失败即取消语义:保持来源框原值,不建会话,不改其它入口可用性。
    } finally {
      setBrowsing(false);
    }
  };

  // 宽屏容器:源列表以卡片网格铺开;无列表(仅手输)时收窄更聚焦。
  const innerWidth = showList ? "max-w-4xl" : "max-w-lg";
  const inner = (
    <div className={`flex w-full ${innerWidth} flex-col gap-4`}>
        {showList ? (
          <section
            data-agent-source-list
            className="flex flex-col gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-[hsl(var(--card-foreground))] shadow-sm"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <span>{t("agentSourcePicker.listTitle")}</span>
              {status === "idle" && items.length > 0 ? (
                <span className="rounded-full bg-[hsl(var(--muted))] px-1.5 text-[10px] font-normal text-[hsl(var(--muted-foreground))]">
                  {items.length}
                </span>
              ) : null}
            </h2>

            {status === "loading" ? (
              <p
                data-agent-source-list-loading
                className="text-sm text-[hsl(var(--muted-foreground))]"
              >
                {t("agentSourcePicker.listLoading")}
              </p>
            ) : status === "error" ? (
              <p
                role="alert"
                data-agent-source-list-error
                className="text-sm text-[hsl(var(--destructive))]"
              >
                {t("agentSourcePicker.listError")}
              </p>
            ) : items.length === 0 ? (
              <p
                data-agent-source-list-empty
                className="text-sm text-[hsl(var(--muted-foreground))]"
              >
                {t("agentSourcePicker.listEmpty")}
              </p>
            ) : (
              // 宽屏卡片网格:窄屏 1 列,渐进到 2/3 列;默认只展示前 9 个,其余折叠。
              <ul className="grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                {visibleItems.map((item) => {
                  const isFav = favoriteSources?.has(item.source) ?? false;
                  return (
                    <li key={item.id} className="relative">
                      <button
                        type="button"
                        disabled={loading}
                        data-agent-source-item
                        data-source={item.source}
                        onClick={() => submit(item.source)}
                        className="flex h-full w-full flex-col gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-left transition-colors hover:border-[hsl(var(--ring))] hover:bg-[hsl(var(--accent))] disabled:opacity-50"
                      >
                        <span className="flex items-center gap-2">
                          <SourceAvatar item={item} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span
                              data-agent-source-title
                              className="truncate pr-6 text-sm font-medium"
                            >
                              {item.title ?? item.name}
                            </span>
                            <span className="mt-0.5 w-fit rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[10px] uppercase text-[hsl(var(--muted-foreground))]">
                              {item.mode}
                            </span>
                          </span>
                        </span>
                        {item.description !== undefined ? (
                          <span className="line-clamp-3 text-xs text-[hsl(var(--muted-foreground))]">
                            {item.description}
                          </span>
                        ) : null}
                      </button>
                      {showFavToggle ? (
                        <button
                          type="button"
                          data-agent-source-favorite-toggle
                          data-source={item.source}
                          data-favorited={isFav ? "true" : "false"}
                          aria-label={
                            isFav
                              ? t("agentSourcePicker.unfavorite", { name: item.name })
                              : t("agentSourcePicker.favorite", { name: item.name })
                          }
                          aria-pressed={isFav}
                          onClick={() => onToggleFavorite?.(item)}
                          className={`absolute right-2 top-2 rounded p-0.5 text-base leading-none ${isFav ? "text-yellow-500" : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"}`}
                        >
                          {isFav ? "★" : "☆"}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* 超过 9 个时:显示全部 / 收起。 */}
            {status === "idle" && hasMore ? (
              <button
                type="button"
                data-agent-source-list-more
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 self-start rounded-md px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
              >
                {expanded
                  ? t("agentSourcePicker.collapse")
                  : t("agentSourcePicker.showAll", {
                      total: items.length,
                      more: items.length - COLLAPSE_LIMIT,
                    })}
              </button>
            ) : null}
          </section>
        ) : null}

        <form
          onSubmit={onFormSubmit}
          className="flex w-full flex-col gap-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-[hsl(var(--card-foreground))] shadow-sm"
        >
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">
              {t("agentSourcePicker.formTitle")}
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {t("agentSourcePicker.hintBefore")}
              <code>index.ts</code>
              {t("agentSourcePicker.hintAfter")}
            </p>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              {t("agentSourcePicker.sourceLabel")}
            </span>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("agentSourcePicker.inputPlaceholder")}
              disabled={loading}
              data-agent-source-input
              className="rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
            />
          </label>

          {/* desktop-directory-picker:桌面壳态展示原生「浏览文件夹」入口(浏览器态不渲染)。 */}
          {showBrowse ? (
            <button
              type="button"
              disabled={loading || browsing}
              data-agent-source-browse
              onClick={() => void onBrowse()}
              className="inline-flex w-fit items-center justify-center rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {t("agentSourcePicker.browseDirectory")}
            </button>
          ) : null}

          {error !== undefined ? (
            <p
              role="alert"
              data-agent-source-error
              className="rounded-md border border-[hsl(var(--destructive))] bg-[hsl(var(--destructive))]/10 px-3 py-2 text-sm text-[hsl(var(--destructive))]"
            >
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={loading}
              data-agent-source-submit
              className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
            >
              {loading
                ? t("agentSourcePicker.creating")
                : t("agentSourcePicker.startSession")}
            </button>

            {defaultSource !== undefined ? (
              <button
                type="button"
                disabled={loading}
                data-agent-source-default
                onClick={() => submit("")}
                className="inline-flex items-center justify-center rounded-md border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {t("agentSourcePicker.useDefault")}
              </button>
            ) : null}
          </div>

          {loading ? (
            <p
              data-agent-source-loading
              className="text-sm text-[hsl(var(--muted-foreground))]"
            >
              {t("agentSourcePicker.resolving")}
            </p>
          ) : null}
        </form>
    </div>
  );

  // 悬浮对话框:shadcn/Radix Dialog(遮罩点击 / Esc / 焦点捕获 / 内置关闭 X 由 Radix 提供)。
  // 受控:open 恒真,任一关闭路径经 onOpenChange(false) 汇聚到 onClose。
  if (isDialog) {
    return (
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose?.();
        }}
      >
        <DialogContent
          data-agent-source-picker
          data-agent-source-dialog
          className="max-h-[85vh] w-[92vw] max-w-4xl gap-2 overflow-auto border-0 bg-transparent p-0 shadow-none"
        >
          {/* inner 自带可见的卡片与标题;此处提供无障碍所需的对话框标题(视觉隐藏)。 */}
          <DialogHeader className="sr-only">
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          {inner}
        </DialogContent>
      </Dialog>
    );
  }

  // 整页(初始启动屏)。
  return (
    <div
      className="flex h-full w-full items-center justify-center p-6"
      data-agent-source-picker
    >
      {inner}
    </div>
  );
}
