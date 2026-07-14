/**
 * 单元:统一插件解析器 resolvePiPlugin(spec: plugin-system-unification,Req 1.2/1.3/1.4)。
 * 用真实 fs(tmpdir)搭建包目录,覆盖:清单优先 / 无清单回退 / 声明 webext 但 dist 缺失 /
 * 非法清单 / 声明路径缺失。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePiPlugin } from "../../src/plugin/resolve-plugin.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "pi-plugin-resolve-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const p = join(root, rel);
  await fs.mkdir(join(p, ".."), { recursive: true });
  await fs.writeFile(p, content, "utf8");
}
async function mkdir(rel: string): Promise<void> {
  await fs.mkdir(join(root, rel), { recursive: true });
}

describe("resolvePiPlugin", () => {
  it("清单优先:据 pi-web.json 合成描述符,声明的存在路径全保留,无诊断", async () => {
    await write("extensions/code-review.ts", "export default () => {};");
    await mkdir("skills/code-review");
    await write(".pi/web/dist/manifest.json", "{}");
    await write(
      "pi-web.json",
      JSON.stringify({
        id: "code-review",
        version: "1.0.0",
        displayName: "Code Review",
        pi: { extensions: ["extensions/code-review.ts"], skills: ["skills/code-review"] },
        web: { dist: ".pi/web/dist", commands: ["review"] },
        bindings: { tools: ["code_review"] },
      }),
    );

    const d = await resolvePiPlugin(root);

    expect(d.id).toBe("code-review");
    expect(d.version).toBe("1.0.0");
    expect(d.displayName).toBe("Code Review");
    expect(d.pi.extensions).toEqual(["extensions/code-review.ts"]);
    expect(d.pi.skills).toEqual(["skills/code-review"]);
    expect(d.web).toEqual({ dist: ".pi/web/dist" });
    expect(d.webCommands).toEqual(["review"]);
    expect(d.bindings).toEqual({ tools: ["code_review"] });
    expect(d.diagnostics).toEqual([]);
  });

  it("无清单:回退目录约定扫描 + 从 package.json 取 id/version", async () => {
    await mkdir("extensions");
    await mkdir("skills");
    await write(".pi/web/dist/manifest.json", "{}");
    await write("package.json", JSON.stringify({ name: "@acme/x", version: "2.3.4" }));

    const d = await resolvePiPlugin(root);

    expect(d.id).toBe("@acme/x");
    expect(d.version).toBe("2.3.4");
    expect(d.pi.extensions).toEqual(["extensions"]);
    expect(d.pi.skills).toEqual(["skills"]);
    expect(d.pi.prompts).toEqual([]);
    expect(d.web).toEqual({ dist: join(".pi", "web", "dist") });
    expect(d.diagnostics).toEqual([]);
  });

  it("声明 webext 但 dist/manifest.json 缺失:忽略 webext + 记诊断,不失败", async () => {
    await write(
      "pi-web.json",
      JSON.stringify({ id: "p", version: "1.0.0", web: { dist: ".pi/web/dist" } }),
    );

    const d = await resolvePiPlugin(root);

    expect(d.web).toBeUndefined();
    expect(d.diagnostics.some((m) => m.includes("manifest.json 缺失"))).toBe(true);
  });

  it("非法清单 JSON:记诊断并回退(id 取目录名)", async () => {
    await write("pi-web.json", "{ not json");

    const d = await resolvePiPlugin(root);

    expect(d.diagnostics.some((m) => m.includes("合法 JSON"))).toBe(true);
    expect(d.id.length).toBeGreaterThan(0); // 回退目录名
  });

  it("声明的 pi 资源路径不存在:忽略 + 记诊断,不使整包失败", async () => {
    await write(
      "pi-web.json",
      JSON.stringify({
        id: "p",
        version: "1.0.0",
        pi: { extensions: ["extensions/missing.ts"] },
      }),
    );

    const d = await resolvePiPlugin(root);

    expect(d.pi.extensions).toEqual([]);
    expect(d.diagnostics.some((m) => m.includes("missing.ts"))).toBe(true);
  });
});
