/**
 * SessionListPanel — 会话列表面板(sessions-list + session-list-item-actions)。
 *
 * 展示历史会话并触发恢复。**恒为全局视图**:列出本机全部工作目录下的会话,不按项目目录
 * 区分(spec session-meta-index 增量;原「当前目录 / 全部」双 Tab 与 `globalEnabled`
 * 部署门控已移除)。列表项仍显示所属 cwd,故「哪个项目的会话」在项上仍可见。
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
import { AlertCircle, Loader2 } from "lucide-react";
import { sourceAccentColor } from "./session-source-color.js";
import { cn } from "../lib/cn.js";
import { useI18n } from "../i18n/index.js";
import { SessionItemMenu, SessionRenameField } from "./session-item-menu.js";

/**
 * 会话项(含可选 `source` 来源标识,如 agent source 名)。`source` 现已进 protocol 契约
 * `SessionListItem`(session-source-protocol),经 `client.listSessions` 的 `.parse()` 保留而非被
 * strip;此别名保留仅为命名可读,与 `SessionListItem` 等价。`showSource` 门控关闭或字段缺失时
 * 零渲染影响(Req 6.2/6.3/6.5)。
 */
type SessionListItemWithSource = SessionListItem;

export interface SessionListPanelProps {
  /** 当前活跃会话标识;用于高亮当前项。 */
  readonly currentSessionId?: string;
  /** 注入的列表数据源(经 PiClient.listSessions);保持本组件不持 pi 接线。 */
  readonly listSessions: (
    req: ListSessionsRequest,
  ) => Promise<ListSessionsResponse>;
  /** 触发恢复某会话(由宿主走 resumeId 链路,Req 4.1)。 */
  readonly onResume: (sessionId: string) => void;
  /**
   * 外部刷新信号:值变化时重拉首页(沿用竞态守卫)。
   * 面板自身只在数据源变化时加载,无法感知「新会话落库」「自动标题(auto_title)持久化」
   * 等发生在加载之后的服务端变更;宿主在「一轮 agent 运行结束」等时机 bump 此值,使列表及时刷新。
   */
  readonly refreshSignal?: unknown;
  /** 单页上限(透传给端点;缺省由端点取默认)。 */
  readonly pageSize?: number;
  /**
   * 是否展示会话项的 source 极小副标题(标题下方一行 `text-xs`)。缺省 `false`/`undefined`
   * 时不渲染该行,DOM 与既有行为字节级一致(向后兼容,Req 6.5);为 `true` 但对应会话项
   * 无 `source` 时同样不渲染(不留空行)。
   */
  readonly showSource?: boolean;
  /**
   * 会话工作状态的轮询周期(毫秒,spec session-meta-index Req 8.6-8.9)。默认 5000;
   * 设为 0 或负数即**关闭**轮询,行为回到仅由 `refreshSignal` 驱动。
   *
   * 为何需要它:列表刷新只由宿主的边沿信号(当前会话忙态翻转、交互挂起变化)触发,
   * 所以「**别的**会话开始忙」这件事没有任何触发点 —— 用户不动就看不到。
   *
   * ★ 周期**分层**而不是「全空闲就停」:停掉会造成鸡生蛋 —— 列表全空闲时不轮询,于是
   *   「别的会话开始忙」永远发现不了,而这正是本机制存在的唯一理由(Chrome 真机实测抓到)。
   *   故:有非空闲项时按本周期轮询;全空闲时按 `IDLE_POLL_FACTOR` 倍的更长周期轮询。
   *   页面不可见则一律不轮询(后台标签页不烧请求,Req 8.7)。
   */
  readonly activityPollMs?: number;
  /** 未设置标题时列表项显示的占位名;缺省取 i18n 的「新对话」。 */
  readonly untitledLabel?: string;
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
/** 全空闲时的轮询周期倍数(相对 `activityPollMs`):闲时放慢,但**不停** ——
 * 停掉会造成「列表全空闲 → 不轮询 → 永远发现不了别的会话变忙」的鸡生蛋。 */
const IDLE_POLL_FACTOR = 3;


/** 列表项展示时间:最近更新优先,回退创建;非法时间退化为原串。 */
function formatTime(item: SessionListItem): string {
  const ts = item.updatedAt ?? item.createdAt;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export function SessionListPanel(
  props: SessionListPanelProps,
): React.ReactElement {
  const t = useI18n();
  const {
    currentSessionId,
    listSessions,
    onResume,
    refreshSignal,
    pageSize,
    showSource = false,
    activityPollMs = 5_000,
    pendingSession,
    className,
    manageEnabled = false,
    favoriteSessionIds,
    onDeleteSession,
    onRenameSession,
    onToggleFavorite,
  } = props;
  const title = props.title ?? t("sessionList.title");
  const cwdTabLabel = props.cwdTabLabel ?? t("sessionList.cwdTab");
  const allTabLabel = props.allTabLabel ?? t("sessionList.allTab");
  const loadingLabel = props.loadingLabel ?? t("sessionList.loading");
  const emptyLabel = props.emptyLabel ?? t("sessionList.empty");
  const errorLabel = props.errorLabel ?? t("sessionList.error");
  const retryLabel = props.retryLabel ?? t("sessionList.retry");
  const loadMoreLabel = props.loadMoreLabel ?? t("sessionList.loadMore");
  const untitledLabel = props.untitledLabel ?? t("sessionList.untitled");
  const pendingSessionLabel =
    props.pendingSessionLabel ?? t("sessionList.pendingSession");
  const favoritesSectionLabel =
    props.favoritesSectionLabel ?? t("sessionList.favoritesSection");
  const actionErrorLabel =
    props.actionErrorLabel ?? t("sessionList.actionError");

  const [items, setItems] = React.useState<ReadonlyArray<SessionListItemWithSource>>([]);
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
      cursor: string | undefined,
      mode: "reset" | "append",
    ): Promise<void> => {
      const reqId = (reqIdRef.current += 1);
      setStatus("loading");
      try {
        const res = await listSessions({
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
    [listSessions, pageSize],
  );

  // 数据源变化 → 加载首页;宿主 bump `refreshSignal` 时亦重拉首页(覆盖加载之后的服务端
  // 变更:新会话落库、auto_title 自动标题持久化)。竞态守卫保证仅最新响应可写。
  React.useEffect(() => {
    void fetchPage(undefined, "reset");
  }, [fetchPage, refreshSignal]);

  /**
   * 状态轮询(Req 8.6-8.9):只更新**已显示项**的活跃态,不动列表的长度、顺序与已加载的分页。
   *
   * ★ 刻意不复用 `fetchPage(..., "reset")`:那会把用户已「加载更多」的内容打回首页 ——
   *   既有 refreshSignal 是每轮末一次的低频信号,这个副作用可以忍;5 秒一次就不行了(Req 8.8)。
   *   故这里单独取一页、按 sessionId 只合并 `activity` 字段。
   *
   * 新会话的出现仍由 `refreshSignal` 负责(轮询不增删项)。
   */
  const hasActiveItems = items.some((i) => i.activity !== undefined);
  const [pageVisible, setPageVisible] = React.useState<boolean>(
    () => typeof document === "undefined" || !document.hidden,
  );
  React.useEffect(() => {
    const onVis = (): void => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  React.useEffect(() => {
    if (activityPollMs <= 0) return; // 部署方关闭(Req 8.9)
    if (!pageVisible) return; // 后台标签页不烧请求(Req 8.7)
    // 分层周期:忙时快、全闲时慢但**不停** —— 停掉就发现不了别的会话开始忙。
    const period = hasActiveItems ? activityPollMs : activityPollMs * IDLE_POLL_FACTOR;

    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const res = await listSessions({
          ...(pageSize !== undefined ? { limit: pageSize } : {}),
        });
        if (cancelled) return;
        const next = new Map(res.sessions.map((x) => [x.sessionId, x]));
        setItems((prev) => {
          let changed = false;
          // ① 更新已显示项的状态(只动 activity,不动其余字段与顺序)
          const merged = prev.map((it) => {
            const fresh = next.get(it.sessionId);
            if (fresh === undefined) return it;
            if (it.activity === fresh.activity) return it;
            changed = true;
            const { activity: _drop, ...rest } = it;
            return fresh.activity === undefined
              ? rest
              : { ...rest, activity: fresh.activity };
          });
          // ② 追加列表尚无的会话 —— 这是「别的会话开始忙」能被看到的前提:
          //    A 的列表里本来就没有后建的 B,只更新状态永远变不出 B 来。
          //    置于顶部(列表按最近更新倒序,新会话本就该在前);既有项一个不删、顺序不动,
          //    故用户已「加载更多」的内容不受影响(Req 8.8)。
          const prevIds = new Set(prev.map((i) => i.sessionId));
          const added = res.sessions.filter((x) => !prevIds.has(x.sessionId));
          if (added.length > 0) return [...added, ...merged];
          return changed ? merged : prev;
        });
      } catch {
        // 轮询失败静默:状态是展示增强,不得把列表推入错误态。
      }
    };

    const timer = setInterval(() => void tick(), period);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    activityPollMs,
    hasActiveItems,
    pageVisible,
    listSessions,
    pageSize,
  ]);

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

  /**
   * 列表项标题(spec session-meta-index, Req 6.7):有标题就显示标题;没有则显示「新对话」占位。
   *
   * ★ 刻意**不再回退到 sessionId**:一串 uuid 对用户没有任何识别价值,反而挤掉了真正有用的
   *   信息。标题的来源是 auto-title 或用户改名,两者都写进会话历史与元数据索引;
   *   `name` 缺省本身就完备表达了「标题尚未设置」,故不为此另设状态字段(避免第二事实源)。
   *   sessionId 仍在 hover 提示里可查。
   */
  const titleOf = (item: SessionListItemWithSource): string =>
    item.name !== undefined && item.name.length > 0 ? item.name : untitledLabel;

  /**
   * 会话工作状态指示(spec session-meta-index, Req 7.1-7.3/7.6)。
   *
   * `activity` 缺省即空闲 → 返回 null,**不占位、不显示任何东西**(Req 7.6:空闲不加视觉噪声)。
   * 三态各有可辨形态:生成中转圈 / 等待回应实心点 / 异常叹号。
   */
  const renderActivity = (
    item: SessionListItemWithSource,
  ): React.ReactElement | null => {
    const activity = item.activity;
    if (activity === undefined) return null;
    const label =
      activity === "working"
        ? t("sessionList.activityWorking")
        : activity === "awaiting-input"
          ? t("sessionList.activityAwaiting")
          : t("sessionList.activityError");
    return (
      <span
        data-pi-session-list-item-activity={activity}
        title={label}
        aria-label={label}
        className="mr-1 flex size-3.5 shrink-0 items-center justify-center"
      >
        {activity === "working" ? (
          // shadcn 风格 spinner:与 pi-tool-part / attachments 同一写法(Loader2 + animate-spin),
          // 不另造自制圆环,保持全站 loading 视觉一致。
          <Loader2
            className="size-3.5 animate-spin text-[hsl(var(--muted-foreground))]"
            aria-hidden="true"
          />
        ) : activity === "awaiting-input" ? (
          // 闪烁圆点:等待用户回应是**需要人动手**的状态,用呼吸动画把它和静态装饰区分开。
          <span className="size-2 animate-pulse rounded-full bg-[hsl(var(--primary))]" />
        ) : (
          <AlertCircle className="size-3.5 text-[hsl(var(--destructive))]" />
        )}
      </span>
    );
  };

  /** 渲染单个会话项(收藏分区与普通列表共用)。 */
  const renderRow = (item: SessionListItemWithSource): React.ReactElement => {
    const isActive = item.sessionId === currentSessionId;
    const isFav = favoriteSet.has(item.sessionId);
    const editing = editingId === item.sessionId;
    const busy = busyIds.has(item.sessionId);
    // 来源色条(Req 6.3/6.4):同来源恒同色。无来源则整条不渲染,布局不占位(Req 6.5)。
    // 与来源副标题同受 `showSource` 门控 —— 二者是「显示来源」这一件事的两种表现,
    // 若门控只管其一,关掉门控后仍会漏出来源信息。
    const hasSource =
      showSource && item.source !== undefined && item.source.length > 0;
    return (
      <li
        key={item.sessionId}
        data-pi-session-list-item={item.sessionId}
        data-pi-session-list-item-busy={busy ? "" : undefined}
      >
        {/* 整行可点击恢复;右侧 hover/聚焦显现 ⋯ 菜单。编辑态时标题位替换为内联输入。 */}
        <div className="group relative flex items-center gap-0.5">
          {hasSource ? (
            <span
              data-pi-session-list-item-accent={item.source}
              aria-hidden="true"
              style={{ backgroundColor: sourceAccentColor(item.source) }}
              className="mr-0.5 h-5 w-0.5 shrink-0 rounded-full"
            />
          ) : null}
          {renderActivity(item)}
          {editing ? (
            <SessionRenameField
              sessionId={item.sessionId}
              initialValue={item.name ?? ""}
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
              title={`${titleOf(item)} · ${formatTime(item)} · ${item.cwd} · ${item.sessionId}`}
              className={cn(
                "block min-w-0 flex-1 truncate rounded-[var(--radius)] px-2 py-2 text-left transition-colors focus-visible:outline-none",
                isActive
                  ? "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
                  : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] focus-visible:bg-[hsl(var(--muted))]",
              )}
            >
              {titleOf(item)}
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
        {showSource && item.source !== undefined && item.source.length > 0 ? (
          <div
            data-pi-session-list-item-source=""
            className="truncate px-2 text-[10px] leading-tight text-[hsl(var(--muted-foreground))]"
          >
            {item.source}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div
      data-pi-session-list=""
      className={cn(
        "flex h-full w-60 shrink-0 flex-col gap-2 overflow-hidden text-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between px-2.5 pb-1 pt-1">
        <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
          {title}
        </span>
      </div>

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
              onClick={() => void fetchPage(undefined, "reset")}
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
                    onClick={() => void fetchPage(nextCursor, "append")}
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
