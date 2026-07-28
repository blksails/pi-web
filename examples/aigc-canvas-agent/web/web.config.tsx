/**
 * aigc-canvas-agent UI 扩展 —— 隔离 Pane 形态(spec isolated-panes Wave 5)。
 *
 * ## 三个槽的去向
 *
 * | 槽 | 迁移前 | 迁移后 | 理由 |
 * |---|---|---|---|
 * | `panelRight` | `CanvasPanel`(同 realm) | `PanesHost`(iframe pane) | 迁移主体 |
 * | `launcherRail` | `CanvasLauncher` | **撤掉** | 见下 |
 * | `promptToolbar` | `AigcQuickSettings` | 原样保留 | 见下 |
 *
 * **launcherRail 必须撤掉,不是顺手删的。** `CanvasLauncher` 靠 module-level 的
 * `canvasOpenStore` 与面板联动 —— 这在同 realm 的 slots 形态下成立(两个槽在同一 app bundle
 * 里共享该 store)。pane 是**独立 iframe realm**,store 不跨 realm;按钮留着会变成一个点了
 * 没反应的死按钮。pane 的开合入口由 `PanesHost` 的 tab 栏承担,`initialPaneIds: ["canvas"]`
 * 让它开箱即在。
 *
 * **promptToolbar 反而必须保留。** `AigcQuickSettings` 挂在输入区(宿主 realm),经 state 桥
 * KV 与 agent 进程里的图像工具通信,整条链路与 pane 化无关。把它一并搬进 pane 是错的 ——
 * 它的位置(发送键旁)本身就是它的语义。
 *
 * 另:原先的 `NEXT_PUBLIC_PI_WEB_CANVAS` 门控随 launcherRail 一并消失。pane 的可见性由
 * source 声明决定(声明了这个 webext 就有画廊 tab),与全局 env 无关 —— 这也更贴 pane 模型。
 */
import * as React from "react";
import {
  defineWebExtension,
  type SlotRenderProps,
  type WebExtSurfaceAccess,
} from "@blksails/pi-web-kit";
import { PanesHost } from "@blksails/pi-web-panes-kit/react";
import { AigcQuickSettings } from "@blksails/pi-web-canvas-ui";
import { panesDefinition } from "./panes/index.js";

export const config = {
  panes: {
    // standard:固定 tab + 基础控件。画廊是单 pane,不需要拖拽重排与命令面板。
    interactionMode: "standard" as const,
    allowTabReorder: false,
    showCommandPalette: false,
  },
  web: {
    // panelRight 初始比例 4:6(对话 40% / 画廊 60%):Canvas 是创作台,默认给足空间。
    panelRatio: "4:6" as const,
    // logs 固定 bottom(对话区下方):避免日志面板挤占画廊的右侧 aside。
    logsPanelPosition: "bottom" as const,
  },
};

/**
 * ★ 轮末 auto-sync 的跨 realm 补齐。
 *
 * 宿主在每轮 idle 边沿 bump `syncSignal`(pi-chat 的 panelSyncSignal),slots 形态下它经 prop
 * 直达 `CanvasPanel` → `CanvasGallery` 发 `run("canvas","sync")`,把 `image_generation` 只落
 * 了 att、没写快照的图收编进画廊。
 *
 * pane 形态下这条线**断了**:`PanesHost` 只把 `capabilities.surfaceKeys` 声明的快照经
 * `pane:surface` 推进 iframe,`syncSignal` 不在协议里。而 image_generation 恰恰不改快照,
 * 所以 pane 侧观察不到任何变化 —— 表现就是「LLM 生了图,画廊不更新」。
 *
 * 补在这里而不是改 panes-kit:「一轮结束该 reconcile 画廊」是 **canvas 域的策略**,不是通用
 * pane 关注点。往协议里加一条通用 host-signal 会让每个 pane 都得懂「轮」这个概念,而绝大多数
 * pane 并不在对话语境里。宿主侧包装器持有 `props.surface`,直接替 pane 发这条命令即可;
 * 快照随即变化 → 经既有 `pane:surface` 推送下行 → 画廊自然刷新。
 */
