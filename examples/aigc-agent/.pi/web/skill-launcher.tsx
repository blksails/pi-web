/** headerRight 槽:「🧩 技能」入口按钮,toggle skill 面板。用 pi-web 设计系统 class。 */
import * as React from "react";
import { toggleSkillPanel, useSkillPanelOpen } from "./skill-panel-store.js";

export function SkillLauncher(): React.JSX.Element {
  const open = useSkillPanelOpen();
  return (
    <button
      type="button"
      data-testid="skill-launcher"
      aria-pressed={open}
      onClick={toggleSkillPanel}
      title="Skill 管理"
      className={
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors " +
        (open
          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
          : "border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]")
      }
    >
      <span aria-hidden>🧩</span>
      <span>技能</span>
    </button>
  );
}
