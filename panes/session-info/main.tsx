/**
 * `host:session-info` — 宿主内置的最小 pane 入口(spec host-builtin-panes,任务 3.1)。
 *
 * 职责单一:显示当前会话的宿主侧事实(会话标识、agent 源、工作目录),使「内置 pane 装载
 * 链路通了」与「装载链路断了」在观察上可区分。它是本 spec 的可取证载体(Req 6.x)。
 *
 * 本文件只做**接线**(建连、订阅、生命周期);校验与渲染在零副作用的 `./view.js`,那部分可单测。
 *
 * ## 三个刻意的选择
 *
 * 1. **数据走宿主具名信号,不走任何 route**。五种 guest 操作里没有「读会话信息」,而 Req 6.1
 *    要求不依赖本 spec 范围外的新能力。`pane:signal` 的设计意图正是搬运「只存在于宿主 realm
 *    的东西」,且语义是最后值即真值 —— 晚连、重连、刷新后重建都不丢。见 design D4。
 * 2. **`capabilities` 全空**(在宿主侧的定义里)。它什么授权都不需要,因此同时充当「内置身份
 *    不产生额外权限」的活体证据:一个零授权的内置 pane 确实什么都调不动。
 * 3. **纯 DOM,不用 React**。srcDoc 是内联进宿主 bundle 的字符串,一个只显示三行事实的 pane
 *    不值得为它内联一份 React 运行时。下游体积大的 pane 自行决定。
 */
import { connectPaneGuest } from "@blksails/pi-web-panes-kit";
import { render, readFacts, SESSION_SIGNAL } from "./view.js";

async function main(): Promise<void> {
  const root = document.getElementById("root");
  if (root === null) return;
  const connection = await connectPaneGuest({ expectedPaneId: "host:session-info" });
  const paneMeta = `实例 ${connection.instanceId} · epoch ${connection.epoch}`;

  // 订阅即以当前值回调一次(guest SDK 保证),故不必先 getSignal 再订阅 —— 那样首帧会渲染两遍。
  const off = connection.onSignal(SESSION_SIGNAL, (value) => {
    render(root, readFacts(value), paneMeta);
  });
  // 该信号从未被推送过时上面的回调不会触发,首帧仍需渲染一次(空态)——否则是白屏,
  // 而白屏与「pane 根本没装上」在观察上无法区分。
  if (connection.getSignal(SESSION_SIGNAL) === undefined) {
    render(root, {}, paneMeta);
  }

  connection.onLifecycle((state) => {
    if (state === "closing") {
      off();
      connection.close();
    }
  });
}

void main();
