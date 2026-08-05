import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPromptTemplate, renderPromptTemplate, templateRoot } from "../../src/template-tools/template-manager.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("template manager", () => {
  it("writes pi-native prompt frontmatter and body", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-template-tool-"));
    roots.push(root);
    const file = await createPromptTemplate({
      scope: "agent",
      cwd: join(root, "cwd"),
      agentDir: join(root, "agent"),
      name: "review",
      description: "审查",
      argumentHint: "$ARGUMENTS",
      content: "请审查 $ARGUMENTS",
    });
    expect(file).toBe(join(root, "cwd", ".pi", "prompts", "review.md"));
    expect(await readFile(file, "utf8")).toContain("argument-hint: \"$ARGUMENTS\"");
  });

  it("company scope can derive from the injected prompt root", () => {
    const previous = process.env.PI_WEB_COMPANY_PROMPTS_DIR;
    process.env.PI_WEB_COMPANY_PROMPTS_DIR = "C:\\company\\prompts";
    try {
      expect(templateRoot("company", "C:\\cwd", "C:\\agent")).toBe("C:\\company\\prompts");
    } finally {
      if (previous === undefined) delete process.env.PI_WEB_COMPANY_PROMPTS_DIR;
      else process.env.PI_WEB_COMPANY_PROMPTS_DIR = previous;
    }
  });

  it("renders argument placeholders without changing content", () => {
    expect(renderPromptTemplate("x", "d", "body", "hint")).toContain("name: x");
  });
});
