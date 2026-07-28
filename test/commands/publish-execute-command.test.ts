// @vitest-environment node
/**
 * 命令层接线:裸 `publish` = 真实发布(spec publish-execution,Req 7.5 / 7.6)。
 *
 * ★ 本文件里最重要的一条是**对照组**:`--dry-run` 的输出必须与本 spec 引入前逐字段相同。
 *   真实发布这条路径是新加的,它若不小心影响了预览,受害的是一条**用户已经在用**的路径。
 *
 * 夹具选型沿用 `publish-preview.test.ts` 的裁断(勿改):`examples/plugin-code-review-agent`
 * 无构建依赖、在 fresh worktree 可靠。
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { createPackageHostCommand, type PackageHostCommandDeps } from "@/lib/app/package-host-command";
import { PublishPreviewDataSchema, PUBLISH_PREVIEW_DATA_PART } from "@blksails/pi-web-protocol";
import type { Installer } from "@/server/cli/install/installer";
import type { PluginInstaller } from "@/server/cli/install/plugin-installer";

const REPO = process.cwd();
const CODE_REVIEW = "./examples/plugin-code-review-agent";
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const session = { id: "s1", cwd: REPO } as never;

/** `executePublish` 的入参形状 —— 让 mock 的调用记录带上类型,断言不必再 as 一遍。 */
type ExecInput = { readonly packageDir: string; readonly expectedKind: string; readonly channel?: string };

const PUBLISHED = {
  data: {
    ok: true as const,
    package: { id: "blksails/x", version: "1.0.0", kind: "plugin" as const, displayName: "X" },
    files: [],
    warnings: [],
    disclaimers: { unsigned: false, grantNotChecked: false },
    published: {
      sourceId: "blksails/x",
      version: "1.0.0",
      bundle: "bundles/a.tgz",
      channel: "stable",
      channelMoved: true,
      publisherId: "pub-1",
      org: "blksails",
    },
  },
  message: "已发布 blksails/x@1.0.0(通道 stable)。该版本不可更改,后续改动请提新版本号。",
};

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

describe("裸 publish → 真实发布(Req 2.1)", () => {
  it("走 executePublish,并把结果原样呈为 publish 卡片", async () => {
    const executePublish = vi.fn(async (_input: ExecInput) => PUBLISHED);
    const cmd = createPackageHostCommand("plugin", baseDeps({ executePublish }));
    const r = await cmd.execute({ session, argv: `publish ${CODE_REVIEW}` });

    expect(executePublish).toHaveBeenCalledTimes(1);
    expect(r.dataPart).toBe(PUBLISH_PREVIEW_DATA_PART);
    const parsed = PublishPreviewDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.published?.sourceId).toBe("blksails/x");
  });

  it("★ 相对路径以会话 cwd 为基准解析成绝对路径(与补全端点同基准)", async () => {
    const executePublish = vi.fn(async (_input: ExecInput) => PUBLISHED);
    await createPackageHostCommand("plugin", baseDeps({ executePublish })).execute({
      session,
      argv: `publish ${CODE_REVIEW}`,
    });
    const arg = executePublish.mock.calls[0]![0];
    expect(arg.packageDir.startsWith("/")).toBe(true);
    expect(arg.packageDir).toContain("plugin-code-review-agent");
    // 类别由命令名固化,不可被 argv 改写。
    expect(arg.expectedKind).toBe("plugin");
  });

  it("`--channel beta` 被透传", async () => {
    const executePublish = vi.fn(async (_input: ExecInput) => PUBLISHED);
    await createPackageHostCommand("plugin", baseDeps({ executePublish })).execute({
      session,
      argv: `publish ${CODE_REVIEW} --channel beta`,
    });
    expect(executePublish.mock.calls[0]![0].channel).toBe("beta");
  });

  it("未给 --channel → 不传该字段(由下游落缺省,而不是在此硬编码一份)", async () => {
    const executePublish = vi.fn(async (_input: ExecInput) => PUBLISHED);
    await createPackageHostCommand("plugin", baseDeps({ executePublish })).execute({
      session,
      argv: `publish ${CODE_REVIEW}`,
    });
    expect(executePublish.mock.calls[0]![0].channel).toBeUndefined();
  });

  it("★ `/agent publish` 恒按 agent 处理 —— 命令名即意图", async () => {
    const executePublish = vi.fn(async (_input: ExecInput) => PUBLISHED);
    await createPackageHostCommand("agent", baseDeps({ executePublish })).execute({
      session,
      argv: `publish ${CODE_REVIEW}`,
    });
    expect(executePublish.mock.calls[0]![0].expectedKind).toBe("agent");
  });
});

