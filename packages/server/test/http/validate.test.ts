/**
 * validate 单测:DTO safeParse 正反例 + 字段路径(Req 2.2,3.3,4.5,10.1)。
 */
import { describe, expect, it } from "vitest";
import {
  CreateSessionRequestSchema,
  PromptRequestSchema,
} from "@pi-web/protocol";
import { validateBody } from "../../src/http/validate.js";
import type { ErrorBody } from "../../src/http/error-map.js";

function jsonReq(body: unknown): Request {
  return new Request("http://x/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("validateBody", () => {
  it("returns typed value for a valid CreateSessionRequest", async () => {
    const res = await validateBody(
      jsonReq({ source: "./agent", cwd: "/tmp" }),
      CreateSessionRequestSchema,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.source).toBe("./agent");
  });

  it("400 with field path when source is missing", async () => {
    const res = await validateBody(jsonReq({ cwd: "/tmp" }), CreateSessionRequestSchema);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(400);
      const body = (await res.response.json()) as ErrorBody;
      expect(body.error.code).toBe("VALIDATION_FAILED");
      expect(body.error.fields).toContain("source");
    }
  });

  it("400 when field type is wrong", async () => {
    const res = await validateBody(
      jsonReq({ message: 123 }),
      PromptRequestSchema,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(400);
      const body = (await res.response.json()) as ErrorBody;
      expect(body.error.fields).toContain("message");
    }
  });

  it("400 INVALID_JSON for malformed body", async () => {
    const req = new Request("http://x/sessions", {
      method: "POST",
      body: "{not json",
    });
    const res = await validateBody(req, CreateSessionRequestSchema);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(400);
      const body = (await res.response.json()) as ErrorBody;
      expect(body.error.code).toBe("INVALID_JSON");
    }
  });
});
