/**
 * webext-background-agent UI 扩展:Tier 1 `background` 插槽 —— 动画极光背景。
 *
 * 宿主把 background 渲染在 `absolute inset-0 -z-10`(消息层之下、不拦截交互)。
 * 自包含组件:内联一段 `<style>`(类名 / @keyframes 均以 `pw-webext-background-` 自命名空间,
 * 不污染宿主),三个模糊渐变光斑缓慢漂移。自包含使其在「构建期集成」与「独立预构建」两条
 * 加载车道下都能直接生效(无需单独注入扩展 CSS)。
 */
import * as React from "react";
import { defineWebExtension } from "@pi-web/web-kit";

const CSS = `
.pw-webext-background-aurora {
  position: absolute; inset: 0; overflow: hidden; pointer-events: none;
}
.pw-webext-background-blob {
  position: absolute; width: 48vmax; height: 48vmax; border-radius: 50%;
  filter: blur(80px); opacity: 0.45; will-change: transform;
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
