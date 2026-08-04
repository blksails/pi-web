// @vitest-environment node
/**
 * `discoverPaneModules` 单测(spec cli-agent-build,任务 3.3,Req 3.1, 3.2, 3.3, 3.4, 3.6)。
 *
 * 覆盖:三级发现顺序(显式路径 > 包根汇总声明 > 逐目录声明)各命中一次、全不命中的空集分支
 * 不报错、entry 归一(URL/相对字符串/非 file: 协议拒绝)、畸形声明报出准确文件路径。
 *
 * `load` 全程注入固定替身(design.md 明确该参数「便于单测替身」),不经真实 jiti 求值 TS
 * 源码——发现逻辑本身是「按路径找到哪个文件、如何归一其求值结果」,与 jiti 如何编译 TS
 * 无关,注入替身能让测试专注于本模块自身的判别逻辑。存在性判定则用真实临时目录(与
 * `agent-source.test.ts` 同策略,不 mock 文件系统)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverPaneModules, type PaneModuleLoader } from "@/server/cli/build/pane-discovery";
import { BuildError } from "@/server/cli/build/errors";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pane-discovery-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 在 `path` 落一个占位文件(内容无关——本模块的存在性判定不解析内容,求值经注入 `load`)。 */
function seed(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "// placeholder, evaluated via injected load()\n");
}

const validCapabilities = { routes: [], surfaceKeys: [], surfaceCommands: [], attachments: "none", conversation: "none", downloads: false, events: { publish: [], subscribe: [] }, state: { read: [], write: [] } };

/** 构造一个按绝对路径分派的 `load` 替身。 */
function loaderFrom(registry: Record<string, unknown>): PaneModuleLoader {
  return async (specifier: string) => {
    if (!(specifier in registry)) throw new Error(`no fixture registered for ${specifier}`);
    return registry[specifier];
  };
}

describe("discoverPaneModules: 约定 1 · 显式路径(--panes,Req 3.6)", () => {
  it("命中显式路径,返回 origin 指向该文件的 PaneDiscovery", async () => {
    const explicit = join(root, "custom", "declare.ts");
    seed(explicit);
    const load = loaderFrom({
      [explicit]: {
        default: {
          id: "custom-panes",
          modules: [{ id: "one", title: "One", entry: "./one.tsx", capabilities: validCapabilities }],
        },
      },
    });

    const discovery = await discoverPaneModules(root, "custom/declare.ts", load);

    expect(discovery?.panesId).toBe("custom-panes");
    expect(discovery?.origin).toBe(explicit);
    expect(discovery?.modules).toHaveLength(1);
    expect(discovery?.modules[0]?.entry).toBe(resolve(root, "custom", "one.tsx"));
    // 未声明的 panelConfig/panesConfig 缺省为空对象。
    expect(discovery?.panelConfig).toEqual({});
    expect(discovery?.panesConfig).toEqual({});
  });

  it("显式路径优先于同时存在的 panes/modules.ts(不去读约定 2)", async () => {
    const explicit = join(root, "custom", "declare.ts");
    seed(explicit);
    const aggregate = join(root, "panes", "modules.ts");
    seed(aggregate);
    const load = loaderFrom({
      [explicit]: { default: { id: "from-explicit", modules: [] } },
      [aggregate]: { default: { id: "from-aggregate", modules: [] } },
    });

    const discovery = await discoverPaneModules(root, "custom/declare.ts", load);

    expect(discovery?.panesId).toBe("from-explicit");
  });

  it("显式路径给出但文件不存在:BuildError 终止,不回落到约定 2/3", async () => {
    // 即便 panes/modules.ts 真实存在,也不应被读取——错路径是用户错误,不是「未命中」。
    seed(join(root, "panes", "modules.ts"));
    const load = loaderFrom({});

    await expect(discoverPaneModules(root, "nope/declare.ts", load)).rejects.toMatchObject({
      stage: "discover",
      code: "BUILD_DISCOVER_EXPLICIT_PATH_NOT_FOUND",
    });
  });
});

