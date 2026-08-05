import * as React from "react";

type Scope = "company" | "agent" | "personal";
type Kind = "skill" | "template";

interface Resource {
  readonly kind: Kind;
  readonly scope: Scope;
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly path: string;
}
interface Catalog {
  readonly skills: readonly Resource[];
  readonly templates: readonly Resource[];
}

const scopes: readonly { readonly id: Scope; readonly label: string }[] = [
  { id: "company", label: "公司" },
  { id: "agent", label: "Agent" },
  { id: "personal", label: "个人" },
];

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    const message = body.error?.message;
    if (typeof message === "string" && message.length > 0) return message;
  } catch {
    // Keep the status-based fallback.
  }
  return `${fallback}（${response.status}）`;
}

export function ResourceManager(): React.JSX.Element {
  const [catalog, setCatalog] = React.useState<Catalog>({ skills: [], templates: [] });
  const [kind, setKind] = React.useState<Kind>("skill");
  const [scope, setScope] = React.useState<Scope>("agent");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [argumentHint, setArgumentHint] = React.useState("");
  const [content, setContent] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string>();

  const load = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await fetch("/api/resources", { credentials: "include" });
      if (!response.ok) throw new Error(await responseMessage(response, "加载资源失败"));
      setCatalog((await response.json()) as Catalog);
      setMessage(undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载资源失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const resources = (kind === "skill" ? catalog.skills : catalog.templates)
    .filter((resource) => resource.scope === scope);

  const create = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    try {
      const body = {
        scope,
        name: name.trim(),
        description: description.trim() || undefined,
        content,
        ...(kind === "template" && argumentHint.trim() !== ""
          ? { argumentHint: argumentHint.trim() }
          : {}),
      };
      const response = await fetch(`/api/resources/${kind === "skill" ? "skills" : "templates"}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "创建资源失败"));
      setName("");
      setDescription("");
      setArgumentHint("");
      setContent("");
      await load();
      setMessage("已创建");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建资源失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (resource: Resource): Promise<void> => {
    if (!window.confirm(`删除${resource.kind === "skill" ? " Skill" : "模板"}「${resource.name}」？`)) return;
    const response = await fetch(
      `/api/resources/${resource.kind === "skill" ? "skills" : "templates"}/${resource.scope}/${encodeURIComponent(resource.name)}`,
      { method: "DELETE", credentials: "include" },
    );
    if (!response.ok) {
      setMessage(await responseMessage(response, "删除资源失败"));
      return;
    }
    await load();
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-[hsl(var(--border))] p-5" data-resource-manager>
      <header>
        <h2 className="text-lg font-semibold">pi 资源管理</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Skill 与 pi 原生 Prompt Template，按公司、Agent、个人分层。</p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="资源类型">
        {(["skill", "template"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={kind === value}
            onClick={() => setKind(value)}
            className={`rounded-md px-3 py-1.5 text-sm ${kind === value ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "border border-[hsl(var(--border))]"}`}
          >
            {value === "skill" ? "Skills" : "Prompt Templates"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="资源作用域">
        {scopes.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={scope === item.id}
            onClick={() => setScope(item.id)}
            className={`rounded-md px-3 py-1.5 text-sm ${scope === item.id ? "bg-[hsl(var(--secondary))] font-medium" : "text-[hsl(var(--muted-foreground))]"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-[hsl(var(--muted-foreground))]">加载中…</p> : (
        <div className="flex flex-col gap-2" data-resource-list>
          {resources.length === 0 ? <p className="text-sm text-[hsl(var(--muted-foreground))]">暂无资源</p> : resources.map((resource) => (
            <div key={`${resource.kind}:${resource.scope}:${resource.name}`} className="flex items-start gap-3 rounded-md border border-[hsl(var(--border))] p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{resource.name}</div>
                {resource.description ? <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{resource.description}</div> : null}
                {resource.argumentHint ? <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">参数：{resource.argumentHint}</div> : null}
              </div>
              <button type="button" className="text-xs text-[hsl(var(--destructive))]" onClick={() => void remove(resource)}>删除</button>
            </div>
          ))}
        </div>
      )}

      <form className="grid gap-3 border-t border-[hsl(var(--border))] pt-4" onSubmit={(event) => void create(event)}>
        <h3 className="text-sm font-medium">创建{kind === "skill" ? " Skill" : "模板"}</h3>
        <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="名称，如 image-review" className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm" />
        <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="描述（可选）" className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm" />
        {kind === "template" ? <input value={argumentHint} onChange={(event) => setArgumentHint(event.target.value)} placeholder="参数提示，如 $ARGUMENTS（可选）" className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm" /> : null}
        <textarea required value={content} onChange={(event) => setContent(event.target.value)} placeholder={kind === "template" ? "模板正文，可用 $1、$@、$ARGUMENTS" : "Skill 正文"} rows={6} className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm" />
        <button type="submit" disabled={saving} className="w-fit rounded-md bg-[hsl(var(--primary))] px-3 py-2 text-sm text-[hsl(var(--primary-foreground))] disabled:opacity-50">{saving ? "创建中…" : "创建"}</button>
      </form>
      {message ? <p role="status" className="text-sm text-[hsl(var(--muted-foreground))]">{message}</p> : null}
    </section>
  );
}
