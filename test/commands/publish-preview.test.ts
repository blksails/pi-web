// @vitest-environment node
/**
 * publish 预览(spec publish-host-command,任务 2.3)。
 *
 * ★ 本文件**刻意不注入编译替身**(Req 8.2):成功与失败两条主路径都跑**真实 `compile()`**
 *   与**真实包目录**。理由是这条通道的全部价值就在"真的能编译出来吗"——用替身证明
 *   等于什么都没证明。
 *
 * ★ 夹具选型有坑,勿改(设计阶段实测):
 *   - `examples/plugin-code-review-agent` → kind=plugin / 5 文件 / 0 告警,**无构建依赖**,
 *     可靠;
 *   - `examples/aigc-canvas-agent` 与 `module-settings-agent` 在 fresh worktree **恒失败**于
 *     `WEBEXT_SOURCE_WITHOUT_DIST`(`.pi/web/dist` 是 gitignored 构建产物),
 *     **只能当失败用例,不能当成功夹具**。
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { previewPublish, describeCompileError } from "@/lib/app/publish-preview";
import { createPackageHostCommand, type PackageHostCommandDeps } from "@/lib/app/package-host-command";
import { PublishPreviewDataSchema, PUBLISH_PREVIEW_DATA_PART } from "@blksails/pi-web-protocol";
import type { Installer } from "@/server/cli/install/installer";
import type { PluginInstaller } from "@/server/cli/install/plugin-installer";

const REPO = process.cwd();
const CODE_REVIEW = resolve(REPO, "examples/plugin-code-review-agent");
const WATERMARK = resolve(REPO, "examples/canvas-component-watermark");
const WEBEXT_NO_DIST = resolve(REPO, "examples/aigc-canvas-agent");

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), "pi-pub-"));
  dirs.push(d);
  return d;
};

/** 目录内容快照(路径 + 大小 + mtime),用于"零外部写"断言。 */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        walk(p, r);
      } else {
        const st = statSync(p);
        out.push(`${r}:${st.size}:${st.mtimeMs}`);
      }
    }
  };
  walk(dir, "");
  return out.sort();
}

// ---------------------------------------------------------------------------
// previewPublish · 真实编译
// ---------------------------------------------------------------------------

