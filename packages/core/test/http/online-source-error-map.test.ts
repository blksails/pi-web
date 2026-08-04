/**
 * 线上源失败的 HTTP 呈现(desktop-online-source-runnable 任务 4.2)。
 *
 * ★ 立此任务的直接原因:真机烟雾证实 `mapEngineError` 对未映射错误一律兜底
 *   `500 INTERNAL`,响应体只有「Internal server error.」。用户未登录却选中线上源时,
 *   看到「服务器内部错误」—— 既不可诊断(Req 4.1),也没告诉他该去登录(Req 5.1)。
 */
import { describe, it, expect } from "vitest";
import { mapEngineError } from "../../src/http/error-map.js";
import {
  OnlineSourceInstallError,
  onlineSourceFailureStatus,
  type OnlineSourceFailureCode,
} from "../../src/agent-source/online-source-errors.js";

const SOURCE = "acme/canvas@stable";

async function mapped(code: OnlineSourceFailureCode) {
  const res = mapEngineError(new OnlineSourceInstallError(SOURCE, code));
  return { status: res.status, body: (await res.json()) as { error: { code: string; message: string } } };
}

describe("mapEngineError — 线上源安装失败", () => {
  it("未认证 → 401 且响应体含失败码(Req 5.1:需登录对用户可见)", async () => {
    const { status, body } = await mapped("NOT_AUTHENTICATED");
    expect(status).toBe(401);
    expect(body.error.code).toBe("NOT_AUTHENTICATED");
    // 关键:不再是泛化的 INTERNAL / Internal server error.
    expect(body.error.code).not.toBe("INTERNAL");
    expect(body.error.message).not.toContain("Internal server error");
  });

  it("未找到 → 404", async () => {
    expect((await mapped("NOT_FOUND")).status).toBe(404);
  });

  it("形态不支持 → 400", async () => {
    expect((await mapped("UNSUPPORTED_DISTRIBUTION")).status).toBe(400);
  });

  it("目标被占 → 409", async () => {
    expect((await mapped("TARGET_OCCUPIED")).status).toBe(409);
  });

  it("上游/环境类失败 → 502(不是调用方的错)", async () => {
    for (const code of [
      "GRANT_UNAVAILABLE",
      "DOWNLOAD_FAILED",
      "EXTRACT_FAILED",
      "INTEGRITY_MISMATCH",
      "INSTALL_BACKEND_UNAVAILABLE",
    ] as const) {
      expect((await mapped(code)).status).toBe(502);
    }
  });

  it("每个失败码都得到可区分的响应码字段(Req 4.1)", async () => {
    const codes: readonly OnlineSourceFailureCode[] = [
      "NOT_AUTHENTICATED",
      "GRANT_UNAVAILABLE",
      "NOT_FOUND",
      "UNSUPPORTED_DISTRIBUTION",
      "DOWNLOAD_FAILED",
      "EXTRACT_FAILED",
      "INTEGRITY_MISMATCH",
      "TARGET_OCCUPIED",
      "INSTALL_BACKEND_UNAVAILABLE",
    ];
    for (const code of codes) {
      const { body } = await mapped(code);
      expect(body.error.code).toBe(code);
    }
  });

  it("错误消息含源标识便于诊断,但不含凭据", async () => {
    const { body } = await mapped("NOT_AUTHENTICATED");
    expect(body.error.message).toContain(SOURCE);
    expect(body.error.message).not.toMatch(/token|bearer|secret/i);
  });
});

describe("onlineSourceFailureStatus — 分档穷尽", () => {
  it("所有失败码都有明确状态码(无 undefined 漏网)", () => {
    const codes: readonly OnlineSourceFailureCode[] = [
      "NOT_AUTHENTICATED",
      "GRANT_UNAVAILABLE",
      "NOT_FOUND",
      "UNSUPPORTED_DISTRIBUTION",
      "DOWNLOAD_FAILED",
      "EXTRACT_FAILED",
      "INTEGRITY_MISMATCH",
      "TARGET_OCCUPIED",
      "INSTALL_BACKEND_UNAVAILABLE",
    ];
    for (const c of codes) {
      const s = onlineSourceFailureStatus(c);
      expect(typeof s).toBe("number");
      expect(s).toBeGreaterThanOrEqual(400);
    }
  });
});
