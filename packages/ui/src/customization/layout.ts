/**
 * 布局预设到 className 的映射(pi-chat-customization 任务 1.4)。
 *
 * 仅提供有限预设枚举,不开放任意 grid template(超范围)。`split` 划出并列让位区,
 * 其内容由现有 slots/children 承接(本期不实现 Artifact 专属功能,Req 7.4)。
 */

export type LayoutPreset = "centered" | "wide" | "full" | "split";

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
