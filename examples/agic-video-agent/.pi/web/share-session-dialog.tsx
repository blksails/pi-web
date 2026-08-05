/**
 * ShareSessionDialog —— 会话分享弹窗(历史会话侧栏「更多 → 分享」)。
 *
 * 复刻独立仓 aigc-agent `components/share-session-dialog.tsx` 的三段交互:复制链接 / 已共享成员
 * (角色徽章 + 移除)/ 公司成员添加(选人 + viewer·editor)。按本仓架构重写:不引 react-query,
 * 样式走本源 `styles.css`(经 `c()` 前缀)而非宿主 tailwind 原子类——webext 是独立 bundle,
 * 不能假定宿主的 utility CSS 在场。
 *
 * 协作名单数据面(`/sessions/:id/collaborators`、`/company/users`)是源项目 app 层的多租户端点,
 * pi-web 宿主当前没有(见 docs/aigc-alignment-checklist.md P5:🔀 待 cloud 会话归属落地)。故成员两段
 * 在端点不可达时**如实降级**为提示文案——与源项目自身「单机模式无多用户」的降级分支同形,
 * 端点一旦上线本组件零改即生效。复制链接段与宿主无关,始终可用。
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { Link as LinkIcon, X } from "lucide-react";
import { c } from "./cls.js";
import { sessionHref } from "./session-history.js";

interface Collaborator {
  readonly userId: string;
  readonly role: "owner" | "viewer" | "editor";
}
interface Member {
  readonly userId: string;
  readonly username?: string;
}

/** 取 `{items:[…]}` 形状端点;不可用(404 / 未登录 / 网络)→ undefined,由调用方呈现降级文案。 */
async function getItems<T>(url: string): Promise<readonly T[] | undefined> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { items?: T[] };
    return Array.isArray(body.items) ? body.items : [];
  } catch {
    return undefined;
  }
}

export function ShareSessionDialog({
  api,
  sessionId,
  currentSessionId,
  title,
  onClose,
}: {
  readonly api: string;
  readonly sessionId: string;
  readonly currentSessionId?: string;
  readonly title: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  const [copied, setCopied] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [role, setRole] = React.useState<"viewer" | "editor">("viewer");
  // undefined = 端点不可用(降级);数组 = 真实名单。
  const [collaborators, setCollaborators] = React.useState<readonly Collaborator[] | undefined>(
    undefined,
  );
  const [members, setMembers] = React.useState<readonly Member[]>([]);

  const collabUrl = `${api}/sessions/${encodeURIComponent(sessionId)}/collaborators`;

  const reload = React.useCallback((): void => {
    void getItems<Collaborator>(collabUrl).then(setCollaborators);
  }, [collabUrl]);

  React.useEffect(() => {
    reload();
    void getItems<Member>(`${api}/company/users`).then((list) => setMembers(list ?? []));
  }, [api, reload]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyLink = (): void => {
    void navigator.clipboard
      .writeText(sessionHref(sessionId, currentSessionId, window.location.href))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* best-effort */
      });
  };

  const mutate = React.useCallback(
    (url: string, init: RequestInit): void => {
      setBusy(true);
      void fetch(url, { credentials: "same-origin", ...init })
        .catch(() => {
          /* best-effort */
        })
        .finally(() => {
          setBusy(false);
          reload();
        });
    },
    [reload],
  );

  const collabIds = new Set((collaborators ?? []).map((x) => x.userId));
  const candidates = members.filter((m) => !collabIds.has(m.userId));
  const memberName = (id: string): string =>
    members.find((m) => m.userId === id)?.username ?? id.slice(0, 8);

  return createPortal(
    <div
      className={c("dlg-backdrop")}
      role="dialog"
      aria-modal="true"
      aria-label={`分享会话 ${title}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={c("dlg")} onClick={(e) => e.stopPropagation()}>
        <div className={c("dlg-head")}>
          <span className={c("t")}>分享「{title}」</span>
          <button type="button" className={c("x")} onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className={c("dlg-body")}>
          <button type="button" className={c("dlg-btn")} onClick={copyLink}>
            <LinkIcon size={12} /> {copied ? "已复制链接" : "复制会话链接"}
          </button>

          <div>
            <div className={c("dlg-label")}>已共享</div>
            {collaborators === undefined ? (
              <div className={c("dlg-hint")}>
                当前宿主未提供协作名单端点(需登录且为会话成员);链接分享不受影响
              </div>
            ) : collaborators.length === 0 ? (
              <div className={c("dlg-hint")}>尚未共享(单机模式无多用户)</div>
            ) : (
              collaborators.map((x) => (
                <div key={x.userId} className={c("dlg-row")}>
                  <span className={c("nm")}>{memberName(x.userId)}</span>
                  <span className={c("dlg-hint")}>
                    {x.role === "owner" ? "所有者" : x.role === "editor" ? "可编辑" : "可查看"}
                  </span>
                  {x.role !== "owner" ? (
                    <button
                      type="button"
                      className={c("dlg-btn")}
                      disabled={busy}
                      onClick={() =>
                        mutate(`${collabUrl}/${encodeURIComponent(x.userId)}`, {
                          method: "DELETE",
                        })
                      }
                    >
                      移除
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>

          {candidates.length > 0 ? (
            <div>
              <div className={c("dlg-row")}>
                <span className={c("dlg-label", "nm")}>添加成员</span>
                <select
                  className={c("dlg-select")}
                  value={role}
                  onChange={(e) => setRole(e.target.value === "editor" ? "editor" : "viewer")}
                >
                  <option value="viewer">可查看</option>
                  <option value="editor">可编辑</option>
                </select>
              </div>
              {candidates.map((m) => (
                <div key={m.userId} className={c("dlg-row")}>
                  <span className={c("nm")}>{m.username ?? m.userId.slice(0, 8)}</span>
                  <button
                    type="button"
                    className={c("dlg-btn")}
                    disabled={busy}
                    onClick={() =>
                      mutate(collabUrl, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ userId: m.userId, role }),
                      })
                    }
                  >
                    添加
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
