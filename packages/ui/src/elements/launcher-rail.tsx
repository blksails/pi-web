"use client";

import * as React from "react";
import type {
  ListSessionsRequest,
  ListSessionsResponse,
  ListFavoritesResponse,
  SetFavoritesRequest,
  AgentSourceFavorite,
} from "@blksails/pi-web-protocol";
import { Search, SquarePen, X } from "lucide-react";
import { ExtErrorBoundary } from "../web-ext/ext-error-boundary.js";
import { useI18n } from "../i18n/index.js";

/** avatar 是否为可直接渲染的图片地址(URL / data-URI)。 */
function isImageAvatar(avatar: string): boolean {
  return (
    avatar.startsWith("http://") ||
    avatar.startsWith("https://") ||
    avatar.startsWith("data:")
  );
}

/** 收藏源头像:图片地址→<img>;短文本/emoji→文字;缺省→标题/名称首字母。 */
function FavoriteAvatar({
  favorite,
}: {
  readonly favorite: AgentSourceFavorite;
}): React.JSX.Element {
  const label = favorite.title ?? favorite.name;
  if (favorite.avatar !== undefined && isImageAvatar(favorite.avatar)) {
    return (
      <img
        src={favorite.avatar}
        alt=""
        className="h-5 w-5 shrink-0 rounded object-cover"
      />
    );
  }
  const glyph =
    favorite.avatar !== undefined && favorite.avatar.length > 0
      ? favorite.avatar
      : (label.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[hsl(var(--muted))] text-[11px] font-medium text-[hsl(var(--muted-foreground))]"
    >
      {glyph}
    </span>
  );
}

/**
 * LauncherRail — 侧栏顶部固定「启动导航区」(sidebar-launcher-rail)。
 *
 * 参考 Grok 侧栏,置于会话列表之上,集中提供四类入口:搜索历史会话、固定的新建聊天、
 * 收藏 agent source 的一键启动锚点、以及一个 webext 贡献的自定义渲染槽。注入式:不持
 * pi 接线,数据/回调由宿主注入(与 SessionListPanel 同构)。
 */
export interface LauncherRailProps {
  /** 新建聊天:回到源选择器(宿主注入 onReset)。 */
  readonly onNewChat: () => void;
  /** 搜索结果恢复某会话(宿主注入 onResume)。 */
  readonly onResume: (sessionId: string) => void;
  /** 收藏锚点点击:以该 source 新建会话(宿主注入 onSubmit)。 */
  readonly onLaunchSource: (source: string) => void;
  /** 会话搜索数据源(注入 PiClient.listSessions)。 */
  readonly listSessions: (
    req: ListSessionsRequest,
  ) => Promise<ListSessionsResponse>;
  /** 搜索目标目录(scope=cwd)。 */
  readonly currentCwd: string;
  /** 收藏读取(注入 PiClient.listFavorites)。 */
  readonly listFavorites: () => Promise<ListFavoritesResponse>;
  /** 收藏写入(注入 PiClient.setFavorites)。 */
  readonly setFavorites: (
    req: SetFavoritesRequest,
  ) => Promise<ListFavoritesResponse>;
  /** 值变化时重拉收藏(宿主在收藏变更后 bump)。 */
  readonly favoritesRefreshSignal?: unknown;
  /** webext 贡献到 launcherRail 槽的自定义渲染节点(resolveSlotContribution 结果)。 */
  readonly webextSlot?: React.ReactNode;
  readonly className?: string;
  // 文案(默认中文)
  readonly newChatLabel?: string;
  readonly searchLabel?: string;
  readonly searchPlaceholder?: string;
  readonly searchEmptyLabel?: string;
  readonly favoritesTitle?: string;
}

type SearchStatus = "idle" | "loading" | "error";

