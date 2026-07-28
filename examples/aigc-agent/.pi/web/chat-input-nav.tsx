/**
 * ChatInputNav —— 「定位我的输入」浮标 + 输入导航弹层(webext `accessoryBelowEditor` 槽)。
 *
 * 复刻独立仓 aigc-agent `components/chat-input-nav.tsx`:点 ⌖ 列出本会话「我」发过的每条输入,
 * 点选平滑滚动定位 + 高亮闪烁;点击外部关闭;本会话一条输入都没有时整个浮标不渲染(不留孤立圆钮)。
 * 内核 Conversation 自带的「回到底部」(`data-pi-conversation-to-bottom`,离底才现)不重复造。
 *
 * 按本仓架构重写:锚点取宿主稳定的 data 属性(`[data-pi-chat-messages]` / `[data-pi-message-role]`
 * / `[data-pi-message-content]` / `[data-pi-input-dock]`),不依赖源项目自造壳的 `.aigc-main` 类;
 * 浮标落点按输入坞实测高度悬于其上方(ResizeObserver 跟随 composer 变高),故用 fixed 定位而非
 * 源项目那套「绝对定位进壳 + 发布 --aigc-dock-h 供壳 CSS 消费」——本仓没有那层壳 CSS。
 */
import * as React from "react";
import { Crosshair } from "lucide-react";
import { c } from "./cls.js";

interface NavItem {
  readonly text: string;
  readonly el: HTMLElement;
}

/** 消息区容器(pi-chat 的滚动列)。 */
function messagesRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-pi-chat-messages]");
}

export function ChatInputNav(): React.JSX.Element | null {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<readonly NavItem[]>([]);
  const [dockH, setDockH] = React.useState(96);
  const [hasInputs, setHasInputs] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // 浮标悬于 composer 之上:实测输入坞高度,随工具条 / 多行输入变高跟随。
  React.useEffect(() => {
    const dock = document.querySelector<HTMLElement>("[data-pi-input-dock]");
    if (dock === null) return undefined;
    const measure = (): void => setDockH(dock.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(dock);
    return () => ro.disconnect();
  }, []);

  /**
   * 修 agent 文本内联附件图的外部 host → 同源(承接源项目同一处置)。pi SDK 有时给绝对 URL
   * (指向不可达的平台域),浏览器加载失败 → 0×0 塌陷不显图。只改 `/api/attachments/…` 路径,
   * CDN 素材图不受影响;改后已同源,不会再次匹配,无循环。
   * 同一次遍历顺带更新「本会话有没有我的输入」,免得再挂一个几乎同参的 MutationObserver。
   */
  React.useEffect(() => {
    const root = messagesRoot();
    if (root === null) return undefined;
    const scan = (): void => {
      root.querySelectorAll("img").forEach((img) => {
        const m = /^https?:\/\/[^/]+(\/api\/attachments\/.*)$/.exec(
          img.getAttribute("src") ?? "",
        );
        if (m !== null && m[1] !== undefined) img.setAttribute("src", m[1]);
      });
      setHasInputs(root.querySelector('[data-pi-message-role="user"]') !== null);
    };
    scan();
    const obs = new MutationObserver(scan);
    obs.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
    return () => obs.disconnect();
  }, []);

  const refresh = React.useCallback((): void => {
    const root = messagesRoot();
    if (root === null) {
      setItems([]);
      return;
    }
    setItems(
      Array.from(root.querySelectorAll<HTMLElement>('[data-pi-message-role="user"]')).map(
        (el) => ({
          text: (
            el.querySelector<HTMLElement>("[data-pi-message-content]")?.innerText ?? ""
          ).trim(),
          el,
        }),
      ),
    );
  }, []);

  const locate = (el: HTMLElement): void => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const flash = c("msg-flash");
    el.classList.add(flash);
    window.setTimeout(() => el.classList.remove(flash), 1300);
    setOpen(false);
  };

  // 点击外部关闭弹层。
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!hasInputs) return null;

  return (
    <div
      ref={rootRef}
      className={c("chat-fabs")}
      style={{ bottom: `${Math.max(dockH + 20, 120)}px` }}
    >
      {open ? (
        <div className={c("input-nav")} role="menu">
          <div className={c("nh")}>定位我的输入</div>
          {items.length === 0 ? (
            <div className={c("in-item")} aria-disabled="true">
              <span className={c("t")}>本会话暂无输入</span>
            </div>
          ) : (
            items.map((it, i) => (
              <button
                key={i}
                type="button"
                className={c("in-item")}
                onClick={() => locate(it.el)}
                role="menuitem"
              >
                <span className={c("dot")} />
                <span className={c("t")}>{it.text.length > 0 ? it.text : "(空)"}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
      <button
        type="button"
        className={open ? c("fab", "on") : c("fab")}
        title="定位我的输入"
        aria-label="定位我的输入"
        aria-expanded={open}
        onClick={() => {
          if (!open) refresh();
          setOpen((v) => !v);
        }}
      >
        <Crosshair size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
