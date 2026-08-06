import * as React from "react";
import { Zap } from "lucide-react";
import { Pill } from "@blksails/pi-web-primitives";
import { cn } from "../lib/cn.js";
import { useIcon } from "../customization/icons.js";

export interface ChatResourceConfig {
  /** 当前会话使用的已加载 Agent source id。 */
  readonly agentId?: string;
  readonly endpoint?: string;
}

type Scope = "company" | "agent" | "personal";
type ResourceKind = "skill" | "template";

interface Resource {
  readonly kind: ResourceKind;
  readonly scope: Scope;
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly sourceTitle?: string;
  readonly coverImage?: string;
}

interface Catalog {
  readonly skills: readonly Resource[];
  readonly templates: readonly Resource[];
}

interface ResourceDocument extends Resource {
  readonly content: string;
}

interface FormState {
  name: string;
  title: string;
  description: string;
  content: string;
}

const EMPTY_FORM: FormState = { name: "", title: "", description: "", content: "" };

function apiUrl(config: ChatResourceConfig, path: string): string {
  return `${config.endpoint ?? "/api"}${path}`;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // 用状态码兜底。
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

function resourceUrl(config: ChatResourceConfig, resource: Resource): string {
  return apiUrl(
    config,
    `/resources/${resource.kind === "skill" ? "skills" : "templates"}/${resource.scope}/${encodeURIComponent(resource.name)}`,
  );
}

function useCatalog(config: ChatResourceConfig): {
  readonly catalog: Catalog;
  readonly reload: () => Promise<void>;
} {
  const [catalog, setCatalog] = React.useState<Catalog>({ skills: [], templates: [] });
  const endpoint = config.endpoint ?? "/api";
  const agentId = config.agentId;
  const reload = React.useCallback(async (): Promise<void> => {
    const query = agentId !== undefined && agentId.length > 0
      ? `?agent=${encodeURIComponent(agentId)}`
      : "";
    try {
      const response = await fetch(`${endpoint}/resources${query}`, { credentials: "include" });
      if (!response.ok) return;
      setCatalog((await response.json()) as Catalog);
    } catch {
      setCatalog({ skills: [], templates: [] });
    }
  }, [agentId, endpoint]);
  React.useEffect(() => {
    void reload();
  }, [reload]);
  return { catalog, reload };
}

export function SkillPill({
  config,
  value,
  onInsert,
}: {
  readonly config: ChatResourceConfig;
  readonly value: string;
  readonly onInsert: (value: string) => void;
}): React.JSX.Element {
  const { catalog, reload } = useCatalog(config);
  const SkillIcon = useIcon("skill", Zap);
  const [open, setOpen] = React.useState(false);
  const [manageOpen, setManageOpen] = React.useState(false);
  return (
    <div className="relative" data-pi-skill-pill>
      <Pill
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="gap-1.5"
      >
        <SkillIcon className="h-3.5 w-3.5" aria-hidden="true" />
        技能
      </Pill>
      {open ? (
        <div role="menu" className="absolute bottom-full left-0 z-40 mb-2 min-w-56 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-1 text-[hsl(var(--popover-foreground))] shadow-lg">
          {catalog.skills.length === 0 ? <p className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">暂无可用技能</p> : catalog.skills.map((skill) => (
            <button
              key={`${skill.scope}:${skill.name}`}
              type="button"
              role="menuitem"
              onClick={() => { onInsert(`/skill:${skill.name} `); setOpen(false); }}
              className="flex w-full flex-col rounded px-2 py-1.5 text-left text-xs hover:bg-[hsl(var(--accent))]"
            >
              <span className="font-medium">{skill.title || skill.name}</span>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{skill.scope === "personal" ? "个人" : skill.scope === "agent" ? "Agent 默认" : "公司默认"}</span>
            </button>
          ))}
          <div className="my-1 border-t border-[hsl(var(--border))]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => { setManageOpen(true); setOpen(false); }}
            className="w-full rounded px-2 py-2 text-left text-xs font-medium hover:bg-[hsl(var(--accent))]"
          >
            管理技能
          </button>
        </div>
      ) : null}
      {manageOpen ? <PersonalSkillDialog config={config} skills={catalog.skills.filter((item) => item.scope === "personal")} onClose={() => setManageOpen(false)} onChanged={() => void reload()} /> : null}
      <span className="sr-only">{value}</span>
    </div>
  );
}