export function LauncherRail({
  onNewChat,
  onResume,
  onLaunchSource,
  listSessions,
  currentCwd,
  listFavorites,
  setFavorites,
  favoritesRefreshSignal,
  webextSlot,
  className,
  newChatLabel,
  searchLabel,
  searchPlaceholder,
  searchEmptyLabel,
}: LauncherRailProps): React.JSX.Element {
  const t = useI18n();
  const newChatText = newChatLabel ?? t("launcherRail.newChat");
  const searchText = searchLabel ?? t("launcherRail.search");
  const searchPlaceholderText =
    searchPlaceholder ?? t("launcherRail.searchPlaceholder");
  const searchEmptyText = searchEmptyLabel ?? t("launcherRail.searchEmpty");
  // ── 搜索 ────────────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<
    ListSessionsResponse["sessions"]
  >([]);
  const [searchStatus, setSearchStatus] = React.useState<SearchStatus>("idle");
  const searchReqIdRef = React.useRef(0);

  React.useEffect(() => {
    const q = query.trim();
    if (!searchOpen || q.length === 0) {
      setResults([]);
      setSearchStatus("idle");
      return;
    }
    const myId = searchReqIdRef.current + 1;
    searchReqIdRef.current = myId;
    setSearchStatus("loading");
    void listSessions({ scope: "cwd", cwd: currentCwd, q })
      .then((res) => {
        if (searchReqIdRef.current !== myId) return; // 过期响应丢弃
        setResults(res.sessions);
        setSearchStatus("idle");
      })
      .catch(() => {
        if (searchReqIdRef.current !== myId) return;
        setSearchStatus("error");
      });
  }, [searchOpen, query, currentCwd, listSessions]);

  const closeSearch = (): void => {
    setSearchOpen(false);
    setQuery("");
    setResults([]);
    setSearchStatus("idle");
  };

  // ── 收藏 ────────────────────────────────────────────────────────────────
  const [favorites, setFavs] = React.useState<AgentSourceFavorite[]>([]);
  React.useEffect(() => {
    let live = true;
    void listFavorites()
      .then((res) => {
        if (live) setFavs(res.favorites);
      })
      .catch(() => {
        if (live) setFavs([]);
      });
    return () => {
      live = false;
    };
  }, [listFavorites, favoritesRefreshSignal]);

  const removeFavorite = (source: string): void => {
    const next = favorites.filter((f) => f.source !== source);
    setFavs(next); // 乐观更新
    void setFavorites({ favorites: next })
      .then((res) => setFavs(res.favorites))
      .catch(() => {
        // 写失败:回读以恢复真实态。
        void listFavorites().then((res) => setFavs(res.favorites)).catch(() => {});
      });
  };

  const rowClass =
    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--accent))]";
  const iconClass =
    "flex w-5 shrink-0 items-center justify-center text-[hsl(var(--muted-foreground))]";

  return (
    <nav
      data-launcher-rail
      className={`flex shrink-0 flex-col gap-0.5 ${className ?? ""}`}
    >
      {/* 搜索入口 */}
      <button
        type="button"
        data-launcher-search
        aria-expanded={searchOpen}
        onClick={() => setSearchOpen((v) => !v)}
        className={rowClass}
      >
        <span aria-hidden className={iconClass}>
          <Search className="h-4 w-4" />
        </span>
        <span>{searchText}</span>
      </button>

      {searchOpen ? (
        <div data-launcher-search-panel className="flex flex-col gap-1 px-1 pb-1">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
            }}
            placeholder={searchPlaceholderText}
            data-launcher-search-input
            className="rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          />
          {query.trim().length > 0 ? (
            searchStatus === "loading" ? (
              <p className="px-2 py-1 text-xs text-[hsl(var(--muted-foreground))]">
                {t("launcherRail.searching")}
              </p>
            ) : searchStatus === "error" ? (
              <p
                role="alert"
                className="px-2 py-1 text-xs text-[hsl(var(--destructive))]"
              >
                {t("launcherRail.searchError")}
              </p>
            ) : results.length === 0 ? (
              <p
                data-launcher-search-empty
                className="px-2 py-1 text-xs text-[hsl(var(--muted-foreground))]"
              >
                {searchEmptyText}
              </p>
            ) : (
              <ul className="pi-scrollbar-ghost flex max-h-48 flex-col gap-0.5 overflow-y-auto">
                {results.map((s) => (
                  <li key={s.sessionId}>
                    <button
                      type="button"
                      data-launcher-search-result
                      onClick={() => {
                        onResume(s.sessionId);
                        closeSearch();
                      }}
                      className="w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-[hsl(var(--accent))]"
                    >
                      {s.name ?? s.sessionId}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}

      {/* 新建聊天(固定) */}
      <button
        type="button"
        data-launcher-new-chat
        onClick={onNewChat}
        className={rowClass}
      >
        <span aria-hidden className={iconClass}>
          <SquarePen className="h-4 w-4" />
        </span>
        <span>{newChatText}</span>
      </button>

      {/* 收藏锚点:无标签,自然跟随在新建聊天下方(无收藏则不占位) */}
      {favorites.length > 0 ? (
        <div data-launcher-favorites className="flex flex-col gap-0.5">
          {favorites.map((f) => (
            <div
              key={f.source}
              className="group relative flex items-center rounded-lg transition-colors hover:bg-[hsl(var(--accent))]"
            >
              <button
                type="button"
                data-launcher-favorite
                data-source={f.source}
                onClick={() => onLaunchSource(f.source)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
              >
                <span className={iconClass}>
                  <FavoriteAvatar favorite={f} />
                </span>
                <span className="truncate">{f.title ?? f.name}</span>
              </button>
              <button
                type="button"
                data-launcher-favorite-remove
                aria-label={`${t("launcherRail.removeFavorite")} ${f.title ?? f.name}`}
                onClick={() => removeFavorite(f.source)}
                className="absolute right-1.5 flex h-6 w-6 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity hover:bg-[hsl(var(--background))] hover:text-[hsl(var(--foreground))] group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* webext 贡献槽(无贡献不占位;渲染失败经 error boundary 隔离) */}
      {webextSlot !== undefined && webextSlot !== null ? (
        <div data-launcher-webext-slot className="mt-1">
          <ExtErrorBoundary>{webextSlot}</ExtErrorBoundary>
        </div>
      ) : null}
    </nav>
  );
}
