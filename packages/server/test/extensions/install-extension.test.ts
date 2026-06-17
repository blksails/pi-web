/**
 * 单元:POST /extensions 治理编排(Req 2.x/7.x/8.x/10.1)。
 */
import { describe, expect, it } from "vitest";
import { makeInstallExtensionHandler } from "../../src/extensions/routes/install-extension.js";
import { createDefaultAdminPolicy } from "../../src/extensions/security/admin-policy.js";
import type { AllowlistConfig } from "../../src/extensions/ext.types.js";
import {
  adminAuth,
  anonAuth,
  auditCollector,
  FakePiCli,
  readJson,
  userAuth,
} from "./helpers.js";
import type { AuthContext, RequestContext } from "../../src/http/index.js";

const allowlist: AllowlistConfig = {
  npmScopes: ["@pi-web"],
  gitHosts: ["github.com"],
  allowLocal: false,
};

const adminPolicy = createDefaultAdminPolicy({ adminUserIds: ["root"] });

function ctx(body: unknown, auth: AuthContext): RequestContext {
  return {
    req: new Request("http://x/extensions", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    auth,
    url: new URL("http://x/extensions"),
  };
}

describe("POST /extensions", () => {
  it("installs an allowlisted pinned source and audits success", async () => {
    const cli = new FakePiCli();
    const audit = auditCollector();
    const res = await makeInstallExtensionHandler({
      piCli: cli,
      adminPolicy,
      onAudit: audit.onAudit,
      allowlist,
    })(ctx({ source: "npm:@pi-web/sample@1.2.3" }, adminAuth));

    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body["ok"]).toBe(true);
    // 装配的命令含 --ignore-scripts。
    expect(cli.runCalls).toHaveLength(1);
    expect(cli.runCalls[0]!.args).toContain("--ignore-scripts");
    expect(cli.runCalls[0]!.args[0]).toBe("install");
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({ outcome: "success", actor: "root" });
  });

  it("rejects a non-admin with 403 and audits rejected (no command run)", async () => {
    const cli = new FakePiCli();
    const audit = auditCollector();
    const res = await makeInstallExtensionHandler({
      piCli: cli,
      adminPolicy,
      onAudit: audit.onAudit,
      allowlist,
    })(ctx({ source: "npm:@pi-web/sample@1.2.3" }, userAuth));

    expect(res.status).toBe(403);
    expect(cli.runCalls).toHaveLength(0);
    expect(audit.records[0]).toMatchObject({ outcome: "rejected" });
  });

  it("rejects an anonymous caller with 401", async () => {
    const cli = new FakePiCli();
    const audit = auditCollector();
    const res = await makeInstallExtensionHandler({
      piCli: cli,
      adminPolicy,
      onAudit: audit.onAudit,
      allowlist,
    })(ctx({ source: "npm:@pi-web/sample@1.2.3" }, anonAuth));
    expect(res.status).toBe(401);
    expect(cli.runCalls).toHaveLength(0);
  });

  it("returns 400 when source is missing", async () => {
    const cli = new FakePiCli();
    const audit = auditCollector();
    const res = await makeInstallExtensionHandler({
      piCli: cli,
      adminPolicy,
      onAudit: audit.onAudit,
      allowlist,
    })(ctx({}, adminAuth));
    expect(res.status).toBe(400);
    expect(cli.runCalls).toHaveLength(0);
    expect(audit.records[0]).toMatchObject({ outcome: "rejected" });
  });

  it("rejects a non-allowlisted source with 422 (no command run)", async () => {
    const cli = new FakePiCli();
    const audit = auditCollector();
    const res = await makeInstallExtensionHandler({
      piCli: cli,
      adminPolicy,
      onAudit: audit.onAudit,
      allowlist,
    })(ctx({ source: "https://evil.com/x/y@v1.0.0" }, adminAuth));
    expect(res.status).toBe(422);
    expect(cli.runCalls).toHaveLength(0);
    expect(audit.records[0]).toMatchObject({ outcome: "rejected" });
  });

  it("rejects an unpinned npm source with 422", async () => {
    const cli = new FakePiCli();
    const audit = auditCollector();
    const res = await makeInstallExtensionHandler({
      piCli: cli,
      adminPolicy,
      onAudit: audit.onAudit,
      allowlist,
    })(ctx({ source: "npm:@pi-web/sample" }, adminAuth));
    expect(res.status).toBe(422);
    expect(cli.runCalls).toHaveLength(0);
  });

  it("returns 500 and audits failure when pi install exits non-zero", async () => {
    const cli = new FakePiCli();
    cli.setRunResult(() => ({
      ok: false,
      stdout: "",
      exitCode: 1,
      errorSummary: "pi install exited with code 1",
    }));
    const audit = auditCollector();
    const res = await makeInstallExtensionHandler({
      piCli: cli,
      adminPolicy,
      onAudit: audit.onAudit,
      allowlist,
    })(ctx({ source: "npm:@pi-web/sample@1.2.3" }, adminAuth));
    expect(res.status).toBe(500);
    expect(audit.records[0]).toMatchObject({ outcome: "failure" });
    const body = await readJson(res);
    expect(JSON.stringify(body)).not.toMatch(/secret|token|API_KEY/i);
  });

  it("forwards the configured timeout to the cli", async () => {
    const cli = new FakePiCli();
    const audit = auditCollector();
    await makeInstallExtensionHandler({
      piCli: cli,
      adminPolicy,
      onAudit: audit.onAudit,
      allowlist,
      timeoutMs: 5000,
    })(ctx({ source: "npm:@pi-web/sample@1.2.3" }, adminAuth));
    expect(cli.runCalls[0]!.opts?.timeoutMs).toBe(5000);
  });
});
