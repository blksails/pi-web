/**
 * 共享状态的宿主侧绑定(spec panes-only-right-panel 任务 1.2;Req 2.1/2.2/2.4)。
 *
 * 形态镜像 `PanesHost` 里既有的 surface 绑定:逐授权键**读一次当前值并订阅**,变化时推给
 * 对应连接。抽成独立模块而非留在组件里,是为了让下面那条重绑语义能被直接测到 ——
 * 它是这个特性里最容易漏、且漏了之后症状最隐蔽的一条。
 *
 * ## ★ 为什么必须能重绑(与 surface 绑定同源的前科)
 *
 * 宿主的共享状态访问器**不是恒等对象**:它由 `useMemo` 依赖会话连接构造,就绪握手与控制流
 * 重开都会换出新实例,而新实例读的是**新的** store。建连那一刻绑定的订阅会挂在旧 store 上,
 * 此后永不触发 —— 表现为「pane 起来了、能力也对,但值永远是空的」,且极易被当成 agent 没发
 * 数据。故访问器换身份时必须**整组退订重绑**,且重绑时**立即重推当前值**(后者同时覆盖
 * 「建连早于首帧数据到达」的竞态)。
 *
 * 槽形态没这个问题,因为组件每次渲染都拿到最新的访问器;pane 形态把它跨到了隔离边界外,
 * 就必须由宿主侧显式跟随。
 */

/** 绑定所需的最小读取面(宿主访问器的子集,便于测试替身)。 */
export interface PaneStateSource {
  get<T = unknown>(key: string): T | undefined;
  subscribe(key: string, listener: (value: unknown) => void): () => void;
}

/** 把某个键的当前值送往某条连接。 */
export type PaneStatePush = (key: string, value: unknown) => void;

/**
 * 为一条连接绑定其授权键的共享状态订阅。
 *
 * - `source` 为 `undefined`(宿主尚未就绪)时是**无操作**,返回的清理函数可安全调用 ——
 *   pane 照常渲染,只是暂时收不到值,不抛错(Req 3.5 的同类要求)。
 * - **未授权的键不会被订阅也不会被推送**:授权是 `readKeys` 这一入参本身,调用方按
 *   `capabilities.state.read` 传入。绑定层不自行放宽。
 * - 每个键**先立即推一次当前值**,再订阅后续变化。
 *
 * @returns 清理函数(退订全部键)。重复调用安全。
 */
export function bindPaneState(
  source: PaneStateSource | undefined,
  readKeys: readonly string[],
  push: PaneStatePush,
): () => void {
  if (source === undefined) return () => {};
  const disposers: Array<() => void> = [];
  for (const key of readKeys) {
    // 先推当前值:连接可能建立在首个值到达之后,只订阅的话那个值就永远等不到了。
    push(key, source.get(key));
    disposers.push(source.subscribe(key, (value) => push(key, value)));
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const dispose of disposers) dispose();
    disposers.length = 0;
  };
}
