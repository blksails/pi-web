// @vitest-environment node
/**
 * 组件清单业务校验单测(spec cli-component-add,任务 2.2,Req 1.2–1.7, 2.5)。
 * 1.2–1.7 每条验收标准至少一个用例;聚合行为(一次校验报全部问题)单独验证。
 */
import { describe, expect, it } from "vitest";
import { PiWebManifestSchema, type PiWebManifest } from "@blksails/pi-web-protocol";
import {
  componentTargetRel,
  validateComponentManifest,
} from "@/server/cli/component/manifest-validate";

function manifest(overrides: Record<string, unknown> = {}): PiWebManifest {
  return PiWebManifestSchema.parse({
    id: "canvas-watermark",
    version: "0.1.0",
    kind: "component",
    component: {
      files: ["components/watermark/watermark.tsx", "components/watermark/watermark.test.tsx"],
      wiring: { point: "canvasPlugins", export: "watermarkBundle", from: "./components/watermark/watermark" },
    },
    ...overrides,
  });
}

function issueCodes(m: PiWebManifest): string[] {
  const result = validateComponentManifest(m);
  return result.ok ? [] : result.issues.map((i) => i.code);
}

describe("validateComponentManifest", () => {
  it("合法清单通过并给出约定落点(1.1/1.7)", () => {
    const result = validateComponentManifest(manifest());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.targetRel).toBe(".pi/web/components/canvas-watermark");
    expect(componentTargetRel("x")).toBe(".pi/web/components/x");
  });

  it("kind 非 component 报 component_spec_missing 并带实际 kind(1.2/2.5)", () => {
    const m = PiWebManifestSchema.parse({ id: "a", version: "1.0.0", kind: "agent" });
    const result = validateComponentManifest(m);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("component_spec_missing");
      expect(result.issues[0]?.message).toContain('"agent"');
    }
  });

  it("kind=component 但缺字段组报 component_spec_missing(1.2)", () => {
    const m = PiWebManifestSchema.parse({ id: "a", version: "1.0.0", kind: "component" });
    expect(issueCodes(m)).toEqual(["component_spec_missing"]);
  });

  it("files 含绝对路径 / Windows 盘符 / .. 逃逸均报 component_files_invalid(1.3)", () => {
    for (const bad of ["/etc/passwd", "C:\\evil.tsx", "../outside.test.tsx", "a/../../b.test.tsx"]) {
      const m = manifest({
        component: {
          files: [bad, "ok.test.tsx"],
          wiring: { point: "canvasPlugins", export: "b", from: "./c" },
        },
      });
      expect(issueCodes(m)).toContain("component_files_invalid");
    }
  });

  it("files 无测试文件报 component_tests_missing(1.4)", () => {
    const m = manifest({
      component: {
        files: ["components/watermark/watermark.tsx"],
        wiring: { point: "canvasPlugins", export: "b", from: "./c" },
      },
    });
    expect(issueCodes(m)).toEqual(["component_tests_missing"]);
  });

  it("wiring.point 预留枚举值 renderers 报 wiring_point_unsupported(1.5)", () => {
    const m = manifest({
      component: {
        files: ["a.tsx", "a.test.tsx"],
        wiring: { point: "renderers", export: "b", from: "./c" },
      },
    });
    expect(issueCodes(m)).toEqual(["wiring_point_unsupported"]);
  });

  it("slots 点(v1.1):带 slot 通过;缺 slot 报 wiring_slot_missing", () => {
    const ok = manifest({
      component: {
        files: ["a.tsx", "a.test.tsx"],
        wiring: { point: "slots", slot: "panelRight", export: "P", from: "./p" },
      },
    });
    expect(issueCodes(ok)).toEqual([]);

    const missing = manifest({
      component: {
        files: ["a.tsx", "a.test.tsx"],
        wiring: { point: "slots", export: "P", from: "./p" },
      },
    });
    expect(issueCodes(missing)).toEqual(["wiring_slot_missing"]);
  });

  it("registryDeps 非空报 registry_deps_unsupported(1.6)", () => {
    const m = manifest({
      component: {
        files: ["a.tsx", "a.test.tsx"],
        wiring: { point: "canvasPlugins", export: "b", from: "./c" },
        registryDeps: ["other-component"],
      },
    });
    expect(issueCodes(m)).toEqual(["registry_deps_unsupported"]);
  });

  it("target 偏离约定报 target_mismatch;等于约定或省略则通过(1.7)", () => {
    const bad = manifest({
      component: {
        files: ["a.tsx", "a.test.tsx"],
        wiring: { point: "canvasPlugins", export: "b", from: "./c" },
        target: ".pi/web/elsewhere",
      },
    });
    expect(issueCodes(bad)).toEqual(["target_mismatch"]);

    const good = manifest({
      component: {
        files: ["a.tsx", "a.test.tsx"],
        wiring: { point: "canvasPlugins", export: "b", from: "./c" },
        target: ".pi/web/components/canvas-watermark",
      },
    });
    expect(issueCodes(good)).toEqual([]);
  });

  it("一次校验聚合全部问题(不首错即返)", () => {
    const m = manifest({
      component: {
        files: ["/abs.tsx"],
        wiring: { point: "slots", export: "b", from: "./c" },
        registryDeps: ["x"],
        target: "wrong",
      },
    });
    const codes = issueCodes(m);
    expect(codes).toContain("component_files_invalid");
    expect(codes).toContain("component_tests_missing");
    expect(codes).toContain("wiring_slot_missing");
    expect(codes).toContain("registry_deps_unsupported");
    expect(codes).toContain("target_mismatch");
  });
});
