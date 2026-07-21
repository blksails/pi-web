/**
 * dialogLayer 槽:skill 管理 modal（pi-web 设计系统 class）。直接调平台 route `/api/skills`
 * (GET 列表 / POST 新建·上传)，无需 sessionId。含前端校验 + 明确的成功/失败反馈。
 */
import * as React from "react";
import { setSkillPanelOpen, useSkillPanelOpen } from "./skill-panel-store.js";

interface SkillItem {
  name: string;
  summary: string;
}

const API = "/api/skills";
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const ERR_ZH: Record<string, string> = {
  INVALID_NAME: "name 非法（需小写字母/数字/连字符，不能以连字符开头）",
  ALREADY_EXISTS: "同名 skill 已存在——勾选「覆盖同名」后再试",
  INVALID_CONTENT: "SKILL.md 正文无效",
};

export function SkillPanel({
  sessionId,
}: {
  extId?: string;
  sessionId?: string;
  baseUrl?: string;
}): React.JSX.Element | null {
  const open = useSkillPanelOpen();
  const [skills, setSkills] = React.useState<SkillItem[]>([]);
  const [name, setName] = React.useState("");
  const [content, setContent] = React.useState("");
  const [overwrite, setOverwrite] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  function showErr(text: string): void {
    setMsg({ kind: "err", text });
  }
  function showOk(text: string): void {
    setMsg({ kind: "ok", text });
  }

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch(
        sessionId ? `${API}?sessionId=${encodeURIComponent(sessionId)}` : API,
      );
      const body = (await res.json()) as { skills?: SkillItem[] };
      setSkills(body.skills ?? []);
    } catch {
      setSkills([]);
    }
  }, [sessionId]);

  React.useEffect(() => {
    if (open) {
      setMsg(null);
      void refresh();
    }
  }, [open, refresh]);

  async function submit(payload: {
    name: string;
    content: string;
    overwrite: boolean;
  }): Promise<void> {
    // 前端预校验：给出即时反馈，避免无谓请求。
    if (!NAME_RE.test(payload.name)) {
      showErr("请填写合法 name：小写字母/数字/连字符，且不以连字符开头");
      return;
    }
    if (payload.content.trim() === "") {
      showErr("SKILL.md 正文不能为空");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, sessionId }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        path?: string;
      };
      if (body.ok) {
        showOk(`已写入 ${body.path}；新建会话后生效`);
        setName("");
        setContent("");
        await refresh();
      } else {
        showErr(ERR_ZH[body.error ?? ""] ?? `失败：${body.error ?? "unknown"}`);
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      showErr(
        `请求失败：${detail}（若浏览器走了系统代理，localhost 可能被拦，请给 localhost 加 no-proxy）`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const base = file.name.replace(/\.md$/i, "").toLowerCase();
    const safe = base
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+/, "")
      .slice(0, 64);
    await submit({ name: safe, content: text, overwrite });
    e.target.value = "";
  }

  if (!open) return null;

  const inputCls =
    "w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]";

  return (
    <div
      data-testid="skill-panel"
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => setSkillPanelOpen(false)}
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-lg flex-col gap-4 overflow-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 text-[hsl(var(--card-foreground))] shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Skill 管理</h2>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => setSkillPanelOpen(false)}
            className="rounded-md px-2 py-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]"
          >
            ✕
          </button>
        </div>
        <p className="-mt-2 text-xs text-[hsl(var(--muted-foreground))]">
          项目级 <code>.pi/skills</code>，agent 每次新建会话时自动发现加载。
        </p>

        <section className="flex flex-col gap-2">
          <div className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
            已装 skill
          </div>
          {skills.length === 0 ? (
            <div className="text-sm text-[hsl(var(--muted-foreground))]">
              （暂无）
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {skills.map((s) => (
                <li key={s.name} className="text-sm">
                  <code className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-xs">
                    {s.name}
                  </code>
                  <span className="ml-2 text-[hsl(var(--muted-foreground))]">
                    {s.summary}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-[hsl(var(--border))] pt-4">
          <div className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
            新建 skill
          </div>
          <input
            data-testid="skill-name"
            placeholder="name（小写字母/数字/连字符）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
          <textarea
            data-testid="skill-content"
            placeholder="SKILL.md 正文（markdown）"
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className={`${inputCls} resize-y font-mono`}
          />
          <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            覆盖同名
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="skill-create"
              disabled={busy}
              onClick={() => void submit({ name, content, overwrite })}
              className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
            >
              {busy ? "创建中…" : "创建"}
            </button>
            <label className="cursor-pointer text-sm text-[hsl(var(--muted-foreground))] underline hover:text-[hsl(var(--foreground))]">
              上传 .md
              <input
                type="file"
                accept=".md"
                className="hidden"
                disabled={busy}
                onChange={(e) => void onUpload(e)}
              />
            </label>
          </div>
        </section>

        {msg !== null ? (
          <p
            data-testid="skill-msg"
            role={msg.kind === "err" ? "alert" : undefined}
            className={
              msg.kind === "err"
                ? "rounded-md border border-[hsl(var(--destructive))] bg-[hsl(var(--destructive))]/10 px-3 py-2 text-sm text-[hsl(var(--destructive))]"
                : "rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--accent))] px-3 py-2 text-sm text-[hsl(var(--accent-foreground))]"
            }
          >
            {msg.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
