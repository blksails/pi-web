/**
 * 工具卡 pill 契约(ui-redesign pill 系统):
 * agent 可在工具结果 `details.pills` 声明「可点击动作条」,宿主工具卡把它渲染为一排 pill。
 * 契约保持惰性宽松:label 为唯一必填,action/src/copyText 均可选;
 * 未知 action 由宿主惰性展示(不产生副作用),保证协议演进期旧宿主不吃未知值崩溃。
 */
export type ToolPillAction = "download" | "open" | "copy" | (string & {});

export interface ToolPill {
  /** pill 展示文本;必填。 */
  label: string;
  /** 动作语义;未知值宿主仅展示不执行。 */
  action?: ToolPillAction;
  /** 目标 URL(供 download/open)。 */
  src?: string;
  /** 复制动作的文本(缺省回落 src → label)。 */
  copyText?: string;
}