describe("未接入发布身份 → 语义与本 spec 引入前一致(Req 5.3)", () => {
  it("未注入 executePublish → 仍是 PUBLISH_NOT_AVAILABLE,文案一字不改", async () => {
    const r = await createPackageHostCommand("agent", baseDeps()).execute({
      session,
      argv: `publish ${CODE_REVIEW}`,
    });
    const parsed = PublishPreviewDataSchema.safeParse(r.data);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.error?.code).toBe("PUBLISH_NOT_AVAILABLE");
    expect(parsed.data.error?.hint).toContain("--dry-run");
    expect(parsed.data.disclaimers).toEqual({ unsigned: true, grantNotChecked: true });
  });
});

describe("★ 对照组:--dry-run 不受影响(Req 7.5)", () => {
  it("注入 executePublish 后,dry-run 输出与不注入时**逐字段相同**,且不调用它", async () => {
    const argv = `publish ${CODE_REVIEW} --dry-run`;
    const baseline = await createPackageHostCommand("plugin", baseDeps()).execute({ session, argv });

    const executePublish = vi.fn(async (_input: ExecInput) => PUBLISHED);
    const withExec = await createPackageHostCommand("plugin", baseDeps({ executePublish })).execute({
      session,
      argv,
    });

    expect(executePublish).not.toHaveBeenCalled();
    expect(withExec.dataPart).toBe(baseline.dataPart);
    expect(withExec.message).toBe(baseline.message);
    expect(withExec.data).toEqual(baseline.data);
  });
});

describe("审计(Req 6.4)", () => {
  it("成功 → 记 succeeded 与 sourceId@version", async () => {
    const auditPublish = vi.fn();
    await createPackageHostCommand(
      "plugin",
      baseDeps({ executePublish: async () => PUBLISHED, auditPublish }),
    ).execute({ session, argv: `publish ${CODE_REVIEW}` });

    expect(auditPublish).toHaveBeenCalledWith(
      expect.objectContaining({ action: "publish", outcome: "succeeded", source: "blksails/x@1.0.0" }),
    );
  });

  it("失败 → 记 failed 与错误码,**不记 message**(message 可能含用户路径)", async () => {
    const auditPublish = vi.fn();
    const failed = {
      data: {
        ok: false as const,
        files: [],
        warnings: [],
        disclaimers: { unsigned: false, grantNotChecked: false },
        error: { code: "PUBLISH_REGISTER_FAILED", message: "登记版本失败(/Users/someone/secret-path)。" },
      },
      message: "失败",
    };
    await createPackageHostCommand(
      "plugin",
      baseDeps({ executePublish: async () => failed, auditPublish }),
    ).execute({ session, argv: `publish ${CODE_REVIEW}` });

    const event = auditPublish.mock.calls[0]![0] as Record<string, unknown>;
    expect(event).toMatchObject({ action: "publish", outcome: "failed", reason: "PUBLISH_REGISTER_FAILED" });
    expect(JSON.stringify(event)).not.toContain("secret-path");
  });
});

describe("用法文本", () => {
  it("两条命令的 usage 都提到发布与 --channel,且提示不可更改", async () => {
    for (const kind of ["agent", "plugin"] as const) {
      const r = await createPackageHostCommand(kind, baseDeps()).execute({ session, argv: "" });
      expect(r.message).toContain("--channel");
      expect(r.message).toContain("不可更改");
    }
  });
});
