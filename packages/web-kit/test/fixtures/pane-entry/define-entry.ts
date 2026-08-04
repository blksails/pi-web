/**
 * pane-document.test.ts fixture:验证 `bundlePaneEntry` 的 `define` 参数透传。
 *
 * `__PANE_LABEL__` 未在此文件声明取值,只靠 esbuild 的 `define` 做文本替换。不替换时
 * 该标识符原样留在产物里,执行会抛 ReferenceError —— 这就是本 fixture 的判别力所在。
 */
declare const __PANE_LABEL__: string;
const root = document.getElementById("root");
if (root) root.textContent = __PANE_LABEL__;
export {};