describe("previewPublish · 成功路径(真实包 + 真实 compile)", () => {
  it("plugin 包经 plugin 预览 → ok,含包身份/文件清单/两个 disclaimer", async () => {
    const r = await previewPublish(CODE_REVIEW, "plugin");

    // 先过 schema —— 证明产出的确实是契约里那个形状。
    const parsed = PublishPreviewDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const d = parsed.data;

    expect(d.ok).toBe(true);
    expect(d.package?.kind).toBe("plugin");
    expect(d.package?.id).toBe("code-review");
    expect(d.files.length).toBeGreaterThan(0);
    // 每个文件都得带完整性摘要 —— 只列路径不算预览。
    expect(d.files.every((f) => f.integrity.startsWith("sha384-"))).toBe(true);
    // ★ Req 2:预览必须自曝其与真实发布的差异,且是**结构化布尔位**而非文案。
    expect(d.disclaimers).toEqual({ unsigned: true, grantNotChecked: true });
    expect(d.error).toBeUndefined();
    // 措辞不得让人以为已发布(Req 2.3)。
    expect(r.message).not.toMatch(/已发布|已提交/);
  });

  it("预览**不修改包目录**,也不发起任何网络请求(Req 8.4)", async () => {
    const before = snapshot(CODE_REVIEW);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await previewPublish(CODE_REVIEW, "plugin");

    expect(snapshot(CODE_REVIEW)).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("previewPublish · kind 门(清单权威)", () => {
  it("plugin 包经 agent 预览 → 拒绝并指向 /plugin publish", async () => {
    const r = await previewPublish(CODE_REVIEW, "agent");
    expect(r.data.ok).toBe(false);
    expect(r.data.error?.code).toBe("PUBLISH_KIND_MISMATCH");
    expect(r.data.error?.hint).toContain("/plugin publish");
  });

  it("component 包两条命令都拒绝,并指向 pi-web add", async () => {
    for (const k of ["agent", "plugin"] as const) {
      const r = await previewPublish(WATERMARK, k);
      expect(r.data.ok).toBe(false);
      expect(r.data.error?.code).toBe("PUBLISH_KIND_MISMATCH");
      expect(r.data.error?.hint).toContain("pi-web add");
    }
  });
});

describe("previewPublish · 编译失败逐类可区分(Req 5.1)", () => {
  it("目录无发布清单 → MANIFEST_MISSING,hint 指出该建什么", async () => {
    const r = await previewPublish(scratch(), "agent");
    expect(r.data.ok).toBe(false);
    expect(r.data.error?.code).toBe("MANIFEST_MISSING");
    expect(r.data.error?.hint).toContain("pi-web.json");
  });

  it("清单缺 kind → MANIFEST_KIND_REQUIRED,hint 说明两侧缺省相反", async () => {
    const d = scratch();
    writeFileSync(join(d, "pi-web.json"), JSON.stringify({ id: "x", version: "1.0.0" }));
    const r = await previewPublish(d, "agent");
    expect(r.data.ok).toBe(false);
    expect(r.data.error?.code).toBe("MANIFEST_KIND_REQUIRED");
    // 这条 hint 不是啰嗦:历史上正因两侧缺省相反把包发成过错误类型。
    expect(r.data.error?.hint).toContain("相反");
  });

  it("有 webext 源无产物 → WEBEXT_SOURCE_WITHOUT_DIST(真实 examples 包)", async () => {
    const r = await previewPublish(WEBEXT_NO_DIST, "agent");
    // 该包在 fresh worktree 恒失败于此 —— 正好当真实失败夹具。
    expect(r.data.ok).toBe(false);
    expect(r.data.error?.code).toBe("WEBEXT_SOURCE_WITHOUT_DIST");
    expect(r.data.error?.hint).toContain("构建");
  });

  it("describeCompileError 对每个分支都给出不同的 code(不压成一条)", () => {
    const codes = [
      describeCompileError({ code: "MANIFEST_MISSING", expectedPath: "/x/pi-web.json" }),
      describeCompileError({ code: "MANIFEST_INVALID", issues: ["a"] }),
      describeCompileError({ code: "MANIFEST_KIND_REQUIRED", allowed: ["agent"] }),
      describeCompileError({ code: "DECLARED_PATH_MISSING", paths: ["a"] }),
      describeCompileError({ code: "ENTRY_NOT_FOUND", candidates: ["index.ts"] }),
      describeCompileError({ code: "ENTRY_OVERRIDE_MISSING", declared: "x.ts" }),
      describeCompileError({ code: "ENTRY_OUTSIDE_PACKAGE", resolved: "/etc/x" }),
      describeCompileError({ code: "WEBEXT_SOURCE_WITHOUT_DIST", source: "s", expectedDist: "d" }),
      describeCompileError({ code: "KEY_UNUSABLE", reason: "missing" }),
    ].map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

// ---------------------------------------------------------------------------
// host 命令层
// ---------------------------------------------------------------------------

function baseDeps(o: Partial<PackageHostCommandDeps> = {}): PackageHostCommandDeps {
  const never = (): never => {
    throw new Error("publish 路径不应触达安装端口");
  };
  return {
    installer: { install: never, uninstall: never } as unknown as Installer,
    pluginInstaller: {
      install: never,
      uninstall: never,
      listInstalled: never,
      update: never,
    } as unknown as PluginInstaller,
    adminGate: () => true,
    reloadRunner: vi.fn(async () => undefined),
    audit: vi.fn(),
    cwd: REPO,
    ...o,
  };
}
const session = { id: "s1", cwd: REPO } as never;

describe("host 命令 · publish 子动作", () => {
  it("--dry-run → 预览卡片,且经 dataPart 指定 publish 渲染器", async () => {
    const cmd = createPackageHostCommand("plugin", baseDeps());
    const r = await cmd.execute({
      session,
      argv: "publish ./examples/plugin-code-review-agent --dry-run",
    });

    expect(r.dataPart).toBe(PUBLISH_PREVIEW_DATA_PART);
    const parsed = PublishPreviewDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.ok).toBe(true);
    // 预览不改变会话可用能力 → 不重载会话。
    expect(baseDeps().reloadRunner).not.toHaveBeenCalled();
  });

  it("裸 publish(无 --dry-run)→ PUBLISH_NOT_AVAILABLE,并指引 --dry-run", async () => {
    const cmd = createPackageHostCommand("agent", baseDeps());
    const r = await cmd.execute({ session, argv: "publish ./examples/plugin-code-review-agent" });

    const parsed = PublishPreviewDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.ok).toBe(false);
    expect(parsed.data.error?.code).toBe("PUBLISH_NOT_AVAILABLE");
    expect(parsed.data.error?.hint).toContain("--dry-run");
    // Req 6.2:不得泄露令牌 / 密钥路径 / 内部端点。
    const text = JSON.stringify(parsed.data);
    expect(text).not.toMatch(/token|PI_WEB_REGISTRY|\.key|privateKey/i);
  });

  it("缺 <dir> → 用法文本,不触达任何编译", async () => {
    const cmd = createPackageHostCommand("agent", baseDeps());
    const r = await cmd.execute({ session, argv: "publish" });
    expect(r.effect).toBe("none");
    expect(r.data).toBeUndefined();
    expect(r.message).toContain("publish <dir>");
  });

  it("adminGate 拒绝 → publish 形状的拒绝卡片 + 审计(不是 install 卡片)", async () => {
    const audit = vi.fn();
    const cmd = createPackageHostCommand("agent", baseDeps({ adminGate: () => false, audit }));
    const r = await cmd.execute({ session, argv: "publish ./x --dry-run" });

    // ★ 拒绝态也必须是 publish 卡片:否则前端会拿 install 渲染器渲染一个没有 action 的对象。
    expect(r.dataPart).toBe(PUBLISH_PREVIEW_DATA_PART);
    const parsed = PublishPreviewDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.error?.code).toBe("ADMIN_DENIED");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "publish", outcome: "rejected" }),
    );
  });

  it("两条命令的用法文本都列出 publish", async () => {
    for (const k of ["agent", "plugin"] as const) {
      const r = await createPackageHostCommand(k, baseDeps()).execute({ session, argv: "" });
      expect(r.message).toContain("publish");
    }
  });

  it("argv 夹带凭据 → 输出面脱敏", async () => {
    const cmd = createPackageHostCommand("agent", baseDeps());
    const r = await cmd.execute({
      session,
      argv: "publish https://user:s3cr3t@example.com/pkg --dry-run",
    });
    expect(JSON.stringify(r.data)).not.toContain("s3cr3t");
  });
});