/**
 * 宿主 `SlotHost` 实际注入的 props 比 `SlotRenderProps`(只声明 `extId`)多得多 ——
 * surface / upload / baseUrl / sessionId / syncSignal / conversation 都是运行时给的。
 * panes-agent 靠 `{...props}` 盲传绕过了这件事;本文件要**读**其中两个,故在此把依赖的
 * 字段显式窄声明出来。若哪天宿主改了注入名,这里会在类型层先炸,而不是运行时静默拿到
 * undefined、auto-sync 悄悄失效。
 */
type PanesSlotProps = SlotRenderProps & {
  readonly surface?: WebExtSurfaceAccess;
  readonly syncSignal?: unknown;
};

/**
 * 宿主 realm 的两件事,pane 自己看不见,必须由宿主观测后经 `pane:signal` 下发。
 *
 * 1. **主题** —— 宿主靠给 `<html>` 加 `dark` 类切换(`theme-provider.tsx`)。iframe 是独立
 *    document,拿不到那个类:宿主切暗色,pane 还是亮的。
 * 2. **聊天工具卡点图** —— `CanvasPanel` 挂的是 `document` 级委托监听。槽形态下它和聊天同
 *    realm,所以「点聊天里的图 → 进 Canvas 编辑」成立;pane 形态下那个监听落在 iframe 里,
 *    宿主的点击永远传不过去,该功能整个失效。
 *
 * 两者都在宿主侧观测,写进 `signals`;pane 侧订阅后各自落地(见 web/panes/canvas.tsx)。
 */
function useHostSignals(): Record<string, unknown> {
  const [dark, setDark] = React.useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  const [focus, setFocus] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    // 主题类由宿主在任意时刻改写,没有事件可订阅 —— 只能观察 class 属性。
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (typeof document === "undefined") return undefined;
    // 判定条件与 canvas-ui 的槽形态监听逐字一致(仅工具卡内、带 data-att-id 的图)。
    const onClick = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      const img = target?.closest?.("img[data-att-id]") as HTMLElement | null;
      if (img === null || img === undefined) return;
      if (img.closest("[data-pi-tool-images]") === null) return;
      const id = img.getAttribute("data-att-id");
      if (id === null || id === "") return;
      // 同一张图连点两次也要能再次打开:pane 侧消费后会清空,但信号是「最后值即真值」,
      // 值没变就不会重推。故附一个递增序号使每次点击都是新值。
      setFocus(`${id}#${Date.now()}`);
    };
    document.addEventListener("click", onClick);
    // 悬浮态「可点」affordance 的样式钩子(canvas-ui styles.css 据此生效)——
    // 槽形态由 CanvasPanel 打在宿主 body 上,pane 形态下它打在 iframe 里,故这里补上。
    document.body.setAttribute("data-canvas-tool-image-clickable", "true");
    return () => {
      document.removeEventListener("click", onClick);
      document.body.removeAttribute("data-canvas-tool-image-clickable");
    };
  }, []);

  return React.useMemo(() => ({ "theme:dark": dark, "canvas:focus": focus }), [dark, focus]);
}

function ConfiguredPanesHost(props: PanesSlotProps): React.JSX.Element {
  const { surface, syncSignal } = props;
  const signals = useHostSignals();
  const seen = React.useRef(false);
  React.useEffect(() => {
    // 首帧不发:装配期 hydrate 已经重建过画廊,再 sync 一次纯属多余往返。
    if (!seen.current) {
      seen.current = true;
      return;
    }
    if (surface === undefined) return;
    // best-effort:sync 失败(agent 未发布 canvas domain / 命令不可用)不该影响 pane 渲染。
    void Promise.resolve(surface.run("canvas", "sync")).catch(() => undefined);
  }, [surface, syncSignal]);
  return (
    <PanesHost {...props} definition={panesDefinition} config={config.panes} signals={signals} />
  );
}

export default defineWebExtension({
  manifestId: "aigc-canvas",
  capabilities: ["slots", "config"],
  config: config.web,
  slots: {
    panelRight: ConfiguredPanesHost,
    // 输入区工具排的模型/尺寸快捷设置(工具设置在 /settings 的「AIGC 图像工具」面板,不在此)。
    promptToolbar: AigcQuickSettings as never,
  },
});
