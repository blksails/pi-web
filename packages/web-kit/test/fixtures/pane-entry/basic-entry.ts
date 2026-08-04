/** pane-document.test.ts fixture:最简 pane 入口,不依赖任何构建期参数。 */
const root = document.getElementById("root");
if (root) root.textContent = "pane-ready";
export {};