function PersonalSkillDialog({
  config,
  skills,
  onClose,
  onChanged,
}: {
  readonly config: ChatResourceConfig;
  readonly skills: readonly Resource[];
  readonly onClose: () => void;
  readonly onChanged: () => void;
}): React.JSX.Element {
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = React.useState<Resource | undefined>();
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string>();

  const edit = async (resource: Resource): Promise<void> => {
    const response = await fetch(resourceUrl(config, resource), { credentials: "include" });
    if (!response.ok) {
      setMessage(await errorMessage(response, "读取技能失败"));
      return;
    }
    const body = (await response.json()) as { resource?: ResourceDocument };
    const doc = body.resource;
    if (doc === undefined) return;
    setEditing(resource);
    setForm({ name: resource.name, title: doc.title ?? "", description: doc.description, content: doc.content });
  };

  const save = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    const payload = {
      ...(editing === undefined ? { scope: "personal", name: form.name.trim() } : {}),
      title: form.title.trim() || undefined,
      description: form.description.trim() || undefined,
      content: form.content,
    };
    const response = await fetch(
      editing === undefined ? apiUrl(config, "/resources/skills") : resourceUrl(config, editing),
      {
        method: editing === undefined ? "POST" : "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) setMessage(await errorMessage(response, "保存技能失败"));
    else {
      setForm(EMPTY_FORM);
      setEditing(undefined);
      onChanged();
      setMessage(await successMessage(response, "已保存"));
    }
    setSaving(false);
  };

  const remove = async (resource: Resource): Promise<void> => {
    const response = await fetch(resourceUrl(config, resource), { method: "DELETE", credentials: "include" });
    if (!response.ok) setMessage(await errorMessage(response, "删除技能失败"));
    else {
      if (editing?.name === resource.name) {
        setEditing(undefined);
        setForm(EMPTY_FORM);
      }
      onChanged();
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="pi-personal-skill-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-5 shadow-2xl">
        <header className="flex items-center gap-3">
          <h2 id="pi-personal-skill-title" className="text-base font-semibold">管理个人技能</h2>
          <button type="button" className="ml-auto text-sm text-[hsl(var(--muted-foreground))]" onClick={onClose}>关闭</button>
        </header>
        <div className="mt-4 grid gap-2">
          {skills.length === 0 ? <p className="text-sm text-[hsl(var(--muted-foreground))]">暂无个人技能</p> : skills.map((skill) => (
            <div key={skill.name} className="flex items-center gap-2 rounded border border-[hsl(var(--border))] px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">{skill.title || skill.name}</span>
              <button type="button" className="text-xs" onClick={() => void edit(skill)}>编辑</button>
              <button type="button" className="text-xs text-[hsl(var(--destructive))]" onClick={() => void remove(skill)}>删除</button>
            </div>
          ))}
        </div>
        <form className="mt-4 grid gap-3 border-t border-[hsl(var(--border))] pt-4" onSubmit={(event) => void save(event)}>
          <div className="flex items-center gap-2"><h3 className="text-sm font-medium">{editing === undefined ? "新建个人技能" : `编辑 ${editing.name}`}</h3>{editing !== undefined ? <button type="button" className="ml-auto text-xs" onClick={() => { setEditing(undefined); setForm(EMPTY_FORM); }}>取消</button> : null}</div>
          <input required value={form.name} disabled={editing !== undefined} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="名称" className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm disabled:opacity-60" />
          <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="显示标题（Skill 元数据）" className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm" />
          <input required value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="描述（必填，pi 据此发现 Skill）" className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm" />
          <textarea required value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} placeholder="Skill 正文" rows={7} className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm" />
          <button type="submit" disabled={saving} className="w-fit rounded-md bg-[hsl(var(--primary))] px-3 py-2 text-sm text-[hsl(var(--primary-foreground))]">{saving ? "保存中…" : "保存"}</button>
        </form>
        {message ? <p role="status" className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">{message}</p> : null}
      </section>
    </div>
  );
}

export function PromptTemplateCards({
  config,
  onSelect,
}: {
  readonly config: ChatResourceConfig;
  readonly onSelect: (content: string) => void;
}): React.JSX.Element | null {
  const { catalog } = useCatalog(config);
  const [loading, setLoading] = React.useState<string>();
  if (catalog.templates.length === 0) return null;
  const select = async (template: Resource): Promise<void> => {
    setLoading(template.name);
    try {
      const query = template.scope === "agent" && config.agentId !== undefined
        ? `?agent=${encodeURIComponent(config.agentId)}`
        : "";
      const response = await fetch(`${resourceUrl(config, template)}${query}`, { credentials: "include" });
      if (!response.ok) return;
      const body = (await response.json()) as { resource?: ResourceDocument };
      if (body.resource?.content !== undefined) onSelect(body.resource.content);
    } finally {
      setLoading(undefined);
    }
  };
  return (
    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-pi-prompt-template-cards>
      {catalog.templates.map((template) => (
        <button key={`${template.scope}:${template.name}`} type="button" disabled={loading !== undefined} onClick={() => void select(template)} className={cn("group overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[hsl(var(--ring))]", loading === template.name ? "opacity-60" : "")}>
          {template.coverImage ? <img src={template.coverImage} alt="" className="h-20 w-full object-cover" /> : <div className="h-2 bg-[hsl(var(--primary))]/20" />}
          <span className="block px-3 pb-1 pt-2 text-sm font-medium">{template.sourceTitle || template.name}</span>
          <span className="block truncate px-3 pb-3 text-xs text-[hsl(var(--muted-foreground))]">{template.description || "使用此提示词模板"}</span>
        </button>
      ))}
    </div>
  );
}
