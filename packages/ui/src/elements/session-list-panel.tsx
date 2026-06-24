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
} from "@pi-web/protocol";
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
  /** 单页上限(透传给端点;缺省由端点取默认)。 */
  readonly pageSize?: number;
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
    pageSize,
    className,
    title = "会话历史",
    cwdTabLabel = "当前目录",
    allTabLabel = "全部",
    loadingLabel = "加载中…",
    emptyLabel = "暂无会话",
    errorLabel = "加载失败",
    retryLabel = "重试",
    loadMoreLabel = "加载更多",
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

  // 切 scope(或 cwd/数据源变化)→ 重置并加载首页。
  React.useEffect(() => {
    void fetchPage(scope, undefined, "reset");
  }, [scope, fetchPage]);

  const showTabs = globalEnabled;
  const isInitialLoading = status === "loading" && items.length === 0;
  const isEmpty = status === "idle" && items.length === 0;

  return (
    <div
      data-pi-session-list=""
      className={cn(
        "flex h-full w-60 shrink-0 flex-col gap-2 overflow-hidden border-r border-[hsl(var(--border))] text-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between px-1 pt-1">
        <span className="font-medium">{title}</span>
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
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.sessionId} data-pi-session-list-item={item.sessionId}>
                {/* 整行可点击:直接重新载入该会话(经 /session/:id 冷恢复,回溯 agent source)。 */}
                <button
                  type="button"
                  data-pi-session-list-resume={item.sessionId}
                  onClick={() => onResume(item.sessionId)}
                  title={item.cwd}
                  className="flex w-full items-center gap-2 rounded-[var(--radius)] px-2 py-1.5 text-left transition-colors hover:bg-[hsl(var(--muted))] focus-visible:bg-[hsl(var(--muted))] focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {item.name ?? item.sessionId}
                    </div>
                    <div className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                      {formatTime(item)} · {item.cwd}
                    </div>
                  </div>
                </button>
              </li>
            ))}
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
