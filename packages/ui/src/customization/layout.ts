/**
 * 布局预设到 className 的映射(pi-chat-customization 任务 1.4)。
 *
 * 仅提供有限预设枚举,不开放任意 grid template(超范围)。`split` 划出并列让位区,
 * 其内容由现有 slots/children 承接(本期不实现 Artifact 专属功能,Req 7.4)。
 */

export type LayoutPreset = "centered" | "wide" | "full" | "split";

/**
 * panelRight 让位比例(对话区 : 右侧面板)。运行时可由宿主段控切换器在三档间切换。
 * 与 protocol `PanelRatio` 同形(此处独立声明,避免 customization 反向依赖契约枚举值)。
 */
export type PanelRatio = "centered" | "2:1" | "4:6" | "3:7";

export const PANEL_RATIOS: ReadonlyArray<PanelRatio> = ["centered", "2:1", "4:6", "3:7"];

/** 段控切换器上的可读标签。 */
export const PANEL_RATIO_LABEL: Record<PanelRatio, string> = {
  centered: "居中",
  "2:1": "2:1",
  "4:6": "4:6",
  "3:7": "3:7",
};

/**
 * 各比例下右侧 aside 的宽度(占容器百分比);对话列为 flex-1 自动吃掉余量。
 * `centered` 收起 aside(返回 undefined),由对话列独占并经 lay.content 居中。
 */
export const PANEL_RATIO_ASIDE_WIDTH: Record<PanelRatio, string | undefined> = {
  centered: undefined,
  "2:1": "33.333%",
  "4:6": "60%",
  "3:7": "70%",
};

export interface LayoutClassNames {
  /** 外层容器附加类。 */
  readonly root: string;
  /** 消息区最大宽度/对齐类。 */
  readonly content: string;
  /** 是否划出并列让位区(仅 split 为 true)。 */
  readonly hasAside: boolean;
}

/** `centered` 等价于现行版面(max-w-3xl 居中)。 */
const PRESETS: Record<LayoutPreset, LayoutClassNames> = {
  centered: { root: "", content: "mx-auto w-full max-w-3xl", hasAside: false },
  wide: { root: "", content: "mx-auto w-full max-w-5xl", hasAside: false },
  full: { root: "", content: "w-full px-4", hasAside: false },
  split: { root: "", content: "mx-auto w-full max-w-3xl", hasAside: true },
};

/** 解析布局预设;缺省回退 `centered`(Req 7.3)。 */
export function layoutClassNames(
  preset: LayoutPreset | undefined,
): LayoutClassNames {
  return PRESETS[preset ?? "centered"];
}
