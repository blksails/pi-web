import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiResourceManager } from "../../src/resources/manager.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeManager() {
  const root = await mkdtemp(join(tmpdir(), "pi-resource-manager-"));
  tempRoots.push(root);
  return {
    manager: createPiResourceManager({
      cwd: join(root, "agent-workspace"),
      agentDir: join(root, "personal"),
      companyRoot: join(root, "company"),
    }),
    root,
  };
}

describe("PiResourceManager", () => {
  it("按公司/Agent/个人分别创建并列出 skill 与 pi template", async () => {
    const { manager, root } = await makeManager();
    await manager.createSkill({ scope: "company", name: "shared", description: "公司共用", content: "公司规则" });
    await manager.createSkill({ scope: "agent", name: "local", content: "Agent 规则" });
    await manager.createTemplate({
      scope: "personal",
      name: "review",
      description: "审查",
      argumentHint: "$ARGUMENTS",
      content: "请审查：$ARGUMENTS",
    });

    const catalog = await manager.list();
    expect(catalog.skills.map((item) => `${item.scope}/${item.name}`)).toEqual([
      "agent/local",
      "company/shared",
    ]);
    expect(catalog.templates).toEqual([
      expect.objectContaining({ scope: "personal", name: "review", argumentHint: "$ARGUMENTS" }),
    ]);
    await expect(readFile(join(root, "agent-workspace", ".pi", "prompts", "review.md"), "utf8")).rejects.toThrow();
    expect(await readFile(join(root, "personal", "prompts", "review.md"), "utf8")).toContain("argument-hint: \"$ARGUMENTS\"");
  });

  it("模板按 pi 原生 prompts 目录直扫，不把子目录误当模板", async () => {
    const { manager, root } = await makeManager();
    const prompts = join(root, "personal", "prompts");
    await mkdir(join(prompts, "nested"), { recursive: true });
    await writeFile(join(prompts, "nested", "ignored.md"), "ignored", "utf8");
    await writeFile(join(prompts, "top.md"), "---\ndescription: top\n---\nbody", "utf8");

    const catalog = await manager.list();
    expect(catalog.templates.map((item) => item.name)).toEqual(["top"]);
  });

  it("拒绝越界名与超大正文，默认不覆盖已有资源", async () => {
    const { manager } = await makeManager();
    await expect(manager.createSkill({ scope: "agent", name: "../escape", content: "x" })).rejects.toThrow("Resource name");
    await expect(manager.createTemplate({ scope: "agent", name: "huge", content: "x".repeat(512 * 1024) })).rejects.toThrow("larger");
    await manager.createTemplate({ scope: "agent", name: "same", content: "first" });
    await expect(manager.createTemplate({ scope: "agent", name: "same", content: "second" })).rejects.toThrow();
  });
});
