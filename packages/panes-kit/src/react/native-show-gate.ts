/**
 * 原生 pane 的显示门控判定（spec desktop-pane-chrome-occlusion，任务 3.1 / 4.1）。
 *
 * ## 为什么要把它从 `placeThenShow` 里抽出来
 *
 * 这条判定是本 spec 唯一改变**用户可见行为**的地方：改动前「量不到几何也照样 show」，
 * pane 遂停在布局侧的默认矩形上（`y=0`、铺满全高），恰好盖住 tab 栏。
 *
 * 但它原本埋在一个 async 闭包里，只能靠渲染整个 `PanesHost` 才能触发——而在 jsdom 下
 * `pane_layout_is_native` 为真时内容 pane 根本不会被创建（实测：relayListeners 已就绪、
 * `created` 仍为 0），握手走不完就到不了 show 那一步。结果是
 * 「不 show」这个断言**因为别的原因**成立，成了一条测不到东西的重言式（初版就是这样，
 * 把门控整个删掉照样跑绿，红对照当场抓出）。
 *
 * 抽成纯函数之后，判定本身可以被穷举断言，且删掉任一条件都会有用例变红。
 *
 * ## 不在此处理的
 *
 * 「几何迟到要重试几次」属于时序，留在调用方；本函数只回答「就当前这组事实，能不能 show」。
 */

/** 几何是否已送达布局侧。`undefined` 表示本形态下不需要几何（非原生布局）。 */
export type GeometryReadiness =
  /** 已送达，或先前送达过且未变（布局侧处于已知态）。 */
  | "delivered"
  /** 未送达：量不到槽、上报失败，或重试耗尽。 */
  | "pending";

export interface NativeShowGateInput {
  /** 宿主 chrome 是否可见（折叠态不 show，既有行为）。 */
  readonly chromeVisible: boolean;
  /**
   * 是否需要几何先到。
   *
   * ★ 判据是**几何门**（`pane_layout_is_native`），不是载体门（有 `__TAURI__` 即用
   *   原生载体）。两者可以不一致——载体为真而几何门为假时，Rust 并不拥有 child 的
   *   bounds，不存在「盖住 chrome 的槽」，此时要求几何先到毫无意义。
   */
  readonly requiresGeometry: boolean;
  readonly geometry: GeometryReadiness;
  /** 该实例是否仍是当前活动 tab（异步等待期间可能已被切走）。 */
  readonly isActiveInstance: boolean;
  /** 该实例是否已被停靠（parked）。 */
  readonly isParked: boolean;
}

/**
 * 是否放行 `show`。
 *
 * 五个条件全部满足才放行；任一不满足都返回 `false`，调用方据此 `hide`。
 */
export function shouldShowNativePane(input: NativeShowGateInput): boolean {
  if (!input.chromeVisible) return false;
  if (!input.isActiveInstance) return false;
  if (input.isParked) return false;
  // 只有需要几何的形态才检查几何；否则该条件不参与判定。
  if (input.requiresGeometry && input.geometry !== "delivered") return false;
  return true;
}
