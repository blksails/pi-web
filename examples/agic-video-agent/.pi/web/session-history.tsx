/**
 * SessionHistory —— 历史会话侧栏(webext `sidebarLeft` 槽)。
 *
 * 复刻独立仓 aigc-agent `components/session-history.tsx` 的 UI 与交互(会话行 = 清洗后的标题 +
 * 相对时间;hover 浮现「更多」→ 重命名 / 分享 / 删除;点行切会话;分组标头),但**按本仓架构重写**:
 * 不搬 vendor 文件、不引 `@tanstack/react-query`(不在宿主 import map 内),数据面改接 pi-web 宿主
 * 自带的会话端点(`packages/server` session-list / session-actions):
 *
 *   列表   GET  {baseUrl}/sessions?scope=cwd&limit=100&sessionId=<当前>   → ListSessionsResponse
 *   重命名 POST {baseUrl}/sessions/rename  { sessionId, name }
 *   删除   POST {baseUrl}/sessions/delete  { sessionId }
 *
 * 与源项目的两处**如实差异**(架构决定,非省略):
 *  - 源项目左栏第二组「历史会话 · pi-labs」读 Supabase `pilabs.sessions`(其 app 独有的平台库),
 *    本仓无该数据源 → 去掉该组,改按时间分「今天 / 本周 / 更早」(源项目 chat-app.tsx:528 注释所述
 *    的分组语义)。随之 `SessionTranscript`(pi-labs 会话不可 live resume 才需要的只读浮层)也不需要:
 *    本仓每个会话都能经宿主冷恢复直接打开。
 *  - 切会话是**宿主能力**(源项目由 app 反查 agent source 后重挂 SessionView),webext 做不到,故
 *    先派可取消事件请宿主接管、宿主不接管才回退 URL 导航(见 `resumeSession`)。
 */
import * as React from "react";
import { MoreVertical, Pencil, Share2, Trash2 } from "lucide-react";
import type { SlotRenderProps } from "@blksails/pi-web-kit";
import { c } from "./cls.js";
import { ShareSessionDialog } from "./share-session-dialog.js";

/** 宿主 `SlotHost` 除 extId 外还透传 baseUrl / sessionId(见 packages/ui/src/web-ext/apply-extension.tsx:84)。 */
type SessionHistoryProps = SlotRenderProps & {
  readonly baseUrl?: string;
  readonly sessionId?: string;
};

