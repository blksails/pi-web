// @vitest-environment node
/**
 * 终端呈现物单测(spec cli-component-add,任务 2.5,Req 5.4, 7.3)。
 * diff:增/删/改/无差异四态;guidance:对范例形状清单的快照。
 */
import { describe, expect, it } from "vitest";
import { unifiedDiff } from "@/server/cli/component/unified-diff";
import { buildWiringGuidance, renderWiringGuidance } from "@/server/cli/component/wiring-guidance";

describe("unifiedDiff", () => {
  it("无差异返回空串", () => {
    expect(unifiedDiff("a.tsx", "same\n", "same\n")).toBe("");
  });

  it("修改行:unified 头 + hunk + -/+ 行", () => {
    const out = unifiedDiff("w.tsx", "line1\nline2\nline3\n", "line1\nline2 changed\nline3\n");
    expect(out).toContain("--- a/w.tsx");
    expect(out).toContain("+++ b/w.tsx");
    expect(out).toContain("-line2");
    expect(out).toContain("+line2 changed");
    expect(out).toContain(" line1");
    expect(out).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it("纯新增与纯删除", () => {
    const added = unifiedDiff("a.tsx", "a\n", "a\nb\n");
    expect(added).toContain("+b");
    expect(added).not.toContain("-a");
    const removed = unifiedDiff("a.tsx", "a\nb\n", "a\n");
    expect(removed).toContain("-b");
  });

  it("相距较远的两处变更产出两个 hunk", () => {
    const oldText = ["h1", ...Array.from({ length: 20 }, (_, i) => `mid${i}`), "t1"].join("\n");
    const newText = ["h1x", ...Array.from({ length: 20 }, (_, i) => `mid${i}`), "t1x"].join("\n");
    const out = unifiedDiff("a.tsx", oldText, newText);
    expect(out.match(/@@ /g)?.length).toBe(2);
  });
});

describe("wiring guidance", () => {
  const wiring = {
    point: "canvasPlugins",
    export: "watermarkBundle",
    from: "./components/watermark/watermark",
  } as const;

  it("canvasPlugins:结构化形态由声明驱动(数组追加)", () => {
    expect(buildWiringGuidance(wiring)).toEqual({
      importLine: `import { watermarkBundle } from "./components/watermark/watermark";`,
      point: "canvasPlugins",
      entry: "watermarkBundle",
      configLine: "canvasPlugins: [watermarkBundle],",
    });
  });

  it("canvasPlugins:终端文本含 import 行、插件点数组项与 build 提示(5.4/6.2)", () => {
    const text = renderWiringGuidance(buildWiringGuidance(wiring));
    expect(text).toContain(`import { watermarkBundle } from "./components/watermark/watermark";`);
    expect(text).toContain("canvasPlugins: [watermarkBundle],");
    expect(text).toContain("pi-web build");
    expect(text).toContain("web.config.tsx");
  });

  it("slots:具名槽对象键 JSX 挂载(v1.1)", () => {
    const guidance = buildWiringGuidance({
      point: "slots",
      slot: "panelRight",
      export: "Scene3dPanel",
      from: "./components/scene3d/components/scene3d/scene3d-panel",
    });
    expect(guidance).toEqual({
      importLine: `import { Scene3dPanel } from "./components/scene3d/components/scene3d/scene3d-panel";`,
      point: "slots",
      slot: "panelRight",
      entry: "<Scene3dPanel />",
      configLine: "slots: { panelRight: <Scene3dPanel /> },",
    });
    const text = renderWiringGuidance(guidance);
    expect(text).toContain("slots: { panelRight: <Scene3dPanel /> },");
    expect(text).toContain("并入同一对象");
  });
});
