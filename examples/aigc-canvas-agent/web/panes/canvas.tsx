/**
 * Canvas 画廊 pane 的 **guest 文档入口**(在独立 iframe 内运行)。
 *
 * 迁移要点:`CanvasPanel` 组件本身一行未改 —— 变的是它拿到的四个接缝从「宿主同 realm 直给」
 * 换成「经 pane 协议中继」:
 *
 * | 接缝 | 迁移前(slots) | 迁移后(pane) |
 * |---|---|---|
 * | `surface` | 宿主 `useSurface("canvas")` 直传 | `guest.surface.*` → postMessage → 宿主 |
 * | `upload` | 宿主 fetch 附件端点 | `guest.upload(file)`(ArrayBuffer 转移) |
 * | `conversation` | 宿主 Prompt 通道 | `guest.submitUserMessage` |
 * | 画廊统计 | 外部 curl agent-route | `guest.query("gallery-stats")` |
 *
 * 这四条都受 `pane-meta.ts` 的 capabilities 门禁:少授予一条,对应功能拿到的是
 * `CAPABILITY_DENIED` 而不是静默降级。
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { CanvasPanel, canvasOpenStore, canvasFocusStore } from "@blksails/pi-web-canvas-ui";
import type { ConversationAccess, WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import { PaneGuestProvider, usePaneGuest } from "@blksails/pi-web-panes-kit/react";

interface GalleryStats {
  readonly assets: number;
  readonly byOrigin: { readonly upload: number; readonly "tool-output": number };
  readonly generating: boolean;
  readonly note?: string;
}

/**
 * ★ 跨边界数据必须校验形状,`guest.query<T>()` 的泛型是**谎言**。
 *
 * 它只是把 `unknown` 断言成 T —— 真正回来的东西由 route handler 决定,而 handler 在另一个进程里。
 * 实测:route 未声明时(如离线 stub agent 有自己固定的 route 表),宿主把 404 的**错误体**
 * 当正常结果 resolve 回来,于是 `stats.byOrigin.upload` 在渲染期抛 TypeError ——
 * 整个 pane 被 React 卸载,`#root` 变空。故障表现是「画廊整个不见了」,而根因在一行统计文案。
 *
 * 教训不限于本例:pane 的四条通道(route/surface/attachment/conversation)回来的都是
 * 未校验数据,任何直接解构都是渲染期崩溃的候选点。
 */
function asGalleryStats(value: unknown): GalleryStats | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const origin = v["byOrigin"];
  if (typeof v["assets"] !== "number" || typeof origin !== "object" || origin === null) {
    return undefined;
  }
  const o = origin as Record<string, unknown>;
  if (typeof o["upload"] !== "number" || typeof o["tool-output"] !== "number") return undefined;
  return {
    assets: v["assets"],
    byOrigin: { upload: o["upload"], "tool-output": o["tool-output"] },
    generating: v["generating"] === true,
  };
}

/**
 * 画廊统计条 —— 本示例里 pane → Agent Route 通道的**可见证据**。
 *
 * 跟着 surface 快照走(快照变即重拉),而不是定时轮询:统计的事实源就是那份快照,
 * 快照没动时重拉必然拿到同样的数,纯属浪费一次跨进程往返。
 */
