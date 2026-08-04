// @vitest-environment node
/**
 * `resolveToolchain` 单测(spec cli-agent-build,任务 3.2,Req 4.2, 4.4)。
 *
 * 覆盖:候选根/预设全齐时的首个存在者选取、候选根不完整时按优先级回落下一候选、
 * 工具链候选全不完整与预设候选全缺失时分别（及同时）以 `BuildError{stage:"toolchain"}`
 * 终止并在 `detail` 里列出缺失项。真实临时目录读写(与 `agent-source.test.ts` 同策略),
 * 不 mock 文件系统——探测逻辑本身就是「文件是否存在」。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveToolchain,
  TOOLCHAIN_PACKAGES,
} from "@/server/cli/build/toolchain";
import { BuildError, describeBuildError } from "@/server/cli/build/errors";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "toolchain-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 在 `nodeModulesRoot` 下为全部四项工具链包各放一份最小 `package.json`。 */
function seedCompleteToolchain(nodeModulesRoot: string): void {
  for (const pkg of TOOLCHAIN_PACKAGES) {
    mkdirSync(join(nodeModulesRoot, pkg), { recursive: true });
    writeFileSync(join(nodeModulesRoot, pkg, "package.json"), JSON.stringify({ name: pkg, version: "0.0.0" }));
  }
}

/** 只放部分工具链包(用于制造「候选根存在但不完整」的场景)。 */
function seedPartialToolchain(nodeModulesRoot: string, pkgs: readonly string[]): void {
  for (const pkg of pkgs) {
    mkdirSync(join(nodeModulesRoot, pkg), { recursive: true });
    writeFileSync(join(nodeModulesRoot, pkg, "package.json"), JSON.stringify({ name: pkg, version: "0.0.0" }));
  }
}

function seedPreset(presetPath: string): void {
  mkdirSync(join(presetPath, ".."), { recursive: true });
  writeFileSync(presetPath, "export const piWebPreset = {};\n");
}

describe("resolveToolchain: 候选全齐", () => {
  it("首个候选目录/文件都存在时,直接选取并返回其路径", () => {
    const nm = join(root, "dist-node-modules");
    const preset = join(root, "dist-packages", "ui", "tailwind-preset.ts");
    seedCompleteToolchain(nm);
    seedPreset(preset);

    const result = resolveToolchain([nm], [preset]);

    expect(result.toolchainRoot).toBe(nm);
    expect(result.presetPath).toBe(preset);
  });

  it("首个候选缺失时按优先级回落到下一个候选(node_modules 根 与 preset 各自独立回落)", () => {
    const missingRoot = join(root, "missing-node-modules");
    const fallbackRoot = join(root, "pkg-node-modules");
    seedCompleteToolchain(fallbackRoot);

    const missingPreset = join(root, "missing-preset", "tailwind-preset.ts");
    const fallbackPreset = join(root, "pkg-preset", "tailwind-preset.ts");
    seedPreset(fallbackPreset);

    const result = resolveToolchain([missingRoot, fallbackRoot], [missingPreset, fallbackPreset]);

    expect(result.toolchainRoot).toBe(fallbackRoot);
    expect(result.presetPath).toBe(fallbackPreset);
  });

  it("首个候选根存在但工具链包不完整(半安装)时,判定为未命中并回落下一候选", () => {
    const partialRoot = join(root, "partial-node-modules");
    const completeRoot = join(root, "complete-node-modules");
    seedPartialToolchain(partialRoot, ["esbuild", "postcss"]); // 缺 tailwindcss/autoprefixer
    seedCompleteToolchain(completeRoot);

    const preset = join(root, "preset", "tailwind-preset.ts");
    seedPreset(preset);

    const result = resolveToolchain([partialRoot, completeRoot], [preset]);

    expect(result.toolchainRoot).toBe(completeRoot);
  });
});

describe("resolveToolchain: 工具链缺失即止(Req 4.4)", () => {
  it("全部候选根都不完整时,以 BuildError{stage:toolchain} 终止并在 detail 中列出缺失的具体包", () => {
    const rootA = join(root, "a-node-modules");
    const rootB = join(root, "b-node-modules");
    seedPartialToolchain(rootA, ["esbuild"]); // 缺 postcss/tailwindcss/autoprefixer
    seedPartialToolchain(rootB, []); // 全缺

    const preset = join(root, "preset", "tailwind-preset.ts");
    seedPreset(preset);

    expect(() => resolveToolchain([rootA, rootB], [preset])).toThrow(BuildError);

    try {
      resolveToolchain([rootA, rootB], [preset]);
      expect.unreachable("应抛出 BuildError");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildError);
      const err = e as BuildError;
      expect(err.stage).toBe("toolchain");
      expect(err.code).toBe("BUILD_TOOLCHAIN_MISSING");
      expect(err.detail).toContain("postcss");
      expect(err.detail).toContain("tailwindcss");
      expect(err.detail).toContain("autoprefixer");
      expect(err.detail).toContain(rootA);
      expect(err.detail).toContain(rootB);
      // preset 本身是齐的,不应被列进缺失项。
      expect(err.detail).not.toContain("画布样式预设");
    }
  });

  it("候选路径数组为空(壳层未注入)时,明确说明未注入任何候选路径,而非静默判定缺失", () => {
    try {
      resolveToolchain([], []);
      expect.unreachable("应抛出 BuildError");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildError);
      const err = e as BuildError;
      expect(err.detail).toContain("未注入任何候选路径");
    }
  });

  it("仅样式预设候选全缺失时,单独报出预设缺失项,不误报工具链缺失", () => {
    const nm = join(root, "node_modules");
    seedCompleteToolchain(nm);
    const missingPreset = join(root, "no-such-preset", "tailwind-preset.ts");

    try {
      resolveToolchain([nm], [missingPreset]);
      expect.unreachable("应抛出 BuildError");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildError);
      const err = e as BuildError;
      expect(err.detail).toContain("画布样式预设");
      expect(err.detail).toContain(missingPreset);
      expect(err.detail).not.toContain("esbuild");
    }
  });

  it("工具链根与样式预设同时缺失时,detail 同时列出两类缺失项", () => {
    try {
      resolveToolchain([join(root, "nope-node-modules")], [join(root, "nope-preset.ts")]);
      expect.unreachable("应抛出 BuildError");
    } catch (e) {
      const err = e as BuildError;
      expect(err.detail).toContain("构建工具链");
      expect(err.detail).toContain("画布样式预设");
    }
  });

  it("describeBuildError 呈现出可读的一行文案(供 reporter.fail 消费)", () => {
    try {
      resolveToolchain([], []);
      expect.unreachable("应抛出 BuildError");
    } catch (e) {
      const err = e as BuildError;
      expect(describeBuildError(err)).toContain("工具链或样式预设");
    }
  });
});
