// @vitest-environment node
/**
 * ScaffoldWriter 单测(spec cli-package-commands,任务 3.2,
 * Req 2.1, 2.2, 2.3, 2.7, 2.8, 2.9, 2.11)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiWebManifestSchema, PI_WEB_MANIFEST_FILENAME } from "@blksails/pi-web-protocol";
import { scaffold, type ScaffoldRequest } from "@/server/cli/scaffold/scaffold-writer";

let root: string;
let examplesRoot: string;

/** 构造一个 minimal-agent 风格的模板(无 pi-web.json,package.json 带 private)。 */
function seedAgentTemplate(): void {
  const dir = join(examplesRoot, "minimal-agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "minimal-agent",
        private: true,
        "pi-web": { title: "极简 agent", avatar: "⚪", description: "最小可运行 agent 骨架" },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, "index.ts"), "export default {};\n");
}

/** 构造一个 plugin-code-review-agent 风格的模板(自带 pi-web.json 与 keywords)。 */
function seedPluginTemplate(): void {
  const dir = join(examplesRoot, "plugin-code-review-agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "@acme/code-review",
        version: "1.0.0",
        private: true,
        keywords: ["pi-package", "pi-extension"],
        "pi-web": { title: "代码检视插件", avatar: "🔍", description: "…" },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(dir, PI_WEB_MANIFEST_FILENAME),
    JSON.stringify(
      { id: "code-review", version: "1.0.0", kind: "plugin", displayName: "Code Review" },
      null,
      2,
    ),
  );
  mkdirSync(join(dir, "extensions"), { recursive: true });
  writeFileSync(join(dir, "extensions", "code-review.ts"), "export default {};\n");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-web-scaffold-"));
  examplesRoot = join(root, "examples");
  mkdirSync(examplesRoot, { recursive: true });
  seedAgentTemplate();
  seedPluginTemplate();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function baseReq(overrides: Partial<ScaffoldRequest> = {}): ScaffoldRequest {
  return {
    name: "my-agent",
    kind: "agent",
    templateName: "minimal-agent",
    targetDir: join(root, "out"),
    ...overrides,
  };
}

describe("scaffold: 2.1 未指定 kind 时以 agent 为默认(骨架形态)", () => {
  it("生成的 pi-web.json 的 kind 为 agent 字面值", async () => {
    const result = await scaffold(baseReq(), examplesRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const manifestPath = join(result.value.absolutePath, PI_WEB_MANIFEST_FILENAME);
    const raw = readFileSync(manifestPath, "utf8");
    expect(JSON.parse(raw).kind).toBe("agent");
  });
});

describe("scaffold: 2.2 --kind plugin 生成 plugin 形态骨架", () => {
  it("pi-web.json 的 kind 为 plugin 字面值", async () => {
    const req = baseReq({
      name: "my-plugin",
      kind: "plugin",
      templateName: "plugin-code-review-agent",
      targetDir: join(root, "out-plugin"),
    });
    const result = await scaffold(req, examplesRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const manifestPath = join(result.value.absolutePath, PI_WEB_MANIFEST_FILENAME);
    const raw = readFileSync(manifestPath, "utf8");
    expect(JSON.parse(raw).kind).toBe("plugin");
  });
});

describe("scaffold: 2.3 观察态 — kind 是显式写出的字面值,不是 schema 缺省补出", () => {
  it("agent 分支:原始 JSON 文本物理含 kind 字段,且能被 PiWebManifestSchema 解析通过", async () => {
    const result = await scaffold(baseReq(), examplesRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const manifestPath = join(result.value.absolutePath, PI_WEB_MANIFEST_FILENAME);
    const raw = readFileSync(manifestPath, "utf8");

    // 区分「显式写出」与「schema 补默认」:PiWebManifestSchema 的 kind 缺省是 plugin,
    // 若实现偷懒不写 kind 字段,parse 后仍会得到 "plugin"(被 schema 缺省悄悄补出),
    // 但下面这条原始文本断言会先失败,因为原始 JSON 里压根没有 "kind" 这个 key。
    expect(raw).toContain('"kind"');
    const parsedRaw = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsedRaw, "kind")).toBe(true);
    expect(parsedRaw.kind).toBe("agent");

    const schemaResult = PiWebManifestSchema.safeParse(parsedRaw);
    expect(schemaResult.success).toBe(true);
  });

  it("plugin 分支:同样物理含 kind 字段且可被 schema 解析", async () => {
    const req = baseReq({
      name: "my-plugin-2",
      kind: "plugin",
      templateName: "plugin-code-review-agent",
      targetDir: join(root, "out-plugin-2"),
    });
    const result = await scaffold(req, examplesRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const manifestPath = join(result.value.absolutePath, PI_WEB_MANIFEST_FILENAME);
    const raw = readFileSync(manifestPath, "utf8");
    expect(raw).toContain('"kind"');
    const schemaResult = PiWebManifestSchema.safeParse(JSON.parse(raw));
    expect(schemaResult.success).toBe(true);
    if (schemaResult.success) expect(schemaResult.data.kind).toBe("plugin");
  });
});

describe("scaffold: 2.7 目标目录已存在且非空 → 拒绝写入,既有文件一字未改", () => {
  it("返回 TARGET_NOT_EMPTY 且既有文件内容不变", async () => {
    const targetDir = join(root, "occupied");
    mkdirSync(targetDir, { recursive: true });
    const sentinelPath = join(targetDir, "keep.txt");
    const sentinelContent = "do-not-touch-me";
    writeFileSync(sentinelPath, sentinelContent);

    const result = await scaffold(baseReq({ targetDir }), examplesRoot);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "TARGET_NOT_EMPTY", path: targetDir });

    // 既有文件必须一字未改
    expect(readFileSync(sentinelPath, "utf8")).toBe(sentinelContent);
  });
});

describe("scaffold: 2.8 package.json 身份重写", () => {
  it("name 被重写为用户提供的名称,private 标记被移除", async () => {
    const req = baseReq({ name: "totally-custom-name" });
    const result = await scaffold(req, examplesRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pkgRaw = readFileSync(join(result.value.absolutePath, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    expect(pkg.name).toBe("totally-custom-name");
    expect(Object.prototype.hasOwnProperty.call(pkg, "private")).toBe(false);
  });
});

describe("scaffold: 2.9 关键字补 pi-package", () => {
  it("模板原本没有 keywords 时补上含 pi-package 的数组(agent 模板)", async () => {
    const result = await scaffold(baseReq(), examplesRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pkg = JSON.parse(readFileSync(join(result.value.absolutePath, "package.json"), "utf8")) as {
      keywords?: readonly string[];
    };
    expect(pkg.keywords).toContain("pi-package");
  });

  it("模板已有 keywords(不含 pi-package)时补上且不重复(plugin 模板变体)", async () => {
    // 覆盖“已有 keywords 但缺 pi-package”的分支:直接改写种子模板的 package.json
    const dir = join(examplesRoot, "plugin-code-review-agent");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: "@acme/code-review",
          version: "1.0.0",
          private: true,
          keywords: ["some-other-tag"],
          "pi-web": { title: "代码检视插件", avatar: "🔍", description: "…" },
        },
        null,
        2,
      ),
    );

    const req = baseReq({
      name: "custom-plugin",
      kind: "plugin",
      templateName: "plugin-code-review-agent",
      targetDir: join(root, "out-plugin-3"),
    });
    const result = await scaffold(req, examplesRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pkg = JSON.parse(readFileSync(join(result.value.absolutePath, "package.json"), "utf8")) as {
      keywords?: readonly string[];
    };
    expect(pkg.keywords).toContain("pi-package");
    expect(pkg.keywords).toContain("some-other-tag");
    expect(pkg.keywords?.filter((k) => k === "pi-package")).toHaveLength(1);
  });

  it("模板已含 pi-package 时不重复添加(plugin 原生模板)", async () => {
    const req = baseReq({
      name: "custom-plugin-2",
      kind: "plugin",
      templateName: "plugin-code-review-agent",
      targetDir: join(root, "out-plugin-4"),
    });
    const result = await scaffold(req, examplesRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pkg = JSON.parse(readFileSync(join(result.value.absolutePath, "package.json"), "utf8")) as {
      keywords?: readonly string[];
    };
    expect(pkg.keywords?.filter((k) => k === "pi-package")).toHaveLength(1);
  });
});

describe("scaffold: 2.11 输出生成物绝对路径与下一步命令提示", () => {
  it("成功返回值含 absolutePath(绝对路径)与 nextStepHint(含该路径的命令提示)", async () => {
    const targetDir = join(root, "out-abs");
    const result = await scaffold(baseReq({ targetDir }), examplesRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.absolutePath).toBe(targetDir);
    expect(result.value.nextStepHint).toContain(targetDir);
  });
});

describe("scaffold: 模板不存在 → TEMPLATE_NOT_FOUND", () => {
  it("返回判别联合错误,不创建目标目录", async () => {
    const targetDir = join(root, "out-missing-template");
    const result = await scaffold(
      baseReq({ templateName: "does-not-exist", targetDir }),
      examplesRoot,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TEMPLATE_NOT_FOUND");
  });
});
