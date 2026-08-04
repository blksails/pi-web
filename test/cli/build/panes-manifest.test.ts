// @vitest-environment node
/**
 * `assemblePanesManifest` 单测(spec cli-agent-build,任务 3.6,Req 2.3, 3.5)。
 *
 * 覆盖:清单组装(排序稳定、`panelConfig`/`panesConfig` 合并为 `config`)、经 `definePanes`
 * 校验通过时输出归一化后的 `capabilities`,以及本任务的核心验收点——一个「两层包装」的畸形
 * `capabilities`(`routes` 被误包成 `{ definition: [...], config: {} }` 而非期望的数组)在
 * **构建期**被 `definePanes` 拒绝,而不是留到宿主运行期才炸(直接对应本 spec 起因的漂移)。
 */
import { describe, it, expect } from "vitest";
import { assemblePanesManifest } from "@/server/cli/build/panes-manifest";
import { BuildError } from "@/server/cli/build/errors";
import type { PaneDiscovery, PaneEntryModule, PaneModule } from "@/server/cli/build/pane-discovery";

const validCapabilities: PaneModule["capabilities"] = {
  routes: [],
  surfaceKeys: [],
  surfaceCommands: [],
  attachments: "none",
  conversation: "none",
  downloads: false,
  events: { publish: [], subscribe: [] },
  state: { read: [], write: [] },
};

function paneModule(overrides: Partial<PaneEntryModule> & Pick<PaneEntryModule, "id" | "title">): PaneEntryModule {
  return {
    entry: `./web/panes/${overrides.id}/entry.tsx`,
    capabilities: validCapabilities,
    ...overrides,
  };
}

function discovery(overrides: Partial<PaneDiscovery> & Pick<PaneDiscovery, "modules">): PaneDiscovery {
  return {
    panesId: "test-panes",
    panelConfig: {},
    panesConfig: {},
    origin: "/agent/panes/modules.ts",
    ...overrides,
  };
}

describe("assemblePanesManifest: 组装(Req 2.3)", () => {
  it("按 id 排序,输出顺序与声明顺序无关", () => {
    const input = discovery({
      modules: [
        paneModule({ id: "zebra", title: "Zebra" }),
        paneModule({ id: "alpha", title: "Alpha" }),
        paneModule({ id: "middle", title: "Middle" }),
      ],
    });

    const sidecar = assemblePanesManifest(input);

    expect(sidecar.panes.map((pane) => pane.id)).toEqual(["alpha", "middle", "zebra"]);
  });

  it("合并 panelConfig 与 panesConfig 为 config,panesConfig 优先", () => {
    const input = discovery({
      modules: [paneModule({ id: "one", title: "One" })],
      panelConfig: { initialPaneIds: ["one"], maxOpenPanes: 4, theme: "light" },
      panesConfig: { theme: "dark", extra: true },
    });

    const sidecar = assemblePanesManifest(input);

    expect(sidecar.id).toBe("test-panes");
    expect(sidecar.config).toEqual({ initialPaneIds: ["one"], maxOpenPanes: 4, theme: "dark", extra: true });
  });

  it("每个条目只含 id/title/icon?/capabilities,不携带构建期字段(entry/canvasStyles)", () => {
    const input = discovery({
      modules: [
        paneModule({ id: "canvas", title: "画廊", icon: "🖼️", canvasStyles: true, entry: "./canvas.tsx" }),
      ],
    });

    const sidecar = assemblePanesManifest(input);

    expect(sidecar.panes).toEqual([
      {
        id: "canvas",
        title: "画廊",
        icon: "🖼️",
        capabilities: expect.objectContaining({ routes: [], surfaceKeys: [] }),
      },
    ]);
    expect(sidecar.panes[0]).not.toHaveProperty("entry");
    expect(sidecar.panes[0]).not.toHaveProperty("canvasStyles");
    expect(sidecar.panes[0]).not.toHaveProperty("document");
  });

  it("icon 缺省时输出条目不含 icon 字段", () => {
    const input = discovery({ modules: [paneModule({ id: "one", title: "One" })] });

    const sidecar = assemblePanesManifest(input);

    expect(sidecar.panes[0]).not.toHaveProperty("icon");
  });
});

describe("assemblePanesManifest: 形态校验(Req 3.5,经 definePanes,不自建校验)", () => {
  it("合法声明经 definePanes 归一后通过,capabilities 补上完整默认字段", () => {
    const input = discovery({
      modules: [paneModule({ id: "one", title: "One", capabilities: { attachments: "read" } as PaneModule["capabilities"] })],
    });

    const sidecar = assemblePanesManifest(input);

    // definePanes 对缺省字段套用 PaneCapabilitiesSchema 的 default(),而非原样透传残缺对象。
    expect(sidecar.panes[0]?.capabilities).toEqual({
      routes: [],
      surfaceKeys: [],
      surfaceCommands: [],
      attachments: "read",
      conversation: "none",
      downloads: false,
      events: { publish: [], subscribe: [] },
      state: { read: [], write: [] },
    });
  });

  it("两层包装的畸形声明(capabilities.routes 被误包成 {definition,config} 而非数组):构建期拒绝", () => {
    // 直接对应 requirements.md 记录的原始漂移:`ext.panes = { definition: {...}, config: {...} }`。
    // 这里把同样的两层包装模式套在 capabilities.routes 上——pane-discovery 的浅层检查(仅要求
    // capabilities 是对象)放行了它,只有 definePanes 的深层 schema 能识别 routes 本该是数组。
    const malformedCapabilities = {
      ...validCapabilities,
      routes: { definition: [{ name: "foo", methods: ["GET"] }], config: {} },
    } as unknown as PaneModule["capabilities"];
    const input = discovery({
      modules: [paneModule({ id: "one", title: "One", capabilities: malformedCapabilities })],
    });

    expect(() => assemblePanesManifest(input)).toThrow(BuildError);
    try {
      assemblePanesManifest(input);
      expect.unreachable("应抛出 BuildError");
    } catch (error) {
      expect(error).toBeInstanceOf(BuildError);
      const buildError = error as BuildError;
      expect(buildError.stage).toBe("manifest");
      expect(buildError.code).toBe("BUILD_MANIFEST_INVALID_SHAPE");
      expect(buildError.path).toBe("/agent/panes/modules.ts");
      // 违反的具体结构约束(routes 须为数组)须出现在文案中,而非泛泛的「校验失败」。
      expect(buildError.detail).toMatch(/routes/);
    }
  });

  it("initialPaneIds 引用未声明的 pane id:构建期拒绝而非留到运行期", () => {
    const input = discovery({
      modules: [paneModule({ id: "one", title: "One" })],
      panelConfig: { initialPaneIds: ["does-not-exist"] },
    });

    expect(() => assemblePanesManifest(input)).toThrow(BuildError);
  });
});