/** `ListSessionsResponse.sessions[]` 项(protocol `SessionListItem`)。 */
export interface SessionItem {
  readonly sessionId: string;
  readonly name?: string;
  readonly cwd: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day} 天前`;
  return `${Math.floor(day / 30)} 个月前`;
}

/** 标题清洗(同源项目):自动标题常是工具入参 JSON / `Text → image:` 包装,抽出人话并截断。 */
export function cleanTitle(s: SessionItem): string {
  let n = (s.name ?? "").trim();
  if (n === "") return `未命名会话 · ${s.sessionId.slice(0, 6)}`;
  const m = /"prompt"\s*:\s*"([^"]+)/.exec(n);
  if (m !== null) n = m[1] ?? n;
  else n = n.replace(/^Text\s*[→>-]+\s*(image|video)\s*[:：]\s*/i, "");
  n = n.trim();
  return n.length > 38 ? `${n.slice(0, 38)}…` : n;
}

type Bucket = "today" | "week" | "older";
const BUCKET_LABEL: Readonly<Record<Bucket, string>> = {
  today: "今天",
  week: "本周",
  older: "更早",
};

function bucketOf(iso: string): Bucket {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "older";
  const day = 86_400_000;
  const diff = Date.now() - t;
  if (diff < day) return "today";
  if (diff < 7 * day) return "week";
  return "older";
}

/**
 * 指向目标会话的地址。宿主路由形态未知(源项目固定 `/session/<id>`,pi-clouds 另有其形),故:
 * 当前地址里出现了当前会话 id 就原位替换成目标 id —— 这一招自适应 `/c/<id>`、`?session=<id>`
 * 等各家形态;地址里没有当前 id(如尚未建会话)则退到 `?sessionId=<id>`。
 * 纯函数,供切会话与「复制会话链接」共用。
 */
export function sessionHref(target: string, current: string | undefined, href: string): string {
  if (current !== undefined && current !== "" && href.includes(current)) {
    return href.replace(current, target);
  }
  const url = new URL(href);
  url.searchParams.set("sessionId", target);
  return url.toString();
}

/**
 * 切到某会话。webext 无宿主会话生命周期的把手(源项目由 app 反查 `/api/bootstrap?sessionId=`
 * 取 resumeSource 后重挂 SessionView),故两级:
 *  ① 派**可取消**事件 `pi-web:resume-session`,宿主监听并 `preventDefault()` 即视为已接管;
 *  ② 未接管则回退 URL 导航(见 `sessionHref`)。
 */
function resumeSession(target: string, current: string | undefined): void {
  const ev = new CustomEvent("pi-web:resume-session", {
    detail: { sessionId: target },
    cancelable: true,
  });
  if (!window.dispatchEvent(ev)) return; // 宿主已接管
  window.location.assign(sessionHref(target, current, window.location.href));
}

/** 点击外部关闭菜单(同源项目)。 */
function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  cb: () => void,
  active: boolean,
): void {
  React.useEffect(() => {
    if (!active) return undefined;
    const handler = (e: PointerEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) cb();
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [active, cb, ref]);
}

async function fetchSessions(
  api: string,
  current: string | undefined,
): Promise<readonly SessionItem[]> {
  const q = new URLSearchParams({ scope: "cwd", limit: "100" });
  // scope=cwd 时宿主按 sessionId 反查该会话真实 cwd(前端推断不了),故有当前会话就带上。
  if (current !== undefined && current !== "") q.set("sessionId", current);
  const res = await fetch(`${api}/sessions?${q.toString()}`, {
    credentials: "same-origin",
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { sessions?: SessionItem[] };
  return json.sessions ?? [];
}

export function SessionHistory(props: SessionHistoryProps): React.JSX.Element {
  // 宿主 client 未就绪时会传空串(见 pi-chat 的 `client?.baseUrl ?? ""`),故空串也回落默认基址。
  const api = props.baseUrl !== undefined && props.baseUrl !== "" ? props.baseUrl : "/api";
  const current = props.sessionId;
  const [items, setItems] = React.useState<readonly SessionItem[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [menuId, setMenuId] = React.useState<string | null>(null);
  const [shareTarget, setShareTarget] = React.useState<SessionItem | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  const refresh = React.useCallback((): void => {
    void fetchSessions(api, current).then((list) => {
      setItems(list);
      setLoaded(true);
    });
  }, [api, current]);

  // 会话切换(新建 / 恢复)后重拉,与源项目 currentSessionId 变更即 invalidate 同效。
  React.useEffect(refresh, [refresh]);

  useClickOutside(
    menuRef as React.RefObject<HTMLElement | null>,
    () => setMenuId(null),
    menuId !== null,
  );

  const handleRename = React.useCallback(
    (s: SessionItem): void => {
      setMenuId(null);
      const name = window.prompt("重命名会话", s.name ?? "");
      if (name === null || name.trim() === "") return;
      void fetch(`${api}/sessions/rename`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: s.sessionId, name: name.trim() }),
      })
        .then((res) => {
          if (res.ok) refresh();
        })
        .catch(() => {
          /* best-effort */
        });
    },
    [api, refresh],
  );

  const handleDelete = React.useCallback(
    (s: SessionItem): void => {
      setMenuId(null);
      if (!window.confirm(`确认删除会话「${cleanTitle(s)}」?`)) return;
      // 本仓删除走 POST /sessions/delete(路径不含 :id —— Router 对含 :id 的路由做内存会话
      // 存在性门控,历史会话必然 404;见 session-actions-routes.ts 顶部注释)。
      void fetch(`${api}/sessions/delete`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: s.sessionId }),
      })
        .then((res) => {
          if (res.ok) refresh();
        })
        .catch(() => {
          /* best-effort */
        });
    },
    [api, refresh],
  );

  const handleShare = React.useCallback((s: SessionItem): void => {
    setMenuId(null);
    setShareTarget(s);
  }, []);

  const sorted = [...items].sort((a, b) =>
    (a.updatedAt ?? a.createdAt) < (b.updatedAt ?? b.createdAt) ? 1 : -1,
  );
  const groups: readonly (readonly [Bucket, readonly SessionItem[]])[] = (
    ["today", "week", "older"] as const
  )
    .map((b) => [b, sorted.filter((s) => bucketOf(s.updatedAt ?? s.createdAt) === b)] as const)
    .filter(([, list]) => list.length > 0);

  if (loaded && sorted.length === 0) {
    return <div className={c("sess-empty")}>暂无会话</div>;
  }

  return (
    <div className={c("sess-list")} data-session-history>
      {groups.map(([bucket, list]) => (
        <React.Fragment key={bucket}>
          <div className={c("sess-group")}>{BUCKET_LABEL[bucket]}</div>
          {list.map((s) => (
            <div
              key={s.sessionId}
              className={s.sessionId === current ? c("sess", "active") : c("sess")}
            >
              <button
                type="button"
                className={c("sess-main")}
                onClick={() => {
                  if (s.sessionId !== current) resumeSession(s.sessionId, current);
                }}
                title={`${cleanTitle(s)} · 点击继续该会话`}
              >
                <span className={c("t")}>{cleanTitle(s)}</span>
                <span className={c("m")}>{relTime(s.updatedAt ?? s.createdAt)}</span>
              </button>
              <button
                type="button"
                className={c("sess-more")}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuId((v) => (v === s.sessionId ? null : s.sessionId));
                }}
                title="更多操作"
              >
                <MoreVertical size={14} />
              </button>
              {menuId === s.sessionId ? (
                <div className={c("sess-menu")} ref={menuRef}>
                  <button type="button" onClick={() => handleRename(s)}>
                    <Pencil size={13} /> 重命名
                  </button>
                  <button type="button" onClick={() => handleShare(s)}>
                    <Share2 size={13} /> 分享
                  </button>
                  <button type="button" className={c("danger")} onClick={() => handleDelete(s)}>
                    <Trash2 size={13} /> 删除
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </React.Fragment>
      ))}

      {shareTarget !== null ? (
        <ShareSessionDialog
          api={api}
          sessionId={shareTarget.sessionId}
          currentSessionId={current}
          title={cleanTitle(shareTarget)}
          onClose={() => setShareTarget(null)}
        />
      ) : null}
    </div>
  );
}
