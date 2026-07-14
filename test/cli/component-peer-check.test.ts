// @vitest-environment node
/**
 * peer 基线校验单测(spec cli-component-add,任务 2.4,Req 4.1, 4.2, 4.4)。
 * 真实临时目录模拟 monorepo 布局:根 node_modules + 深层目标目录向上命中。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPeers, resolvePeerVersion } from "@/server/cli/component/peer-check";

let root: string;

function putPkg(base: string, name: string, version: string): void {
  const dir = join(base, "node_modules", ...name.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-web-peer-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolvePeerVersion", () => {
  it("自目标目录逐级向上命中根 node_modules(scoped 包)(4.1)", () => {
    putPkg(root, "@blksails/pi-web-canvas-kit", "0.3.2");
    const target = join(root, "examples", "my-agent");
    mkdirSync(target, { recursive: true });
    expect(resolvePeerVersion("@blksails/pi-web-canvas-kit", target)).toBe("0.3.2");
  });

  it("近处覆盖远处(最近的 node_modules 优先)", () => {
    putPkg(root, "a-pkg", "1.0.0");
    const target = join(root, "examples", "my-agent");
    putPkg(target, "a-pkg", "2.0.0");
    expect(resolvePeerVersion("a-pkg", target)).toBe("2.0.0");
  });

  it("未找到返回 null;坏 package.json 不视为命中", () => {
    const target = join(root, "examples", "my-agent");
    mkdirSync(target, { recursive: true });
    expect(resolvePeerVersion("ghost-pkg", target)).toBeNull();

    const dir = join(target, "node_modules", "broken-pkg");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), "{broken");
    putPkg(root, "broken-pkg", "3.0.0"); // 上层的好副本
    expect(resolvePeerVersion("broken-pkg", target)).toBe("3.0.0");
  });
});

describe("checkPeers", () => {
  it("全部满足 → ok(4.1)", () => {
    putPkg(root, "pkg-a", "1.5.0");
    putPkg(root, "pkg-b", "0.3.1");
    const result = checkPeers({ "pkg-a": ">=1.2.0", "pkg-b": "^0.3.0" }, root);
    expect(result.ok).toBe(true);
  });

  it("一次遍历聚合全部不满足项(含未找到)(4.2)", () => {
    putPkg(root, "pkg-old", "1.0.0");
    const result = checkPeers({ "pkg-old": ">=2.0.0", "pkg-missing": "^1.0.0" }, root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("peer_unsatisfied");
      expect(result.issues).toEqual([
        { pkg: "pkg-old", required: ">=2.0.0", actual: "1.0.0" },
        { pkg: "pkg-missing", required: "^1.0.0", actual: null },
      ]);
    }
  });

  it("范围写法不支持独立成码且优先呈现(4.4)", () => {
    putPkg(root, "pkg-a", "1.0.0");
    const result = checkPeers({ "pkg-a": "1.x", "pkg-b": ">=99.0.0" }, root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("peer_range_unsupported");
      expect(result.issues[0]?.pkg).toBe("pkg-a");
    }
  });
});
