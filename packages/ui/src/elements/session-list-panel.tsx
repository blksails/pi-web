/**
 * SessionListPanel — 会话列表面板(sessions-list + session-list-item-actions)。
 *
 * 展示历史会话并触发恢复。两类视图经 Tab 切换:「当前目录」(scope=cwd)与「全部」
 * (scope=all,系统/全机器);「全部」入口仅在 `globalEnabled` 时出现(Req 2.2/6.1)。
 * 列表项仅展示头部轻量元数据(名称/标识、时间、所属目录,Req 3.1);不持 pi 接线——
 * 数据经注入的 `listSessions` 函数获取(Req 3.2)。每项整行可点击,直接重新载入该会话:
 * 点击经 `onResume` 回调上抛(Req 4.1),由宿主导航到 /session/:id 冷恢复并回溯 agent source。
 * 三态可见:加载中 / 空态 / 可重试错误(Req 6.2/1.3/6.3);分页经「加载更多」续取
 * (Req 3.3/3.4)。data-* 属性供 e2e 与宿主定位。
 *
 * 项级管理(session-list-item-actions):每项右侧 `⋯` 操作菜单(仅 `manageEnabled` 时渲染写入口,
 * Req 6.1),提供删除(二次确认+乐观移除)/ 重命名(内联编辑+乐观改名)/ 收藏切换。已收藏且属于
 * 当前视图的会话在顶部「收藏」分区置顶、不与普通列表重复(Req 4.3/4.4);写失败展示可见错误并回滚
 * 乐观更新(Req 2.7/3.6/4.8);在途禁用重复触发(Req 5.2);沿用竞态守卫(Req 5.3)。
 */
import * as React from "react";
import type {
  ListSessionsRequest,
  ListSessionsResponse,
  SessionListItem,
} from "@blksails/pi-web-protocol";
import { Button } from "../ui/button.js";
import { cn } from "../lib/cn.js";
import { SessionItemMenu, SessionRenameField } from "./session-item-menu.js";

export interface SessionListPanelProps {
  /** 当前活跃会话标识;在场时「当前目录」视图以其持久化 cwd 为准(优先于 currentCwd)。 */
  readonly currentSessionId?: string;
  /** 当前工作目录(scope=cwd 视图的回退目标,sessionId 不可用时使用)。 */
  readonly currentCwd: string;
  /** 系统(全机器)视图是否启用;false 时隐藏「全部」Tab(Req 2.2)。 */
  readonly globalEnabled: boolean;
  /** 注入的列表数据源(经 PiClient.listSessions);保持本组件不持 pi 接线。 */
  readonly listSessions: (
    req: ListSessionsRequest,
  ) => Promise<ListSessionsResponse>;
  /** 触发恢复某会话(由宿主走 resumeId 链路,Req 4.1)。 */
  readonly onResume: (sessionId: string) => void;
  /**
   * 外部刷新信号:值变化时重拉**当前 scope** 首页(保留用户所在 Tab,沿用竞态守卫)。
   * 面板自身只在 scope/数据源变化时加载,无法感知「新会话落库」「自动标题(auto_title)持久化」
   * 等发生在加载之后的服务端变更;宿主在「一轮 agent 运行结束」等时机 bump 此值,使列表及时刷新。
   */
  readonly refreshSignal?: unknown;
  /** 单页上限(透传给端点;缺省由端点取默认)。 */
  readonly pageSize?: number;
  /**
   * 乐观占位(new-session placeholder):新建会话尚未落库、未进列表数据时,由宿主传入其 id,
   * 面板立即在顶部渲染一个占位行(更符合人类预期:一发起就看到条目)。当真实数据(refreshSignal
   * 重拉)已含该 id 时,占位按 id 去重、自动让位给真实项。仅新建会话传入(resume 分支不传)。
   */
  readonly pendingSession?: { readonly sessionId: string; readonly title?: string };
  readonly className?: string;

  // ── 项级管理(session-list-item-actions,均可选;缺省时退化为纯只读列表)──
  /** 写操作(删除/重命名/收藏)是否启用;false 时不渲染写入口(Req 6.1)。 */
  readonly manageEnabled?: boolean;
  /** 已收藏的会话标识集合(宿主权威);属于当前视图者置顶到「收藏」分区(Req 4.3/4.6)。 */
  readonly favoriteSessionIds?: readonly string[];
  /** 删除会话(宿主执行物理删除+导航/刷新);resolve=成功、reject=失败。 */
  readonly onDeleteSession?: (sessionId: string) => void | Promise<void>;
  /** 重命名会话(宿主执行写入+刷新);resolve=成功、reject=失败。 */
  readonly onRenameSession?: (
    sessionId: string,
    name: string,
  ) => void | Promise<void>;
  /** 切换收藏(favorite=目标态;宿主读→算→写并更新 favoriteSessionIds)。 */
  readonly onToggleFavorite?: (
    sessionId: string,
    favorite: boolean,
  ) => void | Promise<void>;

