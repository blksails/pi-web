/**
 * WebSearchToggle — 无状态受控的"联网/网络搜索"开关(Req 6.1/6.2、11.5)。
 *
 * 受控元件:状态由父/装配层持有(`enabled`),"持久化于当前输入会话"由父维护;本元件只
 * 受控显示当前状态并在点击时回传切换(`onToggle(!enabled)`,Req 6.2)。默认关闭场景由父
 * 传 `enabled=false`(Req 6.1),本元件不持有任何内部开关状态。
 *
 * 渲染一个可切换按钮(lucide Globe 图标 + 既有 Button 基元),`aria-pressed={enabled}` 反映
 * 受控态、`aria-label` 满足无障碍;`disabled` 时禁用且不回传。主题经 shadcn CSS 变量(cn +
 * 既有基元),无硬编码颜色(Req 11.5)。
 *
 * 本元件无 pi 接线逻辑:联网意图的传达由装配层(PiChat,Req 6.3/6.4)处理。
 */
import * as React from "react";
import { Globe } from "lucide-react";
import { useIcon } from "../customization/icons.js";
import { Button } from "../ui/button.js";
import { cn } from "../lib/cn.js";

export interface WebSearchToggleProps {
  /** 受控开关状态;默认场景由父传 false(Req 6.1)。 */
  readonly enabled: boolean;
  /** 切换回调,回传取反后的目标状态(Req 6.2)。 */
  readonly onToggle: (next: boolean) => void;
  /** 无障碍标签 / 提示,默认中文"联网搜索"。 */
  readonly label?: string;
  /** 禁用开关(如能力不可用时由父决定);禁用时不回传。 */
  readonly disabled?: boolean;
  readonly className?: string;
}

export function WebSearchToggle({
  enabled,
  onToggle,
  label = "联网搜索",
  disabled = false,
  className,
}: WebSearchToggleProps): React.JSX.Element {
  const GlobeIcon = useIcon("webSearch", Globe);
  const handleClick = (): void => {
    // 受控:仅回传取反目标态,自身不持有状态(Req 6.2)。
    onToggle(!enabled);
  };

  return (
    <Button
      type="button"
      variant={enabled ? "secondary" : "ghost"}
      size="icon"
      aria-label={label}
      aria-pressed={enabled}
      disabled={disabled}
      onClick={handleClick}
      className={cn(enabled && "text-[hsl(var(--primary))]", className)}
      data-pi-web-search-toggle
      data-enabled={enabled ? "true" : "false"}
    >
      <GlobeIcon className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}
