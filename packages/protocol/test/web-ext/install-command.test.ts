/**
 * `InstallResultData` 契约(spec install-host-command,任务 1.1,Req 5.1, 5.4)。
 *
 * 只测 shape:schema 层不强制 `ok:false` ⇒ `error` 必填的联动 —— 该不变量由组装方
 * (`lib/app/install-host-command.ts`)保证,不在 zod schema 内编码。
 */
import { describe, expect, it } from "vitest";
import { InstallResultDataSchema, InstallStepSchema } from "../../src/web-ext/install-command.js";

describe("web-ext/install-command schema", () => {
  it("InstallStep:stage/status 必填, detail 可选", () => {
    expect(InstallStepSchema.safeParse({ stage: "resolve", status: "complete" }).success).toBe(true);
    expect(
      InstallStepSchema.safeParse({ stage: "resolve", status: "failed", detail: "boom" }).success,
    ).toBe(true);
    expect(InstallStepSchema.safeParse({ stage: "resolve", status: "bogus" }).success).toBe(false);
  });

  it("InstallResultData:安装成功样例(agent kind,steps 与 guidance)", () => {
    const parsed = InstallResultDataSchema.safeParse({
      action: "install",
      ok: true,
      kind: "agent",
      id: "local:my-agent",
      location: "/home/user/.pi-web/agents/my-agent",
      guidance: "在选择器中切换到该来源以使用",
      steps: [
        { stage: "resolve", status: "complete" },
        { stage: "write", status: "complete" },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.steps).toHaveLength(2);
    }
  });

  it("InstallResultData:list 子动作带 items 表体", () => {
    const parsed = InstallResultDataSchema.safeParse({
      action: "list",
      ok: true,
      items: [
        { id: "npm:foo", version: "1.0.0", scope: "user", kind: "plugin" },
        { id: "local:bar" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("InstallResultData:steps 缺省空数组", () => {
    const parsed = InstallResultDataSchema.safeParse({ action: "update", ok: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.steps).toEqual([]);
    }
  });

  it("InstallResultData:ok:false 未带 error 时 shape 仍可解析(联动不变量由组装方保证)", () => {
    const parsed = InstallResultDataSchema.safeParse({ action: "install", ok: false });
    expect(parsed.success).toBe(true);
  });

  it("InstallResultData:ok:false 带 error{code,message}", () => {
    const parsed = InstallResultDataSchema.safeParse({
      action: "install",
      ok: false,
      error: { code: "KIND_COMPONENT_UNSUPPORTED", message: "请使用 pi-web add 安装组件包" },
    });
    expect(parsed.success).toBe(true);
  });

  it("拒绝未知 action", () => {
    expect(InstallResultDataSchema.safeParse({ action: "bogus", ok: true }).success).toBe(false);
  });
});
