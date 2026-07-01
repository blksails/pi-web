/**
 * SessionListPanel — 会话列表面板(sessions-list)。
 *
 * 展示历史会话并触发恢复。两类视图经 Tab 切换:「当前目录」(scope=cwd)与「全部」
 * (scope=all,系统/全机器);「全部」入口仅在 `globalEnabled` 时出现(Req 2.2/6.1)。
 * 列表项仅展示头部轻量元数据(名称/标识、时间、所属目录,Req 3.1);不持 pi 接线——
 * 数据经注入的 `listSessions` 函数获取(Req 3.2)。每项整行可点击,直接重新载入该会话:
 * 点击经 `onResume` 回调上抛(Req 4.1),由宿主导航到 /session/:id 冷恢复并回溯 agent source。
 * 三态可见:加载中 / 空态 / 可重试错误(Req 6.2/1.3/6.3);分页经「加载更多」续取
 * (Req 3.3/3.4)。data-* 属性供 e2e 与宿主定位。
 */
import * as React from "react";
import type {
  ListSessionsRequest,
  ListSessionsResponse,
  SessionListItem,
} from "@blksails/pi-web-protocol";
import { Button } from "../ui/button.js";
import { cn } from "../lib/cn.js";

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
    title = "会话历史",
    cwdTabLabel = "当前目录",
    allTabLabel = "全部",
    loadingLabel = "加载中…",
    emptyLabel = "暂无会话",
    errorLabel = "加载失败",
    retryLabel = "重试",
    loadMoreLabel = "加载更多",
    pendingSessionLabel = "新会话",
  } = props;

  const [scope, setScope] = React.useState<Scope>("cwd");
  const [items, setItems] = React.useState<ReadonlyArray<SessionListItem>>([]);
  const [nextCursor, setNextCursor] = React.useState<string | undefined>(
    undefined,
  );
  const [status, setStatus] = React.useState<Status>("loading");

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

  return (
    <div
      data-pi-session-list=""
      className={cn(
        "flex h-full w-60 shrink-0 flex-col gap-2 overflow-hidden border-r border-[hsl(var(--border))] text-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between px-2 pt-1">
        <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
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

      <div className="min-h-0 flex-1 overflow-y-auto px-1">
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
            {items.map((item) => {
              const isActive = item.sessionId === currentSessionId;
              return (
                <li key={item.sessionId} data-pi-session-list-item={item.sessionId}>
                  {/* 单行标题,整行可点击:直接重新载入该会话(经 /session/:id 冷恢复,回溯 agent
                      source)。时间/路径不占行,移入 hover tooltip;当前会话高亮。 */}
                  <button
                    type="button"
                    data-pi-session-list-resume={item.sessionId}
                    data-active={isActive ? "" : undefined}
                    onClick={() => onResume(item.sessionId)}
                    title={`${formatTime(item)} · ${item.cwd}`}
                    className={cn(
                      "block w-full truncate rounded-[var(--radius)] px-2 py-2 text-left transition-colors focus-visible:outline-none",
                      isActive
                        ? "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
                        : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] focus-visible:bg-[hsl(var(--muted))]",
                    )}
                  >
                    {item.name ?? item.sessionId}
                  </button>
                </li>
              );
            })}
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
        )}
      </div>
    </div>
  );
}