  // 文案(默认中文)。
  readonly title?: string;
  readonly cwdTabLabel?: string;
  readonly allTabLabel?: string;
  readonly loadingLabel?: string;
  readonly emptyLabel?: string;
  readonly errorLabel?: string;
  readonly retryLabel?: string;
  readonly loadMoreLabel?: string;
  /** 占位行标题文案(无标题的新建会话),默认「新会话」。 */
  readonly pendingSessionLabel?: string;
  /** 收藏分区标题,默认「收藏」。 */
  readonly favoritesSectionLabel?: string;
  /** 管理操作失败提示,默认「操作失败」。 */
  readonly actionErrorLabel?: string;
}

type Status = "idle" | "loading" | "error";
type Scope = "cwd" | "all";

/** 列表项展示时间:最近更新优先,回退创建;非法时间退化为原串。 */
function formatTime(item: SessionListItem): string {
  const ts = item.updatedAt ?? item.createdAt;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export function SessionListPanel(
  props: SessionListPanelProps,
): React.ReactElement {
  const {
    currentSessionId,
    currentCwd,
    globalEnabled,
    listSessions,
    onResume,
    refreshSignal,
    pageSize,
    pendingSession,
    className,
    manageEnabled = false,
    favoriteSessionIds,
    onDeleteSession,
    onRenameSession,
    onToggleFavorite,
    title = "会话历史",
    cwdTabLabel = "当前目录",
    allTabLabel = "全部",
    loadingLabel = "加载中…",
    emptyLabel = "暂无会话",
    errorLabel = "加载失败",
    retryLabel = "重试",
    loadMoreLabel = "加载更多",
    pendingSessionLabel = "新会话",
    favoritesSectionLabel = "收藏",
    actionErrorLabel = "操作失败",
  } = props;

  const [scope, setScope] = React.useState<Scope>("cwd");
  const [items, setItems] = React.useState<ReadonlyArray<SessionListItem>>([]);
  const [nextCursor, setNextCursor] = React.useState<string | undefined>(
    undefined,
  );
  const [status, setStatus] = React.useState<Status>("loading");

  // 项级管理瞬态。
  const [editingId, setEditingId] = React.useState<string | undefined>(undefined);
  const [busyIds, setBusyIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // 在途 id 的同步集合:runAction 据此拒绝对同一项的重入(避免快速重复触发发起冲突请求,Req 5.2)。
  const inFlightRef = React.useRef<Set<string>>(new Set());
  const [actionError, setActionError] = React.useState<string | undefined>(
    undefined,
  );

  // 竞态守卫:仅最新一次请求可写状态(切 Tab/快速续取时丢弃过期响应)。
  const reqIdRef = React.useRef(0);

  const fetchPage = React.useCallback(
    async (
      targetScope: Scope,
      cursor: string | undefined,
      mode: "reset" | "append",
    ): Promise<void> => {
      const reqId = (reqIdRef.current += 1);
      setStatus("loading");
      try {
        const res = await listSessions({
          scope: targetScope,
          ...(targetScope === "cwd"
            ? currentSessionId !== undefined
              ? { sessionId: currentSessionId }
              : { cwd: currentCwd }
            : {}),
          ...(pageSize !== undefined ? { limit: pageSize } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
        });
        if (reqId !== reqIdRef.current) return;
        setItems((prev) =>
          mode === "append" ? [...prev, ...res.sessions] : res.sessions,
        );
        setNextCursor(res.nextCursor);
        setStatus("idle");
      } catch {
        if (reqId !== reqIdRef.current) return;
        setStatus("error");
      }
    },
    [listSessions, currentSessionId, currentCwd, pageSize],
  );

  // 切 scope(或 cwd/数据源变化)→ 重置并加载首页;宿主 bump `refreshSignal` 时亦重拉当前 scope 首页
  //(覆盖加载之后的服务端变更:新会话落库、auto_title 自动标题持久化)。竞态守卫保证仅最新响应可写。
  React.useEffect(() => {
    void fetchPage(scope, undefined, "reset");
  }, [scope, fetchPage, refreshSignal]);

  // ── 项级管理操作 ──────────────────────────────────────────────
  // 在途包裹:标记 busy(禁用重复触发,Req 5.2)+ 清错;失败展示可见错误(Req 2.7/3.6/4.8)。
  const runAction = React.useCallback(
    async (id: string, fn: () => void | Promise<void>): Promise<boolean> => {
      // 重入拒绝:该项已有操作在途则忽略(同步 ref 判定,避免 setState 异步导致的竞态,Req 5.2)。
      if (inFlightRef.current.has(id)) return false;
      inFlightRef.current.add(id);
      setBusyIds((s) => new Set(s).add(id));
      setActionError(undefined);
      try {
        await fn();
        return true;
      } catch {
        setActionError(actionErrorLabel);
        return false;
      } finally {
        inFlightRef.current.delete(id);
        setBusyIds((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }
    },
    [actionErrorLabel],
  );

  const handleDelete = React.useCallback(
    (id: string): void => {
      if (onDeleteSession === undefined) return;
      void runAction(id, async () => {
        await onDeleteSession(id);
        // 乐观移除:仅在成功后从本地列表摘除(失败则保留,Req 2.4/2.7)。
        setItems((prev) => prev.filter((i) => i.sessionId !== id));
      });
    },
    [onDeleteSession, runAction],
  );

  const handleRenameSubmit = React.useCallback(
    (id: string, name: string): void => {
      setEditingId(undefined);
      if (onRenameSession === undefined) return;
      void runAction(id, async () => {
        await onRenameSession(id, name);
        // 乐观改名:成功后本地即时更新;失败保留原名(Req 3.3/3.6)。
        setItems((prev) =>
          prev.map((i) => (i.sessionId === id ? { ...i, name } : i)),
        );
      });
    },
    [onRenameSession, runAction],
  );

  const handleToggleFavorite = React.useCallback(
    (id: string, favorite: boolean): void => {
      if (onToggleFavorite === undefined) return;
      void runAction(id, () => onToggleFavorite(id, favorite));
    },
    [onToggleFavorite, runAction],
  );

  // 乐观占位:仅当占位会话 id 尚未出现在已拉取列表时渲染(去重让位)。
  const pending =
    pendingSession !== undefined &&
    !items.some((i) => i.sessionId === pendingSession.sessionId)
      ? pendingSession
      : undefined;

  const showTabs = globalEnabled;
  // 有占位行时:不视作「初始加载中/空」——立即展示占位,避免闪 loading/空态(更符合人类预期)。
  const isInitialLoading =
    status === "loading" && items.length === 0 && pending === undefined;
  const isEmpty =
    status === "idle" && items.length === 0 && pending === undefined;

  // 写入口仅在启用且至少一个写回调在场时渲染(Req 6.1)。收藏分区不受此门控(Req 4.9)。
  const canManage =
    manageEnabled &&
    (onDeleteSession !== undefined ||
      onRenameSession !== undefined ||
      onToggleFavorite !== undefined);

  const favoriteSet = React.useMemo(
    () => new Set(favoriteSessionIds ?? []),
    [favoriteSessionIds],
  );
  // 收藏分区 = 已收藏 ∩ 当前视图会话(失效收藏 id 因不在 items 而自然跳过,Req 4.7);
  // 普通列表排除已收藏项,避免重复渲染(Req 4.3)。
  const favoriteItems = items.filter((i) => favoriteSet.has(i.sessionId));
  const normalItems = items.filter((i) => !favoriteSet.has(i.sessionId));

  /** 渲染单个会话项(收藏分区与普通列表共用)。 */
  const renderRow = (item: SessionListItem): React.ReactElement => {
    const isActive = item.sessionId === currentSessionId;
    const isFav = favoriteSet.has(item.sessionId);
    const editing = editingId === item.sessionId;
    const busy = busyIds.has(item.sessionId);
    return (
      <li
        key={item.sessionId}
        data-pi-session-list-item={item.sessionId}
        data-pi-session-list-item-busy={busy ? "" : undefined}
      >
        {/* 整行可点击恢复;右侧 hover/聚焦显现 ⋯ 菜单。编辑态时标题位替换为内联输入。 */}
        <div className="group relative flex items-center gap-0.5">
          {editing ? (
            <SessionRenameField
              sessionId={item.sessionId}
              initialValue={item.name ?? item.sessionId}
              onSubmit={handleRenameSubmit}
              onCancel={() => setEditingId(undefined)}
              className="flex-1"
            />
          ) : (
            <button
              type="button"
              data-pi-session-list-resume={item.sessionId}
              data-active={isActive ? "" : undefined}
              disabled={busy}
              onClick={() => onResume(item.sessionId)}
              title={`${formatTime(item)} · ${item.cwd}`}
              className={cn(
                "block min-w-0 flex-1 truncate rounded-[var(--radius)] px-2 py-2 text-left transition-colors focus-visible:outline-none",
                isActive
                  ? "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
                  : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] focus-visible:bg-[hsl(var(--muted))]",
              )}
            >
              {item.name ?? item.sessionId}
            </button>
          )}
          {canManage && !editing ? (
            <SessionItemMenu
              sessionId={item.sessionId}
              isFavorite={isFav}
              onRename={(id) => setEditingId(id)}
              onDelete={handleDelete}
              onToggleFavorite={handleToggleFavorite}
            />
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <div
      data-pi-session-list=""
      className={cn(
        "flex h-full w-60 shrink-0 flex-col gap-2 overflow-hidden border-r border-[hsl(var(--border))] text-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between px-2.5 pb-1 pt-1">
        <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
          {title}
        </span>
      </div>

      {showTabs ? (
        <div
          data-pi-session-list-tabs=""
          className="flex gap-1 px-1"
          role="tablist"
        >
          {(
            [
              { key: "cwd" as const, label: cwdTabLabel },
              { key: "all" as const, label: allTabLabel },
            ]
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              data-pi-session-list-tab={t.key}
              data-active={scope === t.key ? "" : undefined}
              aria-selected={scope === t.key}
              onClick={() => setScope(t.key)}
              className={cn(
                "rounded-[var(--radius)] px-2 py-1 text-xs transition-colors",
                scope === t.key
                  ? "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {actionError !== undefined ? (
        <div
          data-pi-session-list-action-error=""
          className="mx-1 rounded-[var(--radius)] bg-[hsl(var(--destructive)/0.1)] px-2 py-1 text-xs text-[hsl(var(--destructive))]"
        >
          {actionError}
        </div>
      ) : null}

      <div className="pi-scrollbar-ghost min-h-0 flex-1 overflow-y-auto px-1">
        {isInitialLoading ? (
          <div
            data-pi-session-list-loading=""
            className="px-2 py-4 text-xs text-[hsl(var(--muted-foreground))]"
          >
            {loadingLabel}
          </div>
        ) : status === "error" ? (
          <div data-pi-session-list-error="" className="px-2 py-4 text-xs">
            <span className="text-[hsl(var(--destructive))]">{errorLabel}</span>
            <Button
              variant="outline"
              size="sm"
              className="ml-2"
              onClick={() => void fetchPage(scope, undefined, "reset")}
            >
              {retryLabel}
            </Button>
          </div>
        ) : isEmpty ? (
          <div
            data-pi-session-list-empty=""
            className="px-2 py-4 text-xs text-[hsl(var(--muted-foreground))]"
          >
            {emptyLabel}
          </div>
        ) : (
          <>
            {/* 收藏分区:属于当前视图的已收藏会话置顶;无则不渲染(Req 4.3/4.4)。 */}
            {favoriteItems.length > 0 ? (
              <div data-pi-session-list-favorites="" className="mb-1">
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {favoritesSectionLabel}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {favoriteItems.map((item) => renderRow(item))}
                </ul>
              </div>
            ) : null}

            <ul className="flex flex-col gap-0.5">
              {pending !== undefined ? (
                <li
                  key={pending.sessionId}
                  data-pi-session-list-item={pending.sessionId}
                  data-pi-session-list-pending=""
                >
                  {/* 乐观占位:新建会话即时出现,高亮为当前;真实数据到达后由上方去重让位。 */}
                  <button
                    type="button"
                    data-pi-session-list-resume={pending.sessionId}
                    data-active=""
                    onClick={() => onResume(pending.sessionId)}
                    className="block w-full truncate rounded-[var(--radius)] bg-[hsl(var(--secondary))] px-2 py-2 text-left text-[hsl(var(--secondary-foreground))] transition-colors focus-visible:outline-none"
                  >
                    {pending.title !== undefined && pending.title.length > 0 ? (
                      pending.title
                    ) : (
                      <span className="text-[hsl(var(--muted-foreground))]">
                        {pendingSessionLabel}
                      </span>
                    )}
                  </button>
                </li>
              ) : null}
              {normalItems.map((item) => renderRow(item))}
              {nextCursor !== undefined ? (
                <li className="px-1 py-1">
                  <Button
                    variant="outline"
                    size="sm"
                    data-pi-session-list-load-more=""
                    disabled={status === "loading"}
                    onClick={() => void fetchPage(scope, nextCursor, "append")}
                    className="w-full"
                  >
                    {loadMoreLabel}
                  </Button>
                </li>
              ) : null}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
