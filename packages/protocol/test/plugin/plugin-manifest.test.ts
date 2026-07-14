/**
 * pi-web.json 清单契约 — kind 判别式与 component 字段组(spec cli-component-add,任务 1,Req 1.1)。
 *
 * 只测**结构**层(zod parse):跨字段业务规则(files 必含测试、路径安全、target 约定等)
 * 归 CLI 侧 validateComponentManifest,不在本文件。重点守两条:
 *   - 新 kind/字段组可解析且带缺省值;
 *   - 既有 agent/plugin 实例的 parse 结果不因本次扩展而变(向后兼容)。
 */
import { describe, expect, it } from "vitest";
import {
  ComponentSpecSchema,
  ComponentWiringSchema,
  PiWebManifestSchema,
  PluginKindSchema,
} from "../../src/plugin/plugin-manifest.js";

describe("PluginKindSchema", () => {
  it("接受三个判别值", () => {
    expect(PluginKindSchema.parse("agent")).toBe("agent");
    expect(PluginKindSchema.parse("plugin")).toBe("plugin");
    expect(PluginKindSchema.parse("component")).toBe("component");
  });

  it("拒绝未知 kind", () => {
    expect(PluginKindSchema.safeParse("widget").success).toBe(false);
  });
});

describe("ComponentWiringSchema", () => {
  it("接受 canvasPlugins 与预留枚举值", () => {
    for (const point of ["canvasPlugins", "renderers", "slots"] as const) {
      const parsed = ComponentWiringSchema.parse({
        point,
        export: "watermarkBundle",
        from: "./components/watermark/watermark",
      });
      expect(parsed.point).toBe(point);
    }
  });

  it("拒绝未知插件点与空字段", () => {
    expect(
      ComponentWiringSchema.safeParse({ point: "toolbar", export: "x", from: "./y" }).success,
    ).toBe(false);
    expect(
      ComponentWiringSchema.safeParse({ point: "canvasPlugins", export: "", from: "./y" }).success,
    ).toBe(false);
  });
});

describe("ComponentSpecSchema", () => {
  it("peer 与 registryDeps 带缺省值", () => {
    const parsed = ComponentSpecSchema.parse({
      files: ["components/watermark/watermark.tsx"],
      wiring: { point: "canvasPlugins", export: "b", from: "./c" },
    });
    expect(parsed.peer).toEqual({});
    expect(parsed.registryDeps).toEqual([]);
    expect(parsed.target).toBeUndefined();
  });

  it("files 至少一项且不接受空串", () => {
    expect(
      ComponentSpecSchema.safeParse({
        files: [],
        wiring: { point: "canvasPlugins", export: "b", from: "./c" },
      }).success,
    ).toBe(false);
    expect(
      ComponentSpecSchema.safeParse({
        files: [""],
        wiring: { point: "canvasPlugins", export: "b", from: "./c" },
      }).success,
    ).toBe(false);
  });
});

describe("PiWebManifestSchema(component 扩展后的向后兼容)", () => {
  it("kind=component 的完整清单可解析", () => {
    const parsed = PiWebManifestSchema.parse({
      id: "canvas-watermark",
      version: "0.1.0",
      kind: "component",
      component: {
        files: ["components/watermark/watermark.tsx", "components/watermark/watermark.test.tsx"],
        wiring: { point: "canvasPlugins", export: "watermarkBundle", from: "./components/watermark/watermark" },
        peer: { "@blksails/pi-web-canvas-kit": ">=0.1.0" },
      },
    });
    expect(parsed.kind).toBe("component");
    expect(parsed.component?.files).toHaveLength(2);
  });

  it("既有 agent/plugin 实例 parse 结果不变(缺省 kind=plugin,无 component 字段)", () => {
    const legacy = PiWebManifestSchema.parse({ id: "code-review", version: "1.0.0" });
    expect(legacy.kind).toBe("plugin");
    expect(legacy.component).toBeUndefined();

    const agent = PiWebManifestSchema.parse({ id: "hello", version: "1.0.0", kind: "agent" });
    expect(agent.kind).toBe("agent");
  });

  it("component 字段组结构非法时整单拒绝", () => {
    expect(
      PiWebManifestSchema.safeParse({
        id: "x",
        version: "1.0.0",
        kind: "component",
        component: { files: ["a.tsx"], wiring: { point: "nope", export: "b", from: "./c" } },
      }).success,
    ).toBe(false);
  });
});
