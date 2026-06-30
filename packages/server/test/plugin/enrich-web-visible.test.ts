/**
 * 单元:get_commands 回填 webVisible(spec plugin-system-unification 增量)。
 * 据命令 sourceInfo 解析其插件 pi-plugin.json 的 web.commands,命中打 webVisible。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichWebVisibleCommands } from "../../src/plugin/enrich-web-visible.js";

let pkg: string;

beforeEach(async () => {
  pkg = await fs.mkdtemp(join(tmpdir(), "pi-plugin-enrich-"));
  await fs.mkdir(join(pkg, ".pi"), { recursive: true });
  await fs.writeFile(
    join(pkg, "pi-plugin.json"),
    JSON.stringify({
      id: "code-review",
      version: "1.0.0",
      web: { commands: ["review"] },
    }),
    "utf8",
  );
});
afterEach(async () => {
  await fs.rm(pkg, { recursive: true, force: true });
});

describe("enrichWebVisibleCommands", () => {
  it("top-level 命令:声明在 web.commands → webVisible:true;未声明 → 不打标", async () => {
    const commands = [
      { name: "review", source: "extension", sourceInfo: { baseDir: join(pkg, ".pi"), origin: "top-level" } },
      { name: "secret", source: "extension", sourceInfo: { baseDir: join(pkg, ".pi"), origin: "top-level" } },
    ];

    const out = (await enrichWebVisibleCommands(commands)) as Array<{ name: string; webVisible?: boolean }>;

    expect(out.find((c) => c.name === "review")?.webVisible).toBe(true);
    expect(out.find((c) => c.name === "secret")?.webVisible).toBeUndefined();
  });

  it("package origin:baseDir 即包根", async () => {
    const commands = [
      { name: "review", source: "extension", sourceInfo: { baseDir: pkg, origin: "package" } },
    ];
    const out = (await enrichWebVisibleCommands(commands)) as Array<{ name: string; webVisible?: boolean }>;
    expect(out[0]?.webVisible).toBe(true);
  });

  it("非扩展命令 / 无 baseDir:原样透传不打标", async () => {
    const commands = [
      { name: "clear", source: "builtin" },
      { name: "noinfo", source: "extension" },
    ];
    const out = (await enrichWebVisibleCommands(commands)) as Array<{ name: string; webVisible?: boolean }>;
    expect(out[0]).toEqual({ name: "clear", source: "builtin" });
    expect(out[1]).toEqual({ name: "noinfo", source: "extension" });
  });

  it("无 pi-plugin.json 的插件:解析降级,不打标不抛错", async () => {
    const bare = await fs.mkdtemp(join(tmpdir(), "pi-plugin-bare-"));
    const commands = [
      { name: "x", source: "extension", sourceInfo: { baseDir: bare, origin: "package" } },
    ];
    const out = (await enrichWebVisibleCommands(commands)) as Array<{ webVisible?: boolean }>;
    expect(out[0]?.webVisible).toBeUndefined();
    await fs.rm(bare, { recursive: true, force: true });
  });
});