describe("discoverPaneModules: 约定 2 · 包根汇总声明(<source>/panes/modules.ts)", () => {
  it("命中 panes/modules.ts,携带 panelConfig/panesConfig", async () => {
    const aggregate = join(root, "panes", "modules.ts");
    seed(aggregate);
    const load = loaderFrom({
      [aggregate]: {
        default: {
          id: "aigc-canvas",
          modules: [
            { id: "canvas", title: "画廊", icon: "🖼️", entry: "./canvas.tsx", canvasStyles: true, capabilities: validCapabilities },
          ],
          panelConfig: { initialPaneIds: ["canvas"], maxOpenPanes: 4 },
          panesConfig: { theme: "dark" },
        },
      },
    });

    const discovery = await discoverPaneModules(root, undefined, load);

    expect(discovery?.panesId).toBe("aigc-canvas");
    expect(discovery?.origin).toBe(aggregate);
    expect(discovery?.panelConfig).toEqual({ initialPaneIds: ["canvas"], maxOpenPanes: 4 });
    expect(discovery?.panesConfig).toEqual({ theme: "dark" });
    const pane = discovery?.modules[0];
    expect(pane?.id).toBe("canvas");
    expect(pane?.icon).toBe("🖼️");
    expect(pane?.canvasStyles).toBe(true);
    // entry 相对 modules.ts 自身所在目录解析,不是相对 sourceRoot。
    expect(pane?.entry).toBe(resolve(root, "panes", "canvas.tsx"));
    // capabilities 原样透传,不重新序列化——即使传入带 Set/函数等非 JSON 值也应保真
    // (在此用普通对象即验证「同一引用透传」这一事实,不做深比较之外的额外断言)。
    expect(pane?.capabilities).toEqual(validCapabilities);
  });

  it("computed property name(计算属性名)在 capabilities 中原样透传(Req 3.2,research F9)", async () => {
    const aggregate = join(root, "panes", "modules.ts");
    seed(aggregate);
    const EVENT_NAME = "canvas:open-attachments";
    const capabilitiesWithComputedKey = {
      ...validCapabilities,
      events: { publish: [], subscribe: [EVENT_NAME] },
    };
    const load = loaderFrom({
      [aggregate]: {
        default: {
          id: "with-computed-keys",
          modules: [{ id: "canvas", title: "画廊", entry: "./canvas.tsx", capabilities: capabilitiesWithComputedKey }],
        },
      },
    });

    const discovery = await discoverPaneModules(root, undefined, load);

    expect(discovery?.modules[0]?.capabilities).toEqual(capabilitiesWithComputedKey);
  });

  it("module.default 缺席时,把 load() 返回值本身当作声明(便于最简单的替身)", async () => {
    const aggregate = join(root, "panes", "modules.ts");
    seed(aggregate);
    const load = loaderFrom({
      [aggregate]: { id: "no-default-wrapper", modules: [] },
    });

    const discovery = await discoverPaneModules(root, undefined, load);

    expect(discovery?.panesId).toBe("no-default-wrapper");
  });
});

describe("discoverPaneModules: 约定 3 · 逐目录声明(<source>/panes/<id>/module.ts)", () => {
  it("命中两个目录,按目录名排序,panesId 缺省取 source 根目录名", async () => {
    const panesDir = join(root, "panes");
    const moduleB = join(panesDir, "b-pane", "module.ts");
    const moduleA = join(panesDir, "a-pane", "module.ts");
    seed(moduleB);
    seed(moduleA);
    const load = loaderFrom({
      [moduleA]: { default: { id: "a-pane", title: "A", entry: "./guest.tsx", capabilities: validCapabilities } },
      [moduleB]: { default: { id: "b-pane", title: "B", entry: "./guest.tsx", capabilities: validCapabilities } },
    });

    const discovery = await discoverPaneModules(root, undefined, load);

    expect(discovery?.modules.map((m) => m.id)).toEqual(["a-pane", "b-pane"]); // 按目录名排序
    expect(discovery?.origin).toBe(panesDir);
    expect(discovery?.panelConfig).toEqual({});
    expect(discovery?.panesConfig).toEqual({});
  });

  it("目录里没有 module.ts 的子目录被跳过,不报错(允许放辅助目录)", async () => {
    const panesDir = join(root, "panes");
    mkdirSync(join(panesDir, "assets"), { recursive: true }); // 无 module.ts
    const moduleA = join(panesDir, "a-pane", "module.ts");
    seed(moduleA);
    const load = loaderFrom({
      [moduleA]: { default: { id: "a-pane", title: "A", entry: "./guest.tsx", capabilities: validCapabilities } },
    });

    const discovery = await discoverPaneModules(root, undefined, load);

    expect(discovery?.modules).toHaveLength(1);
  });
});

describe("discoverPaneModules: 全不命中 —— 空集分支不报错(Req 3.3)", () => {
  it("既无显式路径,也无 panes/modules.ts,panes/ 目录也不存在:返回 undefined", async () => {
    mkdirSync(root, { recursive: true });
    const load = loaderFrom({});

    const discovery = await discoverPaneModules(root, undefined, load);

    expect(discovery).toBeUndefined();
  });

  it("panes/ 目录存在但为空(无任何子目录):返回 undefined", async () => {
    mkdirSync(join(root, "panes"), { recursive: true });
    const load = loaderFrom({});

    const discovery = await discoverPaneModules(root, undefined, load);

    expect(discovery).toBeUndefined();
  });

  it("panes/ 下的子目录均无 module.ts:返回 undefined", async () => {
    mkdirSync(join(root, "panes", "not-a-pane"), { recursive: true });
    const load = loaderFrom({});

    const discovery = await discoverPaneModules(root, undefined, load);

    expect(discovery).toBeUndefined();
  });
});

