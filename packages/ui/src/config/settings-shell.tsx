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
} from "@pi-web/react";
import { SchemaForm } from "./schema-form.js";
import type { FieldRegistry } from "./field-registry.js";
import { Button } from "../ui/button.js";
import { cn } from "../lib/cn.js";

export interface SettingsShellProps {
  readonly registry?: SettingsRegistry;
  readonly fieldRegistry?: FieldRegistry;
  readonly className?: string;
}

export function SettingsShell({
  registry = defaultSettingsRegistry,
  fieldRegistry,
  className,
}: SettingsShellProps): React.JSX.Element {
  const panels = registry.listPanels();
  const [activeId, setActiveId] = React.useState<string | undefined>(
    panels[0]?.id,
  );
  const active = panels.find((p) => p.id === activeId) ?? panels[0];

  if (active === undefined) {
    return (
      <div className={cn("p-6 text-sm text-[hsl(var(--muted-foreground))]", className)}>
        无可用设置面板
      </div>
    );
  }

  return (
    <div className={cn("flex gap-6", className)} data-pi-settings-shell>
      <nav className="flex w-48 shrink-0 flex-col gap-1" aria-label="设置分区">
        {panels.map((p) => (
          <button
            key={p.id}
            type="button"
            data-pi-settings-nav={p.id}
            aria-current={p.id === active.id}
            onClick={() => setActiveId(p.id)}
            className={cn(
              "rounded-md px-3 py-2 text-left text-sm transition-colors",
              p.id === active.id
                ? "bg-[hsl(var(--secondary))] font-medium text-[hsl(var(--secondary-foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]",
            )}
          >
            {p.title}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <ConfigPanelView key={active.id} panel={active} fieldRegistry={fieldRegistry} />
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
  const { form, loading, loadError, saving, saveError, saved, save } =
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
