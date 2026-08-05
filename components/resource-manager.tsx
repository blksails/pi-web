import * as React from "react";

type Scope = "company" | "agent" | "personal";
export type ResourceKind = "skill" | "template";

interface Resource {
  readonly kind: ResourceKind;
  readonly scope: Scope;
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly sourceTitle?: string;
  readonly coverImage?: string;
  readonly path: string;
}

interface ResourcePermission {
  readonly visible: boolean;
  readonly editable: boolean;
  readonly canPublish: boolean;
}

interface Catalog {
  readonly skills: readonly Resource[];
  readonly templates: readonly Resource[];
  readonly permissions?: Partial<Record<Scope, ResourcePermission>>;
  readonly agent?: { readonly id: string; readonly name: string };
}

interface AgentOption {
  readonly id: string;
  readonly name: string;
}

interface IdentityView {
  readonly state?: string;
  readonly tenant?: { readonly companyId?: string };
}

interface FormState {
  name: string;
  title: string;
  description: string;
  argumentHint: string;
  sourceTitle: string;
  coverImage: string;
  content: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  title: "",
  description: "",
  argumentHint: "",
  sourceTitle: "",
  coverImage: "",
  content: "",
};

const scopeLabels: Readonly<Record<Scope, string>> = {
  company: "公司",
  agent: "Agent",
  personal: "个人",
};

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    const message = body.error?.message;
    if (typeof message === "string" && message.length > 0) return message;
  } catch {
    // 保留状态码兜底。
  }
  return `${fallback}（${response.status}）`;
}

async function successMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as {
      validation?: { warnings?: ReadonlyArray<{ message?: unknown }> };
    };
    const warnings = body.validation?.warnings?.flatMap((item) => typeof item.message === "string" ? [item.message] : []) ?? [];
    return warnings.length === 0 ? fallback : `${fallback}；校验提示：${warnings.join(" ")}`;
  } catch {
    return fallback;
  }
}

function resourcePath(resource: Pick<Resource, "kind" | "scope" | "name">): string {
  return `/api/resources/${resource.kind === "skill" ? "skills" : "templates"}/${resource.scope}/${encodeURIComponent(resource.name)}`;
}

