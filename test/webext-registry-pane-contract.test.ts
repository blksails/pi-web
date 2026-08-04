import { describe, expect, it } from "vitest";
import { resolveExtensionForSource } from "../lib/app/webext-registry.js";

/**
 * 宿主**静态集成车道**拿到的 pane 声明必须是扁平 `PaneContributionBundle`，
 * 而非 `{ definition, config }` 两层包装。
 *
 * 本用例原锚定 `examples/aigc-agent`（PR #24 引入）。那个目录不在本仓
 * （`pnpm-workspace.yaml` 里是悬空条目，git 中 0 个文件），其静态注册已随构建期引用
 * 一并剔除 —— 继续锚定它会让 `resolveExtensionForSource` 返回 undefined，而
 * `expect(undefined).not.toHaveProperty("definition")` **恒真**，整条用例退化成假绿。
 * 故改用真实已注册的 `panes-agent` 守同一契约，并显式断言扩展确实解析到了。
 *
 * 两层形态本身的合并语义由 `packages/panes-kit/test/merge.test.ts` 覆盖，不在此重复。
 */
describe("webext pane contract（宿主静态集成车道）", () => {
  it("exports the PaneContributionBundle directly", () => {
    const extension = resolveExtensionForSource("/anywhere/examples/panes-agent");
    // ★ 先证明真的解析到了扩展 —— 否则下面所有 `?.` 断言都会在 undefined 上恒真。
    expect(extension).toBeDefined();
    expect(extension?.panes).toBeDefined();
    expect(extension?.panes).not.toHaveProperty("definition");
    expect(Array.isArray(extension?.panes?.panes)).toBe(true);
    expect(extension?.panes?.panes?.length ?? 0).toBeGreaterThan(0);
  });
});
