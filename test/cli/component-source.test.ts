// @vitest-environment node
/**
 * 组件来源解析单测(spec cli-component-add,任务 3.1,Req 2.1–2.5)。
 * 六类:本地 / git(fake 克隆)/ 带子目录 / 子目录缺失 / registry 形态 / 非 component 包。
 * 合成夹具,不依赖范例包。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveComponentSource,
  splitSubdirFragment,
} from "@/server/cli/component/component-source";

let root: string;

function writeComponentPack(dir: string, id = "demo-comp"): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pi-web.json"),
    JSON.stringify({
      id,
      version: "0.1.0",
      kind: "component",
      component: {
        files: ["c.tsx", "c.test.tsx"],
        wiring: { point: "canvasPlugins", export: "b", from: "./c" },
      },
    }),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-web-compsrc-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("splitSubdirFragment", () => {
  it("剥末段 # 片段;空片段与无片段原样", () => {
    expect(splitSubdirFragment("git:h/u/r@v1.0.0#packages/x")).toEqual({
      base: "git:h/u/r@v1.0.0",
      subdir: "packages/x",
    });
    expect(splitSubdirFragment("./local-dir")).toEqual({ base: "./local-dir" });
    expect(splitSubdirFragment("git:h/u/r@v1.0.0#")).toEqual({ base: "git:h/u/r@v1.0.0" });
  });
});

describe("resolveComponentSource", () => {
  it("本地目录:直接作包根,origin 为 local:<abs>(2.1)", async () => {
    const pack = join(root, "my-comp");
    writeComponentPack(pack);
    const result = await resolveComponentSource(pack, { cwd: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.packRoot).toBe(pack);
    expect(result.value.origin).toBe(`local:${pack}`);
    expect(result.value.manifest.id).toBe("demo-comp");
  });

  it("git 直连:经注入克隆,pinned ref 进 origin(2.2)", async () => {
    const clone = join(root, "clone");
    writeComponentPack(clone);
    const result = await resolveComponentSource("git:github.com/org/repo@v1.2.0", {
      cwd: root,
      ensureGit: async (src) => {
        expect(src.url).toBe("https://github.com/org/repo.git");
        expect(src.ref).toBe("v1.2.0");
        return clone;
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.origin).toBe("git:github.com/org/repo@v1.2.0");
    expect(result.value.packRoot).toBe(clone);
  });

  it("git + #子目录:包根落到子目录,origin 带片段(2.3)", async () => {
    const clone = join(root, "clone2");
    writeComponentPack(join(clone, "packages", "x"));
    const result = await resolveComponentSource("git:github.com/org/repo@v1.2.0#packages/x", {
      cwd: root,
      ensureGit: async () => clone,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.packRoot).toBe(join(clone, "packages", "x"));
    expect(result.value.origin).toBe("git:github.com/org/repo@v1.2.0#packages/x");
  });

  it("子目录不存在 → source_subdir_not_found(2.3)", async () => {
    const clone = join(root, "clone3");
    mkdirSync(clone, { recursive: true });
    const result = await resolveComponentSource("git:github.com/org/repo@v1.2.0#ghost/dir", {
      cwd: root,
      ensureGit: async () => clone,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("source_subdir_not_found");
  });

  it("registry 名称形态 → source_form_unsupported 附用法示例(2.4)", async () => {
    const result = await resolveComponentSource("org/some-component", { cwd: root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("source_form_unsupported");
    expect(result.error.message).toContain("git:");
  });

  it("kind 非 component → source_not_component 报实际 kind(2.5)", async () => {
    const pack = join(root, "agent-pack");
    mkdirSync(pack, { recursive: true });
    writeFileSync(join(pack, "pi-web.json"), JSON.stringify({ id: "a", version: "1.0.0", kind: "agent" }));
    const result = await resolveComponentSource(pack, { cwd: root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("source_not_component");
    expect(result.error.message).toContain('"agent"');
  });

  it("无清单 / 坏 JSON → manifest_unreadable(2.5)", async () => {
    const bare = join(root, "bare");
    mkdirSync(bare, { recursive: true });
    const noManifest = await resolveComponentSource(bare, { cwd: root });
    expect(!noManifest.ok && noManifest.error.code === "manifest_unreadable").toBe(true);

    writeFileSync(join(bare, "pi-web.json"), "{broken");
    const badJson = await resolveComponentSource(bare, { cwd: root });
    expect(!badJson.ok && badJson.error.code === "manifest_unreadable").toBe(true);
  });

  it("git 裸分支名(非 pinned ref)被白名单拒绝(信任判据复用)", async () => {
    const result = await resolveComponentSource("git:github.com/org/repo@main", {
      cwd: root,
      ensureGit: async () => {
        throw new Error("不应走到克隆");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("allowlist_rejected");
  });
});