function useResourceIdentity(): {
  readonly loading: boolean;
  readonly approvedCompany: boolean;
} {
  const [state, setState] = React.useState<{ loading: boolean; approvedCompany: boolean }>({
    loading: true,
    approvedCompany: false,
  });
  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/identity", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) return undefined;
        return (await response.json()) as IdentityView;
      })
      .then((identity) => {
        if (cancelled) return;
        setState({
          loading: false,
          approvedCompany:
            identity?.state === "authenticated" &&
            typeof identity.tenant?.companyId === "string" &&
            identity.tenant.companyId.trim().length > 0,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, approvedCompany: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function ResourceSettingsPanel({ kind }: { readonly kind: ResourceKind }): React.JSX.Element {
  const { loading: identityLoading, approvedCompany } = useResourceIdentity();
  const [scope, setScope] = React.useState<Scope>("personal");
  const [agentId, setAgentId] = React.useState("");
  const [agents, setAgents] = React.useState<readonly AgentOption[]>([]);
  const [catalog, setCatalog] = React.useState<Catalog>({ skills: [], templates: [] });
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = React.useState<Resource | undefined>();
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string>();

  const loadAgents = React.useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/resources/agents", { credentials: "include" });
      if (!response.ok) return;
      const body = (await response.json()) as { agents?: readonly AgentOption[] };
      const next = body.agents ?? [];
      setAgents(next);
      setAgentId((current) => current || next[0]?.id || "");
    } catch {
      setAgents([]);
    }
  }, []);

  React.useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const load = React.useCallback(async (): Promise<void> => {
    if (scope === "agent" && agentId.length === 0) {
      setCatalog({ skills: [], templates: [] });
      return;
    }
    setLoading(true);
    try {
      const query = agentId.length > 0 ? `?agent=${encodeURIComponent(agentId)}` : "";
      const response = await fetch(`/api/resources${query}`, { credentials: "include" });
      if (!response.ok) throw new Error(await responseMessage(response, "加载资源失败"));
      setCatalog((await response.json()) as Catalog);
      setMessage(undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载资源失败");
    } finally {
      setLoading(false);
    }
  }, [agentId, scope]);

  React.useEffect(() => {
    if (!identityLoading) void load();
  }, [identityLoading, load]);

  React.useEffect(() => {
    if (!approvedCompany && scope === "company") setScope("personal");
  }, [approvedCompany, scope]);

  const resources = (kind === "skill" ? catalog.skills : catalog.templates).filter(
    (resource) => resource.scope === scope,
  );
  const permission = catalog.permissions?.[scope];
  const canEdit = permission?.editable ?? scope === "personal";
  const selectedAgent = agents.find((agent) => agent.id === agentId);

  const startCreate = (): void => {
    setEditing(undefined);
    setForm(EMPTY_FORM);
    setMessage(undefined);
  };

  const edit = async (resource: Resource): Promise<void> => {
    setMessage(undefined);
    const query = resource.scope === "agent" ? `?agent=${encodeURIComponent(agentId)}` : "";
    const response = await fetch(`${resourcePath(resource)}${query}`, { credentials: "include" });
    if (!response.ok) {
      setMessage(await responseMessage(response, "读取资源失败"));
      return;
    }
    const body = (await response.json()) as { resource?: Resource & { content?: string } };
    const document = body.resource;
    if (document === undefined) return;
    setEditing(resource);
    setForm({
      name: resource.name,
      title: document.title ?? "",
      description: document.description ?? "",
      argumentHint: document.argumentHint ?? "",
      sourceTitle: document.sourceTitle ?? "",
      coverImage: document.coverImage ?? "",
      content: document.content ?? "",
    });
  };

  const save = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    try {
      const payload = {
        scope,
        name: form.name.trim(),
        ...(kind === "skill" ? { title: form.title.trim() || undefined } : {}),
        description: form.description.trim() || undefined,
        content: form.content,
        ...(scope === "agent" ? { agentId } : {}),
        ...(kind === "template"
          ? {
              argumentHint: form.argumentHint.trim() || undefined,
              sourceTitle: form.sourceTitle.trim() || undefined,
              coverImage: form.coverImage.trim() || undefined,
            }
          : {}),
      };
      const response = await fetch(
        editing === undefined
          ? `/api/resources/${kind === "skill" ? "skills" : "templates"}`
          : `${resourcePath(editing)}${editing.scope === "agent" ? `?agent=${encodeURIComponent(agentId)}` : ""}`,
        {
          method: editing === undefined ? "POST" : "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(editing === undefined ? payload : {
            ...payload,
            ...(editing.scope === "agent" ? { agentId } : {}),
          }),
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response, "保存资源失败"));
      const success = await successMessage(response, editing === undefined ? "已创建" : "已保存");
      await load();
      startCreate();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存资源失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (resource: Resource): Promise<void> => {
    if (!window.confirm(`删除${kind === "skill" ? " Skill" : "模板"}「${resource.name}」？`)) return;
    const query = resource.scope === "agent" ? `?agent=${encodeURIComponent(agentId)}` : "";
    const response = await fetch(`${resourcePath(resource)}${query}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      setMessage(await responseMessage(response, "删除资源失败"));
      return;
    }
    if (editing?.name === resource.name) startCreate();
    await load();
  };

  const promote = async (resource: Resource, targetScope: "company" | "agent"): Promise<void> => {
    const targetAgentId = targetScope === "agent" ? agentId : undefined;
    if (targetScope === "agent" && agentId.length === 0) {
      setMessage("请先选择 Agent");
      return;
    }
    const response = await fetch(`${resourcePath(resource)}/promote`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetScope,
        ...(resource.scope === "agent" ? { sourceAgentId: agentId } : {}),
        ...(targetAgentId !== undefined ? { targetAgentId } : {}),
      }),
    });
    if (response.ok) {
      setMessage(await successMessage(response, `已设置为${scopeLabels[targetScope]}级`));
      await load();
    } else {
      setMessage(await responseMessage(response, "发布资源失败"));
    }
  };

  const onCoverFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    if (!file.type.startsWith("image/") || file.size > 384 * 1024) {
      setMessage("封面图须为图片且不超过 384KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setForm((current) => ({ ...current, coverImage: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const scopes: readonly Scope[] = [
    ...(approvedCompany ? (["company"] as const) : []),
    "agent",
    "personal",
  ];
  const title = kind === "skill" ? "Skills" : "提示词模板";

  return (
    <section className="flex flex-col gap-4" data-resource-settings={kind}>
      <header>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {kind === "skill"
            ? "按层级管理 Skill；公司级与 Agent 级资源对用户作为默认技能。"
            : "按层级管理 Prompt Template；源数据会用于聊天快捷卡片。"}
        </p>
      </header>

      {identityLoading ? <p className="text-sm text-[hsl(var(--muted-foreground))]">正在确认公司归属…</p> : null}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={`${title}作用域`}>
        {scopes.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={scope === item}
            onClick={() => { setScope(item); startCreate(); }}
            className={`rounded-md px-3 py-1.5 text-sm ${scope === item ? "bg-[hsl(var(--secondary))] font-medium" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`}
          >
            {scopeLabels[item]}
          </button>
        ))}
      </div>

      {scope === "agent" ? (
        <label className="grid gap-1 text-sm">
          <span className="text-[hsl(var(--muted-foreground))]">已加载 Agent</span>
          <select
            value={agentId}
            onChange={(event) => { setAgentId(event.target.value); startCreate(); }}
            className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2"
          >
            <option value="">请选择 Agent</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          {selectedAgent === undefined ? <span className="text-xs text-[hsl(var(--muted-foreground))]">仅可编辑已加载的本地 Agent。</span> : null}
        </label>
      ) : null}

      {loading ? <p className="text-sm text-[hsl(var(--muted-foreground))]">加载中…</p> : null}
      {!loading && scope === "agent" && agentId.length === 0 ? <p className="text-sm text-[hsl(var(--muted-foreground))]">请选择 Agent 后查看资源。</p> : null}
      {!loading && (scope !== "agent" || agentId.length > 0) ? (
        <div className="flex flex-col gap-2" data-resource-list>
          {resources.length === 0 ? <p className="text-sm text-[hsl(var(--muted-foreground))]">暂无资源</p> : resources.map((resource) => (
            <article key={`${resource.scope}:${resource.name}`} className="flex items-start gap-3 rounded-lg border border-[hsl(var(--border))] p-3">
              {kind === "template" && resource.coverImage ? <img src={resource.coverImage} alt="" className="h-12 w-16 rounded object-cover" /> : null}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{kind === "skill" ? resource.title || resource.name : resource.sourceTitle || resource.name}</div>
                {resource.description ? <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{resource.description}</div> : null}
                {resource.argumentHint ? <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">参数：{resource.argumentHint}</div> : null}
              </div>
              {permission?.editable ? <button type="button" className="text-xs" onClick={() => void edit(resource)}>编辑</button> : null}
              {permission?.editable ? <button type="button" className="text-xs text-[hsl(var(--destructive))]" onClick={() => void remove(resource)}>删除</button> : null}
              {resource.scope !== "agent" && catalog.permissions?.agent?.canPublish && agentId.length > 0 ? <button type="button" className="text-xs" onClick={() => void promote(resource, "agent")}>设为 Agent 级</button> : null}
              {resource.scope !== "company" && catalog.permissions?.company?.canPublish ? <button type="button" className="text-xs" onClick={() => void promote(resource, "company")}>设为公司级</button> : null}
            </article>
          ))}
        </div>
      ) : null}

      {canEdit && (scope !== "agent" || agentId.length > 0) ? (
        <form className="grid gap-3 border-t border-[hsl(var(--border))] pt-4" onSubmit={(event) => void save(event)}>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{editing === undefined ? `新建${kind === "skill" ? " Skill" : "模板"}` : `编辑${editing.name}`}</h3>
            {editing !== undefined ? <button type="button" className="ml-auto text-xs text-[hsl(var(--muted-foreground))]" onClick={startCreate}>取消编辑</button> : null}
          </div>
          <input required value={form.name} disabled={editing !== undefined} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="名称，如 image-review" className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm disabled:opacity-60" />
          {kind === "skill" ? <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="显示标题（读取/写入 Skill 元数据）" className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm" /> : null}
          <input required={kind === "skill"} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={kind === "skill" ? "描述（必填，pi 据此发现 Skill）" : "描述（可选）"} className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm" />
          {kind === "template" ? <>
            <input value={form.argumentHint} onChange={(event) => setForm((current) => ({ ...current, argumentHint: event.target.value }))} placeholder="参数提示，如 $ARGUMENTS（可选）" className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm" />
            <input value={form.sourceTitle} onChange={(event) => setForm((current) => ({ ...current, sourceTitle: event.target.value }))} placeholder="源数据标题（聊天卡片标题）" className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm" />
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input value={form.coverImage} onChange={(event) => setForm((current) => ({ ...current, coverImage: event.target.value }))} placeholder="封面图 URL 或选择本地图片" className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm" />
              <input type="file" accept="image/*" onChange={onCoverFile} className="max-w-full text-xs" />
            </div>
            {form.coverImage ? <img src={form.coverImage} alt="封面预览" className="h-20 w-32 rounded object-cover" /> : null}
          </> : null}
          <textarea required value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} placeholder={kind === "template" ? "模板正文，可用 $1、$@、$ARGUMENTS" : "Skill 正文"} rows={8} className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm" />
          <button type="submit" disabled={saving} className="w-fit rounded-md bg-[hsl(var(--primary))] px-3 py-2 text-sm text-[hsl(var(--primary-foreground))] disabled:opacity-50">{saving ? "保存中…" : editing === undefined ? "创建" : "保存"}</button>
        </form>
      ) : <p className="rounded-md bg-[hsl(var(--muted))] p-3 text-sm text-[hsl(var(--muted-foreground))]">当前身份只有查看权限；发布者/管理者或公司 owner/admin 才可编辑。</p>}

      {message ? <p role="status" className="text-sm text-[hsl(var(--muted-foreground))]">{message}</p> : null}
    </section>
  );
}
