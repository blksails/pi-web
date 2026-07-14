// @vitest-environment node
/**
 * 原子写入器单测(spec cli-component-add,任务 2.6,Req 3.3, 3.4, 5.1, 5.3)。
 * 真实临时目录:成功写入形态 / 注入 swap 前故障断言还原 / 软链逃逸拒绝。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installComponentFiles } from "@/server/cli/component/installer";
import { COMPONENT_PROVENANCE_FILENAME } from "@/server/cli/component/provenance";

let root: string;
let packRoot: string;
let sourceDir: string;

const PROV = {
  id: "canvas-watermark",
  version: "0.1.0",
  origin: "local:/pack",
  installedAt: "2026-07-09T00:00:00Z",
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-web-installer-"));
  packRoot = join(root, "pack");
  sourceDir = join(root, "my-agent");
  mkdirSync(join(packRoot, "components", "watermark"), { recursive: true });
  writeFileSync(join(packRoot, "components", "watermark", "watermark.tsx"), "export const x = 1;\n");
  writeFileSync(join(packRoot, "components", "watermark", "watermark.test.tsx"), "// test\n");
  mkdirSync(join(sourceDir, ".pi", "web"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const FILES = ["components/watermark/watermark.tsx", "components/watermark/watermark.test.tsx"];

function destDir(): string {
  return join(sourceDir, ".pi", "web", "components", "canvas-watermark");
}

describe("installComponentFiles", () => {
  it("成功:按相对结构落盘 + 溯源同生(5.1/5.2)", () => {
    const result = installComponentFiles({
      packRoot,
      files: FILES,
      destDir: destDir(),
      targetSourceDir: sourceDir,
      provenance: PROV,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readFileSync(join(destDir(), "components/watermark/watermark.tsx"), "utf8")).toContain(
      "export const x",
    );
    const prov = JSON.parse(readFileSync(join(destDir(), COMPONENT_PROVENANCE_FILENAME), "utf8")) as {
      files: Record<string, string>;
    };
    expect(Object.keys(prov.files).sort()).toEqual([...FILES].sort());
    expect(prov.files[FILES[0] as string]).toMatch(/^sha256:/);
    expect(result.value.written).toContain(COMPONENT_PROVENANCE_FILENAME);
    // 无 staging/bak 残留。
    const siblings = readdirSync(join(sourceDir, ".pi", "web", "components"));
    expect(siblings).toEqual(["canvas-watermark"]);
  });

  it("swap 前故障:首装态落点不存在、staging 清理(5.3)", () => {
    const result = installComponentFiles({
      packRoot,
      files: FILES,
      destDir: destDir(),
      targetSourceDir: sourceDir,
      provenance: PROV,
      beforeSwapHook: () => {
        throw new Error("disk full (injected)");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("install_write_failed");
    expect(existsSync(destDir())).toBe(false);
    expect(readdirSync(join(sourceDir, ".pi", "web", "components"))).toEqual([]);
  });

  it("swap 前故障:覆盖态旧内容原样还原(5.3)", () => {
    // 先成功装一次。
    const first = installComponentFiles({
      packRoot,
      files: FILES,
      destDir: destDir(),
      targetSourceDir: sourceDir,
      provenance: PROV,
    });
    expect(first.ok).toBe(true);
    const before = readFileSync(join(destDir(), "components/watermark/watermark.tsx"), "utf8");

    writeFileSync(join(packRoot, "components", "watermark", "watermark.tsx"), "export const x = 2;\n");
    const result = installComponentFiles({
      packRoot,
      files: FILES,
      destDir: destDir(),
      targetSourceDir: sourceDir,
      provenance: { ...PROV, version: "0.2.0" },
      beforeSwapHook: () => {
        throw new Error("injected");
      },
    });
    expect(result.ok).toBe(false);
    expect(readFileSync(join(destDir(), "components/watermark/watermark.tsx"), "utf8")).toBe(before);
    expect(readdirSync(join(sourceDir, ".pi", "web", "components"))).toEqual(["canvas-watermark"]);
  });

  it("软链把落点指向 source 外 → dest_escapes_target(3.3)", () => {
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });
    // .pi/web/components 是指向 source 外的软链。
    symlinkSync(outside, join(sourceDir, ".pi", "web", "components"));
    const result = installComponentFiles({
      packRoot,
      files: FILES,
      destDir: destDir(),
      targetSourceDir: sourceDir,
      provenance: PROV,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("dest_escapes_target");
    expect(readdirSync(outside)).toEqual([]); // 一字节未写
  });

  it("源文件读取失败:一字节未写(5.3)", () => {
    const result = installComponentFiles({
      packRoot,
      files: [...FILES, "components/ghost.tsx"],
      destDir: destDir(),
      targetSourceDir: sourceDir,
      provenance: PROV,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("install_write_failed");
    expect(existsSync(destDir())).toBe(false);
  });
});
