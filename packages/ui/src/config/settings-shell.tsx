/**
 * SettingsShell — 设置外壳:左侧面板导航(注册表 listPanels) + 右侧当前面板表单。
 *
 * 每个面板经 useConfigDomain 驱动:加载值 → <SchemaForm> 受控校验 → 保存。
 * 加载/保存/错误/已保存态就地呈现。新增配置域只需向注册表注册面板,无需改本组件。
 */
import * as React from "react";
import {
  useConfigDomain,
  defaultSettingsRegistry,
  type SettingsRegistry,
  type SettingsPanelDescriptor,
} from "@blksails/pi-web-react";
import { SchemaForm } from "./schema-form.js";
import type { FieldRegistry } from "./field-registry.js";
import { Button } from "../ui/button.js";
import { cn } from "../lib/cn.js";

export interface SettingsShellProps {
  readonly registry?: SettingsRegistry;
  readonly fieldRegistry?: FieldRegistry;
  readonly className?: string;
}

/** 一组(左侧一个菜单项):含 1+ 个面板,>1 时以 Tab 切换。 */
interface PanelGroup {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly panels: readonly SettingsPanelDescriptor[];
}

/** 把已排序的扁平面板列表按 `group` 聚合为分组(组内按 tabOrder 排序、组间按 groupOrder)。 */
function buildGroups(panels: readonly SettingsPanelDescriptor[]): PanelGroup[] {
  const map = new Map<string, { title: string; order: number; panels: SettingsPanelDescriptor[] }>();
  const seen: string[] = [];
  for (const p of panels) {
    const gid = p.group ?? p.id;
    let g = map.get(gid);
    if (g === undefined) {
      g = { title: p.groupTitle ?? p.title, order: p.groupOrder ?? p.order ?? Number.MAX_SAFE_INTEGER, panels: [] };
      map.set(gid, g);
      seen.push(gid);
    }
    if (p.groupTitle !== undefined) g.title = p.groupTitle;
    if (p.groupOrder !== undefined) g.order = p.groupOrder;
    g.panels.push(p);
  }
  return seen
    .map((id) => {
      const g = map.get(id)!;
      const sorted = [...g.panels].sort(
        (a, b) => (a.tabOrder ?? 0) - (b.tabOrder ?? 0),
      );
      return { id, title: g.title, order: g.order, panels: sorted };
    })
    .sort((a, b) => (a.order === b.order ? 0 : a.order - b.order));
}

export function SettingsShell({
  registry = defaultSettingsRegistry,
  fieldRegistry,
  className,
}: SettingsShellProps): React.JSX.Element {
  const groups = buildGroups(registry.listPanels());
  const [activeGroupId, setActiveGroupId] = React.useState<string | undefined>(
    groups[0]?.id,
  );
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0];

  // 组内当前 Tab(面板 id);切组时回退到该组首个面板。
  const [activeTabId, setActiveTabId] = React.useState<string | undefined>(
    activeGroup?.panels[0]?.id,
  );
  const activePanel =
    activeGroup?.panels.find((p) => p.id === activeTabId) ?? activeGroup?.panels[0];

  if (activeGroup === undefined || activePanel === undefined) {
    return (
      <div className={cn("p-6 text-sm text-[hsl(var(--muted-foreground))]", className)}>
        无可用设置面板
      </div>
    );
  }

  const selectGroup = (g: PanelGroup): void => {
    setActiveGroupId(g.id);
    setActiveTabId(g.panels[0]?.id);
  };

  return (
    <div className={cn("flex gap-6", className)} data-pi-settings-shell>
      <nav className="flex w-48 shrink-0 flex-col gap-1" aria-label="设置分区">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            data-pi-settings-nav={g.id}
            aria-current={g.id === activeGroup.id}
            onClick={() => selectGroup(g)}
            className={cn(
              "rounded-md px-3 py-2 text-left text-sm transition-colors",
              g.id === activeGroup.id
                ? "bg-[hsl(var(--secondary))] font-medium text-[hsl(var(--secondary-foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]",
            )}
          >
            {g.title}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {activeGroup.panels.length > 1 ? (
          <div
            role="tablist"
            aria-label={`${activeGroup.title} 范围`}
            className="mb-4 inline-flex gap-1 rounded-lg bg-[hsl(var(--muted))] p-1"
          >
            {activeGroup.panels.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === activePanel.id}
                data-pi-settings-tab={p.id}
                onClick={() => setActiveTabId(p.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  p.id === activePanel.id
                    ? "bg-[hsl(var(--background))] font-medium text-[hsl(var(--foreground))] shadow-sm"
                    : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
                )}
              >
                {p.tabLabel ?? p.title}
              </button>
            ))}
          </div>
        ) : null}
        <ConfigPanelView key={activePanel.id} panel={activePanel} fieldRegistry={fieldRegistry} />
      </div>
    </div>
  );
}

function ConfigPanelView({
  panel,
  fieldRegistry,
}: {
  readonly panel: SettingsPanelDescriptor;
  readonly fieldRegistry?: FieldRegistry;
}): React.JSX.Element {
  const { form, loading, loadError, saving, saveError, saved, save, fileSchemas } =
    useConfigDomain(panel);

  return (
    <section className="flex flex-col gap-4" data-pi-settings-panel={panel.id}>
      <header>
        <h2 className="text-lg font-semibold">{panel.formSchema.title ?? panel.title}</h2>
      </header>

      {loading ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">加载中…</p>
      ) : loadError !== undefined ? (
        <p role="alert" className="text-sm text-[hsl(var(--destructive))]">
          {loadError}
        </p>
      ) : (
        <>
          <SchemaForm
            formSchema={panel.formSchema}
            values={form.values}
            onChange={form.setValues}
            errors={form.errors}
            registry={fieldRegistry}
            disabled={saving}
            fileSchemas={fileSchemas}
          />
          <div className="flex items-center gap-3">
            <Button type="button" onClick={() => void save()} disabled={saving || !form.dirty}>
              {saving ? "保存中…" : "保存"}
            </Button>
            {saved ? (
              <span className="text-sm text-[hsl(var(--muted-foreground))]">已保存</span>
            ) : null}
            {saveError !== undefined ? (
              <span role="alert" className="text-sm text-[hsl(var(--destructive))]">
                {saveError}
              </span>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
