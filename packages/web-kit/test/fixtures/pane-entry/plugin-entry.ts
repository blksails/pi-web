/**
 * pane-document.test.ts fixture:验证 `bundlePaneEntry` 的 `plugins` 参数透传。
 *
 * `virtual:pane-flag` 不是真实模块,只能由测试注入的 esbuild 插件解析 —— 不注入插件时
 * 构建本身就会失败(无法解析该 specifier),这就是本 fixture 的判别力所在。
 */
// @ts-expect-error 该 specifier 只由测试注入的 esbuild 插件解析,类型检查阶段不存在
import flag from "virtual:pane-flag";
const root = document.getElementById("root");
if (root) root.textContent = String(flag);
export {};
