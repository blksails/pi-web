// @vitest-environment node
/**
 * TemplateCatalog 单测(spec cli-package-commands,任务 3.1,Req 2.4, 2.5, 2.6)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listTemplates,
  resolveTemplate,
  resolveExamplesRoot,
} from "@/server/cli/scaffold/template-catalog";

function writePackageJson(dir: string, content: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(content), "utf8");
}

describe("TemplateCatalog: listTemplates", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pi-web-template-catalog-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("只枚举带 pi-web 展示元数据的子目录", () => {
    writePackageJson(join(root, "with-metadata"), {
      name: "with-metadata",
      "pi-web": { title: "带元数据", avatar: "🎯", description: "一句话描述" },
    });
    writePackageJson(join(root, "no-pi-web-field"), { name: "no-pi-web-field" });
    mkdirSync(join(root, "no-package-json"), { recursive: true });
    writeFileSync(join(root, "invalid-json"), "not a directory marker", "utf8");
    mkdirSync(join(root, "invalid-json-dir"), { recursive: true });
    writeFileSync(join(root, "invalid-json-dir", "package.json"), "{not valid json", "utf8");

    const templates = listTemplates(root);

    expect(templates.map((t) => t.name)).toEqual(["with-metadata"]);
  });

  it("正确读出 title/avatar/description", () => {
    writePackageJson(join(root, "full-meta"), {
      name: "full-meta",
      "pi-web": { title: "完整标题", avatar: "🚀", description: "完整描述" },
    });

    const [template] = listTemplates(root);

    expect(template).toEqual({
      name: "full-meta",
      title: "完整标题",
      avatar: "🚀",
      description: "完整描述",
    });
  });

  it("缺字段时回退:title→目录名,avatar→通用图标,description→空字符串", () => {
    writePackageJson(join(root, "partial-meta"), {
      name: "partial-meta",
      "pi-web": {},
    });

    const templates = listTemplates(root);
    const template = templates[0];
    expect(template).toBeDefined();
    expect(template?.name).toBe("partial-meta");
    expect(template?.title).toBe("partial-meta");
    expect(template?.avatar).toBe("📦");
    expect(template?.description).toBe("");
  });

  it("结果按 name 升序排列", () => {
    writePackageJson(join(root, "zeta"), { "pi-web": { title: "Z" } });
    writePackageJson(join(root, "alpha"), { "pi-web": { title: "A" } });

    const templates = listTemplates(root);

    expect(templates.map((t) => t.name)).toEqual(["alpha", "zeta"]);
  });

  it("纯读:枚举不创建任何文件或目录", () => {
    writePackageJson(join(root, "one"), { "pi-web": { title: "One" } });
    const before = readdirSync(root).sort();

    listTemplates(root);

    const after = readdirSync(root).sort();
    expect(after).toEqual(before);
  });

  it("目录不存在时返回空数组,不抛异常", () => {
    expect(() => listTemplates(join(root, "does-not-exist"))).not.toThrow();
    expect(listTemplates(join(root, "does-not-exist"))).toEqual([]);
  });
});

describe("TemplateCatalog: resolveTemplate", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pi-web-template-catalog-resolve-"));
    writePackageJson(join(root, "minimal-agent"), {
      "pi-web": { title: "极简 agent", avatar: "⚪", description: "最小可运行 agent 骨架" },
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("模板存在时返回 ok:true 与其展示元数据", () => {
    const result = resolveTemplate(root, "minimal-agent");

    expect(result).toEqual({
      ok: true,
      template: {
        name: "minimal-agent",
        title: "极简 agent",
        avatar: "⚪",
        description: "最小可运行 agent 骨架",
      },
    });
  });

  it("模板不存在时返回结构化错误(不抛异常),附可用模板名清单", () => {
    let result: ReturnType<typeof resolveTemplate> | undefined;
    expect(() => {
      result = resolveTemplate(root, "does-not-exist");
    }).not.toThrow();

    expect(result).toEqual({
      ok: false,
      code: "TEMPLATE_NOT_FOUND",
      name: "does-not-exist",
      available: ["minimal-agent"],
    });
  });
});

describe("TemplateCatalog: resolveExamplesRoot", () => {
  it("按优先级选出第一个真实存在的候选目录(分发后布局优先于开发期布局)", () => {
    const distRoot = mkdtempSync(join(tmpdir(), "pi-web-dist-"));
    const repoRoot = mkdtempSync(join(tmpdir(), "pi-web-repo-"));
    try {
      const distExamples = join(distRoot, "examples");
      const repoExamples = join(repoRoot, "examples");
      mkdirSync(distExamples, { recursive: true });
      mkdirSync(repoExamples, { recursive: true });

      const resolved = resolveExamplesRoot([distExamples, repoExamples]);

      expect(resolved).toBe(distExamples);
    } finally {
      rmSync(distRoot, { recursive: true, force: true });
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("分发后候选缺失时回落开发期 repo 根 examples/ 布局", () => {
    const distRoot = mkdtempSync(join(tmpdir(), "pi-web-dist-missing-"));
    const repoRoot = mkdtempSync(join(tmpdir(), "pi-web-repo-fallback-"));
    try {
      const distExamples = join(distRoot, "examples"); // 不创建:模拟分发后目录不存在
      const repoExamples = join(repoRoot, "examples");
      mkdirSync(repoExamples, { recursive: true });

      const resolved = resolveExamplesRoot([distExamples, repoExamples]);

      expect(resolved).toBe(repoExamples);
    } finally {
      rmSync(distRoot, { recursive: true, force: true });
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("全部候选都不存在时返回 undefined", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-web-none-"));
    try {
      const resolved = resolveExamplesRoot([join(root, "a"), join(root, "b")]);
      expect(resolved).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("TemplateCatalog: 观察态 —— 真实仓库 examples/ 目录", () => {
  it("--list 应枚举的模板条数与 examples 中带 pi-web 字段的目录数一致", () => {
    // 独立计算期望值:不写死数字,直接扫描真实 examples/ 目录并解析各自的
    // package.json,统计存在 `pi-web` 字段的目录数 —— 与被测函数各自独立实现同一遍
    // 逻辑,以此互相印证而非重复断言实现细节。
    const repoExamplesRoot = join(__dirname, "..", "..", "examples");
    const expected = readdirSync(repoExamplesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => {
        try {
          const raw = require("node:fs").readFileSync(
            join(repoExamplesRoot, entry.name, "package.json"),
            "utf8",
          );
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          return parsed["pi-web"] !== undefined && parsed["pi-web"] !== null;
        } catch {
          return false;
        }
      }).length;

    const templates = listTemplates(repoExamplesRoot);

    expect(templates.length).toBe(expected);
    expect(templates.length).toBeGreaterThan(0);
  });
});