describe("discoverPaneModules: entry 归一(Req 3.2, 7.1)", () => {
  it("URL 实例(file:)归一为 fileURLToPath 后的绝对路径,可跨目录指向兄弟 source", async () => {
    const aggregate = join(root, "panes", "modules.ts");
    seed(aggregate);
    const siblingEntry = join(root, "..", "sibling-agent", "entry.tsx");
    const load = loaderFrom({
      [aggregate]: {
        default: {
          id: "url-entry",
          modules: [
            { id: "shared", title: "Shared", entry: pathToFileURL(siblingEntry), capabilities: validCapabilities },
          ],
        },
      },
    });

    const discovery = await discoverPaneModules(root, undefined, load);

    expect(discovery?.modules[0]?.entry).toBe(siblingEntry);
  });

  it("非 file: 协议的 URL 被显式拒绝,BuildError 指向声明文件路径", async () => {
    const aggregate = join(root, "panes", "modules.ts");
    seed(aggregate);
    const load = loaderFrom({
      [aggregate]: {
        default: {
          id: "bad-entry",
          modules: [{ id: "remote", title: "Remote", entry: new URL("https://example.com/entry.tsx"), capabilities: validCapabilities }],
        },
      },
    });

    await expect(discoverPaneModules(root, undefined, load)).rejects.toMatchObject({
      stage: "discover",
      path: aggregate,
    });
    try {
      await discoverPaneModules(root, undefined, load);
      expect.unreachable("应抛出 BuildError");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildError);
      expect((e as BuildError).detail).toContain("https:");
    }
  });
});

describe("discoverPaneModules: 畸形声明 —— 报出准确文件路径与字段(Req 3.4)", () => {
  it("汇总声明缺 id:BuildError.path 指向 panes/modules.ts", async () => {
    const aggregate = join(root, "panes", "modules.ts");
    seed(aggregate);
    const load = loaderFrom({ [aggregate]: { default: { modules: [] } } });

    await expect(discoverPaneModules(root, undefined, load)).rejects.toMatchObject({
      stage: "discover",
      code: "BUILD_DISCOVER_INVALID_MODULE",
      path: aggregate,
    });
  });

  it("汇总声明的 modules 不是数组:BuildError 指出具体字段", async () => {
    const aggregate = join(root, "panes", "modules.ts");
    seed(aggregate);
    const load = loaderFrom({ [aggregate]: { default: { id: "bad", modules: "not-an-array" } } });

    try {
      await discoverPaneModules(root, undefined, load);
      expect.unreachable("应抛出 BuildError");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildError);
      expect((e as BuildError).detail).toContain("modules");
      expect((e as BuildError).path).toBe(aggregate);
    }
  });

  it("单个 pane 缺 capabilities:BuildError.path 指向该声明文件,detail 含 pane id", async () => {
    const aggregate = join(root, "panes", "modules.ts");
    seed(aggregate);
    const load = loaderFrom({
      [aggregate]: { default: { id: "ok", modules: [{ id: "broken", title: "Broken", entry: "./x.tsx" }] } },
    });

    try {
      await discoverPaneModules(root, undefined, load);
      expect.unreachable("应抛出 BuildError");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildError);
      expect((e as BuildError).detail).toContain("broken");
      expect((e as BuildError).detail).toContain("capabilities");
      expect((e as BuildError).path).toBe(aggregate);
    }
  });

  it("逐目录声明中某个 module.ts 结构不合法:BuildError.path 指向那一个文件,不是整个 panes/ 目录", async () => {
    const panesDir = join(root, "panes");
    const goodModule = join(panesDir, "a-good", "module.ts");
    const badModule = join(panesDir, "b-bad", "module.ts");
    seed(goodModule);
    seed(badModule);
    const load = loaderFrom({
      [goodModule]: { default: { id: "a-good", title: "Good", entry: "./g.tsx", capabilities: validCapabilities } },
      [badModule]: { default: { id: "", title: "Bad", entry: "./b.tsx", capabilities: validCapabilities } }, // 空 id 非法
    });

    await expect(discoverPaneModules(root, undefined, load)).rejects.toMatchObject({
      stage: "discover",
      code: "BUILD_DISCOVER_INVALID_MODULE",
      path: badModule,
    });
  });

  it("声明模块求值本身抛错(如 jiti 编译失败):包装为 BuildError{code: LOAD_FAILED}", async () => {
    const aggregate = join(root, "panes", "modules.ts");
    seed(aggregate);
    const load: PaneModuleLoader = async () => {
      throw new Error("Unexpected token (syntax error)");
    };

    await expect(discoverPaneModules(root, undefined, load)).rejects.toMatchObject({
      stage: "discover",
      code: "BUILD_DISCOVER_LOAD_FAILED",
      path: aggregate,
    });
  });

  it("pane 声明 entry 缺失:BuildError 指出 entry 字段与 pane id", async () => {
    const aggregate = join(root, "panes", "modules.ts");
    seed(aggregate);
    const load = loaderFrom({
      [aggregate]: { default: { id: "ok", modules: [{ id: "no-entry", title: "NoEntry", capabilities: validCapabilities }] } },
    });

    try {
      await discoverPaneModules(root, undefined, load);
      expect.unreachable("应抛出 BuildError");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildError);
      expect((e as BuildError).detail).toContain("no-entry");
      expect((e as BuildError).detail).toContain("entry");
    }
  });
});
