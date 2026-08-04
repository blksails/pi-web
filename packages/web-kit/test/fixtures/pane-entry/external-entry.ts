/**
 * pane-document.test.ts fixture:验证 `bundlePaneEntry` 的 `external` 参数透传。
 *
 * `not-a-real-package` 在 node_modules 里不存在,只有被显式标记为 external 才不会在
 * 打包期报「无法解析」—— 这就是本 fixture 的判别力所在。
 */
// @ts-expect-error 该 specifier 只在测试标记为 external 时才免于解析,类型检查阶段不存在
import { thing } from "not-a-real-package";
const root = document.getElementById("root");
if (root) root.textContent = String(thing);
export {};
