/**
 * 结构验收：example agent 注册三个工具名；runtime 导出运算入口。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

describe("archive tools surface", () => {
  it("exports createZip/extractZip/extractRar from archive module", async () => {
    const mod = await import("../../src/archive/index.js");
    expect(typeof mod.createZip).toBe("function");
    expect(typeof mod.extractZip).toBe("function");
    expect(typeof mod.extractRar).toBe("function");
    expect(typeof mod.writeZipEntries).toBe("function");
  });

  it("example archive-agent registers zip/unzip/unrar customTools", () => {
    const agentPath = path.join(
      repoRoot,
      "examples/archive-agent/tools/archive-tools.ts",
    );
    expect(existsSync(agentPath)).toBe(true);
    const src = readFileSync(agentPath, "utf8");
    expect(src).toMatch(/name:\s*"zip"/);
    expect(src).toMatch(/name:\s*"unzip"/);
    expect(src).toMatch(/name:\s*"unrar"/);
    expect(src).toMatch(/createZip/);
    expect(src).toMatch(/extractZip/);
    expect(src).toMatch(/extractRar/);

    const indexPath = path.join(repoRoot, "examples/archive-agent/index.ts");
    const index = readFileSync(indexPath, "utf8");
    expect(index).toMatch(/customTools:\s*\[\.\.\.archiveTools\]/);
  });

  it("kiro spec phase artifacts exist and ready_for_implementation", () => {
    const base = path.join(repoRoot, ".kiro/specs/archive-tools");
    for (const f of ["spec.json", "requirements.md", "design.md", "tasks.md"]) {
      expect(existsSync(path.join(base, f))).toBe(true);
    }
    const spec = JSON.parse(
      readFileSync(path.join(base, "spec.json"), "utf8"),
    ) as {
      ready_for_implementation?: boolean;
      approvals?: Record<string, { approved?: boolean }>;
    };
    expect(spec.ready_for_implementation).toBe(true);
    expect(spec.approvals?.requirements?.approved).toBe(true);
    expect(spec.approvals?.design?.approved).toBe(true);
    expect(spec.approvals?.tasks?.approved).toBe(true);
  });
});
