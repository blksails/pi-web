/**
 * webext-background-agent UI 扩展:Tier 1 `background` 插槽 —— 动画极光背景。
 *
 * 宿主把 background 渲染在 `absolute inset-0 -z-10`(消息层之下、不拦截交互)。
 * 自包含组件:内联一段 `<style>`(类名 / @keyframes 均以 `pw-webext-background-` 自命名空间,
 * 不污染宿主),三个模糊渐变光斑缓慢漂移。自包含使其在「构建期集成」与「独立预构建」两条
 * 加载车道下都能直接生效(无需单独注入扩展 CSS)。
 */
import * as React from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";

// 极光背景对「会话态」做出反应:宿主在 chat 根挂 `data-pi-chat-empty="true|false"`
// (空屏 vs 已有消息)。本扩展据此在自己的 CSS 里切换观感 —— 无需宿主改动、无需把
// 消息状态传进组件:用祖先属性选择器即可。空屏=静谧(低不饱和、缓慢、聚拢);
// 交互后=鲜明(更亮、铺开、加一道居中辉光),并以过渡平滑切换,直观体现两态差异。
const CSS = `
.pw-webext-background-aurora {
  position: absolute; inset: 0; overflow: hidden; pointer-events: none;
  transition: background 1.2s ease;
}
.pw-webext-background-blob {
  position: absolute; width: 48vmax; height: 48vmax; border-radius: 50%;
  filter: blur(80px); opacity: 0.30; will-change: transform, opacity;
  transition: opacity 1.2s ease, filter 1.2s ease, transform 1.2s ease;
}
.pw-webext-background-blob-a {
  top: -12%; left: -10%;
  background: radial-gradient(circle, #7c3aed, transparent 60%);
  animation: pw-webext-background-drift-a 18s ease-in-out infinite alternate;
}
.pw-webext-background-blob-b {
  right: -12%; bottom: -15%;
  background: radial-gradient(circle, #2563eb, transparent 60%);
  animation: pw-webext-background-drift-b 24s ease-in-out infinite alternate;
}
.pw-webext-background-blob-c {
  top: 28%; left: 38%;
  background: radial-gradient(circle, #db2777, transparent 62%);
  animation: pw-webext-background-drift-c 30s ease-in-out infinite alternate;
}
/* 居中辉光:仅交互态淡入,强化「对话已开始」的氛围。 */
.pw-webext-background-glow {
  position: absolute; left: 50%; top: 42%; width: 70vmax; height: 70vmax;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(124,58,237,0.18), transparent 60%);
  opacity: 0; transition: opacity 1.4s ease; will-change: opacity;
}

/* —— 空屏(默认):静谧。低不饱和、聚拢、漂移更慢。 */
.pw-webext-background-aurora { filter: saturate(0.72); }

/* —— 交互后:鲜明。祖先 [data-pi-chat-empty="false"] 命中即整体提亮、铺开。 */
[data-pi-chat-empty="false"] .pw-webext-background-aurora { filter: saturate(1.15); }
[data-pi-chat-empty="false"] .pw-webext-background-blob { opacity: 0.62; filter: blur(64px); }
[data-pi-chat-empty="false"] .pw-webext-background-blob-a { transform: translate(4vw, 2vh) scale(1.12); }
[data-pi-chat-empty="false"] .pw-webext-background-blob-b { transform: translate(-4vw, -2vh) scale(1.12); }
[data-pi-chat-empty="false"] .pw-webext-background-glow { opacity: 1; }

@keyframes pw-webext-background-drift-a {
  from { transform: translate(0,0) scale(1); } to { transform: translate(18vw,14vh) scale(1.2); }
}
@keyframes pw-webext-background-drift-b {
  from { transform: translate(0,0) scale(1.1); } to { transform: translate(-14vw,-10vh) scale(0.9); }
}
@keyframes pw-webext-background-drift-c {
  from { transform: translate(0,0); } to { transform: translate(10vw,-18vh); }
}
@media (prefers-reduced-motion: reduce) {
  .pw-webext-background-blob { animation: none; }
}
`;

function Aurora(): React.JSX.Element {
  return (
    <div className="pw-webext-background-aurora" aria-hidden="true">
      <style>{CSS}</style>
      <span className="pw-webext-background-blob pw-webext-background-blob-a" />
      <span className="pw-webext-background-blob pw-webext-background-blob-b" />
      <span className="pw-webext-background-blob pw-webext-background-blob-c" />
      <span className="pw-webext-background-glow" />
    </div>
  );
}

export default defineWebExtension({
  manifestId: "webext-background",
  capabilities: ["slots"],
  slots: {
    background: <Aurora />,
  },
});
