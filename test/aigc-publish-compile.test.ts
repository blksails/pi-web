/**
 * examples/aigc-agent · 发布链编译自检(CONTRACT-12 G2 前半)。
 *
 * cloud 只认 registry 来源,且 `RegistryAgentSourceProvider.determineRunnability` 要求
 * **kind === "agent"**,否则在 picker 里标「云版暂不支持此来源」。发布期的 `compile()` 是这条
 * 链的第一环:读 `pi-web.json` + 按约定探测入口/路由/webext 产物,产出待签清单与 bundle 清单。
 *
 * 本测试把 aigc 源的发布契约钉死,尤其是**隔离产物必须进 bundle** —— 隔离宿主(cloud 的
 * pane-loader)正是从 bundle 物化出的 dist 里取 `web-extension.isolated.mjs`;它若漏出 bundle,
 * 云端就只有 external 版可取,而那份在独立 realm 里加载即失败(裸 specifier 无从解析)。
 *
 * 依赖 `pnpm build:example:aigc` 先产 webext(CI 中 build 步骤在 test 之前)。
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "@/server/cli/publish/manifest-compiler.js";

const PKG_DIR = resolve(__dirname, "..", "examples", "aigc-agent");

/** 把 bundle 路径归一为正斜杠相对形式,便于跨平台断言。 */
function normalized(paths: readonly string[]): string[] {
  return paths.map((p) => p.replace(/\\/g, "/"));
}

describe("aigc 源发布编译(pi-web.json → CompiledPackage)", () => {
  it("编译成功且 kind==='agent' —— cloud picker 的 runnable 前置", async () => {
    const r = await compile(PKG_DIR);
    expect(r.ok, r.ok ? "" : JSON.stringify(r.error)).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("agent");
    expect(r.value.id).toBe("blksails/aigc-studio");
    expect(r.value.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("agent 入口经同一套 probeEntry 判定,发布期与运行期指向同一文件", async () => {
    const r = await compile(PKG_DIR);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.entry).toBeDefined();
    expect(r.value.entry?.path.replace(/\\/g, "/")).toContain("index.ts");
    expect(r.value.entry?.integrity).toMatch(/^sha384-/);
  });

  it("★ 隔离产物随包分发:bundle 含 web-extension.isolated.mjs", async () => {
    const r = await compile(PKG_DIR);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const paths = normalized((r.value as { bundlePaths: readonly string[] }).bundlePaths);
    expect(paths.some((p) => p.endsWith(".pi/web/dist/web-extension.isolated.mjs"))).toBe(true);
    // 分派器(manifest.entry)与 external 版(同源宿主用)、manifest 亦须在包内。
    expect(paths.some((p) => p.endsWith(".pi/web/dist/web-extension.mjs"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".pi/web/dist/web-extension.external.mjs"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".pi/web/dist/manifest.json"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".pi/web/dist/ext.css"))).toBe(true);
  });

  it("routes/ 按目录约定静态提取(registry 侧据此派生 hasRoutes)", async () => {
    const r = await compile(PKG_DIR);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const routes = (r.value as { routes?: readonly string[] }).routes ?? [];
    // 全为只读查询路由;素材分发的发起/重试是写路径,刻意不在此列。
    expect([...routes].sort()).toEqual([
      "assets-list",
      "creative-search",
      "gallery-stats",
      "material-status",
    ]);
  });

  it("files 白名单覆盖运行期依赖:panes / media-tools / platform-client 皆入包", async () => {
    const r = await compile(PKG_DIR);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const paths = normalized((r.value as { bundlePaths: readonly string[] }).bundlePaths);
    for (const needle of [
      "panes/materials-surface.ts",
      "panes/modules.ts",
      "media-tools/src/run-media-tool.ts",
      "platform-client.ts",
      "web/pane-documents.generated.ts",
    ]) {
      expect(paths.some((p) => p.endsWith(needle)), `bundle 缺 ${needle}`).toBe(true);
    }
  });
});
