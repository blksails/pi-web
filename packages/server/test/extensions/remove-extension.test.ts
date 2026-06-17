/**
 * 单元:DELETE /extensions/:extId(Req 3.x/7.x/8.1/10.1)。
 */
import { describe, expect, it } from "vitest";
import { makeRemoveExtensionHandler } from "../../src/extensions/routes/remove-extension.js";
import { createDefaultAdminPolicy } from "../../src/extensions/security/admin-policy.js";
import {
  adminAuth,
  auditCollector,
  FakePiCli,
  readJson,
  userAuth,
} from "./helpers.js";
import type { AuthContext, RequestContext } from "../../src/http/index.js";

const adminPolicy = createDefaultAdminPolicy({ adminUserIds: ["root"] });

function ctx(extId: string, auth: AuthContext): RequestContext {
  const url = new URL(`http://x/extensions/${encodeURIComponent(extId)}`);
  return {
    req: new Request(url, { method: "DELETE" }),
    auth,
    url,
  };
}

const installed = [
  { id: "@pi-web/sample", kind: "npm" as const, scope: "global" as const },
];

describe("DELETE /extensions/:extId", () => {
  it("removes an installed extension and audits success", async () => {
    const cli = new FakePiCli({ installed: [...installed] });
    const audit = auditCollector();
    const res = await makeRemoveExtensionHandler({
      piCli: cli,
      adminPolicy,
      onAudit: audit.onAudit,
    })(ctx("@pi-web/sample", adminAuth));

    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body["ok"]).toBe(true);
    expect(cli.runCalls.some((c) => c.args[0] === "remove")).toBe(true);
    expect(audit.records[0]).toMatchObject({ action: "remove", outcome: "success" });
  });

  it("returns 404 when the extension is not installed (no command run)", async () => {
    const cli = new FakePiCli({ installed: [...installed] });
    const audit = auditCollector();
    const res = await makeRemoveExtensionHandler({
      piCli: cli,
      adminPolicy,
      onAudit: audit.onAudit,
    })(ctx("@pi-web/ghost", adminAuth));
    expect(res.status).toBe(404);
    expect(cli.runCalls.some((c) => c.args[0] === "remove")).toBe(false);
  });

  it("rejects a non-admin with 403", async () => {
    const cli = new FakePiCli({ installed: [...installed] });
    const audit = auditCollector();
    const res = await makeRemoveExtensionHandler({
      piCli: cli,
      adminPolicy,
      onAudit: audit.onAudit,
    })(ctx("@pi-web/sample", userAuth));
    expect(res.status).toBe(403);
    expect(audit.records[0]).toMatchObject({ outcome: "rejected" });
  });

  it("returns 500 and audits failure when pi remove exits non-zero", async () => {
    const cli = new FakePiCli({ installed: [...installed] });
    cli.setRunResult((args) =>
      args[0] === "remove"
        ? { ok: false, stdout: "", exitCode: 1, errorSummary: "remove failed" }
        : { ok: true, stdout: "", exitCode: 0 },
    );
    const audit = auditCollector();
    const res = await makeRemoveExtensionHandler({
      piCli: cli,
      adminPolicy,
      onAudit: audit.onAudit,
    })(ctx("@pi-web/sample", adminAuth));
    expect(res.status).toBe(500);
    expect(audit.records[0]).toMatchObject({ outcome: "failure" });
  });
});
