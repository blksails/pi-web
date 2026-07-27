/**
 * 扩展类名前缀助手。
 *
 * 构建期 `scopeCss(css, "aigc-studio")` 给 `styles.css` 里**每个 class 选择器**加
 * `pw-aigc-studio-` 前缀(防撞,见 `packages/web-kit/build/css-scope-plugin.ts`)。
 * TSX 侧必须用同样的全名,故一律经 `c()` 拼,勿手写字面量。
 */
const PREFIX = "pw-aigc-studio-";

/** `c("qp","on")` → `"pw-aigc-studio-qp pw-aigc-studio-on"`(对应 CSS 的 `.qp.on`)。 */
export function c(...names: readonly (string | false | undefined)[]): string {
  return names.filter((n): n is string => typeof n === "string" && n !== "").map((n) => PREFIX + n).join(" ");
}
