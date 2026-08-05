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
    // ★ 不能把 Windows 路径写死在断言里：`templateRoot` 内部对该 env 做的是
    //   「dirname 剥掉最后一段 → 再 resolve 拼回 prompts」这一往返，而 POSIX 的
    //   `dirname` 不认反斜杠 —— "C:\\company\\prompts" 会被当成单个片段，
    //   dirname 得 "."，resolve(".", "prompts") 就变成 <cwd>/prompts。
    //   于是该用例只在 Windows 上过，macOS/Linux（含 CI 的 ubuntu）必挂。
    //   改用平台原生分隔符构造，三个平台语义一致。
    const previousPrompts = process.env.PI_WEB_COMPANY_PROMPTS_DIR;
    // RESOURCES_DIR 优先级更高，若外部环境设了它本用例就测不到 PROMPTS_DIR 这条路径。
    const previousResources = process.env.PI_WEB_COMPANY_RESOURCES_DIR;
    const promptsDir = join(tmpdir(), "pi-template-company", "prompts");
    process.env.PI_WEB_COMPANY_PROMPTS_DIR = promptsDir;
    delete process.env.PI_WEB_COMPANY_RESOURCES_DIR;
    try {
      expect(templateRoot("company", join(tmpdir(), "cwd"), join(tmpdir(), "agent")))
        .toBe(promptsDir);
    } finally {
      if (previousPrompts === undefined) delete process.env.PI_WEB_COMPANY_PROMPTS_DIR;
      else process.env.PI_WEB_COMPANY_PROMPTS_DIR = previousPrompts;
      if (previousResources !== undefined) {
        process.env.PI_WEB_COMPANY_RESOURCES_DIR = previousResources;
      }
    }
  });

  it("renders argument placeholders without changing content", () => {
    expect(renderPromptTemplate("x", "d", "body", "hint")).toContain("name: x");
  });
});