function StatsBar({ revision }: { readonly revision: unknown }): React.JSX.Element {
  const guest = usePaneGuest();
  const [stats, setStats] = React.useState<GalleryStats>();
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    void guest
      .query("gallery-stats")
      .then((value) => {
        if (!alive) return;
        const parsed = asGalleryStats(value);
        // 形状不符(如 404 错误体被当结果回传)与 reject 同等处理:熄掉统计条,不连累画廊主体。
        if (parsed === undefined) setFailed(true);
        else {
          setStats(parsed);
          setFailed(false);
        }
      })
      .catch(() => {
        // route 未授予 / handler 抛错 → 只熄掉统计条,绝不连累画廊主体。
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [guest, revision]);
  if (failed) return <div data-testid="gallery-stats" data-state="failed" />;
  if (stats === undefined) return <div data-testid="gallery-stats" data-state="loading" />;
  return (
    <div
      data-testid="gallery-stats"
      data-state="ready"
      data-assets={String(stats.assets)}
      className="flex items-center gap-3 border-b border-[hsl(var(--border))] px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))]"
    >
      <span>共 {stats.assets} 张</span>
      <span>上传 {stats.byOrigin.upload}</span>
      <span>生成 {stats.byOrigin["tool-output"]}</span>
      {stats.generating ? <span data-generating>生成中…</span> : null}
    </div>
  );
}

function CanvasPane(): React.JSX.Element {
  const guest = usePaneGuest();

  // CanvasPanel 内部读 canvasOpenStore 决定是否渲染。pane 形态下「打开」等价于「这个 tab 存在」,
  // 故挂载即置真。注意这个 store 是 module-level 的 —— 它现在只作用于本 iframe realm,
  // 宿主侧的 launcherRail 按钮已随迁移撤掉(跨 realm 按不动它,留着就是个死按钮)。
  React.useEffect(() => {
    canvasOpenStore.set(true);
    return () => canvasOpenStore.set(false);
  }, []);

  // surface 快照版本:既驱动统计条重拉,也是 pane 与宿主 AAS 之间唯一的下行通道。
  const [revision, setRevision] = React.useState(0);
  React.useEffect(
    () => guest.surface.subscribe("surface:canvas", () => setRevision((n) => n + 1)),
    [guest],
  );

  // 主题跟随:宿主给它自己的 <html> 加 `dark` 类,跨不过 iframe;由宿主经信号下发后在此落地。
  // `onSignal` 订阅即以当前值回调一次,故首帧就是对的,不会先亮一下再跳暗。
  React.useEffect(
    () =>
      guest.onSignal("theme:dark", (value) => {
        document.documentElement.classList.toggle("dark", value === true);
      }),
    [guest],
  );

  // 「点聊天工具卡的图 → 进 Canvas 编辑」:点击发生在**宿主** document,由宿主转成信号下发。
  // 值形如 `att_xxx#<seq>`,seq 只为让连点同一张图也产生新值(信号是最后值即真值,不是事件流)。
  React.useEffect(
    () =>
      guest.onSignal("canvas:focus", (value) => {
        if (typeof value !== "string" || value === "") return;
        const attachmentId = value.split("#")[0] ?? "";
        if (attachmentId !== "") canvasFocusStore.set(attachmentId);
      }),
    [guest],
  );

  const surface = React.useMemo<WebExtSurfaceAccess>(
    () => ({
      run: async (domain, action, args) =>
        (await guest.surface.run(domain, action, args)) as Awaited<
          ReturnType<WebExtSurfaceAccess["run"]>
        >,
      getState: (key) => guest.surface.getState(key),
      subscribe: (key, listener) => guest.surface.subscribe(key, listener),
      hasCommand: (name) => guest.surface.hasCommand(name),
    }),
    [guest],
  );

  // 宿主签名是 (baseUrl, sessionId, file);pane 侧两个前置参数不再有意义 ——
  // 附件端点由宿主持有,guest 只递字节。
  const upload = React.useCallback(
    async (_baseUrl: string, _sessionId: string, file: File) => {
      const result = await guest.upload(file);
      return { attachment: { id: result.attachmentId }, displayUrl: result.displayUrl };
    },
    [guest],
  );

  const conversation = React.useMemo<ConversationAccess>(
    () => ({
      submitUserMessage(text, options) {
        void guest.submitUserMessage(text, options);
      },
    }),
    [guest],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <StatsBar revision={revision} />
      {/*
        ★ 底部留出 56px 给**宿主的**浮动比例切换器(`[data-pi-panel-ratio-switch]`,
        `absolute bottom-4 right-4 z-40`)。它悬在整个对话区之上,而 pane iframe 现在铺满右侧
        aside —— 工作台的动作按钮排恰好落在它下面,点击被拦截(实测 Playwright 报
        "intercepts pointer events",真实用户同样点不动)。

        槽形态没这个问题:CanvasPanel 自带滚动容器,动作排不会贴到视口底。pane 把内容推到了
        aside 的物理边界,才碰上宿主 chrome。让位放在 pane 这边而不是改宿主 chrome:
        浮动切换器是宿主的既有交互,不该为某个 source 的 pane 让路。
      */}
      <div className="min-h-0 flex-1 pb-14">
        <CanvasPanel
          enabled
          surface={surface}
          upload={upload}
          baseUrl="pane://host"
          sessionId={guest.instanceId}
          conversation={conversation}
          // ★ 不传 visionModelOptions(此前传 `[]`,UI 上显示成「没有可用的视觉模型」——
          // 那是 pane 拿不到宿主 baseUrl 的产物,与模型是否真的可用无关,极具误导性:
          // 实测宿主侧有 154 个可用模型,而 pane 里写着「没有」)。
          //
          // 视觉模型的选择已下沉到 agent:`image_vision` 按 config 域 `aigc.visionModel` >
          // env > 弹层询问 解析,用户在弹层选过一次即写回配置、之后不再问,也可在
          // /settings 的「AIGC 图像工具 · 视觉模型」里改或清空。
          // 于是这条选择根本不需要跨 iframe —— pane 不参与。
        />
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Pane root missing");
createRoot(root).render(
  <React.StrictMode>
    <PaneGuestProvider paneId="canvas">
      <CanvasPane />
    </PaneGuestProvider>
  </React.StrictMode>,
);
