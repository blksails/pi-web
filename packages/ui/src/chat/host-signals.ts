/**
 * 宿主环境信号族(spec panes-only-right-panel 任务 1.4;Req 3)。
 *
 * 搬运的是**只存在于宿主 realm、pane 自己观察不到**的东西:主题明暗、对话流里的点击。
 * 迁移前这些由各 agent 在宿主环境自行挂监听实现 —— 那在隔离形态下根本做不到,而且会话外壳
 * 是领域中立层(有守卫会拒绝其中出现领域词汇),不可能让每个 agent 往这里挂东西。
 *
 * ## ★ 两条必须守住的语义
 *
 * 1. **连点同一目标两次都要触达**。下行具名信号是「最后值即真值」,值不变就不重推 ——
 *    若只推目标标识,同一目标第二次点击在 pane 侧完全观察不到。故值里附一个**单调递增序号**。
 *    ⚠ 迁移前的实现用时间戳做这件事,**同一毫秒内连点仍会失效**;这里改用序号,严格更强。
 * 2. **零领域词汇**。本文件在会话外壳内,受领域中立守卫约束。信号名与实现一律用通用词。
 */
import * as React from "react";
import { useTheme } from "../theme/index.js";

/** 主题明暗。值为 `"light" | "dark"`。 */
export const HOST_THEME_SIGNAL = "host:theme";

/**
 * 对话流内可聚焦元素被点击。
 *
 * 值形状 `{ id, seq }`:`id` 是被点对象的附件标识,`seq` 是单调递增序号(见上文语义 1)。
 * 从未点击过时为 `undefined` —— pane 侧据此区分「没点过」与「点了但同一个」。
 */
export const HOST_TRANSCRIPT_FOCUS_SIGNAL = "host:transcriptFocus";

/** 宿主给对话流打的「可聚焦」样式钩子;由 pane 内部据此呈现悬浮态。 */
export const TRANSCRIPT_FOCUSABLE_ATTR = "data-pi-transcript-focusable";

export interface TranscriptFocus {
  readonly id: string;
  readonly seq: number;
}

/**
 * 计算宿主环境信号族。
 *
 * @param enabled 是否启用对话流焦点监听。无人消费时不必往文档上挂监听,也不必打样式钩子。
 */
export function useHostEnvironmentSignals(
  enabled = true,
): Readonly<Record<string, unknown>> {
  const { resolved } = useTheme();
  const [focus, setFocus] = React.useState<TranscriptFocus>();
  const seq = React.useRef(0);

  React.useEffect(() => {
    if (!enabled || typeof document === "undefined") return undefined;
    const onClick = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      const el = target?.closest?.("img[data-att-id]") as HTMLElement | null;
      if (el === null || el === undefined) return;
      // 限定在工具产出区内 —— 对话流里别处的图不参与,避免误触。
      if (el.closest("[data-pi-tool-images]") === null) return;
      const id = el.getAttribute("data-att-id");
      if (id === null || id === "") return;
      // ★ 序号每次自增,故同一目标连点两次是两个不同的值,必然重推(见文件头语义 1)。
      seq.current += 1;
      setFocus({ id, seq: seq.current });
    };
    document.addEventListener("click", onClick);
    document.body.setAttribute(TRANSCRIPT_FOCUSABLE_ATTR, "true");
    return () => {
      document.removeEventListener("click", onClick);
      document.body.removeAttribute(TRANSCRIPT_FOCUSABLE_ATTR);
    };
  }, [enabled]);

  return React.useMemo(
    () => ({
      [HOST_THEME_SIGNAL]: resolved,
      // 从未点击过时**不放这个键**,而不是放 undefined —— 后者会与「推过一个空值」混淆。
      ...(focus !== undefined ? { [HOST_TRANSCRIPT_FOCUS_SIGNAL]: focus } : {}),
    }),
    [resolved, focus],
  );
}
